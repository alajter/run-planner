// What each page shows, read straight from the database and the engine. Server-side only.
import "server-only";
import { all, getSetting, one } from "./db";
import { addDays, daysBetween, today } from "./dates";
import { DEFAULT_SETTINGS, type PlanSettings, type Session, type Week } from "./engine/plan";
import { plannedWeeks } from "./planned";
import { readiness, restDays, type Baselined, type Night } from "./engine/readiness";
import { step, trimpPerKm, type LoadState } from "./engine/load";
import type { LoadInput } from "./engine/plan";
import { bpk, debrief, did, type RunRow } from "./engine/debrief";
import { fmtTime, hrZones, paceZones, parseTime, type Paces } from "./engine/zones";
import type { Analysis } from "./analysis";
import type { RCalculations, RPrognosis } from "./runalyze";
import { timeZone } from "./secrets";

export interface Profile { lthr: number }
export const DEFAULT_PROFILE: Profile = { lthr: 171 };

export async function settings() {
  await timeZone();
  const plan = await getSetting<PlanSettings>("plan", DEFAULT_SETTINGS);
  const profile = await getSetting<Profile>("profile", DEFAULT_PROFILE);
  return { plan: { ...DEFAULT_SETTINGS, ...plan, race: { ...DEFAULT_SETTINGS.race, ...plan.race } }, profile };
}

type DbRun = Omit<RunRow, "analysis"> & { analysis: string | null; title: string | null; datetime: string | null; hr_max: number | null; trimp: number | null };
const toRun = (r: DbRun): RunRow & { title: string | null; datetime: string | null; hr_max: number | null; trimp: number | null } =>
  ({ ...r, analysis: r.analysis ? (JSON.parse(r.analysis) as Analysis) : null });

export async function runs(from?: string) {
  const rows = await all<DbRun>(
    `SELECT id, date, datetime, title, km, sec, hr, hr_max, trimp, cadence, decoupling, temp, vo2, analysis FROM runs
     WHERE ignored=0 ${from ? "AND date>=?" : ""} ORDER BY date DESC, datetime DESC`, from ? [from] : []);
  return rows.map(toRun);
}

export async function snapshot() {
  const s = await one<{ date: string; calc: string; prognosis: string | null }>(
    `SELECT date, calc, COALESCE(prognosis, (SELECT prognosis FROM snapshots WHERE prognosis IS NOT NULL ORDER BY date DESC LIMIT 1)) AS prognosis
     FROM snapshots ORDER BY date DESC LIMIT 1`);
  return s ? { date: s.date, calc: JSON.parse(s.calc) as RCalculations, prognosis: s.prognosis ? (JSON.parse(s.prognosis) as RPrognosis) : null } : null;
}

export function racePrediction(p: RPrognosis | null, km: number): number | null {
  const d = p?.distances?.find(x => Math.abs(x.distance - km) < 0.2);
  return d?.prognosis_seconds ?? null;
}

/** Daily TRIMP, all sports (a run not yet analysed is costed from its km), and TRIMP per easy km. */
export async function loadInput(t: string): Promise<LoadInput> {
  const rs = await all<{ date: string; km: number; trimp: number | null }>("SELECT date, km, trimp FROM runs WHERE ignored=0");
  const perKm = trimpPerKm(rs.filter(r => r.date >= addDays(t, -42)));
  const others = await all<{ date: string; trimp: number }>("SELECT date, trimp FROM loads WHERE trimp IS NOT NULL");
  const daily = new Map<string, number>();
  for (const r of rs) daily.set(r.date, (daily.get(r.date) ?? 0) + (r.trimp ?? r.km * perKm));
  for (const o of others) daily.set(o.date, (daily.get(o.date) ?? 0) + o.trimp);
  return { daily, perKm };
}

export type Status = "done" | "missed" | "today" | "planned";
export interface DaySession extends Session { status: Status; ran: { id: number; km: number; strides: number } | null }

/** The plan with each session matched to its run: the run on its day, else one a day either side
 *  (a Monday long run for a Sunday ask) when that day has no session of its own. */
