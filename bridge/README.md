# Zenith local backend

The backend is a loopback-only service for read-only game telemetry and
allowlisted Guild Wars 2 API data. It never sends input to the game.

## Modes

```bash
# Automatic: native MumbleLink on Windows, Proton relay on Linux
npm run dev:bridge

# Explicit moving Queensdale simulator
npm run bridge:mock

# Explicit native Windows MumbleLink reader
npm run bridge:mumble

# Explicit Proton relay + native Linux backend
npm run bridge:proton
```

The Windows source and Proton relay create-or-open the standard `MumbleLink`
mapping, map their own views read-only, copy each snapshot before parsing, and
reconnect when Guild Wars 2 is not running or restarts. They prefer the
continent-coordinate `playerX`/`playerY` fields from the extended GW2 context.

On Linux, the launcher waits for GW2, discovers its live Wine prefix and
loader, inherits its fsync/esync settings, and runs the 56 KB relay inside that
same wineserver. The relay forwards a versioned binary packet to UDP
`127.0.0.1:38423`; the HTTP/WebSocket backend remains a native Linux process.
See `proton/README.md` for the boundary and reproducible build details.

## HTTP API

The backend listens only on `127.0.0.1:38421`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Backend, telemetry, and API-cache status |
| `GET /api/player` | Latest normalized player snapshot |
| `GET /api/maps` | IDs explicitly registered with the backend |
| `GET /api/maps/15` | Normalized Queensdale metadata, hearts, and landmark POIs |
| `GET /api/maps/15?refresh=1` | Force an upstream refresh |
| `POST /api/guide/turn` | Submit one bounded message to the owner-local Zenith Guide runtime |
| `WS /` | Player snapshots at 10 Hz |

ArenaNet requests are restricted to registered maps, deduplicated while in
flight, cached for five minutes, aborted after eight seconds, and fall back to a
stale cached response during a transient upstream failure. No arbitrary proxy
URL is accepted.

Guide requests accept only a message and optional conversation UUID. The
backend fixes the runtime role, communicates over the configured Unix socket,
and returns only the conversation UUID and response text. Runtime decisions,
scene evidence, prompts, and provider details remain behind the local boundary.

Example WebSocket or `/api/player` payload:

```json
{
  "type": "player",
  "sequence": 42,
  "connected": true,
  "mapId": 15,
  "position": [43728.4, 28589.9],
  "heading": 1.2,
  "characterName": "Example",
  "timestamp": "2026-07-27T00:00:00.000Z",
  "source": "mumblelink",
  "gameBuild": 170000,
  "inCombat": false
}
```

Security boundaries:

- bind only to `127.0.0.1`;
- accept WebSocket clients only from localhost browser origins;
- expose normalized telemetry, never raw shared-memory buffers;
- keep upstream API routes allowlisted;
- never send input to Guild Wars 2.
