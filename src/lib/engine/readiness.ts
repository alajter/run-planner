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
export interface Part { key: PartKey; name: string; score: number; weight: number; detail: string }
export interface Readiness {
  verdict: Verdict; word: string; advice: string;
  score: number | null; parts: Part[]; reasons: string[];
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
  const pc = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)} %`;
  if (i.sleep) parts.push({ key: "sleep", name: "Sleep", weight: 0.4, score: sleepScore(i.sleep),
    detail: `${hm(i.sleep.total)}${i.sleep.deep != null ? ` · deep ${Math.round((i.sleep.deep / i.sleep.total) * 100)} %` : ""}${i.sleep.rem != null ? ` · REM ${Math.round((i.sleep.rem / i.sleep.total) * 100)} %` : ""}${i.sleep.awake ? ` · ${Math.round(i.sleep.awake)} min awake` : ""}` });
  if (i.hrv && i.hrv.n >= 7) parts.push({ key: "hrv", name: "HRV", weight: 0.3, score: hrvScore(i.hrv),
    detail: `${Math.round(i.hrv.value)} ms · ${pc(((i.hrv.value - i.hrv.baseline) / i.hrv.baseline) * 100)} on your 28-day ${Math.round(i.hrv.baseline)}${i.band ? ` · Runalyze band ${Math.round(i.band[0])}–${Math.round(i.band[1])}` : ""}` });
  if (i.rhr && i.rhr.n >= 7) parts.push({ key: "rhr", name: "Resting HR", weight: 0.2, score: rhrScore(i.rhr),
    detail: `${Math.round(i.rhr.value)} bpm · ${i.rhr.value - i.rhr.baseline >= 0 ? "+" : ""}${(i.rhr.value - i.rhr.baseline).toFixed(1)} on your 28-day ${i.rhr.baseline.toFixed(1)}` });
  if (i.load) parts.push({ key: "load", name: "Yesterday", weight: 0.1, score: loadScore(i.load),
    detail: i.load.yesterday > 0 ? `TRIMP ${Math.round(i.load.yesterday)} · a usual day is ${Math.round(i.load.avg)}` : "rest day" });
  const w = parts.reduce((a, p) => a + p.weight, 0);
  const score = w ? Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / w) : null;

  // the reasons: the parts pulling the score down
  const reasons = parts.filter(p => p.score < 50).map(p => `${p.name} is low (${p.score}): ${p.detail}.`);
  if (score == null) return { verdict: "green", word: "Good to go", score, parts, reasons,
    advice: "No overnight readings: go by feel." };
  if (score >= 70) return { verdict: "green", word: "Good to go", score, parts, reasons,
    advice: "Run the session as planned." };
  if (score >= 40) return { verdict: "amber", word: "Go easier", score, parts, reasons,
    advice: "Keep it easy and short: drop the strides and anything fast." };
  return { verdict: "red", word: "Rest", score, parts, reasons,
    advice: "Recovery is behind: rest today, or walk. The plan picks up tomorrow." };
}

/** Days of full rest until form (fitness − fatigue) is back to zero, Runalyze's 'rest days'. */
export function restDays(ctl: number, atl: number): number {
  if (ctl - atl >= 0) return 0;
  if (ctl <= 0) return 60;
  const t = Math.log(atl / ctl) / Math.log((41 / 43) / (6 / 8));
  return Math.min(Math.round(t * 10) / 10, 60);
}
