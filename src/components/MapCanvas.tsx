import Map from "ol/Map";
import Overlay from "ol/Overlay";
import View from "ol/View";
import { defaults as defaultControls } from "ol/control/defaults";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import Projection from "ol/proj/Projection";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import TileGrid from "ol/tilegrid/TileGrid";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  continentBoundsToTileRange,
  mumbleHeadingToScreenRadians,
} from "../domain/coordinates";
import { appEvents } from "../domain/events";
import { buildColorRoute } from "../domain/colorPathfinding";
import type {
  ContinentPoint,
  Heart,
  PlayerSnapshot,
  PointOfInterest,
  ZoneMap,
} from "../domain/types";

interface MapCanvasProps {
  zone: ZoneMap;
  hearts: Heart[];
  pois: PointOfInterest[];
  completedHearts: Set<number>;
  completedPois: Set<number>;
  suggestedId: number | null;
  player: PlayerSnapshot;
  focusedHeart: Heart | null;
  routeTarget: Heart | null;
  onToggleHeart: (heart: Heart, anchor: HTMLElement) => void;
  onTogglePoi: (poi: PointOfInterest, anchor: HTMLElement) => void;
  following: boolean;
  onFollowingChange: (following: boolean) => void;
}

interface ObjectiveOverlay {
  overlay: Overlay;
  element: HTMLButtonElement;
}

function toMapCoordinate(point: ContinentPoint): [number, number] {
  return [point[0], -point[1]];
}

function updateHeartElement(
  element: HTMLButtonElement,
  complete: boolean,
  suggested: boolean,
) {
  element.className = `map-heart ${complete ? "is-complete" : ""} ${suggested ? "is-suggested" : ""}`;
  element.textContent = complete ? "♥" : "♡";
}

function updatePoiElement(
  element: HTMLButtonElement,
  kind: PointOfInterest["kind"],
  complete: boolean,
) {
  element.className =
    `map-poi map-poi--${kind} ${complete ? "is-complete" : ""}`;
}

