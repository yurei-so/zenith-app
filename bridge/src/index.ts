import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Gw2ApiClient } from "./gw2-api.js";
import { createHttpHandler } from "./http.js";
import { createMockSource } from "./mock.js";
import { createMumbleLinkSource } from "./mumblelink.js";
import { createProtonSource } from "./proton.js";
import type { PlayerSnapshot, TelemetrySource } from "./types.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.ZENITH_BACKEND_PORT ?? 38421);
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const startedAt = Date.now();
let sequence = 0;

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new RangeError("ZENITH_BACKEND_PORT must be an integer from 1024 to 65535");
}

function requestedMode() {
  if (process.argv.includes("--mock")) return "mock";
  if (process.argv.includes("--mumble")) return "mumblelink";
  if (process.argv.includes("--proton")) return "proton";
  return process.platform === "win32" ? "mumblelink" : "proton";
}

async function createSource(): Promise<TelemetrySource> {
  const mode = requestedMode();
  if (mode === "mock") return createMockSource();
  if (mode === "proton") return createProtonSource();
  return createMumbleLinkSource();
}

const source = await createSource();
let currentPlayer: PlayerSnapshot = {
  type: "player",
  sequence: sequence++,
  connected: false,
  mapId: null,
  position: null,
  heading: null,
  characterName: null,
  timestamp: new Date().toISOString(),
  source: source.kind,
  cameraPosition: null,
  cameraFront: null,
};

const api = new Gw2ApiClient();
const server = createServer(
  createHttpHandler(api, () => currentPlayer, startedAt),
);
const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const origin = request.headers.origin;
  if (request.url !== "/" || (origin && !LOCAL_ORIGIN.test(origin))) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => {
    sockets.emit("connection", client, request);
  });
});

function sendPlayer(socket: WebSocket) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(currentPlayer));
}

sockets.on("connection", (socket) => sendPlayer(socket));

const timer = setInterval(() => {
  currentPlayer = {
    type: "player",
    sequence: sequence++,
    ...source.read(),
    timestamp: new Date().toISOString(),
    source: source.kind,
  };
  for (const socket of sockets.clients) sendPlayer(socket);
}, 100);

server.listen(PORT, HOST, () => {
  console.log(
    `Zenith backend listening on http://${HOST}:${PORT} ` +
      `(telemetry: ${source.kind})`,
  );
});

function shutdown() {
  clearInterval(timer);
  source.close();
  for (const socket of sockets.clients) socket.close(1001, "Backend shutting down");
  sockets.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
