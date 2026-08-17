import type { ContinentPoint, PlayerSnapshot, ZoneMap } from "./types";

export const VISTA_ARM_RADIUS_GAME_UNITS = 300;

const MAX_AVATAR_STEP_GAME_UNITS = 24;
const MIN_STATIONARY_MS = 750;
const MIN_CINEMATIC_MS = 2_000;
const SETTLE_MS = 650;
const MIN_MOTION_SAMPLES = 8;
const MIN_CAMERA_TRAVEL_METERS = 4;
const MIN_CAMERA_ROTATION_RADIANS = 0.8;

export function continentDistanceInGameUnits(
  from: ContinentPoint,
  to: ContinentPoint,
  zone: Pick<ZoneMap, "mapRect" | "continentRect">,
) {
  const mapWidth = zone.mapRect[1][0] - zone.mapRect[0][0];
  const mapHeight = zone.mapRect[1][1] - zone.mapRect[0][1];
  const continentWidth = zone.continentRect[1][0] - zone.continentRect[0][0];
  const continentHeight = zone.continentRect[1][1] - zone.continentRect[0][1];
  if (!continentWidth || !continentHeight) return Number.POSITIVE_INFINITY;
  const dx = (from[0] - to[0]) * (mapWidth / continentWidth);
  const dy = (from[1] - to[1]) * (mapHeight / continentHeight);
  return Math.hypot(dx, dy);
}

function vectorDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function vectorAngle(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  const aLength = Math.hypot(...a);
  const bLength = Math.hypot(...b);
  if (aLength < 0.0001 || bLength < 0.0001) return 0;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (aLength * bLength);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

interface DetectorState {
  candidateId: number;
  stableSince: number;
  trackingSince: number | null;
  lastMotionAt: number;
  motionSamples: number;
  cameraTravel: number;
  cameraRotation: number;
}

export interface VistaDetectionInput {
  zone: ZoneMap;
  player: PlayerSnapshot;
  completedPois: ReadonlySet<number>;
}

export class VistaCinematicDetector {
  private state: DetectorState | null = null;
  private previousPlayerPosition: ContinentPoint | null = null;
  private previousCameraPosition: PlayerSnapshot["cameraPosition"] = null;
  private previousCameraFront: PlayerSnapshot["cameraFront"] = null;

  reset() {
    this.state = null;
    this.previousPlayerPosition = null;
    this.previousCameraPosition = null;
    this.previousCameraFront = null;
  }

  update({ zone, player, completedPois }: VistaDetectionInput): number | null {
    const now = Date.parse(player.timestamp);
    const cameraPosition = player.cameraPosition ?? null;
    const cameraFront = player.cameraFront ?? null;
    if (
      !Number.isFinite(now) ||
      !player.connected ||
      player.mapId !== zone.id ||
      !player.position ||
      !cameraPosition ||
      !cameraFront ||
      player.inCombat
    ) {
      this.reset();
      return null;
    }

    const nearby = zone.pointsOfInterest.filter(
      (poi) =>
        poi.kind === "vista" &&
        !completedPois.has(poi.id) &&
        continentDistanceInGameUnits(player.position!, poi.coordinate, zone) <=
          VISTA_ARM_RADIUS_GAME_UNITS,
    );
    if (nearby.length !== 1) {
      this.reset();
      return null;
    }

    const candidate = nearby[0];
    if (!this.state || this.state.candidateId !== candidate.id) {
      this.state = {
        candidateId: candidate.id,
        stableSince: now,
        trackingSince: null,
        lastMotionAt: now,
        motionSamples: 0,
        cameraTravel: 0,
        cameraRotation: 0,
      };
    }

    const avatarStep = this.previousPlayerPosition
      ? continentDistanceInGameUnits(player.position, this.previousPlayerPosition, zone)
      : 0;
    const cameraTravel = this.previousCameraPosition
      ? vectorDistance(cameraPosition, this.previousCameraPosition)
      : 0;
    const cameraRotation = this.previousCameraFront
      ? vectorAngle(cameraFront, this.previousCameraFront)
      : 0;
    this.previousPlayerPosition = player.position;
    this.previousCameraPosition = cameraPosition;
    this.previousCameraFront = cameraFront;

    if (avatarStep > MAX_AVATAR_STEP_GAME_UNITS) {
      this.state.stableSince = now;
      this.state.trackingSince = null;
      this.state.motionSamples = 0;
      this.state.cameraTravel = 0;
      this.state.cameraRotation = 0;
      return null;
    }

    const cameraMoved = cameraTravel >= 0.025 || cameraRotation >= 0.01;
    if (
      this.state.trackingSince === null &&
      now - this.state.stableSince >= MIN_STATIONARY_MS &&
      cameraMoved
    ) {
      this.state.trackingSince = now;
    }
    if (this.state.trackingSince === null) return null;

    if (cameraMoved) {
      this.state.lastMotionAt = now;
      this.state.motionSamples += 1;
      this.state.cameraTravel += cameraTravel;
      this.state.cameraRotation += cameraRotation;
    }

    const cinematicDuration = now - this.state.trackingSince;
    const settled = now - this.state.lastMotionAt >= SETTLE_MS;
    if (
      cinematicDuration >= MIN_CINEMATIC_MS &&
      settled &&
      this.state.motionSamples >= MIN_MOTION_SAMPLES &&
      this.state.cameraTravel >= MIN_CAMERA_TRAVEL_METERS &&
      this.state.cameraRotation >= MIN_CAMERA_ROTATION_RADIANS
    ) {
      const detectedId = candidate.id;
      this.reset();
      return detectedId;
    }
    return null;
  }
}
