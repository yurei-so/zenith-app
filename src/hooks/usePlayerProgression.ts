import { useEffect, useState } from "react";
import type { PlayerProgression } from "../domain/types";

const API_ROOT = "http://127.0.0.1:38421";

export function usePlayerProgression(connected: boolean) {
  const [progression, setProgression] = useState<PlayerProgression | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const response = await fetch(`${API_ROOT}/api/progression`, {
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as PlayerProgression | { error?: string };
        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : `HTTP ${response.status}`);
        }
        if (!disposed) {
          setProgression(body as PlayerProgression);
          setError(null);
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Progression unavailable");
      } finally {
        if (!disposed) timer = window.setTimeout(refresh, connected ? 30_000 : 5_000);
      }
    };

    void refresh();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [connected]);

  return { progression, error };
}
