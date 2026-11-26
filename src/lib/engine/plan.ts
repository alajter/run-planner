// The plan, in km. Simple, visible rules: the long run steps up at most 10 % a week, the week is sized
// around the long run, every 4th week is a down week, the taper cuts volume and keeps intensity, and the
// load ratio (fatigue over fitness, from TRIMP) trims the easy runs when a week would rise faster than
// fitness can carry it. Weeks already run are read from the runs, not from the plan, so a missed or
// shortened week sizes the next ones from what really happened.
// Every constant names its source; "my choice" means there is none and it is untuned.
import { addDays, daysBetween } from "../dates";
import { KM_FACTOR, LOAD, step, weekRatio, type LoadState } from "./load";

export interface PlanSettings {
  race: { label: string; date: string; km: number; target: string };
  blockStart: string;          // first day of week 1 (always a week-start day)
  weekStartDow: number;        // the first day of the week: 0 = Sunday … 6 = Saturday
  longRunDow: number;          // the long run's day; the other runs follow it every second day
  longMaxKm: number;           // never longer than this before the race
  volumeHoldKm: number;        // weeks stay at or under this until 3 of the last 4 reached 95 % of it
  fourthRunAtLongKm: number;   // a 4th run joins once the long run has reached this
  minRunKm: number;
}

export const DEFAULT_SETTINGS: PlanSettings = {
  race: { label: "Riverside Half (fictional)", date: "2027-02-28", km: 21.1, target: "1:55" },
  blockStart: "2026-10-25", weekStartDow: 0, longRunDow: 0, longMaxKm: 18, volumeHoldKm: 40, fourthRunAtLongKm: 12, minRunKm: 4,
};

export const RULES = {
  // the "10 % rule": a common coaching heuristic, not a proven limit (a graded 10 % program did not lower
  // injuries in novice runners: Buist et al. 2008, Am J Sports Med)
  longStep: 1.10,              // long run ≤ +10 % over the longest of the last 4 weeks
  weekStep: 1.10,              // a week ≤ +10 % over the biggest of the last 4 weeks
  longShare3: 0.40,            // my choice, untuned: the long run's share of a 3-run week …
  longShare4: 0.35,            // … and of a 4-run week
  longShareMax: 0.45,          // my choice, untuned: when a cap holds the week, the long run may take up to this share;
                               // and once the long run is at its longest, the week holds at long ÷ this (or the last 4 weeks' biggest)
  // 3:1 step loading, three building weeks then one lighter, as in periodization texts (e.g. Bompa and Haff)
  downEvery: 4,                // every 4th week of Base and Build is a down week …
  downWeek: 0.80, downLong: 0.70,   // … at 80 % of the week and 70 % of the long run (my choice, untuned)
  // the taper: about two weeks, volume cut by 41–60 %, intensity kept (Bosquet et al. 2007, Med Sci Sports Exerc)
  taperWeeks: 2, taperWeek: [0.6, 0.45], taperLong: [0.6, 0.45],
  // one quality session a week. Daniels caps threshold running at 10 % and intervals at 8 % of the week;
  // the session is twice that, half of it warm-up, recoveries and cool-down (my choice)
  tempoShare: 0.20, intervalShare: 0.16,
  easyLadder: 1.11,            // my choice: each later easy run a little longer than the one before
  easyMaxOfLong: 0.85,         // my choice: no easy run longer than 85 % of the week's long run
  phaseBase: 0.40, phaseBuild: 0.35,   // my choice, untuned: the rest of the block before the taper is Peak
};

export type Kind = "long" | "easy" | "interval" | "tempo" | "race" | "rest";
export interface Session { date: string; kind: Kind; km: number; strides: boolean; note?: string }
export interface Week {
  n: number; start: string; phase: "Base" | "Build" | "Peak" | "Taper"; phaseWeek: number; down: boolean;
  km: number; longKm: number; runs: number; sessions: Session[]; past: boolean;
  binding: string;             // the rule that set this week's size
  limits: Limit[];             // every limit the week was checked against, the binding one marked
  ratio: number | null;        // the load ratio as laid (fatigue ÷ fitness over the week)
}
export interface RunDay { date: string; km: number }
/** Daily TRIMP as run (all sports), and TRIMP per easy km to cost the planned days. */
export interface LoadInput { daily: Map<string, number>; perKm: number }
export type LimitKey = "load_ratio" | "week_step" | "long_step" | "long_max" | "volume_hold";
export interface Limit { key: LimitKey; name: string; value: number; ceiling: number; unit: string; holds: boolean; why: string; warnAt?: number }

