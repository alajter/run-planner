import { describe, expect, it } from "vitest";
import { debrief, heat, type RunRow } from "../src/lib/engine/debrief";

// a made-up long run at midday in the sun
const run = (o: Partial<RunRow>): RunRow => ({ id: 1, date: "2026-11-15", km: 12, sec: 4500, hr: 148, cadence: 170,
  decoupling: 6, temp: 24, vo2: 45, analysis: null, datetime: "2026-11-15T12:00:00Z", ...o });
const asked = { date: "2026-11-15", kind: "long", km: 12, strides: false } as never;

describe("heat", () => {
  it("26 °C or more at any hour", () => expect(heat(run({ temp: 26, datetime: "2026-11-15T19:00:00Z" }))).toBe("hot"));
  it("20 °C or more in the midday sun", () => expect(heat(run({}))).toBe("sun"));
  it("a run that starts before 11 and runs into it counts", () => expect(heat(run({ datetime: "2026-11-15T10:30:00Z" }))).toBe("sun"));
  it("not a cool midday", () => expect(heat(run({ temp: 14 }))).toBeNull());
  it("not a 25 °C evening", () => expect(heat(run({ datetime: "2026-11-15T18:00:00Z" }))).toBeNull());
});

describe("debrief in the heat", () => {
  it("a few beats over in the midday sun reads neutral", () => {
    const d = debrief(run({}), asked, 145, []);
    expect(d.headline).toBe("A touch hard: the heat");
    expect(d.neutral).toBe(true);
    expect(d.change[0].text).toContain("midday sun");
  });
  it("well over the ceiling is still harder than asked", () => {
    const d = debrief(run({ hr: 155 }), asked, 145, []);
    expect(d.headline).toBe("Harder than asked");
    expect(d.neutral).toBe(false);
  });
  it("the same run in the evening is harder than asked", () =>
    expect(debrief(run({ datetime: "2026-11-15T18:00:00Z" }), asked, 145, []).headline).toBe("Harder than asked"));
});
