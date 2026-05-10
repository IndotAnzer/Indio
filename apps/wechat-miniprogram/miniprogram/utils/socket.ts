import {
  INDIO_WS_RECONNECT_MS,
  cloudContainerRequestConfig,
  indioNetworkConfigError,
  shouldUseCloudContainer
} from "./config";
import { authHeaders, websocketUrl } from "./api";
import type { NowState, StreamEvent } from "./types";

interface RadioSocketOptions {
  onState: (state: NowState) => void;
  onError: (message: string) => void;
}

export interface RadioSocketController {
  close: () => void;
}

export function connectRadioStream(options: RadioSocketOptions): RadioSocketController {
  let socket: WechatMiniprogram.SocketTask | null = null;
  let reconnectTimer: number | null = null;
  let closed = false;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, INDIO_WS_RECONNECT_MS);
  };

  const bindSocket = (nextSocket: WechatMiniprogram.SocketTask) => {
    socket = nextSocket;

    socket.onMessage((message: any) => {
      try {
        const raw = typeof message.data === "string" ? message.data : String(message.data);
        const event = JSON.parse(raw) as StreamEvent;

        if (event.type === "radio.state") {
          options.onState(event.payload);
        }
      } catch {
        options.onError("实时状态解析失败");
      }
    });

    socket.onError(() => {
      options.onError("实时连接暂时不可用");
    });

    socket.onClose(() => {
      scheduleReconnect();
    });
  };

  const open = () => {
    if (closed) {
      return;
    }

    const configError = indioNetworkConfigError();
    if (configError) {
      options.onError(configError);
      return;
    }

    if (shouldUseCloudContainer()) {
      const base = cloudContainerRequestConfig();
      void wx.cloud.connectContainer({
        config: base.config,
        path: "/ws/radio",
        header: {
          ...base.header,
          ...authHeaders()
        }
      })
        .then((response: any) => {
          const nextSocket = response?.socketTask ?? response;
          if (!closed && nextSocket) {
            bindSocket(nextSocket);
          }
        })
        .catch(() => {
          options.onError("云托管实时连接暂时不可用");
          scheduleReconnect();
        });
      return;
    }

    bindSocket(wx.connectSocket({
      url: websocketUrl("/ws/radio"),
      header: authHeaders()
    }));
  };

  open();

  return {
    close() {
      closed = true;
      clearReconnect();
      if (socket) {
        socket.close({});
        socket = null;
      }
    }
  };
}
