// Pace zones from VO₂max (Daniels' oxygen cost of running) and heart-rate zones from LTHR.

/** Velocity (m/min) at VO₂max: solve −4.60 + 0.182258·v + 0.000104·v² = VO₂max. */
export function vVO2max(vo2max: number): number {
  let lo = 100, hi = 500;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2;
    if (-4.6 + 0.182258 * v + 0.000104 * v * v < vo2max) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}

export type Zone = "easy" | "marathon" | "half" | "threshold" | "interval";
export type Paces = Record<Zone, number>;   // sec/km

/** Pace for each zone as a share of the speed at VO₂max. `easy` is the top of the easy range. */
export function paceZones(vo2max: number): Paces {
  const v = vVO2max(vo2max);
  const p = (f: number) => Math.round(60000 / (v * f));
  const marathon = p(0.81);
  return { easy: p(0.72), marathon, half: Math.round((marathon * 0.81) / 0.85), threshold: p(0.88), interval: p(0.97) };
}

/** Easy ceiling and zone cut-offs from lactate-threshold heart rate. */
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
