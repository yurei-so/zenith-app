import { describe, expect, it } from "vitest";
import type { PlayerSnapshot, ZoneMap } from "./types";
import {
  continentDistanceInGameUnits,
  VistaCinematicDetector,
} from "./vistaDetection";

const zone: ZoneMap = {
  id: 15,
  name: "Test map",
  minLevel: 1,
  maxLevel: 15,
  continentId: 1,
  continentName: "Tyria",
  floorId: 1,
  regionId: 4,
  regionName: "Kryta",
  continentDimensions: [81920, 114688],
  minZoom: 0,
  maxZoom: 7,
  mapRect: [[-43008, -27648], [43008, 30720]],
  continentRect: [[42624, 28032], [46208, 30464]],
  center: [44416, 29248],
  hearts: [],
  pointsOfInterest: [
    { id: 99, name: "Test Vista", kind: "vista", coordinate: [44000, 29000] },
  ],
};

function snapshot(time: number, cameraX: number, cameraAngle: number): PlayerSnapshot {
  return {
    type: "player",
    sequence: time / 100,
    connected: true,
    mapId: 15,
    position: [44000, 29000],
    heading: 0,
    characterName: "Tester",
    timestamp: new Date(1_700_000_000_000 + time).toISOString(),
    source: "mumblelink",
    inCombat: false,
    cameraPosition: [cameraX, 2, 0],
    cameraFront: [Math.sin(cameraAngle), 0, -Math.cos(cameraAngle)],
  };
}

describe("vista cinematic detection", () => {
  it("converts continent deltas to game units before applying the arm radius", () => {
    expect(continentDistanceInGameUnits([44000, 29000], [44012.5, 29000], zone))
      .toBeCloseTo(300);
  });

  it("detects sustained camera travel and rotation after the avatar settles by one vista", () => {
    const detector = new VistaCinematicDetector();
    let detected: number | null = null;
    for (let time = 0; time <= 700; time += 100) {
      detected = detector.update({ zone, player: snapshot(time, 0, 0), completedPois: new Set() });
      expect(detected).toBeNull();
    }
    for (let time = 800; time <= 3_800; time += 100) {
      const step = (time - 700) / 100;
      detected = detector.update({
        zone,
        player: snapshot(time, step * 0.2, step * 0.04),
        completedPois: new Set(),
      });
      expect(detected).toBeNull();
    }
    for (let time = 3_900; time <= 4_600; time += 100) {
      detected ??= detector.update({
        zone,
        player: snapshot(time, 6.2, 1.24),
        completedPois: new Set(),
      });
    }
    expect(detected).toBe(99);
  });

  it("does not arm when more than one incomplete vista is in range", () => {
    const detector = new VistaCinematicDetector();
    const crowded = {
      ...zone,
      pointsOfInterest: [
        ...zone.pointsOfInterest,
        { id: 100, name: "Other Vista", kind: "vista" as const, coordinate: [44001, 29000] as const },
      ],
    };
    expect(
      detector.update({ zone: crowded, player: snapshot(0, 0, 0), completedPois: new Set() }),
    ).toBeNull();
  });
});
