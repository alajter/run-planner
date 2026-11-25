// Print the plan built from the local database: `npm run plan [date]`.
import { all } from "../src/lib/db";
import { buildPlan, DEFAULT_SETTINGS } from "../src/lib/engine/plan";
import { step, type LoadState } from "../src/lib/engine/load";
import { addDays, today } from "../src/lib/dates";
import { loadInput } from "../src/lib/views";
(async () => {
  const t = process.argv[2] || today();
  const runs = await all<{ date: string; km: number }>("SELECT date, km FROM runs WHERE ignored=0");
  const load = await loadInput(t);
  let s: LoadState = { ctl: 0, atl: 0 };
  const first = [...load.daily.keys()].sort()[0];
  for (let d = first; d < t; d = addDays(d, 1)) s = step(s, load.daily.get(d) ?? 0);
  console.log(`end of yesterday: fitness ${s.ctl.toFixed(1)} · fatigue ${s.atl.toFixed(1)} · TRIMP/km ${load.perKm.toFixed(1)}`);
  for (const w of buildPlan(DEFAULT_SETTINGS, runs, t, load))
    console.log(w.start, w.phase.padEnd(5), w.phaseWeek, w.down ? "down" : "    ", String(w.km).padStart(5), `r ${w.ratio}`.padEnd(7), `(${w.binding})`.padEnd(32),
      w.sessions.map(x => `${x.date.slice(5)} ${x.kind} ${x.km}${x.strides ? "+st" : ""}`).join(" | "));
})();