export function matchWeek(w: Week, ranByDate: Map<string, { id: number; km: number; strides: number }>, t: string): DaySession[] {
  const asked = new Set(w.sessions.map(s => s.date));
  const used = new Set<string>();
  const exact = w.sessions.map(s => { const r = ranByDate.get(s.date) ?? null; if (r) used.add(s.date); return r; });
  return w.sessions.map((s, i) => {
    let ran = exact[i];
    if (!ran && s.date <= t) {
      for (const d of [addDays(s.date, 1), addDays(s.date, -1)]) {
        const r = ranByDate.get(d);
        if (r && !asked.has(d) && !used.has(d) && d <= t) { ran = r; used.add(d); break; }
      }
    }
    const status: Status = ran ? "done" : s.date < t ? "missed" : s.date === t ? "today" : "planned";
    return { ...s, status, ran };
  });
}

function ranByDate(rs: RunRow[]) {
  // km = the whole run; strides = the strides and walk-backs in it, which no session asks for
  const m = new Map<string, { id: number; km: number; strides: number }>();
  for (const r of [...rs].reverse()) {
    const prev = m.get(r.date);
    const st = r.analysis?.strides?.km ?? 0;
    m.set(r.date, { id: prev?.id ?? r.id, km: Math.round(((prev?.km ?? 0) + did(r).km + st) * 10) / 10,
      strides: Math.round(((prev?.strides ?? 0) + st) * 10) / 10 });
  }
  return m;
}

export async function planView() {
  const { plan: s, profile } = await settings();
  const t = today();
  const rs = await runs(addDays(s.blockStart, -35));
  const weeks = await plannedWeeks(s, rs, t, await loadInput(t));
  const by = ranByDate(rs);
  const snap = await snapshot();
  const paces: Paces | null = snap ? paceZones(snap.calc.effectiveVO2max) : null;
  const out = weeks.map(w => ({ ...w, days: matchWeek(w, by, t),
    ranKm: Math.round([...Array(7)].reduce((a, _, i) => a + (by.get(addDays(w.start, i))?.km ?? 0), 0) * 10) / 10,
    stridesKm: Math.round([...Array(7)].reduce((a, _, i) => a + (by.get(addDays(w.start, i))?.strides ?? 0), 0) * 10) / 10,
    current: w.start <= t && t <= addDays(w.start, 6) }));
  // the week in focus: this week, until every one of its runs is done; then the next one
  const cur = out.findIndex(w => w.current);
  const allDone = cur >= 0 && out[cur].days.length > 0 && out[cur].days.every(d => d.status === "done" || d.status === "missed");
  const focusIdx = cur < 0 ? -1 : allDone && cur + 1 < out.length ? cur + 1 : cur;
  out.forEach((w, i) => Object.assign(w, { focus: i === focusIdx }));
  // the block so far: what was asked up to today (today counts once it's run) against what was run
  const due = out.flatMap(w => w.days).filter(d => d.date < t || (d.date === t && d.status === "done"));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const end = s.race.date;
  const progress = {
    week: out.find(w => w.current)?.n ?? (t < s.blockStart ? 0 : out.length), weeks: out.length,
    daysIn: Math.max(0, daysBetween(s.blockStart, t)), days: daysBetween(s.blockStart, end),
    askedKm: r1(due.reduce((a, d) => a + d.km, 0)),
    ranKm: r1(out.filter(w => w.start <= t).reduce((a, w) => a + w.ranKm, 0)),
    stridesKm: r1(out.filter(w => w.start <= t).reduce((a, w) => a + w.stridesKm, 0)),
    sessions: due.length, done: due.filter(d => d.status === "done").length,
    totalKm: r1(out.reduce((a, w) => a + w.km, 0)),
    peak: out.reduce((a, w) => (w.km > a.km && w.phase !== "Taper" ? w : a), out[0]),
  };
  return {
    settings: s, today: t, paces, easyCeiling: hrZones(profile.lthr).easyCeiling, acwr: snap?.calc.acuteChronicWorkloadRatio ?? null,
    weeks: out as (typeof out[number] & { focus: boolean })[], progress,
  };
}

export interface Metric { key: "bpk" | "vo2" | "cadence" | "long"; name: string; unit: string; now: number | null; before: number | null;
  better: "down" | "up"; digits: number; series: (number | null)[]; note: string; why: string | null }

