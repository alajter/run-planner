// Fitness, fatigue and the load ratio. Every constant names its source; "my choice" means there is none.
//
// Load is Runalyze's TRIMP per calendar day, all sports. Fitness (CTL) and fatigue (ATL) are exponentially
// weighted averages of it over 42 and 7 days, the Performance Manager convention (Coggan; Runalyze uses the
// same spans), with the usual EWMA smoothing alpha = 2 / (N + 1).
// The planning ratio is acute over chronic load: the week's mean fatigue over its mean fitness.
import { speedAt } from "./zones";

export const LOAD = {
  tauCtl: 42, tauAtl: 7,      // Coggan's Performance Manager spans, as in Runalyze
  cap: 1.3,                   // Gabbett 2016 (BJSM): injury risk was lowest with an acute:chronic ratio of 0.8–1.3
  defaultPerKm: 15,           // my choice, untuned: TRIMP per easy km until there are runs to calibrate from
};

// ── costing planned km ──
// A planned km of a harder session costs more than an easy km. Each kind's intensity as a share of VO2max,
// from the middle of Daniels' ranges (Daniels' Running Formula): easy 59–74 %, threshold 83–88 %,
// interval 95–100 %. Heart-rate reserve is taken as the same share (%HRR tracks %VO2 reserve: Swain and
// Leutholtz 1997). TRIMP per minute is Banister's: HRr × 0.64 e^(1.92 HRr) (Banister 1991, men's weighting).
// Speed at each share comes from Daniels and Gilbert's oxygen cost of running, at a reference VO2max of 45
// (my choice: the cost ratios barely move between 40 and 55).
export const INTENSITY = { easy: 0.665, threshold: 0.855, interval: 0.975 };
const REF_VO2MAX = 45;
export const banisterPerMin = (hrr: number) => hrr * 0.64 * Math.exp(1.92 * hrr);
const zoneKm = (f: number) =>
  (banisterPerMin(f) / banisterPerMin(INTENSITY.easy)) * (speedAt(REF_VO2MAX, INTENSITY.easy) / speedAt(REF_VO2MAX, f));

export const KM_FACTOR: Record<string, number> = {
  easy: 1, long: 1, rest: 0,
  // a quality session is about half warm-up, recoveries and cool-down at easy effort (my choice, untuned)
  tempo: (1 + zoneKm(INTENSITY.threshold)) / 2,
  interval: (1 + zoneKm(INTENSITY.interval)) / 2,
  // the race at threshold intensity: Daniels' threshold pace is about what can be held for an hour
  race: zoneKm(INTENSITY.threshold),
};

export interface LoadState { ctl: number; atl: number }

export function step(s: LoadState, trimp: number): LoadState {
  return {
    ctl: s.ctl + (trimp - s.ctl) * (2 / (LOAD.tauCtl + 1)),
    atl: s.atl + (trimp - s.atl) * (2 / (LOAD.tauAtl + 1)),
  };
}

/** The ratio a planned week is judged by: mean fatigue over mean fitness across its 7 days. */
export function weekRatio(start: LoadState, days: number[]): { ratio: number; end: LoadState; charge: number } {
  let s = start, atl = 0, ctl = 0, charge = 0;
  for (const t of days) { s = step(s, t); atl += s.atl; ctl += s.ctl; charge += t; }
  const n = days.length || 1;
  return { ratio: ctl > 0 ? (atl / n) / (ctl / n) : 0, end: s, charge };
}

/** TRIMP per easy km from recent runs (needs 15 km of them; my choice), else the default. */
export function trimpPerKm(runs: { km: number; trimp: number | null }[]): number {
  const r = runs.filter(x => x.trimp && x.km > 0);
  const km = r.reduce((a, x) => a + x.km, 0);
  return km >= 15 ? r.reduce((a, x) => a + x.trimp!, 0) / km : LOAD.defaultPerKm;
}
