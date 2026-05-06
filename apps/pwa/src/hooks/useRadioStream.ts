import { useEffect } from "react";
import type { NowState, StreamEvent } from "@indio/contracts";
import { API_BASE } from "../lib/api";

export function useRadioStream(
  setNowState: (state: NowState) => void,
  setError: (message: string | null | ((current: string | null) => string | null)) => void
): void {
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      socket = new WebSocket(API_BASE.replace("http", "ws") + "/ws/radio");

      socket.addEventListener("open", () => {
        setError((current) => (current === "实时连接暂时不可用" ? null : current));
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data) as StreamEvent;

        setError((current) => (current === "实时连接暂时不可用" ? null : current));

        if (payload.type !== "radio.state") {
          return;
        }

        setNowState(payload.payload);
      });

      socket.addEventListener("error", () => {
        setError("实时连接暂时不可用");
        socket?.close();
      });

      socket.addEventListener("close", () => {
        if (cancelled) {
          return;
        }

        setError("实时连接暂时不可用");
        reconnectTimer = window.setTimeout(connect, 2000);
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [setError, setNowState]);
}
