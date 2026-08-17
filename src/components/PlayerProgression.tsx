import type { PlayerProgression as Progression } from "../domain/types";

interface PlayerProgressionProps {
  progression: Progression | null;
  error: string | null;
}

export function PlayerProgression({ progression, error }: PlayerProgressionProps) {
  const status = error ?? progression?.notice;
  return (
    <section className="player-progression" aria-labelledby="progression-heading">
      <div className="progression-heading">
        <h2 id="progression-heading">Player progression</h2>
        <span className={progression?.configured && !error ? "is-live" : ""}>
          {progression?.configured && !error ? "Live API" : "Setup"}
        </span>
      </div>
      {progression?.character && (
        <div className="character-summary">
          <span className="character-level">{progression.character.level}</span>
          <span><strong>{progression.character.name}</strong><small>{progression.character.profession}</small></span>
        </div>
      )}
      {progression?.configured && (
        <dl className="progression-stats">
          <div><dt>Achievement points</dt><dd>{progression.achievementPoints?.toLocaleString() ?? "—"}</dd></div>
          <div><dt>Mastery points</dt><dd>{progression.masteryPoints ? `${progression.masteryPoints.spent} / ${progression.masteryPoints.earned}` : "—"}</dd></div>
          <div><dt>Fractal level</dt><dd>{progression.fractalLevel ?? "—"}</dd></div>
        </dl>
      )}
      {status && <p className={error ? "is-error" : ""}>{status}</p>}
    </section>
  );
}
