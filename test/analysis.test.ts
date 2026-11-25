import { describe, expect, it } from "vitest";
import { analyze } from "../src/lib/analysis";
import { demoRunner } from "../demo/runner.mjs";

// the demo runner's last easy run with strides: easy running, then 6 strides of 20 s with a jog back after each
const demo = demoRunner("2026-11-25");
const run = demo.runs.filter(r => r.strides).at(-1)!;

describe("analyze", () => {
  it("splits an easy run from its strides", () => {
    const a = analyze(run.streams);
    expect(a.easy).not.toBeNull();
    expect(a.strides!.n).toBe(6);
    expect(a.easy!.km).toBeGreaterThan(run.km - 1.6);
    expect(a.easy!.km).toBeLessThan(run.km - 0.6);
    expect(a.easy!.km + a.strides!.km).toBeCloseTo(run.km, 1);
    expect(a.easy!.hr).toBeLessThan(run.maxHr);
  });

  it("leaves a steady run whole", () => {
    const steady = demo.runs.find(r => r.kind === "easy" && !r.strides)!;
    expect(analyze(steady.streams).easy).toBeNull();
  });

  it("cuts a run into 100 m steps", () => {
    const a = analyze(run.streams);
    expect(a.series!.length).toBeGreaterThan(run.km * 10 - 2);
  });
});
