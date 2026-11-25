// One run's own analysis, from its 1 Hz streams: where the easy running ends and the strides begin,
// and the easy part's figures. The strides and their walk-backs are a different effort: inside the
// run's totals they stretch the distance, drag the cadence down and make the second half look slow.

export interface Streams { distance?: number[]; time?: number[]; heart_rate?: (number | null)[]; cadence?: (number | null)[] }

export interface Part { km: number; sec: number; pace: number; hr: number | null; cadence: number | null }
export interface Analysis {
  v: number;
  easy: Part & { halves: [number, number] | null; decoupling: number | null } | null;  // null: no late strides
  strides: { n: number; km: number; sec: number; pace: number | null } | null;
  /** Every 100 m: [km at the end of it, seconds it took, mean HR (0 = none), cadence spm (0 = none)]. */
  series?: [number, number, number, number][];
}

export const ANALYSIS_VERSION = 2;
const SMOOTH_S = 5;            // speed smoothed over 5 s
const BURST = 1.35;            // a stride runs ≥35 % faster than the easy running around it
const BURST_MIN_S = 8, BURST_MAX_S = 45;
const SET_GAP_S = 180;         // bursts closer than this belong to one set
const SET_MIN = 3;             // a set is at least 3 strides
const EASY_MIN_S = 15 * 60;    // the easy run before the set is at least 15 minutes …
const LATE_SHARE = 0.6;        // … and the set starts past 60 % of the recording

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Cadence as steps a minute: some sources send one leg's count (~80). */
export function spm(c: number | null): number | null {
  if (c == null) return null;
  return c < 120 ? c * 2 : c;
}

function part(t: number[], d: number[], hr: (number | null)[], cad: (number | null)[], i0: number, i1: number): Part {
  const km = (d[i1] - d[i0]) / (d[d.length - 1] > 100 ? 1000 : 1);
  const sec = t[i1] - t[i0];
  const hrs = hr.slice(i0, i1).filter((x): x is number => x != null && x > 0);
  const cads = cad.slice(i0, i1).filter((x): x is number => x != null && x > 0);
  const c = median(cads);
  return { km: round(km, 2), sec, pace: km > 0 ? Math.round(sec / km) : 0, hr: hrs.length ? Math.round(mean(hrs)!) : null,
           cadence: c != null ? Math.round(spm(c)!) : null };
}

const round = (x: number, n = 0) => Math.round(x * 10 ** n) / 10 ** n;

/** The run in 100 m steps, for the run page's charts and splits. */
export function series(s: Streams): [number, number, number, number][] {
  const t = s.time ?? [], d = s.distance ?? [], hr = s.heart_rate ?? [], cad = s.cadence ?? [];
  const n = Math.min(t.length, d.length);
  if (n < 2) return [];
  const scale = d[n - 1] > 100 ? 1 : 1000;
  const out: [number, number, number, number][] = [];
  let i0 = 0, next = 100;
  for (let i = 1; i < n; i++) {
    const m = (d[i] - d[0]) * scale;
    if (m < next && i < n - 1) continue;
    const hrs = hr.slice(i0, i + 1).filter((x): x is number => x != null && x > 0);
    const cads = cad.slice(i0, i + 1).filter((x): x is number => x != null && x > 0);
    const c = median(cads);
    if (m - (d[i0] - d[0]) * scale >= 20)   // a last stub under 20 m is dropped
      out.push([round(m / 1000, 2), t[i] - t[i0], hrs.length ? Math.round(mean(hrs)!) : 0, c != null ? Math.round(spm(c)!) : 0]);
    i0 = i; next = Math.floor(m / 100) * 100 + 100;
  }
  return out;
}

export function analyze(s: Streams): Analysis {
  return { ...detect(s), series: series(s) };
}

function detect(s: Streams): Analysis {
  const t = s.time ?? [], d = s.distance ?? [], hr = s.heart_rate ?? [], cad = s.cadence ?? [];
  const n = Math.min(t.length, d.length);
  const none: Analysis = { v: ANALYSIS_VERSION, easy: null, strides: null };
  if (n < 600) return none;
  // speed (m/s) per sample, smoothed
  const scale = d[n - 1] > 100 ? 1 : 1000;
  const sp: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - SMOOTH_S), b = Math.min(n - 1, i + SMOOTH_S);
    const dt = t[b] - t[a];
    sp[i] = dt > 0 ? ((d[b] - d[a]) * scale) / dt : 0;
  }
  // the easy running's speed: the median of the moving samples in the run's middle stretch
  const base = median(sp.slice(Math.floor(n * 0.1), Math.floor(n * 0.6)).filter(v => v > 1.2));
  if (!base) return none;
  // bursts: stretches clearly faster than the easy speed
  const bursts: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const fast = sp[i] >= base * BURST;
    if (fast && start < 0) start = i;
    if (!fast && start >= 0) {
      const len = t[i - 1] - t[start];
      if (len >= BURST_MIN_S && len <= BURST_MAX_S) bursts.push([start, i - 1]);
      start = -1;
    }
  }
  if (bursts.length < SET_MIN) return none;
  // the last set: walk back from the final burst while the gaps stay short
  let k = bursts.length - 1;
  while (k > 0 && t[bursts[k][0]] - t[bursts[k - 1][1]] <= SET_GAP_S) k--;
  const set = bursts.slice(k);
  if (set.length < SET_MIN) return none;
  // the cut: a few seconds before the first stride's run-up
  let cut = set[0][0];
  while (cut > 0 && t[set[0][0]] - t[cut] < 5) cut--;
  if (t[cut] - t[0] < EASY_MIN_S || cut < n * LATE_SHARE) return none;
  const easy = part(t, d, hr, cad, 0, cut);
  // halves of the easy part by distance: pace and heart rate in each, for fade and drift
  const half = (d[cut] - d[0]) / 2 + d[0];
  let mid = 0;
  while (mid < cut && d[mid] < half) mid++;
  const h1 = part(t, d, hr, cad, 0, mid), h2 = part(t, d, hr, cad, mid, cut);
  let decoupling: number | null = null;
  if (h1.hr && h2.hr && h1.pace && h2.pace) {
    const ef1 = 1 / h1.pace / h1.hr, ef2 = 1 / h2.pace / h2.hr;   // speed per beat
    decoupling = round((100 * (ef1 - ef2)) / ef1, 1);
  }
  const rest = part(t, d, hr, cad, cut, n - 1);
  const fastSec = set.reduce((a, [i, j]) => a + (t[j] - t[i]), 0);
  const fastKm = set.reduce((a, [i, j]) => a + (d[j] - d[i]) / (scale === 1 ? 1000 : 1), 0);
  return {
    v: ANALYSIS_VERSION,
    easy: { ...easy, halves: h1.pace && h2.pace ? [h1.pace, h2.pace] : null, decoupling },
    strides: { n: set.length, km: rest.km, sec: rest.sec, pace: fastKm > 0 ? Math.round(fastSec / fastKm) : null },
  };
}