export function MapCanvas({
  zone,
  hearts,
  pois,
  completedHearts,
  completedPois,
  suggestedId,
  player,
  focusedHeart,
  routeTarget,
  onToggleHeart,
  onTogglePoi,
  following,
  onFollowingChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const heartOverlaysRef = useRef(new globalThis.Map<number, ObjectiveOverlay>());
  const poiOverlaysRef = useRef(new globalThis.Map<number, ObjectiveOverlay>());
  const playerOverlayRef = useRef<Overlay | null>(null);
  const playerElementRef = useRef<HTMLDivElement | null>(null);
  const routeSourceRef = useRef<VectorSource | null>(null);
  const [routeEnabled, setRouteEnabled] = useState(false);
  const [routeStatus, setRouteStatus] = useState<"idle" | "sampling" | "ready" | "error">("idle");
  const [routeDetail, setRouteDetail] = useState("Experimental");
  const playerAvailable =
    player.connected && player.position !== null && player.mapId === zone.id;
  // MumbleLink updates rapidly. Recalculate only after meaningful movement so
  // color sampling and A* do not run on every telemetry packet.
  const routeStartX = player.position
    ? Math.round(player.position[0] / 256) * 256
    : null;
  const routeStartY = player.position
    ? Math.round(player.position[1] / 256) * 256
    : null;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const heartOverlays = heartOverlaysRef.current;
    const poiOverlays = poiOverlaysRef.current;
    const continentExtent = [
      0,
      -zone.continentDimensions[1],
      zone.continentDimensions[0],
      0,
    ];
    const zoneExtent = [
      zone.continentRect[0][0],
      -zone.continentRect[1][1],
      zone.continentRect[1][0],
      -zone.continentRect[0][1],
    ];
    const resolutions = Array.from(
      { length: zone.maxZoom + 1 },
      (_, zoom) => 2 ** (zone.maxZoom - zoom),
    );
    const projection = new Projection({
      code: `GW2:CONTINENT:${zone.continentId}`,
      units: "pixels",
      extent: continentExtent,
    });
    const tileGrid = new TileGrid({
      extent: continentExtent,
      origin: [0, 0],
      resolutions,
      tileSize: 256,
    });

    const tileSource = new XYZ({
      projection,
      tileGrid,
      tileUrlFunction: (tileCoordinate) => {
        if (!tileCoordinate) return undefined;
        const [zoom, x, y] = tileCoordinate;
        const allowed = continentBoundsToTileRange(
          zone.continentRect,
          zoom,
          zone.maxZoom,
        );
        if (
          x < allowed.minX ||
          x > allowed.maxX ||
          y < allowed.minY ||
          y > allowed.maxY
        ) {
          return undefined;
        }
        return `https://tiles.guildwars2.com/${zone.continentId}/${zone.floorId}/${zoom}/${x}/${y}.jpg`;
      },
      wrapX: false,
      transition: 180,
      attributions: "Map tiles © ArenaNet",
    });
    const map = new Map({
      target: containerRef.current,
      controls: defaultControls({ rotate: false }),
      layers: [new TileLayer({ source: tileSource, preload: 0 })],
      view: new View({
        projection,
        center: toMapCoordinate(zone.center),
        extent: zoneExtent,
        resolutions,
        zoom: zone.minZoom,
        minZoom: zone.minZoom,
        maxZoom: zone.maxZoom,
        constrainResolution: true,
      }),
    });
    const routeSource = new VectorSource();
    map.addLayer(new VectorLayer({
      source: routeSource,
      zIndex: 30,
      style: new Style({
        stroke: new Stroke({ color: "rgba(255, 210, 94, .9)", width: 4, lineDash: [10, 8] }),
      }),
    }));
    routeSourceRef.current = routeSource;
    map.getView().fit(zoneExtent, {
      padding: [28, 28, 108, 28],
      nearest: true,
    });
    map.on("pointerdrag", () => {
      onFollowingChange(false);
    });
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      heartOverlays.clear();
      poiOverlays.clear();
      playerOverlayRef.current = null;
      playerElementRef.current = null;
      routeSourceRef.current = null;
      mapRef.current = null;
    };
  }, [onFollowingChange, zone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeIds = new Set(hearts.map((heart) => heart.id));

    for (const [id, heartOverlay] of heartOverlaysRef.current) {
      if (!activeIds.has(id)) {
        map.removeOverlay(heartOverlay.overlay);
        heartOverlaysRef.current.delete(id);
      }
    }

    for (const heart of hearts) {
      let heartOverlay = heartOverlaysRef.current.get(heart.id);
      if (!heartOverlay) {
        const shell = document.createElement("div");
        shell.className = "map-icon-shell";
        const element = document.createElement("button");
        element.type = "button";
        element.title = `Level ${heart.level} · ${heart.name}`;
        element.ariaLabel = `${heart.name}, level ${heart.level}`;
        element.addEventListener("click", () => onToggleHeart(heart, element));
        shell.append(element);
        const overlay = new Overlay({
          element: shell,
          positioning: "center-center",
          position: toMapCoordinate(heart.coordinate),
          stopEvent: true,
        });
        map.addOverlay(overlay);
        heartOverlay = { element, overlay };
        heartOverlaysRef.current.set(heart.id, heartOverlay);
      }
      updateHeartElement(
        heartOverlay.element,
        completedHearts.has(heart.id),
        suggestedId === heart.id,
      );
    }
  }, [completedHearts, hearts, onToggleHeart, suggestedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeIds = new Set(pois.map((poi) => poi.id));

    for (const [id, poiOverlay] of poiOverlaysRef.current) {
      if (!activeIds.has(id)) {
        map.removeOverlay(poiOverlay.overlay);
        poiOverlaysRef.current.delete(id);
      }
    }

    for (const poi of pois) {
      let poiOverlay = poiOverlaysRef.current.get(poi.id);
      if (!poiOverlay) {
        const shell = document.createElement("div");
        shell.className = "map-icon-shell";
        const element = document.createElement("button");
        element.type = "button";
        const kindLabel =
          poi.kind === "landmark"
            ? "Point of interest"
            : poi.kind === "waypoint"
              ? "Waypoint"
              : "Vista";
        element.title = `${poi.name} · ${kindLabel}`;
        element.ariaLabel = `${poi.name}, ${kindLabel.toLowerCase()}`;
        element.innerHTML = "<span aria-hidden=\"true\"></span>";
        element.addEventListener("click", () => onTogglePoi(poi, element));
        shell.append(element);
        const overlay = new Overlay({
          element: shell,
          positioning: "center-center",
          position: toMapCoordinate(poi.coordinate),
          stopEvent: true,
        });
        map.addOverlay(overlay);
        poiOverlay = { element, overlay };
        poiOverlaysRef.current.set(poi.id, poiOverlay);
      }
      updatePoiElement(poiOverlay.element, poi.kind, completedPois.has(poi.id));
    }
  }, [completedPois, onTogglePoi, pois]);

  useEffect(
    () =>
      appEvents.on("heart:completed", ({ heartId }) => {
        window.setTimeout(() => {
          const element = heartOverlaysRef.current.get(heartId)?.element;
          if (!element) return;
          element.classList.remove("heart-bounce");
          void element.offsetWidth;
          element.classList.add("heart-bounce");
          window.setTimeout(() => element.classList.remove("heart-bounce"), 600);
        });
      }),
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !player.position || player.mapId !== zone.id) return;
    const location = toMapCoordinate(player.position);

    if (!playerOverlayRef.current) {
      const shell = document.createElement("div");
      shell.className = "map-icon-shell player-icon-shell";
      const element = document.createElement("div");
      element.className = "player-marker";
      element.innerHTML = "<span></span>";
      shell.append(element);
      playerElementRef.current = element;
      playerOverlayRef.current = new Overlay({
        element: shell,
        position: location,
        positioning: "center-center",
        stopEvent: false,
      });
      map.addOverlay(playerOverlayRef.current);
    } else {
      playerOverlayRef.current.setPosition(location);
    }

    if (following) map.getView().setCenter(location);
    playerElementRef.current?.style.setProperty(
      "--heading",
      `${mumbleHeadingToScreenRadians(player.heading ?? 0)}rad`,
    );
  }, [following, player, zone]);

  useEffect(() => {
    if (!focusedHeart) return;
    const map = mapRef.current;
    if (!map) return;
    onFollowingChange(false);
    map.getView().animate({
      center: toMapCoordinate(focusedHeart.coordinate),
      zoom: zone.maxZoom,
      duration: 550,
    });
  }, [focusedHeart, onFollowingChange, zone.maxZoom]);

  useEffect(() => {
    const source = routeSourceRef.current;
    source?.clear();
    if (!routeEnabled || routeStartX === null || routeStartY === null || player.mapId !== zone.id || !routeTarget || !source) {
      setRouteStatus("idle");
      return;
    }
    const controller = new AbortController();
    setRouteStatus("sampling");
    setRouteDetail("Reading map colors…");
    buildColorRoute(zone, [routeStartX, routeStartY], routeTarget.coordinate, controller.signal)
      .then((route) => {
        if (!route.points.length) throw new Error("No gloriously questionable route found");
        source.addFeature(new Feature({
          geometry: new LineString(route.points.map(toMapCoordinate)),
        }));
        setRouteStatus("ready");
        setRouteDetail(`${route.confidence} confidence · ${route.sampledTiles} tiles`);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRouteStatus("error");
        setRouteDetail(error instanceof Error ? error.message : "Route experiment failed");
      });
    return () => controller.abort();
  }, [player.mapId, routeEnabled, routeStartX, routeStartY, routeTarget, zone]);

  const toggleFollowing = useCallback(() => {
    if (!player.position || player.mapId !== zone.id) return;
    const next = !following;
    onFollowingChange(next);
    if (!next) return;
    mapRef.current?.getView().animate({
      center: toMapCoordinate(player.position),
      duration: 300,
    });
  }, [following, onFollowingChange, player.mapId, player.position, zone.id]);

  const objectiveKinds = ["landmark", "waypoint", "vista"] as const;

  return (
    <>
      <div
        className="map-canvas"
        ref={containerRef}
        aria-label={`Interactive map of ${zone.name}`}
      />
      <div className="player-controls" aria-label="Player tracking controls">
        <button
          className={following ? "is-active" : ""}
          disabled={!playerAvailable}
          onClick={toggleFollowing}
          aria-pressed={following}
          title={following ? "Stop following player" : "Focus and follow player"}
        >
          <span aria-hidden="true">⌖</span>
          <small>{following ? "Following" : "Follow"}</small>
        </button>
        <button
          className={routeEnabled ? "is-active is-experimental" : "is-experimental"}
          disabled={!playerAvailable || !routeTarget}
          onClick={() => setRouteEnabled((enabled) => !enabled)}
          aria-pressed={routeEnabled}
          title={routeTarget ? `Color-route to ${routeTarget.name}` : "Select a heart to route"}
        >
          <span aria-hidden="true">⌁</span>
          <small>{routeStatus === "sampling" ? "Sampling" : "Chaos route"}</small>
          {routeEnabled && <em>{routeDetail}</em>}
        </button>
      </div>
      <div className="map-legend" aria-label="Map objective legend">
        {objectiveKinds.map((kind) => {
          const objectives = pois.filter((poi) => poi.kind === kind);
          const completed = objectives.filter((poi) =>
            completedPois.has(poi.id),
          ).length;
          return (
            <span className="legend-item" key={kind}>
              <i
                className={`legend-marker legend-marker--${kind}`}
                aria-hidden="true"
              >
                <b />
              </i>
              <span>
                <strong>{completed} / {objectives.length}</strong>
                {kind === "landmark" ? "points of interest" : `${kind}s`}
              </span>
            </span>
          );
        })}
      </div>
    </>
  );
}
