// A run's debrief: did it do what was asked, how it went against your own recent runs. An easy run
// that ended with strides is judged on the easy part alone.
import type { Analysis } from "../analysis";
import type { Session } from "./plan";
import { fmtPace } from "./zones";

export interface RunRow {
  id: number; date: string; km: number; sec: number; hr: number | null; cadence: number | null;
  decoupling: number | null; temp: number | null; vo2: number | null; analysis: Analysis | null;
  datetime?: string | null;   // local start, "YYYY-MM-DD HH:MM…"
}
export interface Did { km: number; sec: number; pace: number; hr: number | null; cadence: number | null; decoupling: number | null; easyPart: boolean }
export interface Check { label: string; asked: string; did: string; ok: boolean; word: string }
export interface Line { text: string }
export interface Debrief { headline: string; ok: boolean; neutral: boolean; did: Did; checks: Check[]; keep: Line[]; change: Line[]; bpk: number | null; bpkMedian: number | null }

export const KM_TOL = 0.10;
export const BPK_MIN_KM = 4;
const EVEN = 3, FADE = 5, DC_OK = 5, DC_HIGH = 10, EFF = 2, CAD = 4;
export const HOT = 26, SUN_MIN = 20, SUN_FROM = 11, SUN_TO = 15, HEAT_SLACK = 5;

/** Hot enough to lift heart rate: 26 °C or more, or 20 °C or more in the midday sun (any part of the run in 11:00–15:00). */
export function heat(r: Pick<RunRow, "temp" | "sec" | "datetime">): "hot" | "sun" | null {
  if (r.temp == null) return null;
  if (r.temp >= HOT) return "hot";
  const m = r.datetime?.match(/[ T](\d{2}):(\d{2})/);
  if (!m || r.temp < SUN_MIN) return null;
  const start = +m[1] + +m[2] / 60, end = start + r.sec / 3600;
  return start < SUN_TO && end > SUN_FROM ? "sun" : null;
}

/** The run as the debrief reads it: the easy part when the run ended with strides. */
export function did(r: RunRow): Did {
  const e = r.analysis?.easy;
  if (e) return { km: e.km, sec: e.sec, pace: e.pace, hr: e.hr, cadence: e.cadence, decoupling: e.decoupling, easyPart: true };
  return { km: r.km, sec: r.sec, pace: r.km ? Math.round(r.sec / r.km) : 0, hr: r.hr, cadence: r.cadence, decoupling: r.decoupling, easyPart: false };
}

/** Heartbeats per km: average HR × minutes per km. Lower means more running per beat. */
export function bpk(r: RunRow): number | null {
  const d = did(r);
  return d.hr && d.km >= BPK_MIN_KM ? Math.round((d.hr * d.sec) / 60 / d.km) : null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

export function debrief(r: RunRow, asked: Session | null, easyCeiling: number, recent: RunRow[]): Debrief {
  const d = did(r);
  const checks: Check[] = [];
  if (asked && asked.km) {
    const ratio = d.km / asked.km;
    const ok = Math.abs(ratio - 1) <= KM_TOL;
    checks.push({ label: "Distance", asked: `${asked.km} km`, did: `${d.km.toFixed(1)} km`, ok,
      word: ok ? "as asked" : ratio < 1 ? "shorter than asked" : "longer than asked" });
  }
  const easyKind = !asked || asked.kind === "easy" || asked.kind === "long";
  if (easyKind && d.hr) {
    const ok = d.hr <= easyCeiling;
    checks.push({ label: "Effort", asked: `≤ ${easyCeiling} bpm`, did: `${d.hr} bpm`, ok, word: ok ? "easy, as asked" : "harder than asked" });
  }
  const keep: Line[] = [], change: Line[] = [];
  const h = r.analysis?.easy?.halves;
  if (h && d.km >= BPK_MIN_KM) {
    const delta = (100 * (h[1] - h[0])) / h[0];
    if (Math.abs(delta) <= EVEN) keep.push({ text: `Even pacing: ${fmtPace(h[0])} then ${fmtPace(h[1])}/km.` });
    else if (delta < 0) keep.push({ text: `Negative split: the second half ${Math.abs(delta).toFixed(0)} % faster.` });
    else if (delta >= FADE) change.push({ text: `The run faded: the second half ${delta.toFixed(0)} % slower. Start slower next time.` });
  }
  if (d.decoupling != null && d.km >= BPK_MIN_KM) {
    if (d.decoupling < DC_OK) keep.push({ text: `Heart rate held steady against pace: ${d.decoupling} % drift.` });
    else if (d.decoupling >= DC_HIGH) change.push({ text: `Heart rate drifted ${d.decoupling} % against pace: this distance is at the edge of your base.` });
  }
  if (easyKind && d.hr && d.hr > easyCeiling) change.push({ text: `Average ${d.hr} bpm, ${d.hr - easyCeiling} over the easy ceiling. Run by heart rate, not pace.` });
  const b = bpk(r);
  const med = median(recent.map(bpk).filter((x): x is number => x != null));
  if (b && med) {
    const pct = (100 * (b - med)) / med;
    if (pct <= -EFF) keep.push({ text: `More running per heartbeat: ${b} beats a km, ${Math.abs(pct).toFixed(0)} % under your recent median (${med}).` });
    else if (pct >= EFF) change.push({ text: `Each km cost more beats than usual: ${b}, ${pct.toFixed(0)} % over your recent median (${med}). Heat, sleep or tiredness show here first.` });
  }
  const cmed = median(recent.map(x => did(x).cadence).filter((x): x is number => x != null));
  if (d.cadence && cmed && Math.abs(d.cadence - cmed) >= CAD)
    (d.cadence > cmed ? keep : change).push({ text: `Cadence ${d.cadence} spm, ${d.cadence > cmed ? "higher" : "lower"} than your usual ${cmed}.` });
  const hot = heat(r);
  if (hot) change.push({ text: hot === "hot"
    ? `${r.temp}°C: warm enough to lift heart rate a few beats at the same pace.`
    : `${r.temp}°C in the midday sun: hotter than the thermometer says, enough to lift heart rate a few beats at the same pace.` });
  // a few beats over the ceiling in the heat is the heat, not a mistake: said plainly, not as a warning
  const failed = checks.filter(c => !c.ok);
  const heatOnly = !!hot && failed.length === 1 && failed[0].label === "Effort" && !!d.hr && d.hr - easyCeiling <= HEAT_SLACK;
  if (heatOnly) change.unshift(...change.splice(change.findIndex(x => x.text.includes("°C")), 1));
  const ok = failed.length === 0 || heatOnly;
  const headline = !asked ? "Extra run" : heatOnly ? "A touch hard: the heat" : ok ? "As asked" : failed.map(c => c.word).join(" · ");
  return { headline: headline[0].toUpperCase() + headline.slice(1), ok, neutral: heatOnly, did: d, checks, keep, change, bpk: b, bpkMedian: med };
}
