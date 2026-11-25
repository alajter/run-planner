// A made-up runner for demos and tests. No real person's data.
//
// Deterministic: a fixed seed drives a small pseudo-random generator, so the same anchor date always
// gives the same runs, nights and streams. The anchor is "today" for the demo; tests pass a fixed date.
//
// The runner: 38, training for a half marathon about 14 weeks out, about 4 runs a week. Sixteen weeks
// of history with a steady build, a down week every 4th week, one missed week (a cold) and one session
// at half-marathon pace. Sleep, HRV and resting heart rate for every night.

export const SEED = 38021;

export const PROFILE = {
  name: "Demo Runner",
  age: 38,
  sex: "male",
  heightCm: 178,
  weightKg: 72,
  maxHr: 186,
  restHr: 52,
  lthr: 168,          // lactate-threshold heart rate
  vo2maxStart: 44.0,  // fitness at the start of the history ...
  vo2maxEnd: 47.0,    // ... and now
};

// Weekly km for the 16 weeks of history: a build with a down week every 4th week; week 10 missed.
export const WEEK_KM = [22, 24, 26, 20, 27, 29, 31, 25, 32, 0, 27, 30, 33, 26, 34, 36];
export const MISSED_WEEK = 9;      // index into WEEK_KM
export const RACE_PACE_WEEK = 14;  // the Thursday of this week is 2 x 3 km at half-marathon pace
export const CURRENT_WEEK_KM = 37;

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const sundayOnOrBefore = (iso) => addDays(iso, -dow(iso));
const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Daniels and Gilbert: oxygen cost (ml/kg/min) of running at v metres per minute. */
export const oxygenCost = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
/** The speed (m/min) whose oxygen cost is `vo2`. */
export function speedFor(vo2) {
  let lo = 50, hi = 600;
  for (let i = 0; i < 60; i++) { const v = (lo + hi) / 2; if (oxygenCost(v) < vo2) lo = v; else hi = v; }
  return (lo + hi) / 2;
}
/** Banister's TRIMP for one session (men's weighting): minutes x HRr x 0.64 e^(1.92 HRr). */
export function banisterTrimp(minutes, avgHr, restHr = PROFILE.restHr, maxHr = PROFILE.maxHr) {
  const r = clamp((avgHr - restHr) / (maxHr - restHr), 0, 1);
  return minutes * r * 0.64 * Math.exp(1.92 * r);
}

// ── one run as 1 Hz streams ──────────────────────────────────────────────────────────────────────
// A run is a list of segments: { m: metres, speed: m/s, hr: steady-state HR, cadence: spm }.
// HR moves toward each segment's target with a 40 s time constant and drifts up slowly over the run.
function streamsFor(segments, rnd) {
  const distance = [], time = [], heart_rate = [], cadence = [];
  let d = 0, t = 0, hr = PROFILE.restHr + 35, wobble = 0;
  const phase = rnd() * 1000;
  for (const seg of segments) {
    const end = d + seg.m;
    while (d < end) {
      // rolling terrain: a gentle grade that slows the pace and lifts the heart rate on the way up
      const grade = 0.03 * Math.sin((d + phase) / 700) + 0.015 * Math.sin((d + phase) / 230);
      wobble = 0.95 * wobble + 0.05 * (rnd() - 0.5) * 0.5;            // smooth pace noise, a few %
      const v = seg.speed * (1 + wobble - grade);
      const drift = (t / 60) * 0.06;                                   // +0.06 bpm a minute
      hr += (seg.hr + drift + grade * 150 - hr) / 40;
      distance.push(round(d / 1000, 5));
      time.push(t);
      heart_rate.push(Math.round(hr + (rnd() - 0.5) * 2));
      cadence.push(Math.round(seg.cadence + (rnd() - 0.5) * 3));
      d += v; t += 1;
    }
  }
  distance.push(round(d / 1000, 5)); time.push(t);
  heart_rate.push(heart_rate[heart_rate.length - 1]); cadence.push(cadence[cadence.length - 1]);
  return { distance, time, heart_rate, cadence };
}

function summarise(s) {
  const n = s.time.length;
  const km = s.distance[n - 1];
  const sec = s.time[n - 1];
  const avgHr = Math.round(s.heart_rate.reduce((a, b) => a + b, 0) / n);
  const maxHr = Math.max(...s.heart_rate);
  const cads = [...s.cadence].sort((a, b) => a - b);
  return { km: round(km, 2), sec, avgHr, maxHr, cadence: cads[n >> 1] };
}

// ── the generator ────────────────────────────────────────────────────────────────────────────────
/**
 * The demo runner as of `anchor` (YYYY-MM-DD, "today"). Runs end the day before the anchor; nights
 * run up to and including the anchor's morning.
 * Returns { profile, race, blockStart, runs, nights }. Each run carries its 1 Hz `streams`.
 */
