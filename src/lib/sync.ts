// Pull from Runalyze: runs (with each new run's analysis), the overnight markers, and today's
// calculations and prognosis. Idempotent: run it as often as you like.
import { all, getSetting, one, run, setSetting } from "./db";
import { addDays, today } from "./dates";
import { Runalyze, type RActivity, type RCalculations, type RDetail, type RPrognosis } from "./runalyze";
import { analyze, ANALYSIS_VERSION } from "./analysis";
import { runalyzeToken, timeZone } from "./secrets";

const HISTORY_DAYS = 400;     // the first sync reaches back this far (trends need a year)
const REFRESH_DAYS = 14;      // later syncs re-read this window (edits on Runalyze land here)
const WINDOW_DAYS = 90;       // one list call covers this many days
const MARKER_DAYS = 60;
const ANALYZE_PER_SYNC = 12;  // stream reads per sync: keeps a sync inside a serverless time budget
const OTHER_PER_SYNC = 20;    // other sports' TRIMP reads per sync
const RUN_SPORTS = new Set(["Running"]);

export interface SyncResult { runs: number; analyzed: number; markers: number; snapshot: boolean; errors: string[] }

export async function sync(opts: { full?: boolean; analyzeLimit?: number } = {}): Promise<SyncResult> {
  await timeZone();
  const r = new Runalyze((await runalyzeToken()).token);
  const t = today();
  const res: SyncResult = { runs: 0, analyzed: 0, markers: 0, snapshot: false, errors: [] };
  const newest = await one<{ d: string | null }>("SELECT MAX(date) AS d FROM runs");
  const from = opts.full || !newest?.d ? addDays(t, -HISTORY_DAYS) : addDays(newest.d, -REFRESH_DAYS);

  // 1 runs, newest window first
  for (let end = t; end >= from; end = addDays(end, -WINDOW_DAYS)) {
    const start = addDays(end, -(WINDOW_DAYS - 1)) < from ? from : addDays(end, -(WINDOW_DAYS - 1));
    try {
      const { items } = await r.call<{ items: RActivity[] }>("get_activities", { start_date: start, end_date: end, limit: 200 });
      for (const a of items ?? []) {
        if (!RUN_SPORTS.has(a.sport)) {
          // another sport: kept for its TRIMP (read below), which fitness and fatigue count
          await run(`INSERT INTO loads (id, date, sport) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date, sport=excluded.sport`,
            [a.id, a.date, a.sport]);
          continue;
        }
        if (!a.distance || !a.duration) continue;
        await run(
          `INSERT INTO runs (id, date, datetime, title, type, km, sec, hr, hr_max, vo2) VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET date=excluded.date, datetime=excluded.datetime, title=excluded.title,
             type=excluded.type, km=excluded.km, sec=excluded.sec, hr=excluded.hr, hr_max=excluded.hr_max, vo2=excluded.vo2`,
          [a.id, a.date, a.datetime, a.title, a.type, a.distance, a.duration, a.average_heart_rate, a.maximum_heart_rate,
           a.effective_vo2max]);
        res.runs++;
      }
    } catch (e) {
      res.errors.push(`runs ${start}..${end}: ${(e as Error).message}`);
    }
  }

  // 2 analysis: new runs first (details + streams), a few per sync
  const todo = await all<{ id: number }>(
    "SELECT id FROM runs WHERE analysis IS NULL OR json_extract(analysis, '$.v') < ? ORDER BY date DESC LIMIT ?",
    [ANALYSIS_VERSION, opts.analyzeLimit ?? ANALYZE_PER_SYNC]);
  for (const { id } of todo) {
    try {
      const det = await r.call<{ activity?: RDetail } & RDetail>("get_activity_details", {
        activity_id: id, include_streams: true, stream_fields: ["distance", "time", "heart_rate", "cadence"], max_stream_points: 20000 });
      const a: RDetail = det.activity ?? det;
      const an = analyze(a.streams ?? {});
      const cad = a.cadence != null ? a.cadence * (a.cadence_display_factor || 1) : null;
      await run(`UPDATE runs SET trimp=?, cadence=?, decoupling=?, temp=?, analysis=?, analyzed_at=? WHERE id=?`,
        [a.trimp, cad, a.aerobic_decoupling_pace, a.temperature, JSON.stringify(an), new Date().toISOString(), id]);
      res.analyzed++;
    } catch (e) {
      res.errors.push(`analyze ${id}: ${(e as Error).message}`);
    }
  }

  // 2b other sports' TRIMP (no streams: a light call each)
  const others = await all<{ id: number }>("SELECT id FROM loads WHERE trimp IS NULL ORDER BY date DESC LIMIT ?",
    [opts.full ? 400 : OTHER_PER_SYNC]);
  for (const { id } of others) {
    try {
      const det = await r.call<{ activity?: RDetail } & RDetail>("get_activity_details", { activity_id: id });
      await run("UPDATE loads SET trimp=? WHERE id=?", [(det.activity ?? det).trimp ?? 0, id]);
    } catch (e) {
      res.errors.push(`load ${id}: ${(e as Error).message}`);
    }
  }

  // 3 overnight markers
  const mFrom = addDays(t, -MARKER_DAYS);
  interface MarkerItem { date?: string; hrv?: number; heart_rate?: number; duration?: number; is_nap?: boolean;
    deep_sleep_duration?: number; rem_duration?: number; light_sleep_duration?: number; awake_duration?: number }
  const markers: [string, string, (x: MarkerItem) => number | null | undefined][] = [
    ["hrv", "get_hrv_trend", x => x.hrv],
    ["rhr", "get_resting_heart_rate_trend", x => x.heart_rate],
    ["sleep", "get_sleep_summary", x => (x.is_nap ? null : x.duration)],
  ];
  for (const [kind, tool, val] of markers) {
    try {
      const { items } = await r.call<{ items: MarkerItem[] }>(tool, { start_date: mFrom, end_date: t });
      for (const x of items ?? []) {
        const v = val(x);
        if (v == null || !x.date) continue;
        // sleep: dated by the morning the night ended; a split night keeps its longest entry
        await run(`INSERT INTO markers (kind, date, value) VALUES (?,?,?)
                   ON CONFLICT(kind, date) DO UPDATE SET value=${kind === "sleep" ? "MAX(value, excluded.value)" : "excluded.value"}`,
          [kind, x.date, v]);
        res.markers++;
        if (kind === "sleep") {
          // the stages of the night's longest entry
          await run(`INSERT INTO nights (date, total, deep, rem, light, awake) VALUES (?,?,?,?,?,?)
                     ON CONFLICT(date) DO UPDATE SET total=excluded.total, deep=excluded.deep, rem=excluded.rem,
                       light=excluded.light, awake=excluded.awake WHERE excluded.total >= nights.total`,
            [x.date, v, x.deep_sleep_duration ?? null, x.rem_duration ?? null, x.light_sleep_duration ?? null, x.awake_duration ?? null]);
        }
      }
    } catch (e) {
      res.errors.push(`${kind}: ${(e as Error).message}`);
    }
  }

  // 4 today's calculations and prognosis
  try {
    const calc = await r.call<RCalculations>("get_calculations");
    let prog: RPrognosis | null = null;
    try { prog = await r.call<RPrognosis>("get_prognosis"); }
    catch (e) { res.errors.push(`prognosis: ${(e as Error).message}`); }
    // a failed prognosis call keeps the day's earlier one
    await run(`INSERT INTO snapshots (date, calc, prognosis) VALUES (?,?,?)
               ON CONFLICT(date) DO UPDATE SET calc=excluded.calc, prognosis=COALESCE(excluded.prognosis, snapshots.prognosis)`,
      [t, JSON.stringify(calc), prog ? JSON.stringify(prog) : null]);
    res.snapshot = true;
  } catch (e) {
    res.errors.push(`calculations: ${(e as Error).message}`);
  }

  await run("INSERT OR REPLACE INTO sync_log (at, ok, summary) VALUES (?,?,?)",
    [new Date().toISOString(), res.errors.length ? 0 : 1, JSON.stringify(res)]);
  await setSetting("last_sync", new Date().toISOString());
  return res;
}

export async function lastSync(): Promise<string | null> {
  return getSetting<string | null>("last_sync", null);
}
