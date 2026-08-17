import type { IncomingMessage, ServerResponse } from "node:http";
import { Gw2ApiClient } from "./gw2-api.js";
import type { PlayerSnapshot } from "./types.js";

const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function setCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

export function createHttpHandler(
  api: Gw2ApiClient,
  getPlayer: () => PlayerSnapshot,
  startedAt: number,
) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/api/health") {
        const player = getPlayer();
        sendJson(response, 200, {
          ok: true,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          telemetry: {
            source: player.source,
            connected: player.connected,
            mapId: player.mapId,
            lastSnapshotAt: player.timestamp,
          },
          gw2Api: api.status(),
        });
        return;
      }
      if (url.pathname === "/api/player") {
        sendJson(response, 200, getPlayer());
        return;
      }
      if (url.pathname === "/api/progression") {
        const player = getPlayer();
        sendJson(response, 200, await api.getPlayerProgression(player.characterName));
        return;
      }
      if (url.pathname === "/api/maps") {
        sendJson(response, 200, { ids: api.status().loadedMaps });
        return;
      }

      const match = /^\/api\/maps\/(\d+)$/.exec(url.pathname);
      if (match) {
        const mapId = Number(match[1]);
        const map = await api.getMap(mapId, url.searchParams.get("refresh") === "1");
        sendJson(response, 200, map);
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected backend error";
      sendJson(response, 502, { error: message });
    }
  };
}
