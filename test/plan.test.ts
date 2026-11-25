import { describe, expect, it } from "vitest";
import { buildPlan, DEFAULT_SETTINGS, RULES, type RunDay } from "../src/lib/engine/plan";
import { addDays } from "../src/lib/dates";
import { LOAD } from "../src/lib/engine/load";

// the 4 weeks before the block and the first fortnight, as run (Sun long, Tue, Thu)
const history: RunDay[] = [];
const wk = (start: string, km: number[]) => km.forEach((x, i) => x && history.push({ date: addDays(start, [0, 2, 4][i]), km: x }));
wk("2026-10-04", [6, 4, 4]); wk("2026-10-11", [6.5, 4.5, 4]); wk("2026-10-18", [6, 4, 4.5]); wk("2026-10-25", [6.3, 4.3, 4.6]);
wk("2026-11-01", [6.9, 4.3, 0]); wk("2026-11-08", [7.7, 4.7, 6.5]);

const plan = buildPlan(DEFAULT_SETTINGS, history, "2026-11-13");
const future = plan.filter(w => w.start > "2026-11-13");

describe("buildPlan", () => {
  it("runs from the block start to race week, phases in order", () => {
    expect(plan[0].start).toBe("2026-11-01");
    expect(plan.at(-1)!.sessions.at(-1)).toMatchObject({ kind: "race", date: "2026-02-26".replace("2026", "2027") });
    expect(plan.map(w => w.phase).join(",")).toMatch(/^(Base,)+(Build,)+(Peak,)+(Taper,)*Taper$/);
  });

  it("never steps the long run more than 10 % over the last 4 weeks, nor past the longest", () => {
    const longs = plan.map(w => w.longKm);
    for (let i = 4; i < plan.length; i++) {
      const prev = Math.max(...longs.slice(i - 4, i));
      expect(longs[i]).toBeLessThanOrEqual(Math.round(prev * RULES.longStep * 10) / 10 + 0.05);
      expect(longs[i]).toBeLessThanOrEqual(DEFAULT_SETTINGS.longMaxKm);
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

  it("sizes the next weeks from what was run: a missed week lowers them", () => {
    const missed = history.filter(r => r.date < "2026-11-08");
    const lower = buildPlan(DEFAULT_SETTINGS, missed, "2026-11-13").find(w => w.start === "2026-11-15")!;
    const normal = future.find(w => w.start === "2026-11-15")!;
    expect(lower.longKm).toBeLessThan(normal.longKm);
  });

  it("no easy run under 4 km outside race week, none over 85 % of the long run", () => {
    for (const w of future) for (const s of w.sessions.filter(s => s.kind === "easy")) {
      if (!w.sessions.some(x => x.kind === "race")) expect(s.km).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.minRunKm);
      expect(s.km).toBeLessThanOrEqual(w.longKm * RULES.easyMaxOfLong + 0.05);
    }
  });

  it("never steps the long run back outside down and taper weeks", () => {
    let last = 0;
    for (const w of plan) {
      if (w.down || w.phase === "Taper") continue;
      if (w.start > "2026-11-13") expect(w.longKm).toBeGreaterThanOrEqual(last - 0.05);
      last = Math.max(last, w.longKm);
    }
  });

  it("trims only easy runs for the load ratio: over 1.25 only when every easy run is at its minimum", () => {
    for (const w of future.filter(w => w.binding.startsWith("load ratio"))) {
      const lr = w.limits.find(l => l.key === "load_ratio")!;
      if (lr.value > LOAD.softCap + 0.01)
        for (const s of w.sessions.filter(s => s.kind === "easy")) expect(s.km).toBeLessThanOrEqual(DEFAULT_SETTINGS.minRunKm + 0.3);
    }
  });

  it("keeps the long run on its own day when the week starts on another", () => {
    const mon = buildPlan({ ...DEFAULT_SETTINGS, blockStart: "2026-10-26", weekStartDow: 1, longRunDow: 0 }, history, "2026-11-13");
    for (const w of mon) {
      expect(new Date(`${w.start}T12:00:00Z`).getUTCDay()).toBe(1);
      for (const x of w.sessions.filter(x => x.kind === "long")) expect(new Date(`${x.date}T12:00:00Z`).getUTCDay()).toBe(0);
      for (const x of w.sessions) expect(x.date >= w.start && x.date <= addDays(w.start, 6)).toBe(true);
    }
  });
});
