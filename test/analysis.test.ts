import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyze } from "../src/lib/analysis";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("analyze", () => {
  it("splits the 12 Nov easy run from its strides", () => {
    const a = analyze(fixture("run-2026-11-12-strides.json"));
    expect(a.easy).not.toBeNull();
    // asked: 5.3 km easy, then strides; the watch's total was 6.48 km in 47:09
    expect(a.easy!.km).toBeGreaterThan(5.1);
    expect(a.easy!.km).toBeLessThan(5.5);
    expect(a.easy!.hr).toBeGreaterThanOrEqual(140);
    expect(a.easy!.hr).toBeLessThanOrEqual(144);
    expect(a.strides!.n).toBeGreaterThanOrEqual(5);
    expect(a.strides!.n).toBeLessThanOrEqual(8);
    expect(a.easy!.km + a.strides!.km).toBeCloseTo(6.48, 1);
  });

  it("leaves a steady run whole", () => {
    const s = fixture("run-2026-11-12-strides.json");
    const cut = 2200;   // the same run, ended before the strides
    const steady = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, (v as unknown[]).slice(0, cut)]));
    expect(analyze(steady).easy).toBeNull();
  });
});
