import type { ContinentPoint, PlayerSnapshot, Vector3 } from "./types.js";

export const MUMBLE_LINK_SIZE = 5460;

const offsets = {
  uiVersion: 0,
  uiTick: 4,
  avatarPosition: 8,
  avatarFront: 20,
  cameraPosition: 556,
  cameraFront: 568,
  name: 44,
  identity: 592,
  contextLength: 1104,
  context: 1108,
} as const;

const contextOffsets = {
  mapId: 28,
  buildId: 44,
  uiState: 48,
  playerX: 60,
  playerY: 64,
} as const;

function readVector3(view: DataView, offset: number): [number, number, number] {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
}

function readUtf16(buffer: Uint8Array, offset: number, byteLength: number) {
  const slice = buffer.subarray(offset, offset + byteLength);
  let end = 0;
  while (end + 1 < slice.length && (slice[end] !== 0 || slice[end + 1] !== 0)) {
    end += 2;
  }
  return new TextDecoder("utf-16le").decode(slice.subarray(0, end));
}

function parseIdentity(text: string): { name?: string } {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && "name" in value) {
      const name = (value as { name?: unknown }).name;
      return typeof name === "string" ? { name } : {};
    }
  } catch {
    // A partially-written identity is expected occasionally; retry next tick.
  }
  return {};
}

function headingFromFront(front: readonly [number, number, number]) {
  if (!Number.isFinite(front[0]) || !Number.isFinite(front[2])) return null;
  if (Math.abs(front[0]) < 0.0001 && Math.abs(front[2]) < 0.0001) return null;
  return Math.atan2(front[0], -front[2]);
}

export interface ParsedMumbleLink {
  uiVersion: number;
  uiTick: number;
  mapId: number;
  gameBuild: number;
  position: ContinentPoint | null;
  heading: number | null;
  characterName: string | null;
  inCombat: boolean;
  cameraPosition: Vector3 | null;
  cameraFront: Vector3 | null;
}

function finiteVector(vector: Vector3): Vector3 | null {
  return vector.every(Number.isFinite) ? vector : null;
}

export function parseMumbleLink(bytes: Uint8Array): ParsedMumbleLink {
  if (bytes.byteLength < MUMBLE_LINK_SIZE) {
    throw new RangeError(`MumbleLink buffer must contain ${MUMBLE_LINK_SIZE} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const contextLength = Math.min(view.getUint32(offsets.contextLength, true), 256);
  const avatarFront = readVector3(view, offsets.avatarFront);
  const identity =
    parseIdentity(readUtf16(bytes, offsets.identity, 512)).name ??
    readUtf16(bytes, offsets.name, 512) ??
    null;

  const hasExtendedContext = contextLength >= 48 && bytes.byteLength >= offsets.context + 68;
  const playerX = hasExtendedContext
    ? view.getFloat32(offsets.context + contextOffsets.playerX, true)
    : 0;
  const playerY = hasExtendedContext
    ? view.getFloat32(offsets.context + contextOffsets.playerY, true)
    : 0;
  const position =
    Number.isFinite(playerX) &&
    Number.isFinite(playerY) &&
    (Math.abs(playerX) > 0.001 || Math.abs(playerY) > 0.001)
      ? ([playerX, playerY] as const)
      : null;
  const uiState = hasExtendedContext
    ? view.getUint32(offsets.context + contextOffsets.uiState, true)
    : 0;

  return {
    uiVersion: view.getUint32(offsets.uiVersion, true),
    uiTick: view.getUint32(offsets.uiTick, true),
    mapId: view.getUint32(offsets.context + contextOffsets.mapId, true),
    gameBuild: view.getUint32(offsets.context + contextOffsets.buildId, true),
    position,
    heading: headingFromFront(avatarFront),
    characterName: identity,
    inCombat: Boolean(uiState & (1 << 6)),
    cameraPosition: finiteVector(readVector3(view, offsets.cameraPosition)),
    cameraFront: finiteVector(readVector3(view, offsets.cameraFront)),
  };
}

export function disconnectedMumbleSnapshot(): Omit<
  PlayerSnapshot,
  "type" | "sequence" | "timestamp" | "source"
> {
  return {
    connected: false,
    mapId: null,
    position: null,
    heading: null,
    characterName: null,
    cameraPosition: null,
    cameraFront: null,
  };
}