export const LIMIT_WHY: Record<LimitKey, string> = {
  load_ratio: "Fatigue against fitness over the week, both from Runalyze's TRIMP (7- and 42-day averages). Injury risk was lowest between 0.8 and 1.3 (Gabbett 2016), so over 1.3 the easy runs are trimmed, unless the week carries no more load than the last full week. The long run keeps its own ladder and never steps back.",
  week_step: "No week more than 10 % over the biggest of your last 4. The 10 % rule is a coaching heuristic, not a proven limit.",
  long_step: "The long run is the biggest single load of the week, so it grows at most 10 % over the longest of the last 4 weeks (the same heuristic).",
  long_max: "The longest long run before the race, from Settings (18 km by default, my choice).",
  volume_hold: "Weeks stay at or under this until 3 of the last 4 reached 95 % of it: the body settles at a volume before the next step.",
};

const r1 = (x: number) => Math.round(x * 10) / 10;
/** km to one decimal, a ratio to two */
export const rnd = (x: number, unit: string) => (unit === "km" ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100);

export function phases(totalWeeks: number) {
  const taper = RULES.taperWeeks;
  const rem = totalWeeks - taper;
  const base = Math.round(rem * RULES.phaseBase), build = Math.round(rem * RULES.phaseBuild);
  return { base, build, peak: rem - base - build, taper };
}

/** Sum of runs per calendar day. */
function byDay(runs: RunDay[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of runs) m.set(r.date, (m.get(r.date) ?? 0) + r.km);
  return m;
}

