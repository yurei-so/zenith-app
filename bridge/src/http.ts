import type { IncomingMessage, ServerResponse } from "node:http";
import { Gw2ApiClient } from "./gw2-api.js";
import type { GuideChatClient } from "./guide-chat.js";
import type { PlayerSnapshot } from "./types.js";

const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function setCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
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
  guide: Pick<GuideChatClient, "submit">,
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
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/api/guide/turn") {
      let input: Awaited<ReturnType<typeof readGuideInput>>;
      try {
        input = await readGuideInput(request);
      } catch {
        sendJson(response, 400, { error: "INVALID_GUIDE_REQUEST" });
        return;
      }
      try {
        sendJson(response, 200, await guide.submit(input.message, input.conversationId));
      } catch {
        sendJson(response, 503, { error: "GUIDE_UNAVAILABLE" });
      }
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
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

async function readGuideInput(request: IncomingMessage) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new Error("JSON required");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.byteLength;
    if (size > 16 * 1024) throw new Error("Request too large");
    chunks.push(value);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message || message.length > 4_000) throw new Error("Invalid message");
  const conversationId = input.conversationId;
  if (conversationId !== undefined &&
      (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId))) {
    throw new Error("Invalid conversation ID");
  }
  return { message, ...(typeof conversationId === "string" ? { conversationId } : {}) };
}
