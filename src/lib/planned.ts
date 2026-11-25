// The plan as it was asked. The engine re-plans from the runs every time, but a day that has come
// keeps the session it had: it is saved ("frozen") the first time its day arrives, and from then on
// that saved session is what the run is judged against. Days still ahead follow the engine.
import "server-only";
import { all, run } from "./db";
import { buildPlan, rnd, type LoadInput, type PlanSettings, type RunDay, type Session, type Week } from "./engine/plan";
import { addDays } from "./dates";

interface Row { date: string; kind: Session["kind"]; km: number; strides: number; note: string | null; week: string }

export async function plannedWeeks(s: PlanSettings, runs: RunDay[], t: string, load?: LoadInput): Promise<Week[]> {
  const weeks = buildPlan(s, runs, t, load);
  const rows = await all<Row>("SELECT date, kind, km, strides, note, week FROM plan WHERE date <= ? ORDER BY date", [t]);
  // frozen days belong to the week whose dates hold them (not their stored key: the first day of the
  // week can change in Settings, and the days already asked must stay where they are)
  const weekOf = (date: string) => weeks.find(w => date >= w.start && date <= addDays(w.start, 6))?.start ?? null;
  const lastStored = new Map<string, string>();   // week start → its latest frozen date
  for (const r of rows) { const k = weekOf(r.date); if (k && r.date > (lastStored.get(k) ?? "")) lastStored.set(k, r.date); }
  // freeze what has come and isn't saved yet: a day after the week's last frozen day, up to today
  const fresh: Row[] = [];
  for (const w of weeks) for (const x of w.sessions) {
    if (x.date <= t && x.date > (lastStored.get(w.start) ?? "")) {
      fresh.push({ date: x.date, kind: x.kind, km: x.km, strides: x.strides ? 1 : 0, note: x.note ?? null, week: w.start });
    }
  }
  const built = new Date().toISOString();
  for (const r of fresh) {
    await run("INSERT OR IGNORE INTO plan (date, kind, km, strides, note, week, built_at) VALUES (?,?,?,?,?,?,?)",
      [r.date, r.kind, r.km, r.strides, r.note, r.week, built]);
  }
  const stored = new Map<string, Row[]>();
  for (const r of [...rows, ...fresh]) { const k = weekOf(r.date); if (k) stored.set(k, [...(stored.get(k) ?? []), r]); }
  // each week: the frozen days, then the engine's days still ahead
  return weeks.map(w => {
    const kept = stored.get(w.start);
    if (!kept) return w;
    const asked: Session[] = kept
      .map(r => ({ date: r.date, kind: r.kind, km: r.km, strides: !!r.strides, ...(r.note ? { note: r.note } : {}) }));
    const ahead = w.sessions.filter(x => x.date > t);
    const sessions = [...asked, ...ahead].sort((a, b) => a.date.localeCompare(b.date));
    const km = Math.round(sessions.reduce((a, x) => a + x.km, 0) * 10) / 10;
    const longKm = Math.max(0, ...sessions.filter(x => x.kind === "long").map(x => x.km));
    const long = longKm || w.longKm;
    const training = Math.round(sessions.filter(x => x.kind !== "race").reduce((a, x) => a + x.km, 0) * 10) / 10;
    // the limits read the week as it now stands (frozen days + the days ahead); the load ratio already
    // does: the engine reads the days before today from the runs
    const limits = w.limits.map(l => l.key === "load_ratio" ? l
      : { ...l, value: rnd(l.key === "long_step" || l.key === "long_max" ? long : training, l.unit) });
    return { ...w, sessions, km, longKm: long, runs: sessions.length, limits };
  });
}

/** One-off: load what an earlier planner asked (data/*.json) as frozen days. Never overwrites. */
export async function importAsked(rows: { date: string; kind: Session["kind"]; km: number; strides: boolean; week: string }[]) {
  for (const r of rows) {
    await run("INSERT OR IGNORE INTO plan (date, kind, km, strides, note, week, built_at) VALUES (?,?,?,?,?,?,?)",
      [r.date, r.kind, r.km, r.strides ? 1 : 0, null, r.week, "imported"]);
  }
}
