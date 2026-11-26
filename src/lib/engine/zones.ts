// Pace zones from VO₂max and heart-rate zones from lactate-threshold heart rate.
//
// Paces use Daniels and Gilbert's oxygen cost of running, VO₂ = −4.60 + 0.182258·v + 0.000104·v² (v in m/min),
// and the intensity ranges in Daniels' Running Formula, as shares of VO₂max. Race paces use Daniels and
// Gilbert's curve of the share of VO₂max a runner can hold for t minutes.

/** Oxygen cost (ml/kg/min) of running at v m/min. */
export const oxygenCost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;

/** Speed (m/min) whose oxygen cost is a share `f` of VO₂max. */
export function speedAt(vo2max: number, f: number): number {
  let lo = 30, hi = 600;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2;
    if (oxygenCost(v) < vo2max * f) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}

/** Velocity (m/min) at VO₂max. */
export const vVO2max = (vo2max: number) => speedAt(vo2max, 1);

/** Daniels and Gilbert: the share of VO₂max that can be held for t minutes. */
export const sustainable = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

/** Predicted race time (seconds) over `km` for a VO₂max: the time t at which the race pace costs exactly what can be held for t. */
export function raceTime(vo2max: number, km: number): number {
  let lo = 1, hi = 600;   // minutes
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    const cost = oxygenCost((km * 1000) / t);
    if (cost > vo2max * sustainable(t)) lo = t; else hi = t;
  }
  return Math.round(((lo + hi) / 2) * 60);
}

export type Zone = "marathon" | "half" | "threshold" | "interval";
/** sec/km. Easy is a range, not one pace: anywhere in it is easy. */
export type Paces = Record<Zone, number> & { easy: { fast: number; slow: number } };

/** Pace for each zone. Easy is Daniels' whole easy range, 59–74 % of VO₂max (its fast end alone reads as a
 *  target and is quicker than most easy running); threshold and interval are the middle of his 83–88 % and
 *  95–100 % ranges; marathon and half are race paces from Daniels and Gilbert. */
export function paceZones(vo2max: number): Paces {
  const p = (f: number) => Math.round(60000 / speedAt(vo2max, f));
  return {
    easy: { fast: p(0.74), slow: p(0.59) },
    marathon: Math.round(raceTime(vo2max, 42.195) / 42.195),
    half: Math.round(raceTime(vo2max, 21.0975) / 21.0975),
    threshold: p(0.855),
    interval: p(0.975),
  };
}

/** Easy ceiling and zone cut-offs from lactate-threshold heart rate: Friel's running zones
 *  (zone 1 under 85 % of LTHR, then 85–89, 90–94, 95–99 %). */
export function hrZones(lthr: number) {
  const c = [0.85, 0.9, 0.95, 1].map(f => Math.round(lthr * f));
  return { easyCeiling: c[0], cuts: c };
}

export function fmtPace(sec: number | null | undefined): string {
  if (!sec) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

export function parseTime(t: string): number | null {
  const parts = t.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0) * (parts.length === 2 ? 60 : 1);   // "1:59" = h:mm
}
