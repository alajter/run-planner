import { describe, expect, it } from "vitest";
import { hrvScore, loadScore, readiness, rhrScore, sleepScore } from "../src/lib/engine/readiness";
import { step, weekRatio } from "../src/lib/engine/load";

describe("readiness score (run-coach)", () => {
  it("scores sleep on duration, deep, REM and awake time", () => {
    expect(sleepScore({ date: "d", total: 480, deep: 100, rem: 100, awake: 5 })).toBe(100);
    expect(sleepScore({ date: "d", total: 310, deep: 52, rem: 75, awake: 4 })).toBe(58);   // 12 Nov: 5h10 (3) + deep 17 % (25) + REM 24 % (20) + awake (10)
  });
  it("maps HRV, resting HR and load onto 0–100", () => {
    expect(hrvScore({ value: 44, baseline: 40, n: 28 })).toBe(100);
    expect(hrvScore({ value: 32, baseline: 40, n: 28 })).toBe(0);
    expect(rhrScore({ value: 55, baseline: 55, n: 28 })).toBe(63);
    expect(loadScore({ yesterday: 0, avg: 80 })).toBe(100);
    expect(loadScore({ yesterday: 160, avg: 80 })).toBe(20);
  });
  it("weights the parts it has", () => {
    const good = { sleep: null, hrv: { value: 44, baseline: 40, n: 28 }, rhr: null, load: null };
    expect(readiness(good)).toMatchObject({ score: 100, verdict: "green" });
    const low = { ...good, hrv: { value: 33, baseline: 40, n: 28 } };
    expect(readiness(low).verdict).toBe("red");
  });
});

describe("load model", () => {
  it("rolls fitness and fatigue with alpha 2/(N+1)", () => {
    const s = step({ ctl: 0, atl: 0 }, 43);
    expect(s.ctl).toBeCloseTo(2, 6);
    expect(s.atl).toBeCloseTo(10.75, 6);
  });
  it("floors fitness at 45 in the week's ratio", () => {
    expect(weekRatio({ ctl: 10, atl: 10 }, Array(7).fill(10)).ratio).toBeCloseTo(10 / 45, 2);
  });
});