export function demoRunner(anchor) {
  const rnd = mulberry32(SEED);
  const thisWeek = sundayOnOrBefore(anchor);
  const firstWeek = addDays(thisWeek, -7 * WEEK_KM.length);
  const race = {
    label: "Riverside Half (fictional)",
    date: addDays(thisWeek, 7 * 14),
    km: 21.1,
    target: "1:55",
  };
  const hmPace = (115 * 60) / 21.1;               // s/km for the 1:55 target
  const fitness = (w) => {                        // VO2max in week w (0..16), with a dip after the cold
    const f = PROFILE.vo2maxStart + ((PROFILE.vo2maxEnd - PROFILE.vo2maxStart) * w) / WEEK_KM.length;
    return w >= MISSED_WEEK && w <= MISSED_WEEK + 2 ? f - 0.8 : f;
  };
  const hrAt = (frac) => Math.round(PROFILE.restHr + frac * (PROFILE.maxHr - PROFILE.restHr));
  const easySpeed = (vo2, frac) => speedFor(vo2 * frac) / 60;   // m/s

  const runs = [];
  let id = 1;
  const weeks = [...WEEK_KM.map((km, i) => ({ i, km })), { i: WEEK_KM.length, km: CURRENT_WEEK_KM }];
  for (const { i, km } of weeks) {
    if (km === 0) continue;
    const start = addDays(firstWeek, 7 * i);
    const down = i % 4 === 3;
    const vo2 = fitness(i);
    const plan = [
      { off: 0, kind: "long", share: 0.35 },
      { off: 2, kind: "easy", share: 0.22 },
      { off: 4, kind: i === RACE_PACE_WEEK ? "race-pace" : "easy", share: 0.23 },
      { off: 6, kind: "easy", share: 0.20, strides: !down },
    ];
    for (const p of plan) {
      const date = addDays(start, p.off);
      if (date >= anchor) continue;
      const target = km * p.share * (1 + (rnd() - 0.5) * 0.06);
      const cad = 165 + Math.round((i / WEEK_KM.length) * 3);
      let segments, title;
      if (p.kind === "long") {
        segments = [{ m: target * 1000, speed: easySpeed(vo2, 0.62), hr: hrAt(0.63), cadence: cad - 1 }];
        title = "Long run";
      } else if (p.kind === "race-pace") {
        const hmp = 1000 / hmPace;
        const ez = { speed: easySpeed(vo2, 0.66), hr: hrAt(0.66), cadence: cad };
        segments = [{ m: 1500, ...ez }, { m: 3000, speed: hmp, hr: hrAt(0.84), cadence: cad + 7 },
          { m: 1000, ...ez }, { m: 3000, speed: hmp, hr: hrAt(0.86), cadence: cad + 7 }, { m: 1000, ...ez }];
        title = "2 x 3 km at half-marathon pace";
      } else {
        const ez = { speed: easySpeed(vo2, 0.66), hr: hrAt(0.66), cadence: cad };
        segments = [{ m: target * 1000, ...ez }];
        title = "Easy run";
        if (p.strides) {
          // 6 strides of 20 s with a 70 s easy jog back after each
          for (let k = 0; k < 6; k++) {
            segments.push({ m: ez.speed * 1.6 * 20, speed: ez.speed * 1.6, hr: hrAt(0.8), cadence: cad + 14 });
            segments.push({ m: ez.speed * 0.6 * 70, speed: ez.speed * 0.6, hr: hrAt(0.6), cadence: cad - 10 });
          }
          title = "Easy run + strides";
        }
      }
      const streams = streamsFor(segments, rnd);
      const s = summarise(streams);
      const hour = p.off === 0 ? 8 : 7;
      const v = (s.km * 1000) / (s.sec / 60);
      const hrr = (s.avgHr - PROFILE.restHr) / (PROFILE.maxHr - PROFILE.restHr);
      runs.push({
        id: id++, date, datetime: `${date}T0${hour}:${String(10 + Math.floor(rnd() * 40)).padStart(2, "0")}:00`,
        kind: p.kind, title, strides: !!p.strides && p.kind === "easy",
        km: s.km, sec: s.sec, avgHr: s.avgHr, maxHr: s.maxHr, cadence: s.cadence,
        elevationGain: Math.round(s.km * (4 + rnd() * 8)),
        trimp: round(banisterTrimp(s.sec / 60, s.avgHr), 1),
        // effective VO2max estimate: the oxygen cost of the pace over the share of heart-rate reserve
        // (%HRR tracks %VO2 reserve: Swain and Leutholtz, 1997)
        vo2: round(oxygenCost(v) / clamp(hrr, 0.4, 1), 1),
        streams,
      });
    }
  }

  // nights, dated by the morning they end: from the first week to the anchor's morning
  const nights = [];
  const longDays = new Set(runs.filter((r) => r.kind === "long" || r.kind === "race-pace").map((r) => r.date));
  const sick = (d) => d >= addDays(firstWeek, 7 * MISSED_WEEK - 1) && d <= addDays(firstWeek, 7 * MISSED_WEEK + 8);
  for (let d = addDays(firstWeek, 1); d <= anchor; d = addDays(d, 1)) {
    const w = Math.floor((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${firstWeek}T12:00:00Z`)) / (7 * 86400000));
    const progress = clamp(w / WEEK_KM.length, 0, 1);
    const hardYesterday = longDays.has(addDays(d, -1));
    const weekend = dow(d) === 0 || dow(d) === 6;
    const total = Math.round(415 + (weekend ? 25 : 0) - (sick(d) ? 30 : 0) + (rnd() - 0.5) * 60);
    const deep = Math.round(total * (0.15 + (rnd() - 0.5) * 0.04));
    const rem = Math.round(total * (0.21 + (rnd() - 0.5) * 0.04));
    const awake = Math.round(8 + rnd() * 18 + (sick(d) ? 15 : 0));
    const hrv = round(54 + 5 * progress - (hardYesterday ? 5 : 0) - (sick(d) ? 12 : 0) + (rnd() - 0.5) * 8, 1);
    const rhr = round(54 - 2.5 * progress + (hardYesterday ? 1.5 : 0) + (sick(d) ? 6 : 0) + (rnd() - 0.5) * 2.5, 1);
    nights.push({ date: d, total, deep, rem, awake, light: total - deep - rem - awake, hrv, rhr });
  }

  return { profile: PROFILE, race, blockStart: addDays(thisWeek, -28), runs, nights };
}
