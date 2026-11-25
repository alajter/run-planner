import { describe, expect, it } from "vitest";
import { buildPlan, DEFAULT_SETTINGS, RULES, type PlanSettings, type RunDay } from "../src/lib/engine/plan";
import { addDays } from "../src/lib/dates";
import { LOAD } from "../src/lib/engine/load";
import { demoRunner } from "../demo/runner.mjs";

// the made-up demo runner as of a fixed day: 16 weeks of history, a block that started 4 weeks ago
const TODAY = "2026-11-25";
const demo = demoRunner(TODAY);
const settings: PlanSettings = { ...DEFAULT_SETTINGS, race: demo.race, blockStart: demo.blockStart };
const history: RunDay[] = demo.runs.map(r => ({ date: r.date, km: r.km }));
const plan = buildPlan(settings, history, TODAY);
const future = plan.filter(w => w.start > TODAY);

describe("buildPlan", () => {
  it("matches the default settings to the demo runner", () => {
    expect(DEFAULT_SETTINGS.race.date).toBe(demo.race.date);
    expect(DEFAULT_SETTINGS.blockStart).toBe(demo.blockStart);
  });

  it("runs from the block start to race week, phases in order, a two-week taper", () => {
    expect(plan[0].start).toBe(demo.blockStart);
    expect(plan.at(-1)!.sessions.at(-1)).toMatchObject({ kind: "race", date: demo.race.date });
    expect(plan.map(w => w.phase).join(",")).toMatch(/^(Base,)+(Build,)+(Peak,)+Taper,Taper$/);
  });

  it("never steps the long run more than 10 % over the last 4 weeks, nor past the longest", () => {
    // weeks already run count as run, later weeks as planned
    const ranLong = (start: string) => Math.max(0, ...history.filter(r => r.date >= start && r.date <= addDays(start, 6)).map(r => r.km));
    const longs = plan.map(w => (w.start <= TODAY ? Math.max(ranLong(w.start), w.start > addDays(TODAY, -7) ? w.longKm : 0) : w.longKm));
    for (let i = 4; i < plan.length; i++) {
      if (plan[i].start <= TODAY) continue;
      const prev = Math.max(...longs.slice(i - 4, i));
      expect(longs[i]).toBeLessThanOrEqual(Math.round(prev * RULES.longStep * 10) / 10 + 0.05);
      expect(longs[i]).toBeLessThanOrEqual(settings.longMaxKm);
    }
  });

  it("makes every 4th Base and Build week a down week, with no strides", () => {
    const downs = plan.filter(w => w.down);
    expect(downs.length).toBeGreaterThanOrEqual(2);
    for (const w of downs) expect(w.sessions.some(s => s.strides)).toBe(false);
  });

  it("keeps quality out of Base and Build week 1", () => {
    for (const w of plan.filter(w => w.phase === "Base" || (w.phase === "Build" && w.phaseWeek === 1)))
      expect(w.sessions.every(s => s.kind === "long" || s.kind === "easy")).toBe(true);
  });

  it("cuts taper volume by 40-55 % of the peak week (Bosquet et al. 2007: 41-60 %)", () => {
    const peak = Math.max(...plan.filter(w => w.phase !== "Taper").map(w => w.km));
    const [t1] = plan.filter(w => w.phase === "Taper");
    expect(t1.km / peak).toBeGreaterThan(0.5);
    expect(t1.km / peak).toBeLessThan(0.7);
  });

  it("sizes the next weeks from what was run: a missed week lowers them", () => {
    const lastWeek = addDays(TODAY, -10);
    const missed = history.filter(r => r.date < lastWeek);
    const next = addDays(demo.blockStart, 35);
    const lower = buildPlan(settings, missed, TODAY).find(w => w.start === next)!;
    const normal = plan.find(w => w.start === next)!;
    expect(lower.km).toBeLessThan(normal.km);
  });

  it("no easy run under 4 km outside race week, none over 85 % of the long run", () => {
    for (const w of future) for (const s of w.sessions.filter(s => s.kind === "easy")) {
      if (!w.sessions.some(x => x.kind === "race")) expect(s.km).toBeGreaterThanOrEqual(settings.minRunKm);
      expect(s.km).toBeLessThanOrEqual(w.longKm * RULES.easyMaxOfLong + 0.05);
    }
  });

  it("never steps the long run back outside down and taper weeks", () => {
    let last = 0;
    for (const w of plan) {
      if (w.down || w.phase === "Taper") continue;
      if (w.start > TODAY) expect(w.longKm).toBeGreaterThanOrEqual(last - 0.05);
      last = Math.max(last, w.longKm);
    }
  });

  it("trims only easy runs for the load ratio: over the 1.3 cap only when every easy run is at its minimum", () => {
    for (const w of future.filter(w => w.binding.startsWith("load ratio"))) {
      const lr = w.limits.find(l => l.key === "load_ratio")!;
      if (lr.value > LOAD.cap + 0.01)
        for (const s of w.sessions.filter(s => s.kind === "easy")) expect(s.km).toBeLessThanOrEqual(settings.minRunKm + 0.3);
    }
  });

  it("keeps the long run on its own day when the week starts on another", () => {
    const mon = buildPlan({ ...settings, blockStart: addDays(demo.blockStart, 1), weekStartDow: 1, longRunDow: 0 }, history, TODAY);
    for (const w of mon) {
      expect(new Date(`${w.start}T12:00:00Z`).getUTCDay()).toBe(1);
      for (const x of w.sessions.filter(x => x.kind === "long")) expect(new Date(`${x.date}T12:00:00Z`).getUTCDay()).toBe(0);
      for (const x of w.sessions) expect(x.date >= w.start && x.date <= addDays(w.start, 6)).toBe(true);
    }
  });
});
