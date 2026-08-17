import type { TelemetrySource } from "./types.js";
import {
  disconnectedMumbleSnapshot,
  MUMBLE_LINK_SIZE,
  parseMumbleLink,
} from "./mumblelink-parser.js";

const FILE_MAP_READ = 0x0004;
const PAGE_READWRITE = 0x04;

export async function createMumbleLinkSource(): Promise<TelemetrySource> {
  if (process.platform !== "win32") {
    throw new Error("The native MumbleLink source currently requires Windows");
  }

  const koffi = await import("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  const OpenFileMappingW = kernel32.func(
    "win64",
    "OpenFileMappingW",
    "void *",
    ["uint32_t", "bool", "str16"],
  );
  const MapViewOfFile = kernel32.func(
    "win64",
    "MapViewOfFile",
    "void *",
    ["void *", "uint32_t", "uint32_t", "uint32_t", "size_t"],
  );
  const CreateFileMappingW = kernel32.func(
    "win64",
    "CreateFileMappingW",
    "void *",
    ["void *", "void *", "uint32_t", "uint32_t", "uint32_t", "str16"],
  );
  const UnmapViewOfFile = kernel32.func(
    "win64",
    "UnmapViewOfFile",
    "bool",
    ["void *"],
  );
  const CloseHandle = kernel32.func("win64", "CloseHandle", "bool", ["void *"]);

  let mapping: unknown = null;
  let viewPointer: unknown = null;
  let lastOpenAttempt = 0;
  let lastTick = 0;

  const closeMapping = () => {
    if (viewPointer) UnmapViewOfFile(viewPointer);
    if (mapping) CloseHandle(mapping);
    viewPointer = null;
    mapping = null;
  };

  const openMapping = () => {
    const now = Date.now();
    if (viewPointer || now - lastOpenAttempt < 1000) return Boolean(viewPointer);
    lastOpenAttempt = now;
    mapping = OpenFileMappingW(FILE_MAP_READ, false, "MumbleLink");
    if (!mapping) {
      mapping = CreateFileMappingW(
        -1n,
        null,
        PAGE_READWRITE,
        0,
        MUMBLE_LINK_SIZE,
        "MumbleLink",
      );
    }
    if (!mapping) return false;
    viewPointer = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, MUMBLE_LINK_SIZE);
    if (!viewPointer) {
      CloseHandle(mapping);
      mapping = null;
      return false;
    }
    return true;
  };

  return {
    kind: "mumblelink",
    read() {
      if (!openMapping() || !viewPointer) return disconnectedMumbleSnapshot();
      try {
        // Copy each tick so the game cannot mutate the external view mid-parse.
        const external = new Uint8Array(koffi.view(viewPointer, MUMBLE_LINK_SIZE));
        const parsed = parseMumbleLink(Uint8Array.from(external));
        const connected = parsed.uiVersion > 0 && parsed.uiTick > 0 && parsed.uiTick !== lastTick;
        lastTick = parsed.uiTick;
        return {
          connected,
          mapId: parsed.mapId || null,
          position: parsed.position,
          heading: parsed.heading,
          characterName: parsed.characterName,
          gameBuild: parsed.gameBuild,
          inCombat: parsed.inCombat,
          cameraPosition: parsed.cameraPosition,
          cameraFront: parsed.cameraFront,
        };
      } catch {
        closeMapping();
        return disconnectedMumbleSnapshot();
      }
    },
    close() {
      closeMapping();
      kernel32.unload();
    },
  };
}