/** The four progress signals: the last 4 weeks against the 4 before, and a 12-week trend for each. Beats per
 *  km and cadence compare easy runs only (a faster run takes fewer beats per km without being fitter), every
 *  figure is a median so one odd run can't swing it, and a change needs 3 runs in each window. */
export async function progressMetrics(t: string, easyCeiling: number): Promise<Metric[]> {
  const rs = (await runs(addDays(t, -7 * 12 - 60))).reverse();
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const inRange = (from: string, to: string) => rs.filter(r => r.date >= from && r.date <= to);
  const easy = (r: typeof rs[number]) => { const d = did(r); return d.hr != null && d.hr <= easyCeiling + 3; };
  const vals: Record<Metric["key"], (xs: typeof rs) => number[]> = {
    bpk: xs => xs.filter(easy).map(bpk).filter((x): x is number => x != null),
    vo2: xs => xs.map(r => r.vo2).filter((x): x is number => x != null),
    cadence: xs => xs.filter(easy).map(r => did(r).cadence).filter((x): x is number => x != null),
    long: xs => xs.map(r => r.km),
  };
  const meta: [Metric["key"], string, string, Metric["better"], number, string, number, string][] = [
    ["bpk", "Beats per km", "", "down", 0, "easy runs of 4 km or more (the easy part when a run ends with strides); fewer = fitter", 3, "easy runs"],
    ["vo2", "VO₂max", "", "up", 1, "the runs' VO₂max, as Runalyze estimates it from heart rate and pace", 3, "runs"],
    ["cadence", "Easy cadence", "spm", "up", 0, "easy runs (heart rate at the easy ceiling or under)", 3, "easy runs"],
    ["long", "Long run", "km", "up", 1, "the longest run", 1, "runs"],
  ];
  return meta.map(([key, name, unit, better, digits, note, min, what]) => {
    const now = vals[key](inRange(addDays(t, -27), t)), before = vals[key](inRange(addDays(t, -55), addDays(t, -28)));
    const at = (xs: number[]) => (key === "long" ? (xs.length ? Math.max(...xs) : null) : med(xs));
    const enough = now.length >= min && before.length >= min;
    return {
      key, name, unit, better, digits, note: `${key === "long" ? "" : "median of "}${note}`,
      now: at(now), before: enough ? at(before) : null,
      why: enough ? null : before.length === 0 ? `no ${what} before` : `too few ${what} before (${before.length})`,
      series: [...Array(12)].map((_, i) => { const end = addDays(t, -7 * (11 - i)); return at(vals[key](inRange(addDays(end, -6), end))); }),
    };
  });
}

