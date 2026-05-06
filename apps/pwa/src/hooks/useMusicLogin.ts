import { useCallback, useEffect, useRef, useState } from "react";
import type { MusicBootstrap, NeteaseQrLoginSession } from "@indio/contracts";
import {
  checkMusicQrLogin,
  createMusicQrLogin,
  fetchMusicBootstrap,
  logoutMusic
} from "../lib/api";

export function useMusicLogin() {
  const [bootstrap, setBootstrap] = useState<MusicBootstrap | null>(null);
  const [qrSession, setQrSession] = useState<NeteaseQrLoginSession | null>(null);
  const [qrStatusMessage, setQrStatusMessage] = useState<string | null>(null);
  const [isStartingMusicLogin, setIsStartingMusicLogin] = useState(false);
  const [isLoggingOutMusic, setIsLoggingOutMusic] = useState(false);
  const qrPollingTimer = useRef<number | null>(null);

  const syncMusicBootstrap = useCallback((music: MusicBootstrap) => {
    setBootstrap(music);
    setQrSession((current) => {
      if (music.loggedIn) {
        return null;
      }

      return music.loginSession ?? current;
    });
  }, []);

  const refreshMusicBootstrap = useCallback(async (): Promise<MusicBootstrap> => {
    const bootstrapResponse = await fetchMusicBootstrap();

    syncMusicBootstrap(bootstrapResponse.music);
    if (bootstrapResponse.music.loggedIn) {
      setQrStatusMessage("网易云已连接，电台会优先从你的歌单里选歌。");
    }

    return bootstrapResponse.music;
  }, [syncMusicBootstrap]);

  const startMusicLogin = useCallback(async () => {
    setIsStartingMusicLogin(true);
    setQrStatusMessage(null);

    try {
      const response = await createMusicQrLogin();
      setQrSession(response.session);
      setQrStatusMessage("请用网易云音乐 App 扫码并确认登录。");
      await refreshMusicBootstrap();
    } catch (loginError: unknown) {
      setQrStatusMessage(loginError instanceof Error ? loginError.message : "网易云二维码生成失败");
    } finally {
      setIsStartingMusicLogin(false);
    }
  }, [refreshMusicBootstrap]);

  const disconnectMusic = useCallback(async () => {
    setIsLoggingOutMusic(true);
    setQrStatusMessage(null);

    try {
      const response = await logoutMusic();
      syncMusicBootstrap(response.music);
      setQrStatusMessage("已断开网易云。");
    } catch (logoutError: unknown) {
      setQrStatusMessage(logoutError instanceof Error ? logoutError.message : "网易云退出登录失败");
    } finally {
      setIsLoggingOutMusic(false);
    }
  }, [syncMusicBootstrap]);

  useEffect(() => {
    if (!qrSession?.key || bootstrap?.loggedIn) {
      if (qrPollingTimer.current !== null) {
        window.clearTimeout(qrPollingTimer.current);
        qrPollingTimer.current = null;
      }
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await checkMusicQrLogin(qrSession.key);

        if (cancelled) {
          return;
        }

        syncMusicBootstrap(response.music);
        setQrStatusMessage(
          response.status.authorized || response.music.loggedIn
            ? "网易云已连接，电台会优先从你的歌单里选歌。"
            : response.status.state === "expired"
              ? "二维码已过期，请重新生成。"
              : response.status.message
        );

        if (response.status.authorized || response.music.loggedIn || response.status.state === "expired") {
          return;
        }
      } catch (pollError: unknown) {
        if (!cancelled) {
          setQrStatusMessage(pollError instanceof Error ? pollError.message : "网易云登录状态检查失败");
        }
      }

      if (!cancelled) {
        qrPollingTimer.current = window.setTimeout(poll, 2000);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (qrPollingTimer.current !== null) {
        window.clearTimeout(qrPollingTimer.current);
        qrPollingTimer.current = null;
      }
    };
  }, [qrSession?.key, bootstrap?.loggedIn, syncMusicBootstrap]);

  return {
    bootstrap,
    qrSession,
    qrStatusMessage,
    isStartingMusicLogin,
    isLoggingOutMusic,
    syncMusicBootstrap,
    refreshMusicBootstrap,
    startMusicLogin,
    disconnectMusic
  };
}
