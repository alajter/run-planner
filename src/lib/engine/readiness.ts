// Readiness: a 0–100 score, ported from run-coach (server/services/recovery.js). Four parts, each
// 0–100, weighted over the parts that have a reading: last night's sleep 40 %, HRV against its 28-day
// average 30 %, resting HR against its 28-day average 20 %, yesterday's load 10 %. 70+ is good to go,
// 40–69 go easier, under 40 rest.

export type Verdict = "green" | "amber" | "red";
export interface Night { date: string; total: number; deep: number | null; rem: number | null; awake: number | null }
export interface Baselined { value: number; baseline: number; n: number }
export interface ReadinessInput {
  sleep: Night | null;                         // last night only
  hrv: Baselined | null; rhr: Baselined | null;
  load: { yesterday: number; avg: number } | null;   // TRIMP yesterday, and the mean of the last 7 days that had load
  band?: [number, number] | null;              // Runalyze's HRV normal range, shown for context
}
export type PartKey = "sleep" | "hrv" | "rhr" | "load";
/** How much a part needs attention, judged on the reading itself rather than the strict 0–100 score:
 *  ok, watch (a small dip inside normal day-to-day variation), act (outside the normal range). */
export type Level = "ok" | "watch" | "act";
export interface Part { key: PartKey; name: string; score: number; weight: number; detail: string; level: Level }
export interface Reason { key: PartKey; level: Exclude<Level, "ok">; text: string }
export interface Readiness {
  verdict: Verdict; word: string; advice: string;
  score: number | null; parts: Part[]; reasons: Reason[];
  /** true when something is off but every part is still only a small dip */
  onlySmallDips: boolean;
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

/** Sleep 0–100: duration 40 (7 h+ full, under 5 h none), deep 30 and REM 20 (20 %+ full), awake 10 (≤ 10 min full, 30+ none). */
export function sleepScore(n: Night): number {
  const h = n.total / 60;
  let x = h >= 7 ? 40 : h >= 5 ? ((h - 5) / 2) * 40 : 0;
  const pct = (m: number | null) => (n.total > 0 ? ((m ?? 0) / n.total) * 100 : 0);
  x += Math.min(1, pct(n.deep) / 20) * 30;
  x += Math.min(1, pct(n.rem) / 20) * 20;
  const aw = n.awake ?? 0;
  x += aw <= 10 ? 10 : aw <= 30 ? ((30 - aw) / 20) * 10 : 0;
  return clamp(x);
}
/** HRV 0–100: +10 % over the 28-day average or more = 100, −20 % or worse = 0. */
export const hrvScore = (h: Baselined) => clamp((((h.value - h.baseline) / h.baseline) * 100 + 20) / 30 * 100);
/** Resting HR 0–100: 3 bpm under the 28-day average or more = 100, 5 bpm over or more = 0. */
export const rhrScore = (r: Baselined) => clamp(((5 - (r.value - r.baseline)) / 8) * 100);
/** Yesterday's load 0–100: rest or half a usual day = 100, twice a usual day = 20. */
export function loadScore(l: { yesterday: number; avg: number }): number {
  if (l.yesterday <= 0 || l.avg <= 0) return 100;   // run-coach assumed 80 with no data; a rest day is full marks here
  const r = l.yesterday / l.avg;
  return r <= 0.5 ? 100 : r >= 2 ? 20 : clamp(100 - ((r - 0.5) / 1.5) * 80);
}

export function readiness(i: ReadinessInput): Readiness {
  const parts: Part[] = [];
  const reasons: Reason[] = [];
  const pc = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)} %`;
  const lvl = (score: number, act: boolean): Level => act ? "act" : score < 50 ? "watch" : "ok";
  const note = (key: PartKey, level: Level, text: string) => { if (level !== "ok") reasons.push({ key, level, text }); };

  if (i.sleep) {
    const score = sleepScore(i.sleep);
    const level: Level = score < 40 ? "act" : score < 70 ? "watch" : "ok";
    const detail = `${hm(i.sleep.total)}${i.sleep.deep != null ? ` · deep ${Math.round((i.sleep.deep / i.sleep.total) * 100)} %` : ""}${i.sleep.rem != null ? ` · REM ${Math.round((i.sleep.rem / i.sleep.total) * 100)} %` : ""}${i.sleep.awake ? ` · ${Math.round(i.sleep.awake)} min awake` : ""}`;
    parts.push({ key: "sleep", name: "Sleep", weight: 0.4, score, detail, level });
    note("sleep", level, `Sleep was ${i.sleep.total < 420 ? "short" : "light"}: ${detail}.`);
  }
  if (i.hrv && i.hrv.n >= 7) {
    const h = i.hrv, score = hrvScore(h), pct = ((h.value - h.baseline) / h.baseline) * 100;
    const below = i.band ? h.value < i.band[0] : false;
    const level = lvl(score, below || pct <= -20);
    const band = i.band ? `Runalyze band ${Math.round(i.band[0])}–${Math.round(i.band[1])}` : "";
    parts.push({ key: "hrv", name: "HRV", weight: 0.3, score, level,
      detail: `${Math.round(h.value)} ms · ${pc(pct)} on your 28-day ${Math.round(h.baseline)}${band ? ` · ${band}` : ""}` });
    note("hrv", level, `HRV is down ${Math.abs(Math.round(pct))} % on your usual ${Math.round(h.baseline)}: ${Math.round(h.value)} ms${
      i.band ? `, ${below ? "below" : "inside"} Runalyze's normal ${Math.round(i.band[0])}–${Math.round(i.band[1])}` : ""}.`);
  }
  if (i.rhr && i.rhr.n >= 7) {
    const r = i.rhr, score = rhrScore(r), d = r.value - r.baseline;
    const level = lvl(score, d >= 5);
    parts.push({ key: "rhr", name: "Resting HR", weight: 0.2, score, level,
      detail: `${Math.round(r.value)} bpm · ${d >= 0 ? "+" : ""}${d.toFixed(1)} on your 28-day ${r.baseline.toFixed(1)}` });
    note("rhr", level, `Resting HR is up ${d.toFixed(1)} bpm on your usual ${r.baseline.toFixed(1)}: ${Math.round(r.value)} bpm${d < 5 ? ", within a normal day's swing" : ""}.`);
  }
  if (i.load) {
    const score = loadScore(i.load);
    const level: Level = score < 40 ? "act" : score < 50 ? "watch" : "ok";
    const detail = i.load.yesterday > 0 ? `TRIMP ${Math.round(i.load.yesterday)} · a usual day is ${Math.round(i.load.avg)}` : "rest day";
    parts.push({ key: "load", name: "Yesterday", weight: 0.1, score, detail, level });
    note("load", level, `Yesterday was a heavy day: ${detail}.`);
  }
  const w = parts.reduce((a, p) => a + p.weight, 0);
  const score = w ? Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / w) : null;
  const onlySmallDips = reasons.length > 0 && reasons.every(r => r.level === "watch");
  const base = { score, parts, reasons, onlySmallDips };

  if (score == null) return { ...base, verdict: "green", word: "Good to go", advice: "No overnight readings: go by feel." };
  if (score >= 70) return { ...base, verdict: "green", word: "Good to go", advice: "Run the session as planned." };
  if (score >= 40) return { ...base, verdict: "amber", word: "Go easier", advice: "Keep it easy and short: drop the strides and anything fast." };
  return { ...base, verdict: "red", word: "Rest", advice: "Recovery is behind: rest today, or walk. The plan picks up tomorrow." };
}

/** Days of full rest until form (fitness − fatigue) is back to zero, Runalyze's 'rest days'. */
export function restDays(ctl: number, atl: number): number {
  if (ctl - atl >= 0) return 0;
  if (ctl <= 0) return 60;
  const t = Math.log(atl / ctl) / Math.log((41 / 43) / (6 / 8));
  return Math.min(Math.round(t * 10) / 10, 60);
}
