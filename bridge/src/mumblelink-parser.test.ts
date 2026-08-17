import { describe, expect, it } from "vitest";
import { MUMBLE_LINK_SIZE, parseMumbleLink } from "./mumblelink-parser.js";

function writeUtf16(buffer: Buffer, offset: number, value: string) {
  buffer.write(`${value}\0`, offset, "utf16le");
}

describe("MumbleLink parser", () => {
  it("normalizes the stable and extended Guild Wars 2 fields", () => {
    const buffer = Buffer.alloc(MUMBLE_LINK_SIZE);
    buffer.writeUInt32LE(2, 0);
    buffer.writeUInt32LE(42, 4);
    buffer.writeFloatLE(1, 20);
    buffer.writeFloatLE(0, 24);
    buffer.writeFloatLE(0, 28);
    writeUtf16(buffer, 592, JSON.stringify({ name: "A Very Real Mesmer" }));
    buffer.writeUInt32LE(85, 1104);
    buffer.writeUInt32LE(15, 1108 + 28);
    buffer.writeUInt32LE(170000, 1108 + 44);
    buffer.writeUInt32LE(1 << 6, 1108 + 48);
    buffer.writeFloatLE(44087.8, 1108 + 60);
    buffer.writeFloatLE(29386.4, 1108 + 64);
    buffer.writeFloatLE(12, 556);
    buffer.writeFloatLE(3, 560);
    buffer.writeFloatLE(8, 564);
    buffer.writeFloatLE(0.5, 568);
    buffer.writeFloatLE(0, 572);
    buffer.writeFloatLE(-0.5, 576);

    const parsed = parseMumbleLink(buffer);

    expect(parsed).toMatchObject({
      uiVersion: 2,
      uiTick: 42,
      mapId: 15,
      gameBuild: 170000,
      characterName: "A Very Real Mesmer",
      inCombat: true,
    });
    expect(parsed.position?.[0]).toBeCloseTo(44087.8, 1);
    expect(parsed.position?.[1]).toBeCloseTo(29386.4, 1);
    expect(parsed.heading).toBeCloseTo(Math.PI / 2);
    expect(parsed.cameraPosition).toEqual([12, 3, 8]);
    expect(parsed.cameraFront).toEqual([0.5, 0, -0.5]);
  });

  it("rejects truncated mappings before reading offsets", () => {
    expect(() => parseMumbleLink(new Uint8Array(128))).toThrow(RangeError);
  });

  it("tolerates identity JSON while the game is rewriting it", () => {
    const buffer = Buffer.alloc(MUMBLE_LINK_SIZE);
    buffer.writeUInt32LE(2, 0);
    buffer.writeUInt32LE(1, 4);
    writeUtf16(buffer, 44, "Fallback Character");
    writeUtf16(buffer, 592, '{"name":');
    buffer.writeUInt32LE(48, 1104);

    expect(parseMumbleLink(buffer).characterName).toBe("Fallback Character");
  });
});