export function buildPlan(s: PlanSettings, runs: RunDay[], today: string, load?: LoadInput): Week[] {
  const total = Math.floor(daysBetween(s.blockStart, s.race.date) / 7) + 1;
  const ph = phases(total);
  const ran = byDay(runs);
  const perKm = load?.perKm ?? LOAD.defaultPerKm;
  const daily = load?.daily ?? new Map([...ran].map(([d, km]) => [d, km * perKm]));
  // fitness and fatigue at the block start, rolled from the first day with load, rest days = 0
  let state: LoadState = { ctl: 0, atl: 0 };
  const first = [...daily.keys()].sort()[0];
  if (first) for (let d = first; d < s.blockStart; d = addDays(d, 1)) state = step(state, daily.get(d) ?? 0);
  // a day's load: as run before today (and today once run), as laid after
  const dayLoad = (date: string, laid: Session[]) => date < today || (date === today && daily.has(date))
    ? daily.get(date) ?? 0
    : laid.filter(x => x.date === date).reduce((a, x) => a + x.km * perKm * (KM_FACTOR[x.kind] ?? 1), 0);
  const weekDays = (start: string, laid: Session[]) => [...Array(7)].map((_, i) => dayLoad(addDays(start, i), laid));
  // the last non-down week's TRIMP, for the progression floor; seeded with the week before the block
  let lastCharge = [...Array(7)].reduce((a, _, i) => a + (daily.get(addDays(s.blockStart, i - 7)) ?? 0), 0);
  const weekKm = (start: string) => [...Array(7)].reduce((a, _, i) => a + (ran.get(addDays(start, i)) ?? 0), 0);
  const weekLong = (start: string) => Math.max(0, ...[...Array(7)].map((_, i) => ran.get(addDays(start, i)) ?? 0));
  // the trailing windows: what was run (past weeks) or laid (later weeks), seeded with the 4 weeks before the block
  const histKm: number[] = [], histLong: number[] = [];
  for (let k = 4; k >= 1; k--) { const st = addDays(s.blockStart, -7 * k); histKm.push(weekKm(st)); histLong.push(weekLong(st)); }
  let lastKm = Math.max(...histKm), lastLong = Math.max(...histLong);   // the last non-down week
  let peakKm = 0, peakLong = 0, quality = 0;
  const weeks: Week[] = [];

  for (let n = 1; n <= total; n++) {
    const start = addDays(s.blockStart, 7 * (n - 1));
    const end = addDays(start, 6);
    const past = end < today;
    const [phase, pw] = n <= ph.base ? ["Base", n] as const
      : n <= ph.base + ph.build ? ["Build", n - ph.base] as const
      : n <= ph.base + ph.build + ph.peak ? ["Peak", n - ph.base - ph.build] as const
      : ["Taper", n - ph.base - ph.build - ph.peak] as const;
    const down = (phase === "Base" || phase === "Build") && pw % RULES.downEvery === 0;
    const t4km = Math.max(...histKm.slice(-4)), t4long = Math.max(...histLong.slice(-4));
    const runsN = t4long >= s.fourthRunAtLongKm - 0.05 ? 4 : 3;
    const share = runsN === 4 ? RULES.longShare4 : RULES.longShare3;
    let km: number, long: number, binding: string, holds: LimitKey | null = null;
    const heldBack = histKm.slice(-4).filter(x => x >= 0.95 * s.volumeHoldKm).length < 3;

    if (phase === "Taper") {
      const i = pw - 1;
      km = peakKm * RULES.taperWeek[i]; long = peakLong * RULES.taperLong[i]; binding = `taper ${Math.round(RULES.taperWeek[i] * 100)} % of peak`;
    } else if (down) {
      km = lastKm * RULES.downWeek; long = lastLong * RULES.downLong; binding = "down week";
    } else {
      long = Math.min(t4long * RULES.longStep, s.longMaxKm);
      [binding, holds] = long === s.longMaxKm ? ["longest long run", "long_max"] : ["long run +10 %", "long_step"];
      km = long / share;
      // once the long run is at its longest the week holds: 45 % of it, or the biggest of the last 4 weeks
      // if that is more, never less (my choice). Sized at the share alone, the week kept growing 10 % a
      // week until the taper, so the peak fell wherever the taper began
      if (long >= s.longMaxKm - 0.05) km = Math.min(km, Math.max(long / RULES.longShareMax, t4km));
      if (km > t4km * RULES.weekStep) { km = t4km * RULES.weekStep; [binding, holds] = ["week +10 %", "week_step"]; }
      if (heldBack && km > s.volumeHoldKm) { km = s.volumeHoldKm; [binding, holds] = [`weekly km cap ${s.volumeHoldKm}`, "volume_hold"]; }
      // a capped week keeps the long run's step while it fits in 45 % of the week (the easy runs give way);
      // past that it shrinks to 45 %, but never below the last full week's long run. Shrinking it to the
      // sizing share instead held it flat for as long as the cap lasted
      if (long > km * RULES.longShareMax + 0.05) long = Math.max(km * RULES.longShareMax, Math.min(long, lastLong));
    }
    km = r1(km); long = r1(long);

    // lay the days: the long run on its day, then every second day after it (Sun → Tue, Thu, Sat),
    // wrapped into this week
    const isRaceWeek = s.race.date >= start && s.race.date <= end;
    const longOff = (((s.longRunDow ?? s.weekStartDow) - s.weekStartDow) % 7 + 7) % 7;
    const offsets = (runsN === 4 ? [0, 2, 4, 6] : [0, 2, 4]).map(k => (longOff + k) % 7);
    const hasQuality = !down && !isRaceWeek && ((phase === "Build" && pw >= 2) || phase === "Peak" || (phase === "Taper"));
    const qKind: Kind = phase === "Taper" ? "tempo" : quality % 2 === 0 ? "interval" : "tempo";
    const qKm = hasQuality ? r1(Math.max(s.minRunKm, km * (qKind === "interval" ? RULES.intervalShare : RULES.tempoShare))) : 0;
    if (hasQuality) quality++;
    const easyDays = offsets.length - 1 - (hasQuality ? 1 : 0);
    const lay = (weekKm: number): Session[] => {
      const sessions: Session[] = [];
      const restKm = Math.max(0, weekKm - long - qKm);
      const weights = [...Array(easyDays)].map((_, i) => RULES.easyLadder ** i);
      const wsum = weights.reduce((a, b) => a + b, 0);
      let ei = 0;
      offsets.forEach((o, i) => {
        const date = addDays(start, o);
        if (i === 0) sessions.push({ date, kind: "long", km: long, strides: false });
        else if (hasQuality && i === 1) sessions.push({ date, kind: qKind, km: qKm, strides: false });
        else {
          const x = r1(Math.min(long * RULES.easyMaxOfLong, Math.max(isRaceWeek ? 3 : s.minRunKm, (restKm * weights[ei]) / wsum)));
          sessions.push({ date, kind: "easy", km: x, strides: false });
          ei++;
        }
      });
      sessions.sort((a, b) => a.date.localeCompare(b.date));
      // strides: on the last easy run, not on down weeks or race week
      const lastEasy = [...sessions].reverse().find(x => x.kind === "easy");
      if (lastEasy && !down && !isRaceWeek) lastEasy.strides = true;
      if (isRaceWeek) {
        const kept = sessions.filter(x => x.date < s.race.date);
        kept.push({ date: s.race.date, kind: "race", km: s.race.km, strides: false, note: s.race.label });
        return kept;
      }
      return sessions;
    };
    let sessions = lay(km);
    // the load ratio (building weeks still to run): over the cap, and carrying more load than the last full
    // week, the easy runs are trimmed until it fits or every easy run is at its minimum. A week that does not
    // grow is never trimmed, so a quiet month can't choke the weeks after it (my choice). A week already run
    // is what was run: trimming it would change only its label.
    const breach = (x: Session[]) => {
      const w = weekRatio(state, weekDays(start, x));
      return w.ratio > LOAD.cap + 1e-9 && w.charge > lastCharge;
    };
    if (!past && !down && phase !== "Taper" && breach(sessions)) {
      const floor = long + qKm + easyDays * s.minRunKm;
      let lo = floor, hi = km;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (breach(lay(mid))) hi = mid; else lo = mid; }
      km = r1(lo); sessions = lay(km);
      [binding, holds] = [`load ratio ${LOAD.cap} (easy runs trimmed)`, "load_ratio"];
    }
    const laid = r1(sessions.reduce((a, x) => a + x.km, 0));
    const wr = weekRatio(state, weekDays(start, sessions));
    const L = (key: LimitKey, name: string, value: number, ceiling: number, unit: string): Limit =>
      ({ key, name, value: rnd(value, unit), ceiling: rnd(ceiling, unit), unit, holds: holds === key, why: LIMIT_WHY[key] });
    const training = r1(sessions.filter(x => x.kind !== "race").reduce((a, x) => a + x.km, 0));   // the race is not training load
    const limits: Limit[] = [
      L("load_ratio", "Load ratio", wr.ratio, LOAD.cap, "×"),
      L("week_step", "Week size", training, t4km * RULES.weekStep, "km"),
      L("long_step", "Long-run step", long, t4long * RULES.longStep, "km"),
      L("long_max", "Longest long run", long, s.longMaxKm, "km"),
      ...(heldBack && phase !== "Taper" ? [L("volume_hold", "Weekly km cap", training, s.volumeHoldKm, "km")] : []),
    ];
    weeks.push({ n, start, phase, phaseWeek: pw, down, km: laid, longKm: long, runs: sessions.length, sessions, past, binding, limits, ratio: Math.round(wr.ratio * 100) / 100 });
    state = wr.end;

    // carry: a week already run counts as run; a week still ahead counts as laid
    const elapsed = start <= today;
    const wk = past ? weekKm(start) : elapsed ? Math.max(weekKm(start), laid) : laid;
    const wl = past ? weekLong(start) : elapsed ? Math.max(weekLong(start), long) : long;
    histKm.push(wk); histLong.push(wl);
    if (!down && phase !== "Taper") { lastCharge = wr.charge; lastKm = wk; lastLong = wl; peakKm = Math.max(peakKm, laid); peakLong = Math.max(peakLong, long); }
  }
  return weeks;
}
