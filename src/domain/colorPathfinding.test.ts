import { describe, expect, it } from "vitest";
import { colorTraversalCost } from "./colorPathfinding";

describe("experimental color pathfinding", () => {
  it("prefers warm road-like pixels over water and dark terrain", () => {
    const road = colorTraversalCost(177, 151, 104);
    const water = colorTraversalCost(65, 112, 145);
    const dark = colorTraversalCost(30, 37, 32);
    expect(road).toBeLessThan(water);
    expect(road).toBeLessThan(dark);
  });

  it("keeps unknown terrain traversable for a deliberately naive route", () => {
    expect(colorTraversalCost(120, 115, 110)).toBeGreaterThan(0);
    expect(colorTraversalCost(120, 115, 110)).toBeLessThan(7);
  });
});
