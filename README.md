# Zenith

A local-first Guild Wars 2 map-completion companion. Zenith pairs ArenaNet's
official world-map tiles with read-only MumbleLink telemetry, then helps the
player choose and track objectives without automating game input.

## First milestone

- one polished Queensdale map;
- all 17 renown-heart markers from the public GW2 API;
- a moving player marker over a normalized localhost WebSocket contract;
- manual completion toggles with local persistence;
- event-driven confetti, heart bounce, completion toast, and next-objective pulse;
- reduced-motion behavior;
- responsive desktop and compact layouts.

The local backend uses native read-only MumbleLink telemetry on Windows and a
small same-prefix relay when GW2 runs through Proton on Linux. An explicit
simulator remains available for development without the game. The backend also
provides cached, allowlisted access to public Guild Wars 2 map data.

To show live account and current-character progression, create a Guild Wars 2
API key with `account`, `progression`, and `characters` permissions and provide
it only to the local backend:

```bash
ZENITH_GW2_API_KEY=your-key npm run dev
```

The key stays in the backend process and is never sent to the browser. Zenith
refreshes the normalized `/api/progression` view every 30 seconds; manual map
completion remains available when no key is configured.

## Run it

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. `npm run dev` starts both the Vite app and the
loopback-only backend at `http://127.0.0.1:38421`; player snapshots use its
root WebSocket endpoint. On Linux, the relay waits for a running `Gw2-64.exe`
and automatically joins its live Proton prefix.

```bash
npm test
npm run check
npm run build
```

## Architecture

```text
GW2 MumbleLink shared memory
   ├── Windows: native backend
   └── Proton: same-prefix relay ── loopback UDP
                                             │
                                             ▼
ArenaNet public API ── cache/allowlist ── native backend :38421
                                             ▼
                         normalized WebSocket│and HTTP API
                                             ▼
React state ── OpenLayers map ── completion store (localStorage)
                   │
                   └── explicit domain events ── celebration effects
```

Celebrations subscribe to `heart:completed` domain events. They are not React
render side effects, so Strict Mode, reconnects, and ordinary rerenders cannot
replay confetti.

Coordinate conventions live in `src/domain/coordinates.ts`. The tile layer and
API markers use continent coordinates. Mumble avatar coordinates are meters and
must first become game/event-coordinate inches before applying a map's
`map_rect` → `continent_rect` transform. Recent GW2 Mumble context also exposes
continent `playerX`/`playerY`, which the native adapter can prefer when valid.

The map uses each zone's `continent_rect` as both its movement boundary and tile
layer boundary. World wrapping is disabled and OpenLayers requests only the
visible tile subset. At zoom 4 Queensdale intersects 6 tiles; even at maximum
zoom it intersects only 150.

The player control in the map's upper-right corner supports focus/follow.
Dragging the map or selecting an objective exits follow mode while preserving a
stable north-up view.

Zenith Guide is an optional workstation-local conversation surface. The React
panel sends bounded messages to the loopback backend, which proxies them over an
owner-only Unix socket to the dedicated `zenith.scene-aware` Chat Runtime role.
Chat Runtime captures one privacy-projected Zenith Vision scene per turn; the
browser never receives screenshots, OCR, model-routing details, roles, or the
runtime wake envelope. If the guide is unavailable, maps and telemetry continue
normally and the panel reports an isolated error.

Queensdale's landmark POIs are layered from the public map payload rather than
assumed to be legible in the raster tiles. They can be toggled manually and
remain visible in a muted gray completed state. Existing heart completion
storage is migrated additively to retain prior progress.

Vista completion can also be inferred prospectively from MumbleLink. Zenith
only arms the detector when exactly one incomplete vista is within 300 game
units, the player is stationary and out of combat, and camera telemetry shows
sustained translation and rotation followed by a settle period. This is a
conservative local heuristic because neither MumbleLink nor the authenticated
Guild Wars 2 API exposes a vista-completed event or historical objective IDs.

## Data and attribution

Queensdale metadata is a small checked-in fixture sourced from the unauthenticated
Guild Wars 2 API. Map imagery is loaded at runtime from ArenaNet's official tile
service and attributed in the UI.

Guild Wars 2 and all associated content are © ArenaNet. Zenith is an unofficial
fan project and is not affiliated with or endorsed by ArenaNet.
