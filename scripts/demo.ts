// Fill demo.db with the made-up demo runner (demo/runner.mjs), as of today. No Runalyze token needed.
// `npm run demo` runs this, then starts the app on demo.db with sign-in and sync switched off.
import { rmSync } from "node:fs";

process.env.TURSO_DATABASE_URL = "file:demo.db";
process.env.TURSO_AUTH_TOKEN = "";

async function main() {
  for (const f of ["demo.db", "demo.db-journal"]) rmSync(f, { force: true });
  const { run, setSetting } = await import("../src/lib/db");
  const { analyze } = await import("../src/lib/analysis");
  const { DEFAULT_SETTINGS } = await import("../src/lib/engine/plan");
  const { step } = await import("../src/lib/engine/load");
  const { restDays } = await import("../src/lib/engine/readiness");
  const { raceTime } = await import("../src/lib/engine/zones");
  const { addDays } = await import("../src/lib/dates");
  const { demoRunner } = await import("../demo/runner.mjs");

  const today = new Date().toISOString().slice(0, 10);
  const d = demoRunner(today);

  for (const r of d.runs) {
    const a = analyze(r.streams);
    await run(
      `INSERT INTO runs (id, date, datetime, title, type, km, sec, hr, hr_max, vo2, trimp, cadence, decoupling, temp, analysis, analyzed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.date, r.datetime, r.title, r.kind, r.km, r.sec, r.avgHr, r.maxHr, r.vo2, r.trimp, r.cadence,
       a.easy?.decoupling ?? null, 12, JSON.stringify(a), new Date().toISOString()]);
  }
  for (const n of d.nights) {
    for (const [kind, value] of [["hrv", n.hrv], ["rhr", n.rhr], ["sleep", n.total]] as const)
      await run("INSERT INTO markers (kind, date, value) VALUES (?,?,?)", [kind, n.date, value]);
    await run("INSERT INTO nights (date, total, deep, rem, light, awake) VALUES (?,?,?,?,?,?)",
      [n.date, n.total, n.deep, n.rem, n.light, n.awake]);
  }

  // a daily snapshot of what Runalyze would report: fitness and fatigue from TRIMP, effective VO2max
  // (the mean of the last 10 runs), rest days, the HRV band, and race predictions from VO2max
  const trimp = new Map<string, number>();
  for (const r of d.runs) trimp.set(r.date, (trimp.get(r.date) ?? 0) + r.trimp);
  let s = { ctl: 0, atl: 0 };
  const first = d.nights[0].date;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    s = step(s, trimp.get(day) ?? 0);
    const past = d.runs.filter(r => r.date <= day).slice(-10);
    if (!past.length) continue;
    const vo2 = Math.round((past.reduce((a, r) => a + r.vo2, 0) / past.length) * 10) / 10;
    const hrvs = d.nights.filter(n => n.date <= day && n.date > addDays(day, -28)).map(n => n.hrv);
    const mean = hrvs.reduce((a, b) => a + b, 0) / hrvs.length;
    const sd = Math.sqrt(hrvs.reduce((a, b) => a + (b - mean) ** 2, 0) / hrvs.length);
    const calc = {
      effectiveVO2max: vo2, fitness: Math.round(s.ctl), fatigue: Math.round(s.atl), performance: Math.round(s.ctl - s.atl),
      acuteChronicWorkloadRatio: s.ctl > 0 ? Math.round((s.atl / s.ctl) * 100) / 100 : 0,
      restDays: restDays(s.ctl, s.atl), marathonShape: 0,
      hrvBaseline: Math.round(mean * 10) / 10, hrvNormalRange: [Math.round(mean - sd), Math.round(mean + sd)],
    };
    const prognosis = { predictions_available: true,
      distances: [5, 10, 21.1, 42.2].map(km => ({ distance: km, prognosis_seconds: raceTime(vo2, km), personal_best: null })) };
    await run("INSERT INTO snapshots (date, calc, prognosis) VALUES (?,?,?)", [day, JSON.stringify(calc), JSON.stringify(prognosis)]);
  }

  await setSetting("plan", { ...DEFAULT_SETTINGS, race: d.race, blockStart: d.blockStart });
  await setSetting("profile", { lthr: d.profile.lthr });
  await setSetting("tz", "UTC");
  await setSetting("last_sync", new Date().toISOString());
  console.log(`demo.db: ${d.runs.length} runs, ${d.nights.length} nights, race ${d.race.label} on ${d.race.date}`);
}

main().catch(e => { console.error(e); process.exit(1); });