export async function todayView() {
  const { plan: s, profile } = await settings();
  const t = today();
  const pv = await planView();
  const week = pv.weeks.find(w => w.current) ?? null;
  const focusWeek = pv.weeks.find(w => w.focus) ?? week;
  const session = week?.days.find(d => d.date === t) ?? null;
  const next = pv.weeks.flatMap(w => w.days).find(d => d.date > t) ?? null;
  const snap = await snapshot();
  // readiness: last night's readings against their 28-day averages, and yesterday's load
  const baselined = async (kind: string): Promise<Baselined | null> => {
    const last = await one<{ date: string; value: number }>("SELECT date, value FROM markers WHERE kind=? AND date>=? ORDER BY date DESC LIMIT 1", [kind, addDays(t, -1)]);
    const b = await one<{ v: number | null; n: number }>("SELECT AVG(value) AS v, COUNT(*) AS n FROM markers WHERE kind=? AND date>?", [kind, addDays(t, -28)]);
    return last && b?.v ? { value: last.value, baseline: b.v, n: b.n } : null;
  };
  const night = await one<Night>("SELECT date, total, deep, rem, awake FROM nights WHERE date=?", [t]);
  const load = await loadInput(t);
  const week7 = [...Array(7)].map((_, i) => load.daily.get(addDays(t, -1 - i)) ?? 0).filter(x => x > 0);
  const rd = readiness({
    sleep: night, hrv: await baselined("hrv"), rhr: await baselined("rhr"),
    load: { yesterday: load.daily.get(addDays(t, -1)) ?? 0, avg: week7.length ? week7.reduce((a, b) => a + b, 0) / week7.length : 0 },
    band: snap?.calc.hrvNormalRange ?? null,
  });
  const latest = (await runs(addDays(t, -7)))[0] ?? null;
  const marker = async (kind: string) => one<{ date: string; value: number }>("SELECT date, value FROM markers WHERE kind=? ORDER BY date DESC LIMIT 1", [kind]);
  const rhr = await marker("rhr"), sleep = await marker("sleep");
  const rhrAvg = await one<{ v: number | null }>("SELECT AVG(value) AS v FROM markers WHERE kind='rhr' AND date>=?", [addDays(t, -6)]);
  // VO₂max: Runalyze's effective value, and the mean of the last 10 runs now and 4 weeks ago
  const withVo2 = (await runs(addDays(t, -150))).filter(r => r.vo2).reverse();
  const mean10 = (upto: string) => { const xs = withVo2.filter(r => r.date <= upto).slice(-10); return xs.length ? xs.reduce((a, r) => a + r.vo2!, 0) / xs.length : null; };
  const vNow = mean10(t), vThen = mean10(addDays(t, -28));
  const vo2 = { effective: snap?.calc.effectiveVO2max ?? null, last10: vNow, change: vNow != null && vThen != null ? vNow - vThen : null };
  const target = parseTime(s.race.target);
  const predicted = racePrediction(snap?.prognosis ?? null, s.race.km);
  // after today's run: its debrief, the rest days the load (today's run included) asks for, and the next run
  let after = null;
  if (latest && latest.date === t) {
    const asked = pv.weeks.flatMap(w => w.days).find(x => x.ran?.id === latest.id) ?? (session && !session.ran ? session : null);
    const recent = (await runs(addDays(t, -42))).filter(x => x.date < t && x.km >= 4);
    const days = [...load.daily.keys()].sort();
    let st: LoadState = { ctl: 0, atl: 0 };
    for (let d = days[0]; d && d <= t; d = addDays(d, 1)) st = step(st, load.daily.get(d) ?? 0);
    const rest = restDays(st.ctl, st.atl);
    after = { asked, debrief: debrief(latest, asked, hrZones(profile.lthr).easyCeiling, recent), restDays: rest,
              nextIn: next ? daysBetween(t, next.date) : null };
  }
  return {
    after,
    today: t, settings: s, easyCeiling: hrZones(profile.lthr).easyCeiling, paces: pv.paces,
    session, next, week, focusWeek, acwr: pv.acwr, readiness: rd, progress: pv.progress, vo2,
    metrics: await progressMetrics(t, hrZones(profile.lthr).easyCeiling),
    overnight: {
      rhr: rhr ? { value: rhr.value, date: rhr.date, avg7: rhrAvg?.v ? Math.round(rhrAvg.v * 10) / 10 : null } : null,
      sleep: sleep ? { minutes: sleep.value, date: sleep.date, lastNight: sleep.date === t } : null,
      restDays: snap ? Math.round(snap.calc.restDays * 10) / 10 : null,
    },
    latest: latest ? { id: latest.id, date: latest.date, did: did(latest), strides: latest.analysis?.strides ?? null, km: latest.km } : null,
    race: { label: s.race.label, date: s.race.date, days: daysBetween(t, s.race.date), target: s.race.target,
            predicted: predicted ? fmtTime(predicted) : null, marginS: predicted && target ? target - predicted : null },
  };
}

export async function runsView(month?: string) {
  await timeZone();
  const t = today();
  const m = month || t.slice(0, 7);
  const rows = (await runs(`${m}-01`)).filter(r => r.date.slice(0, 7) === m);
  return { month: m, runs: rows.map(r => ({ id: r.id, date: r.date, title: r.title, km: r.km, did: did(r), bpk: bpk(r), strides: r.analysis?.strides?.n ?? 0 })) };
}

export async function runView(id: number) {
  const { plan: s, profile } = await settings();
  const r = await one<DbRun & { ignored: number }>(`SELECT id, date, datetime, title, km, sec, hr, hr_max, trimp, cadence, decoupling, temp, vo2, analysis, ignored FROM runs WHERE id=?`, [id]);
  if (!r) return null;
  const run = toRun(r);
  const weeks = await plannedWeeks(s, await runs(addDays(s.blockStart, -35)), today(), await loadInput(today()));
  const by = ranByDate(await runs(addDays(s.blockStart, -35)));
  const asked = weeks.flatMap(w => matchWeek(w, by, today())).find(x => x.ran?.id === run.id || (!x.ran && x.date === run.date)) ?? null;
  const recent = (await runs(addDays(run.date, -42))).filter(x => x.date < run.date && x.km >= 4);
  const ceiling = hrZones(profile.lthr).easyCeiling;
  return { run, asked, debrief: debrief(run, asked, ceiling, recent), easyCeiling: ceiling, ignored: !!r.ignored, ...traces(run.analysis) };
}

