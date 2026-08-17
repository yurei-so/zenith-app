import type { TelemetrySource } from "./types.js";

const MOCK_ROUTE = [
  [43728.4, 28589.9],
  [43244.7, 28723.5],
  [42822.6, 28780],
  [44087.8, 29386.4],
  [43550.7, 30028],
  [44063.9, 29886.6],
] as const;

export function createMockSource(): TelemetrySource {
  const startedAt = Date.now();
  return {
    kind: "mock",
    read() {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const legDuration = 8;
      const leg = Math.floor(elapsedSeconds / legDuration) % MOCK_ROUTE.length;
      const nextLeg = (leg + 1) % MOCK_ROUTE.length;
      const progress = (elapsedSeconds % legDuration) / legDuration;
      const from = MOCK_ROUTE[leg];
      const to = MOCK_ROUTE[nextLeg];
      const x = from[0] + (to[0] - from[0]) * progress;
      const y = from[1] + (to[1] - from[1]) * progress;
      return {
        connected: true,
        mapId: 15,
        position: [x, y] as const,
        heading: Math.atan2(to[0] - from[0], -(to[1] - from[1])),
        characterName: "Demo Wayfinder",
        cameraPosition: [x / 39.3701, 2, y / 39.3701] as const,
        cameraFront: [Math.sin(elapsedSeconds / 5), 0, -Math.cos(elapsedSeconds / 5)] as const,
      };
    },
    close() {},
  };
}
