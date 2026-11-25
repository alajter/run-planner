import { describe, expect, it } from "vitest";
import { hrZones, paceZones, raceTime } from "../src/lib/engine/zones";
import { KM_FACTOR, banisterPerMin } from "../src/lib/engine/load";

describe("zones and costs", () => {
  it("predicts race times on Daniels and Gilbert's curve (VDOT 50: 5 km about 19:57, half about 1:31:35)", () => {
    expect(Math.abs(raceTime(50, 5) - (19 * 60 + 57))).toBeLessThan(20);
    expect(Math.abs(raceTime(50, 21.0975) - (91 * 60 + 35))).toBeLessThan(60);
  });

  it("orders the paces from slow to fast", () => {
    const p = paceZones(45);
    expect(p.easy).toBeGreaterThan(p.marathon);
    expect(p.marathon).toBeGreaterThan(p.half);
    expect(p.half).toBeGreaterThan(p.threshold);
    expect(p.threshold).toBeGreaterThan(p.interval);
  });

  it("sets the easy ceiling at 85 % of LTHR (Friel)", () => {
    expect(hrZones(168).easyCeiling).toBe(143);
  });

  it("costs a harder km more than an easy km (Banister weighting)", () => {
    expect(banisterPerMin(0.9)).toBeGreaterThan(banisterPerMin(0.6));
    expect(KM_FACTOR.interval).toBeGreaterThan(KM_FACTOR.tempo);
    expect(KM_FACTOR.tempo).toBeGreaterThan(1);
    expect(KM_FACTOR.race).toBeGreaterThan(KM_FACTOR.tempo);
  });
});
