import { describe, expect, it } from "vitest";
import {
  parseProtonPacket,
  PROTON_PACKET_SIZE,
  protonPacketToSnapshot,
} from "./proton-packet.js";

describe("Proton relay protocol", () => {
  it("decodes a versioned loopback packet", () => {
    const packet = Buffer.alloc(PROTON_PACKET_SIZE);
    packet.write("ZNML", 0, "ascii");
    packet.writeUInt16LE(2, 4);
    packet.writeUInt16LE(PROTON_PACKET_SIZE, 6);
    packet.writeUInt32LE(91, 8);
    packet.writeUInt32LE(15, 12);
    packet.writeUInt32LE(170001, 16);
    packet.writeUInt32LE(1 << 6, 20);
    packet.writeUInt32LE(12345, 24);
    packet.writeFloatLE(44087.8, 28);
    packet.writeFloatLE(29386.4, 32);
    packet.writeFloatLE(Math.PI / 2, 36);
    packet.writeUInt8(8, 40);
    packet.write("Proton Mesmer", 44, "utf8");
    packet.writeFloatLE(10, 172);
    packet.writeFloatLE(2, 176);
    packet.writeFloatLE(4, 180);
    packet.writeFloatLE(0.5, 184);
    packet.writeFloatLE(0, 188);
    packet.writeFloatLE(-0.5, 192);

    const parsed = parseProtonPacket(packet);
    expect(parsed).toMatchObject({
      tick: 91,
      mapId: 15,
      gameBuild: 170001,
      processId: 12345,
      mountIndex: 8,
      characterName: "Proton Mesmer",
      cameraPosition: [10, 2, 4],
      cameraFront: [0.5, 0, -0.5],
    });
    expect(parsed.position?.[0]).toBeCloseTo(44087.8, 1);
    expect(parsed.heading).toBeCloseTo(Math.PI / 2);
    expect(protonPacketToSnapshot(parsed)).toMatchObject({
      connected: true,
      mapId: 15,
      inCombat: true,
      characterName: "Proton Mesmer",
    });
  });

  it("rejects foreign and truncated datagrams", () => {
    expect(() => parseProtonPacket(Buffer.alloc(12))).toThrow(RangeError);
    const packet = Buffer.alloc(PROTON_PACKET_SIZE);
    expect(() => parseProtonPacket(packet)).toThrow(TypeError);
  });
});
