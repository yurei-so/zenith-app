export type ContinentPoint = readonly [x: number, y: number];
export type Vector3 = readonly [x: number, y: number, z: number];

export interface PlayerSnapshot {
  type: "player";
  sequence: number;
  connected: boolean;
  mapId: number | null;
  position: ContinentPoint | null;
  heading: number | null;
  characterName: string | null;
  timestamp: string;
  source: "mumblelink" | "mock";
  gameBuild?: number;
  inCombat?: boolean;
  cameraPosition?: Vector3 | null;
  cameraFront?: Vector3 | null;
}

export interface Heart {
  id: number;
  name: string;
  level: number;
  coordinate: ContinentPoint;
}

export interface PointOfInterest {
  id: number;
  name: string;
  kind: "landmark" | "waypoint" | "vista";
  coordinate: ContinentPoint;
}

export interface ZoneMap {
  id: number;
  name: string;
  minLevel: number;
  maxLevel: number;
  continentId: number;
  continentName: string;
  floorId: number;
  regionId: number;
  regionName: string;
  continentDimensions: ContinentPoint;
  minZoom: number;
  maxZoom: number;
  mapRect: readonly [ContinentPoint, ContinentPoint];
  continentRect: readonly [ContinentPoint, ContinentPoint];
  center: ContinentPoint;
  hearts: Heart[];
  pointsOfInterest: PointOfInterest[];
}

export interface CompletionState {
  completedHeartIds: number[];
  completedPoiIds?: number[];
  updatedAt: string;
}

export interface PlayerProgression {
  configured: boolean;
  updatedAt: string;
  accountName: string | null;
  achievementPoints: number | null;
  fractalLevel: number | null;
  masteryPoints: { spent: number; earned: number } | null;
  character: { name: string; profession: string; level: number } | null;
  notice: string | null;
}
