import { useCallback, useEffect, useMemo, useState } from "react";
import { CompletionEffects } from "./components/CompletionEffects";
import { HeartList } from "./components/HeartList";
import { MapCanvas } from "./components/MapCanvas";
import { PlayerProgression } from "./components/PlayerProgression";
import { appEvents } from "./domain/events";
import type { Heart, PlayerSnapshot, PointOfInterest, ZoneMap } from "./domain/types";
import { useCompletion } from "./hooks/useCompletion";
import { useMapData } from "./hooks/useMapData";
import { usePlayerSocket } from "./hooks/usePlayerSocket";
import { usePlayerProgression } from "./hooks/usePlayerProgression";
import { useVistaDetection } from "./hooks/useVistaDetection";

function nearestIncompleteHeart(
  hearts: Heart[],
  completed: Set<number>,
  position: readonly [number, number] | null,
) {
  const remaining = hearts.filter((heart) => !completed.has(heart.id));
  if (!remaining.length) return null;
  if (!position) return remaining.sort((a, b) => a.level - b.level)[0];
  return remaining.reduce((nearest, heart) => {
    const distance = Math.hypot(heart.coordinate[0] - position[0], heart.coordinate[1] - position[1]);
    const nearestDistance = Math.hypot(nearest.coordinate[0] - position[0], nearest.coordinate[1] - position[1]);
    return distance < nearestDistance ? heart : nearest;
  });
}

interface ZoneWorkspaceProps {
  zone: ZoneMap;
  player: PlayerSnapshot;
  loading: boolean;
  error: string | null;
  progression: ReturnType<typeof usePlayerProgression>;
  following: boolean;
  onFollowingChange: (following: boolean) => void;
}

function ZoneWorkspace({
  zone,
  player,
  loading,
  error,
  progression,
  following,
  onFollowingChange,
}: ZoneWorkspaceProps) {
  const {
    completedHearts,
    completedPois,
    toggleHeart: persistHeart,
    togglePoi: persistPoi,
  } = useCompletion(zone.id);
  const [focusedHeart, setFocusedHeart] = useState<Heart | null>(null);
  useVistaDetection(zone, player, completedPois, persistPoi);
  const suggested = useMemo(
    () => nearestIncompleteHeart(zone.hearts, completedHearts, player.position),
    [completedHearts, player.position, zone.hearts],
  );

  const toggleHeart = useCallback(
    (heart: Heart, anchor: HTMLElement) => {
      const becameCompleted = !completedHearts.has(heart.id);
      persistHeart(heart.id);
      if (becameCompleted) {
        const rect = anchor.getBoundingClientRect();
        anchor.classList.remove("heart-bounce");
        void anchor.offsetWidth;
        anchor.classList.add("heart-bounce");
        window.setTimeout(() => anchor.classList.remove("heart-bounce"), 600);
        appEvents.emit("heart:completed", {
          heartId: heart.id,
          markerPoint: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        });
      }
    },
    [completedHearts, persistHeart],
  );

  const togglePoi = useCallback(
    (poi: PointOfInterest) => persistPoi(poi.id),
    [persistPoi],
  );

  const progress = zone.hearts.length
    ? (completedHearts.size / zone.hearts.length) * 100
    : 0;

  return (
    <section className="workspace">
        <aside className="sidebar">
          <div className="zone-heading">
            <span className="eyebrow">{zone.continentName} · {zone.regionName}</span>
            <h1>{zone.name}</h1>
            <p>
              {zone.minLevel || zone.maxLevel
                ? `Level ${zone.minLevel}–${zone.maxLevel} exploration`
                : "Map exploration"}
            </p>
            {loading && <small className="map-data-status">Loading current map…</small>}
            {error && <small className="map-data-status is-error">{error}</small>}
          </div>
          <div className="progress-card">
            <div>
              <span>HEARTS</span>
              <strong>{completedHearts.size}<small> / {zone.hearts.length}</small></strong>
            </div>
            <div className="progress-track">
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
          <PlayerProgression {...progression} />
          <div className="list-heading">
            <h2>Renown hearts</h2>
            <span>{zone.hearts.length - completedHearts.size} remaining</span>
          </div>
          <HeartList
            hearts={zone.hearts}
            completed={completedHearts}
            suggestedId={suggested?.id ?? null}
            onSelect={setFocusedHeart}
            onToggle={toggleHeart}
          />
        </aside>

        <section className="map-panel">
          <MapCanvas
            zone={zone}
            hearts={zone.hearts}
            pois={zone.pointsOfInterest}
            completedHearts={completedHearts}
            completedPois={completedPois}
            suggestedId={suggested?.id ?? null}
            player={player}
            focusedHeart={focusedHeart}
            routeTarget={focusedHeart ?? suggested}
            onToggleHeart={toggleHeart}
            onTogglePoi={togglePoi}
            following={following}
            onFollowingChange={onFollowingChange}
          />
          <div className="map-wash" aria-hidden="true" />
          {suggested && (
            <button className="next-objective" onClick={() => setFocusedHeart(suggested)}>
              <span className="next-icon">♡</span>
              <span><small>SUGGESTED NEXT · LEVEL {suggested.level}</small><strong>{suggested.name}</strong></span>
              <span className="next-arrow">→</span>
            </button>
          )}
        </section>
    </section>
  );
}

export default function App() {
  const player = usePlayerSocket();
  const { map, loading, error } = useMapData(player.mapId);
  const progression = usePlayerProgression(player.connected);
  const [following, setFollowing] = useState(() => {
    try {
      return localStorage.getItem("zenith:map:following") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("zenith:map:following", String(following));
    } catch {
      // Following still persists across map changes when storage is unavailable.
    }
  }, [following]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Zenith home">
          <span className="brand-mark">Z</span>
          <span><strong>ZENITH</strong><small>Map completion companion</small></span>
        </a>
        <div className={`bridge-status ${player.connected ? "is-connected" : ""}`}>
          <i />
          <span>{player.connected ? `${player.source === "mock" ? "Demo trail" : "MumbleLink"} connected` : "Waiting for local bridge"}</span>
        </div>
      </header>
      <ZoneWorkspace
        key={map.id}
        zone={map}
        player={player}
        loading={loading}
        error={error}
        progression={progression}
        following={following}
        onFollowingChange={setFollowing}
      />
      <CompletionEffects />
    </main>
  );
}
