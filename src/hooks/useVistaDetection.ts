import { useEffect, useRef } from "react";
import { VistaCinematicDetector } from "../domain/vistaDetection";
import type { PlayerSnapshot, ZoneMap } from "../domain/types";

export function useVistaDetection(
  zone: ZoneMap,
  player: PlayerSnapshot,
  completedPois: ReadonlySet<number>,
  onDetected: (poiId: number) => void,
) {
  const detectorRef = useRef(new VistaCinematicDetector());

  useEffect(() => {
    const detectedId = detectorRef.current.update({ zone, player, completedPois });
    if (detectedId !== null && !completedPois.has(detectedId)) onDetected(detectedId);
  }, [completedPois, onDetected, player, zone]);

  useEffect(() => () => detectorRef.current.reset(), [zone.id]);
}
