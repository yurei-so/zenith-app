import { useEffect, useState } from "react";
import type { PlayerSnapshot } from "../domain/types";

const WAITING: PlayerSnapshot = {
  type: "player",
  sequence: 0,
  connected: false,
  mapId: null,
  position: null,
  heading: null,
  characterName: null,
  timestamp: new Date(0).toISOString(),
  source: "mock",
  cameraPosition: null,
  cameraFront: null,
};

export function usePlayerSocket(url = "ws://127.0.0.1:38421") {
  const [player, setPlayer] = useState<PlayerSnapshot>(WAITING);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(url);
      socket.addEventListener("message", (event) => {
        try {
          const snapshot = JSON.parse(String(event.data)) as PlayerSnapshot;
          if (snapshot.type === "player") setPlayer(snapshot);
        } catch {
          // Ignore malformed bridge messages; the last good position is safer.
        }
      });
      socket.addEventListener("close", () => {
        setPlayer((current) => ({ ...current, connected: false }));
        if (!disposed) retry = window.setTimeout(connect, 1500);
      });
      socket.addEventListener("error", () => socket?.close());
    };

    connect();
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [url]);

  return player;
}
