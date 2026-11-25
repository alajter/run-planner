// Fitness, fatigue and the load ratio. The model and its constants follow Sparing Horse
// (https://github.com/dros74/sparinghorse, Duarte Rosado, AGPL-3.0): "the earlier planner" below.
// Load is Runalyze's TRIMP per calendar day, all sports. Fitness (CTL) and fatigue (ATL) are
// exponentially weighted averages over 42 and 7 days, with alpha = 2 / (N + 1) as Runalyze uses.
// The planning ratio is "shape-neutral": the week's mean fatigue over its mean fitness, with fitness
// counted as at least 45 so a quiet month doesn't choke the weeks after it.

export const LOAD = {
  tauCtl: 42, tauAtl: 7,
  ctlFloor: 45,          // fitness counted as at least this
  softCap: 1.25,         // a week's mean fatigue ≤ 1.25 × its mean fitness …
  progFloor: 1.06,       // … unless the week carries no more than 1.06 × the last full week's load
  defaultPerKm: 15,      // TRIMP per easy km when there are no recent runs to calibrate from
};

// TRIMP per minute by zone, and the zone's pace as a fraction of vVO₂max (zones.ts).
// A planned km of a zone costs (rate / easy rate) × (easy speed / zone speed) easy km. Quality
// sessions are about half warm-up, cool-down and recoveries at easy effort.
const RATE = { easy: 1.65, threshold: 2.55, interval: 3.10 };
const SPEED = { easy: 0.72, threshold: 0.88, interval: 0.97 };
const zoneKm = (z: "threshold" | "interval") => (RATE[z] / RATE.easy) * (SPEED.easy / SPEED[z]);
export const KM_FACTOR: Record<string, number> = {
  easy: 1, long: 1, rest: 0,
  tempo: (1 + zoneKm("threshold")) / 2,
  interval: (1 + zoneKm("interval")) / 2,
  race: zoneKm("threshold"),        // the race is charged at threshold, as the old engine did
};

export interface LoadState { ctl: number; atl: number }

export function step(s: LoadState, trimp: number): LoadState {
  return {
    ctl: s.ctl + (trimp - s.ctl) * (2 / (LOAD.tauCtl + 1)),
    atl: s.atl + (trimp - s.atl) * (2 / (LOAD.tauAtl + 1)),
  };
}

/** The ratio a planned week is judged by: mean fatigue over mean fitness (floored), across its 7 days. */
export function weekRatio(start: LoadState, days: number[]): { ratio: number; end: LoadState; charge: number } {
  let s = start, atl = 0, ctl = 0, charge = 0;
  for (const t of days) { s = step(s, t); atl += s.atl; ctl += s.ctl; charge += t; }
  const n = days.length || 1;
  return { ratio: (atl / n) / Math.max(ctl / n, LOAD.ctlFloor), end: s, charge };
}

/** TRIMP per easy km from recent runs: what the old engine's calibration achieved. */
export function trimpPerKm(runs: { km: number; trimp: number | null }[]): number {
  const r = runs.filter(x => x.trimp && x.km > 0);
  const km = r.reduce((a, x) => a + x.km, 0);
  return km >= 15 ? r.reduce((a, x) => a + x.trimp!, 0) / km : LOAD.defaultPerKm;
}
