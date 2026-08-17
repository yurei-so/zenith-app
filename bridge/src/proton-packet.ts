import type { PlayerSnapshot, Vector3 } from "./types.js";

export const PROTON_PACKET_V1_SIZE = 172;
export const PROTON_PACKET_SIZE = 196;

export interface ProtonPacket {
  tick: number;
  mapId: number;
  gameBuild: number;
  uiState: number;
  processId: number;
  position: readonly [number, number] | null;
  heading: number | null;
  mountIndex: number;
  characterName: string | null;
  cameraPosition: Vector3 | null;
  cameraFront: Vector3 | null;
}

function readFiniteVector(buffer: Buffer, offset: number): Vector3 | null {
  const vector: Vector3 = [
    buffer.readFloatLE(offset),
    buffer.readFloatLE(offset + 4),
    buffer.readFloatLE(offset + 8),
  ];
  return vector.every(Number.isFinite) ? vector : null;
}

export function parseProtonPacket(buffer: Buffer): ProtonPacket {
  if (buffer.length !== PROTON_PACKET_V1_SIZE && buffer.length !== PROTON_PACKET_SIZE) {
    throw new RangeError(
      `Proton relay packet must contain ${PROTON_PACKET_V1_SIZE} or ${PROTON_PACKET_SIZE} bytes`,
    );
  }
  if (buffer.toString("ascii", 0, 4) !== "ZNML") {
    throw new TypeError("Invalid Proton relay packet magic");
  }
  const version = buffer.readUInt16LE(4);
  if ((version !== 1 && version !== 2) || buffer.readUInt16LE(6) !== buffer.length) {
    throw new TypeError("Unsupported Proton relay packet version");
  }

  const playerX = buffer.readFloatLE(28);
  const playerY = buffer.readFloatLE(32);
  const headingValue = buffer.readFloatLE(36);
  const position =
    Number.isFinite(playerX) &&
    Number.isFinite(playerY) &&
    (Math.abs(playerX) > 0.001 || Math.abs(playerY) > 0.001)
      ? ([playerX, playerY] as const)
      : null;
  const nameEnd = buffer.indexOf(0, 44);
  const characterName =
    buffer.toString("utf8", 44, nameEnd === -1 ? buffer.length : nameEnd) || null;

  return {
    tick: buffer.readUInt32LE(8),
    mapId: buffer.readUInt32LE(12),
    gameBuild: buffer.readUInt32LE(16),
    uiState: buffer.readUInt32LE(20),
    processId: buffer.readUInt32LE(24),
    position,
    heading: Number.isFinite(headingValue) ? headingValue : null,
    mountIndex: buffer.readUInt8(40),
    characterName,
    cameraPosition: version >= 2 ? readFiniteVector(buffer, 172) : null,
    cameraFront: version >= 2 ? readFiniteVector(buffer, 184) : null,
  };
}

export function protonPacketToSnapshot(
  packet: ProtonPacket,
): Omit<PlayerSnapshot, "type" | "sequence" | "timestamp" | "source"> {
  return {
    connected: true,
    mapId: packet.mapId || null,
    position: packet.position,
    heading: packet.heading,
    characterName: packet.characterName,
    gameBuild: packet.gameBuild,
    inCombat: Boolean(packet.uiState & (1 << 6)),
    cameraPosition: packet.cameraPosition,
    cameraFront: packet.cameraFront,
  };
}