/** Pace, HR and beats per km over the run (300 m rolling, so a GPS wobble doesn't spike the line), and km splits. */
function traces(a: Analysis | null) {
  const s = a?.series ?? [];
  const roll = s.map((_, i) => {
    const w = s.slice(Math.max(0, i - 1), i + 2);
    const km = w.length * 0.1, sec = w.reduce((x, p) => x + p[1], 0);
    const hrs = w.filter(p => p[2] > 0);
    const hr = hrs.length ? hrs.reduce((x, p) => x + p[2] * p[1], 0) / hrs.reduce((x, p) => x + p[1], 0) : null;
    return { x: s[i][0], pace: sec / km, hr, bpk: hr ? (hr * sec) / 60 / km : null };
  });
  const splits: { km: number; dist: number; sec: number; pace: number; hr: number | null; bpk: number | null; cadence: number | null; strides: boolean }[] = [];
  const cut = a?.easy && a.strides ? a.easy.km : null;
  for (let k = 0; k * 10 < s.length; k++) {
    const w = s.slice(k * 10, k * 10 + 10);
    const dist = w.at(-1)![0] - (k ? s[k * 10 - 1][0] : 0);
    if (dist < 0.3) continue;   // a last stub under 300 m isn't a split
    const sec = w.reduce((x, p) => x + p[1], 0);
    const hw = w.filter(p => p[2] > 0), cw = w.filter(p => p[3] > 0);
    const hr = hw.length ? Math.round(hw.reduce((x, p) => x + p[2] * p[1], 0) / hw.reduce((x, p) => x + p[1], 0)) : null;
    splits.push({ km: k + 1, dist: Math.round(dist * 100) / 100, sec, pace: Math.round(sec / dist), hr,
      bpk: hr ? Math.round((hr * sec) / 60 / dist) : null,
      cadence: cw.length ? Math.round(cw.reduce((x, p) => x + p[3], 0) / cw.length) : null,
      strides: cut != null && w.at(-1)![0] > cut + 0.05 });
  }
  return { trace: roll, cut, splits };
}

export async function progressView() {
  await timeZone();
  const t = today();
  const rs = (await runs(addDays(t, -365))).reverse();
  // per run: VO₂max and beats per km; the 28-day median of beats per km as the smoothed line
  const points = rs.map(r => ({ date: r.date, vo2: r.vo2, bpk: bpk(r), km: r.km }));
  const smooth = points.map(p => {
    const win = points.filter(q => q.bpk && q.date <= p.date && q.date > addDays(p.date, -28)).map(q => q.bpk!).sort((a, b) => a - b);
    return { date: p.date, bpk: win.length ? win[win.length >> 1] : null };
  });
  // weekly km, last 16 weeks
  const { plan: s } = await settings();
  const weeks: { start: string; km: number }[] = [];
  const wsDow = s.weekStartDow;
  let start = addDays(t, -((new Date(`${t}T12:00:00Z`).getUTCDay() - wsDow + 7) % 7));
  for (let i = 0; i < 16; i++, start = addDays(start, -7)) {
    const km = rs.filter(r => r.date >= start && r.date <= addDays(start, 6)).reduce((a, r) => a + r.km, 0);
    weeks.unshift({ start, km: Math.round(km * 10) / 10 });
  }
  const snaps = (await all<{ date: string; calc: string; prognosis: string | null }>("SELECT * FROM snapshots ORDER BY date"))
    .map(x => ({ date: x.date, calc: JSON.parse(x.calc) as RCalculations, pred: racePrediction(x.prognosis ? JSON.parse(x.prognosis) : null, s.race.km) }));
  const { profile } = await settings();
  return { points, smooth, weeks, snaps, race: s.race, target: parseTime(s.race.target), metrics: await progressMetrics(t, hrZones(profile.lthr).easyCeiling) };
}
