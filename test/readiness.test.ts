import { describe, expect, it } from "vitest";
import { hrvScore, loadScore, readiness, restDays, rhrScore, sleepScore } from "../src/lib/engine/readiness";
import { step, weekRatio } from "../src/lib/engine/load";
import { demoRunner } from "../demo/runner.mjs";

describe("readiness score (run-coach)", () => {
  it("scores sleep on duration, deep, REM and awake time", () => {
    expect(sleepScore({ date: "d", total: 480, deep: 100, rem: 100, awake: 5 })).toBe(100);
    expect(sleepScore({ date: "d", total: 310, deep: 52, rem: 75, awake: 4 })).toBe(58);   // 5h10 (3) + deep 17 % (25) + REM 24 % (20) + awake (10)
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
  it("calls small dips inside the normal range 'watch', says which way they moved, and keeps red for outside it", () => {
    const morning = { sleep: null, load: { yesterday: 0, avg: 60 }, band: [40, 58] as [number, number],
      hrv: { value: 45.5, baseline: 50, n: 28 }, rhr: { value: 54, baseline: 52, n: 28 } };
    const r = readiness(morning);
    expect(r.score).toBe(48);
    expect(r.parts.find(p => p.key === "hrv")!.level).toBe("watch");
    expect(r.parts.find(p => p.key === "rhr")!.level).toBe("watch");
    expect(r.onlySmallDips).toBe(true);
    expect(r.reasons.map(x => x.text)).toEqual([
      "HRV is down 9 % on your usual 50: 46 ms, inside Runalyze's normal 40–58.",
      "Resting HR is up 2.0 bpm on your usual 52.0: 54 bpm, within a normal day's swing.",
    ]);
    const off = readiness({ ...morning, hrv: { value: 38, baseline: 50, n: 28 }, rhr: { value: 58, baseline: 52, n: 28 } });
    expect(off.parts.filter(p => p.level === "act").map(p => p.key)).toEqual(["hrv", "rhr"]);
    expect(off.onlySmallDips).toBe(false);
  });
});

describe("rest days to balanced form", () => {
  it("is 0 when fitness already covers fatigue", () => expect(restDays(40, 40)).toBe(0));
  it("counts the full rest days until fatigue falls to fitness", () => {
    expect(restDays(40, 50)).toBe(0.9);          // under one day: one rest day balances it
    expect(step({ ctl: 40, atl: 50 }, 0)).toSatisfy((s: { ctl: number; atl: number }) => s.atl < s.ctl);
    expect(restDays(40, 80)).toBe(2.9);          // between two and three
    let s = { ctl: 40, atl: 80 };
    s = step(step(s, 0), 0);
    expect(s.atl).toBeGreaterThan(s.ctl);
    expect(step(s, 0)).toSatisfy((x: { ctl: number; atl: number }) => x.atl < x.ctl);
  });
});

describe("load model", () => {
  it("rolls fitness and fatigue with alpha 2/(N+1)", () => {
    const s = step({ ctl: 0, atl: 0 }, 43);
    expect(s.ctl).toBeCloseTo(2, 6);
    expect(s.atl).toBeCloseTo(10.75, 6);
  });
  it("divides the week's mean fatigue by its mean fitness", () => {
    expect(weekRatio({ ctl: 10, atl: 10 }, Array(7).fill(10)).ratio).toBeCloseTo(1, 6);
    expect(weekRatio({ ctl: 10, atl: 10 }, Array(7).fill(30)).ratio).toBeGreaterThan(1.3);
  });
});

describe("readiness on the demo runner", () => {
  const demo = demoRunner("2026-11-25");
  const base = (k: "hrv" | "rhr", from: number) => {
    const xs = demo.nights.slice(from - 28, from).map(n => n[k]);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  it("is good to go on an ordinary morning", () => {
    const i = demo.nights.length - 1, n = demo.nights[i];
    const r = readiness({ sleep: n, hrv: { value: n.hrv, baseline: base("hrv", i), n: 28 }, rhr: { value: n.rhr, baseline: base("rhr", i), n: 28 }, load: null });
    expect(r.verdict).toBe("green");
  });
  it("drops during the week with a cold", () => {
    const i = demo.nights.findIndex(n => n.rhr > 58), n = demo.nights[i + 3];
    const r = readiness({ sleep: n, hrv: { value: n.hrv, baseline: base("hrv", i), n: 28 }, rhr: { value: n.rhr, baseline: base("rhr", i), n: 28 }, load: null });
    expect(r.verdict).not.toBe("green");
  });
});
