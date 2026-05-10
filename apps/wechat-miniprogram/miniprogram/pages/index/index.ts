import {
  advanceRadio,
  checkMusicQrLogin,
  createMusicQrLogin,
  fetchBootstrap,
  fetchMusicBootstrap,
  fetchNow,
  logoutMusic,
  submitChat
} from "../../utils/api";
import { createRadioAudioContext, PlaybackStoppedError, playAudioUrl, stopAudio, type AudioMetadata, type RadioAudioContext } from "../../utils/audio";
import { ensureWechatSession } from "../../utils/auth";
import { INDIO_API_BASE_URL } from "../../utils/config";
import { connectRadioStream, type RadioSocketController } from "../../utils/socket";
import type { MusicBootstrap, NeteaseQrLoginSession, NowState, PreparedSegment, Track } from "../../utils/types";

interface IndexData {
  apiBaseUrl: string;
  nowState: NowState | null;
  music: MusicBootstrap | null;
  currentTrack: Track | null;
  queue: Track[];
  artworkUrl: string;
  stationTitle: string;
  trackTitle: string;
  trackLine: string;
  narrationText: string;
  narrationChars: NarrationChar[];
  narrationReady: boolean;
  showMusicFlow: boolean;
  draft: string;
  error: string | null;
  musicMessage: string | null;
  isSending: boolean;
  isPlaybackPlaying: boolean;
  isPlaybackPaused: boolean;
  isNarrationPlaying: boolean;
  playbackLabel: string;
  isStartingMusicLogin: boolean;
  isLoggingOutMusic: boolean;
  qrSession: NeteaseQrLoginSession | null;
  qrImageSrc: string | null;
  qrStatusMessage: string | null;
  musicStatusText: string;
  agentStatusText: string;
}

interface NarrationChar {
  key: string;
  char: string;
  state: "idle" | "read" | "active" | "space" | "break";
}

function materializePreparedSegment(segment: PreparedSegment): NowState {
  return {
    segmentId: segment.segmentId,
    updatedAt: segment.preparedAt,
    source: segment.source,
    mood: segment.mood,
    mode: segment.mode,
    provider: segment.provider,
    narrationText: segment.narrationText,
    narrationAudioUrl: segment.narrationAudioUrl,
    segue: segment.segue,
    reason: segment.reason,
    outputDevice: segment.outputDevice,
    nowPlaying: segment.nowPlaying,
    queuedTracks: segment.queuedTracks,
    preparedNext: null
  };
}

function preserveReadyNarration(nextState: NowState, currentState: NowState | null): NowState {
  if (
    currentState?.segmentId === nextState.segmentId &&
    currentState.narrationAudioUrl &&
    !nextState.narrationAudioUrl
  ) {
    return { ...nextState, narrationAudioUrl: currentState.narrationAudioUrl };
  }

  return nextState;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function makeTrackLine(track: Track | null): string {
  if (!track) {
    return "夜色已校准，唱片待命。";
  }

  return `${track.artist} · ${track.album}`;
}

function narrationAudioMetadata(state: NowState, stationTitle: string): AudioMetadata {
  return {
    title: state.nowPlaying ? `Indio 口播：${state.nowPlaying.title}` : "Indio 电台口播",
    epname: stationTitle,
    singer: state.provider?.model || "Indio Agent",
    coverImgUrl: state.nowPlaying?.artworkUrl ?? null
  };
}

function trackAudioMetadata(track: Track, stationTitle: string): AudioMetadata {
  return {
    title: track.title || "Indio Radio",
    epname: track.album || stationTitle,
    singer: track.artist || "Indio",
    coverImgUrl: track.artworkUrl
  };
}

function playbackLabel(isPlaying: boolean, isPaused: boolean): string {
  if (isPlaying) {
    return "暂停";
  }
  if (isPaused) {
    return "继续";
  }
  return "播放";
}

function estimateNarrationDurationMs(text: string): number {
  const speakableCount = Array.from(text).reduce((count, char) => count + (/\s/.test(char) ? 0 : 1), 0);
  return Math.min(18_000, Math.max(2_400, speakableCount * 170 + 700));
}

function buildNarrationChars(text: string, progress: number, isPlaying: boolean): NarrationChar[] {
  const chars = Array.from(text);
  const speakableCount = chars.reduce((count, char) => count + (/\s/.test(char) ? 0 : 1), 0);
  const spokenCount = speakableCount === 0 ? 0 : Math.min(speakableCount, Math.floor(progress * speakableCount));
  let cursor = 0;

  return chars.map((char, index) => {
    const key = `${index}-${char.charCodeAt(0)}`;

    if (char === "\n") {
      return { key, char, state: "break" };
    }

    if (/\s/.test(char)) {
      return { key, char: " ", state: "space" };
    }

    const currentIndex = cursor;
    cursor += 1;

    if (spokenCount >= speakableCount || currentIndex < spokenCount) {
      return { key, char, state: "read" };
    }

    if (isPlaying && currentIndex === spokenCount) {
      return { key, char, state: "active" };
    }

    return { key, char, state: "idle" };
  });
}

function materializeQrImage(session: NeteaseQrLoginSession | null): string | null {
  const source = session?.qrImage;
  if (!source) {
    return null;
  }

  const match = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/i.exec(source);
  if (!match) {
    return source;
  }

  try {
    const extension = match[1].replace("+xml", "") || "png";
    const filepath = `${wx.env.USER_DATA_PATH}/indio-ncm-qr.${extension}`;
    wx.getFileSystemManager().writeFileSync(filepath, match[2], "base64");
    return filepath;
  } catch {
    return source;
  }
}

const QR_LOGIN_REFRESH_MS = 150_000;

function qrRefreshDelay(session: NeteaseQrLoginSession): number {
  const createdAtMs = Date.parse(session.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return QR_LOGIN_REFRESH_MS;
  }

  return Math.max(5_000, createdAtMs + QR_LOGIN_REFRESH_MS - Date.now());
}

Page({
  data: {
    apiBaseUrl: INDIO_API_BASE_URL,
    nowState: null,
    music: null,
    currentTrack: null,
    queue: [],
    artworkUrl: "",
    stationTitle: "Personal Record Radio",
    trackTitle: "等待开播",
    trackLine: "夜色已校准，唱片待命。",
    narrationText: "直播间安静亮着灯。",
    narrationChars: buildNarrationChars("直播间安静亮着灯。", 0, false),
    narrationReady: false,
    showMusicFlow: false,
    draft: "",
    error: null,
    musicMessage: null,
    isSending: false,
    isPlaybackPlaying: false,
    isPlaybackPaused: false,
    isNarrationPlaying: false,
    playbackLabel: "播放",
    isStartingMusicLogin: false,
    isLoggingOutMusic: false,
    qrSession: null,
    qrImageSrc: null,
    qrStatusMessage: null,
    musicStatusText: "未连接网易云",
    agentStatusText: "Indio Agent: standby"
  } as IndexData,

  audio: null as RadioAudioContext | null,
  radioSocket: null as RadioSocketController | null,
  qrPollingTimer: null as number | null,
  qrRefreshTimer: null as number | null,
  activeQrPollingKey: null as string | null,
  pendingTurnPollingTimer: null as number | null,
  pendingNarrationPollingTimer: null as number | null,
  narrationProgressTimer: null as number | null,
  narrationProgress: 0,
  narrationVisualStartedAt: 0,
  narrationVisualDurationMs: 0,
  pendingAutoPlaySegmentId: null as string | null,
  pendingAutoPlayNextState: false,
  playRunId: 0,
  handledAudioEndedKey: null as string | null,
  playbackPhase: "idle" as "idle" | "narration" | "music",
  lastSpokenSegmentId: null as string | null,
  audioPlayStateHandler: null as (() => void) | null,
  audioPauseStateHandler: null as (() => void) | null,
  audioStopStateHandler: null as (() => void) | null,
  audioNextHandler: null as (() => void) | null,

  onLoad() {
    this.audio = createRadioAudioContext();
    this.bindBackgroundAudioControls();
    void this.bootstrapWithAuth();
  },

  onUnload() {
    this.clearQrPolling();
    this.clearQrRefreshTimer();
    this.clearPendingTurnPolling();
    this.clearPendingNarrationPolling();
    this.stopNarrationProgressLoop();
    this.radioSocket?.close();
    this.radioSocket = null;
    if (this.audio) {
      this.unbindBackgroundAudioControls();
      stopAudio(this.audio);
      if (typeof this.audio.destroy === "function") {
        this.audio.destroy();
      }
      this.audio = null;
    }
  },

  onShareAppMessage() {
    return {
      title: "Indio 私人唱片台",
      path: "/pages/index/index"
    };
  },

  bindBackgroundAudioControls() {
    const audio = this.audio as any;
    if (!audio) {
      return;
    }

    this.audioPlayStateHandler = () => {
      if (this.playbackPhase === "idle") {
        return;
      }
      if (this.playbackPhase === "narration") {
        this.startNarrationProgressLoop(this.data.narrationText, this.audio as RadioAudioContext, this.playRunId);
      }
      this.setPlaybackFlags(true, false, this.playbackPhase === "narration");
    };
    this.audioPauseStateHandler = () => {
      if (this.playbackPhase === "narration") {
        this.stopNarrationProgressLoop();
        this.updateNarrationProgress(this.narrationProgress, false);
      }
      if (this.playbackPhase !== "idle") {
        this.setPlaybackFlags(false, true, this.playbackPhase === "narration");
      }
    };
    this.audioStopStateHandler = () => {
      this.stopNarrationProgressLoop();
      this.setPlaybackFlags(false, false, false);
    };
    this.audioNextHandler = () => {
      const now = this.data.nowState;
      if (now?.nowPlaying) {
        void this.advanceFromState(now);
      }
    };

    audio.onPlay?.(this.audioPlayStateHandler);
    audio.onPause?.(this.audioPauseStateHandler);
    audio.onStop?.(this.audioStopStateHandler);
    audio.onNext?.(this.audioNextHandler);
    audio.onPrev?.(this.audioNextHandler);
  },

  unbindBackgroundAudioControls() {
    const audio = this.audio as any;
    if (!audio) {
      return;
    }

    if (this.audioPlayStateHandler) {
      audio.offPlay?.(this.audioPlayStateHandler);
    }
    if (this.audioPauseStateHandler) {
      audio.offPause?.(this.audioPauseStateHandler);
    }
    if (this.audioStopStateHandler) {
      audio.offStop?.(this.audioStopStateHandler);
    }
    if (this.audioNextHandler) {
      audio.offNext?.(this.audioNextHandler);
      audio.offPrev?.(this.audioNextHandler);
    }
    this.audioPlayStateHandler = null;
    this.audioPauseStateHandler = null;
    this.audioStopStateHandler = null;
    this.audioNextHandler = null;
  },

  async bootstrapWithAuth() {
    const authed = await ensureWechatSession().catch((error) => {
      this.setData({
        error: `微信登录失败，已使用本地用户继续：${errorMessage(error, "未知错误")}`
      });
      return false;
    });
    this.connectRadio();
    await this.refreshBootstrap();
    if (authed && this.data.error?.startsWith("微信登录失败")) {
      this.setData({ error: null });
    }
  },

  connectRadio() {
    this.radioSocket?.close();
    this.radioSocket = connectRadioStream({
      onState: (incomingState) => {
        const state = preserveReadyNarration(incomingState, this.data.nowState);
        const message = state.narrationAudioUrl && this.data.musicMessage === "口播音频准备中，稍等一下。"
          ? null
          : this.data.musicMessage;
        const shouldAutoPlayGeneratedState =
          this.pendingAutoPlayNextState &&
          state.provider?.state !== "error" &&
          Boolean(state.nowPlaying);
        const shouldResumePendingAutoplay =
          this.pendingAutoPlaySegmentId === state.segmentId &&
          Boolean(state.nowPlaying?.streamUrl) &&
          (state.mode !== "narrated" || Boolean(state.narrationAudioUrl) || this.lastSpokenSegmentId === state.segmentId);
        const nextMessage = shouldAutoPlayGeneratedState && message === "电台正在选歌，马上开播。" ? null : message;
        this.setData({
          nowState: state,
          musicMessage: nextMessage,
          error: state.provider?.state === "error" ? state.provider.detail || "电台生成失败" : null
        });
        this.syncDerivedState();
        if (state.provider?.state === "error") {
          this.pendingAutoPlayNextState = false;
          this.pendingAutoPlaySegmentId = null;
          this.clearPendingTurnPolling();
          this.clearPendingNarrationPolling();
          return;
        }
        if (shouldAutoPlayGeneratedState) {
          this.pendingAutoPlayNextState = false;
          this.clearPendingTurnPolling();
          void this.playNowState(state);
          return;
        }
        if (shouldResumePendingAutoplay) {
          this.pendingAutoPlaySegmentId = null;
          this.clearPendingNarrationPolling();
          void this.playNowState(state);
        }
      },
      onError: (message) => {
        this.setData({ error: message });
      }
    });
  },

  async refreshBootstrap() {
    try {
      const bootstrap = await fetchBootstrap();
      this.setData({
        nowState: bootstrap.now,
        music: bootstrap.music,
        agentStatusText: `Indio Agent: ${bootstrap.agent.model}`
      });
      this.syncMusicLoginState(bootstrap.music);
      this.syncDerivedState();
    } catch (error) {
      this.setData({ error: errorMessage(error, "电台初始化失败") });
    }
  },

  async refreshMusicBootstrap() {
    try {
      const response = await fetchMusicBootstrap();
      this.syncMusicLoginState(response.music);
    } catch (error) {
      this.setData({ qrStatusMessage: errorMessage(error, "网易云状态刷新失败") });
    }
  },

  syncMusicLoginState(music: MusicBootstrap) {
    this.setData({
      music,
      qrSession: music.loggedIn ? null : music.loginSession,
      qrImageSrc: music.loggedIn ? null : materializeQrImage(music.loginSession),
      musicStatusText: music.loggedIn
        ? `已连接 ${music.user?.nickname ?? "网易云"}`
        : music.configured
          ? "未连接网易云"
          : "网易云服务未配置"
    });

    if (music.loggedIn) {
      this.clearQrPolling();
      this.clearQrRefreshTimer();
      return;
    }

    if (music.loginSession && this.activeQrPollingKey !== music.loginSession.key) {
      this.pollQrLogin(music.loginSession.key);
      this.scheduleQrRefresh(music.loginSession);
    }
  },

  syncDerivedState() {
    const now = this.data.nowState;
    const music = this.data.music;
    const currentTrack = now?.nowPlaying ?? null;
    const narrationText = now?.narrationText || (currentTrack ? "这一轮没有口播，先把音乐往下接。" : "直播间安静亮着灯。");
    const isNarrationActive = this.data.isPlaybackPlaying && this.data.isNarrationPlaying;

    this.setData({
      currentTrack,
      queue: now?.queuedTracks?.slice(0, 3) ?? [],
      artworkUrl: currentTrack?.artworkUrl ?? "",
      stationTitle: music?.loggedIn ? `${music.user?.nickname ?? "你的"}的私人唱片台` : "Personal Record Radio",
      trackTitle: currentTrack?.title ?? "等待开播",
      trackLine: makeTrackLine(currentTrack),
      narrationText,
      narrationChars: buildNarrationChars(narrationText, this.narrationProgress, isNarrationActive),
      narrationReady: Boolean(now?.narrationAudioUrl),
      showMusicFlow: Boolean(currentTrack && this.data.isPlaybackPlaying && !this.data.isNarrationPlaying),
      playbackLabel: playbackLabel(this.data.isPlaybackPlaying, this.data.isPlaybackPaused)
    });
  },

  handleDraftInput(event: any) {
    this.setData({ draft: String(event.detail.value ?? "") });
  },

  async submitTurn() {
    const message = this.data.draft.trim();
    if (!message || this.data.isSending) {
      return;
    }

    this.clearPendingTurnPolling();
    this.clearPendingNarrationPolling();
    this.pendingAutoPlaySegmentId = null;
    this.pendingAutoPlayNextState = true;
    this.setData({ isSending: true, error: null, musicMessage: "电台正在选歌，马上开播。" });

    try {
      const response = await submitChat(message);
      const nextState = preserveReadyNarration(response.nowState, this.data.nowState);
      this.setData({ nowState: nextState, draft: "" });
      this.syncDerivedState();
      void this.refreshMusicBootstrap();
      if (nextState.nowPlaying) {
        this.pendingAutoPlayNextState = false;
        this.setData({ musicMessage: null });
        await this.playNowState(nextState);
        return;
      }
      this.startPendingTurnPolling(nextState.segmentId);
    } catch (error) {
      this.pendingAutoPlayNextState = false;
      this.setData({ error: errorMessage(error, "电台生成失败") });
    } finally {
      this.setData({ isSending: false });
    }
  },

  clearPendingTurnPolling() {
    if (this.pendingTurnPollingTimer !== null) {
      clearTimeout(this.pendingTurnPollingTimer);
      this.pendingTurnPollingTimer = null;
    }
  },

  startPendingTurnPolling(pendingSegmentId: string) {
    this.clearPendingTurnPolling();

    const poll = async () => {
      if (!this.pendingAutoPlayNextState) {
        this.pendingTurnPollingTimer = null;
        return;
      }

      try {
        const response = await fetchNow();
        const nextState = response.now ? preserveReadyNarration(response.now, this.data.nowState) : null;
        if (nextState && nextState.segmentId !== pendingSegmentId) {
          this.setData({
            nowState: nextState,
            musicMessage: nextState.provider?.state === "error" ? this.data.musicMessage : null,
            error: nextState.provider?.state === "error" ? nextState.provider.detail || "电台生成失败" : null
          });
          this.syncDerivedState();
          this.pendingAutoPlayNextState = false;
          this.clearPendingTurnPolling();
          if (nextState.provider?.state !== "error" && nextState.nowPlaying) {
            await this.playNowState(nextState);
          }
          return;
        }
      } catch {
        // WebSocket usually delivers the result first; polling is only a fallback.
      }

      this.pendingTurnPollingTimer = setTimeout(poll, 2_000);
    };

    this.pendingTurnPollingTimer = setTimeout(poll, 2_000);
  },

  clearPendingNarrationPolling() {
    if (this.pendingNarrationPollingTimer !== null) {
      clearTimeout(this.pendingNarrationPollingTimer);
      this.pendingNarrationPollingTimer = null;
    }
  },

  startPendingNarrationPolling(segmentId: string) {
    this.clearPendingNarrationPolling();

    const poll = async () => {
      if (this.pendingAutoPlaySegmentId !== segmentId) {
        this.pendingNarrationPollingTimer = null;
        return;
      }

      try {
        const response = await fetchNow();
        const nextState = response.now ? preserveReadyNarration(response.now, this.data.nowState) : null;

        if (nextState?.segmentId === segmentId) {
          const narrationIsReady =
            nextState.mode !== "narrated" ||
            Boolean(nextState.narrationAudioUrl) ||
            this.lastSpokenSegmentId === nextState.segmentId;
          const nextMessage =
            narrationIsReady && this.data.musicMessage === "口播音频准备中，稍等一下。"
              ? null
              : this.data.musicMessage;

          this.setData({
            nowState: nextState,
            musicMessage: nextMessage,
            error: nextState.provider?.state === "error" ? nextState.provider.detail || "电台生成失败" : null
          });
          this.syncDerivedState();

          if (nextState.provider?.state === "error") {
            this.pendingAutoPlaySegmentId = null;
            this.clearPendingNarrationPolling();
            return;
          }

          if (nextState.nowPlaying?.streamUrl && narrationIsReady && this.pendingAutoPlaySegmentId === segmentId) {
            this.pendingAutoPlaySegmentId = null;
            this.clearPendingNarrationPolling();
            await this.playNowState(nextState);
            return;
          }
        }
      } catch {
        // WebSocket is still the primary path; polling only covers missed ready updates.
      }

      this.pendingNarrationPollingTimer =
        this.pendingAutoPlaySegmentId === segmentId ? setTimeout(poll, 2_000) : null;
    };

    this.pendingNarrationPollingTimer = setTimeout(poll, 1_500);
  },

  handlePlayPause() {
    const audio = this.audio;
    const now = this.data.nowState;

    if (!audio || !now?.nowPlaying) {
      return;
    }

    if (this.data.isPlaybackPlaying) {
      audio.pause();
      if (this.playbackPhase === "narration") {
        this.stopNarrationProgressLoop();
        this.updateNarrationProgress(this.narrationProgress, false);
      }
      this.setPlaybackFlags(false, true, this.playbackPhase === "narration");
      return;
    }

    if (this.data.isPlaybackPaused && this.playbackPhase !== "idle") {
      audio.play();
      if (this.playbackPhase === "narration") {
        this.startNarrationProgressLoop(now.narrationText, audio, this.playRunId);
      }
      this.setPlaybackFlags(true, false, this.playbackPhase === "narration");
      return;
    }

    void this.playNowState(now);
  },

  async handleNext() {
    const now = this.data.nowState;
    if (!now?.nowPlaying) {
      return;
    }

    await this.advanceFromState(now);
  },

  async advanceFromState(state: NowState) {
    if (state.preparedNext) {
      const promoted = materializePreparedSegment(state.preparedNext);
      this.lastSpokenSegmentId = null;
      this.setData({ nowState: promoted, musicMessage: null });
      this.syncDerivedState();
      void advanceRadio(state.segmentId)
        .then((response) => {
          if (response.nowState.segmentId === promoted.segmentId) {
            this.setData({ nowState: response.nowState });
            this.syncDerivedState();
          }
        })
        .catch((error) => {
          this.setData({ musicMessage: errorMessage(error, "下一段电台还没准备好。") });
        });
      await this.playNowState(promoted);
      return;
    }

    try {
      const response = await advanceRadio(state.segmentId);
      this.lastSpokenSegmentId = null;
      this.setData({ nowState: response.nowState, musicMessage: null });
      this.syncDerivedState();
      await this.playNowState(response.nowState);
    } catch (error) {
      this.setData({ musicMessage: errorMessage(error, "下一段电台还没准备好。") });
    }
  },

  async playNowState(state: NowState, options: { skipNarration?: boolean } = {}) {
    const audio = this.audio;
    if (!audio || !state.nowPlaying) {
      return;
    }

    this.playRunId += 1;
    const runId = this.playRunId;
    this.playbackPhase = "idle";
    stopAudio(audio);
    this.setPlaybackFlags(false, false, false);

    if (state.mode === "narrated" && !options.skipNarration && this.lastSpokenSegmentId !== state.segmentId) {
      if (!state.narrationAudioUrl) {
        this.pendingAutoPlaySegmentId = state.segmentId;
        this.stopNarrationProgressLoop();
        this.narrationProgress = 0;
        this.updateNarrationProgress(0, false);
        this.setData({ musicMessage: "口播音频准备中，稍等一下。" });
        this.startPendingNarrationPolling(state.segmentId);
        return;
      }

      try {
        this.playbackPhase = "narration";
        this.pendingAutoPlaySegmentId = null;
        this.clearPendingNarrationPolling();
        this.narrationProgress = 0;
        this.updateNarrationProgress(0, true);
        this.setPlaybackFlags(true, false, true);
        await playAudioUrl(audio, state.narrationAudioUrl, () => {
          this.startNarrationProgressLoop(state.narrationText, audio, runId);
        }, narrationAudioMetadata(state, this.data.stationTitle), () => {
          this.handleAudioEnded(runId, "narration", state);
        });
        if (this.playRunId !== runId) {
          return;
        }
        if (!this.claimAudioEnded(runId, "narration")) {
          return;
        }
        this.finishNarrationPlayback(state, runId);
      } catch (error) {
        if (this.playRunId !== runId || error instanceof PlaybackStoppedError) {
          return;
        }
        this.stopNarrationProgressLoop();
        this.playbackPhase = "idle";
        this.setData({ musicMessage: errorMessage(error, "口播播放失败，请稍后重试。") });
        this.setPlaybackFlags(false, false, false);
        return;
      }
    }

    if (this.playRunId !== runId) {
      return;
    }

    if (!state.nowPlaying.streamUrl) {
      this.playbackPhase = "idle";
      this.setData({ musicMessage: "当前曲目没有可直接播放的音频链接。" });
      this.setPlaybackFlags(false, false, false);
      return;
    }

    try {
      this.playbackPhase = "music";
      this.stopNarrationProgressLoop();
      this.setPlaybackFlags(true, false, false);
      await playAudioUrl(
        audio,
        state.nowPlaying.streamUrl,
        undefined,
        trackAudioMetadata(state.nowPlaying, this.data.stationTitle),
        () => {
          this.handleAudioEnded(runId, "music", state);
        }
      );
      if (this.playRunId !== runId) {
        return;
      }
      if (!this.claimAudioEnded(runId, "music")) {
        return;
      }
      await this.finishMusicPlayback(state, runId);
    } catch (error) {
      if (this.playRunId !== runId || error instanceof PlaybackStoppedError) {
        return;
      }
      this.playbackPhase = "idle";
      this.setData({ musicMessage: errorMessage(error, "音乐播放失败") });
      this.setPlaybackFlags(false, false, false);
    }
  },

  claimAudioEnded(runId: number, phase: "narration" | "music"): boolean {
    const key = `${runId}:${phase}`;
    if (this.handledAudioEndedKey === key) {
      return false;
    }
    this.handledAudioEndedKey = key;
    return true;
  },

  handleAudioEnded(runId: number, phase: "narration" | "music", state: NowState) {
    if (this.playRunId !== runId || !this.claimAudioEnded(runId, phase)) {
      return;
    }

    if (phase === "narration") {
      if (this.finishNarrationPlayback(state, runId)) {
        void this.playNowState(state, { skipNarration: true });
      }
      return;
    }

    void this.finishMusicPlayback(state, runId);
  },

  finishNarrationPlayback(state: NowState, runId: number): boolean {
    if (this.playRunId !== runId) {
      return false;
    }

    this.stopNarrationProgressLoop();
    this.lastSpokenSegmentId = state.segmentId;
    this.narrationProgress = 1;
    this.updateNarrationProgress(1, false);
    this.setPlaybackFlags(false, false, false);
    return true;
  },

  async finishMusicPlayback(state: NowState, runId: number) {
    if (this.playRunId !== runId) {
      return;
    }

    this.playbackPhase = "idle";
    this.setPlaybackFlags(false, false, false);
    await this.advanceFromState(state);
  },

  setPlaybackFlags(isPlaying: boolean, isPaused: boolean, isNarration: boolean) {
    this.setData({
      isPlaybackPlaying: isPlaying,
      isPlaybackPaused: isPaused,
      isNarrationPlaying: isNarration,
      showMusicFlow: Boolean(this.data.currentTrack && isPlaying && !isNarration),
      narrationChars: buildNarrationChars(this.data.narrationText, this.narrationProgress, isPlaying && isNarration),
      playbackLabel: playbackLabel(isPlaying, isPaused)
    });
  },

  startNarrationProgressLoop(text: string, audio: RadioAudioContext, runId: number) {
    this.stopNarrationProgressLoop();
    this.narrationVisualDurationMs = estimateNarrationDurationMs(text);
    this.narrationVisualStartedAt = Date.now() - this.narrationProgress * this.narrationVisualDurationMs;
    this.updateNarrationProgress(this.narrationProgress, true);

    const tick = () => {
      if (this.playRunId !== runId || this.playbackPhase !== "narration") {
        this.narrationProgressTimer = null;
        return;
      }

      const duration = Number(audio.duration);
      const currentTime = Number(audio.currentTime);
      const audioDurationMs = Number.isFinite(duration) && duration > 0 ? duration * 1000 : 0;
      const audioElapsedMs = Number.isFinite(currentTime) && currentTime > 0 ? currentTime * 1000 : 0;
      const visualDurationMs = audioDurationMs || this.narrationVisualDurationMs;
      const visualElapsedMs = Date.now() - this.narrationVisualStartedAt;
      const elapsedMs = audioElapsedMs || (this.data.isPlaybackPaused ? this.narrationProgress * visualDurationMs : visualElapsedMs);
      const progress = visualDurationMs > 0 ? Math.min(0.995, elapsedMs / visualDurationMs) : 0;

      this.updateNarrationProgress(progress, this.data.isPlaybackPlaying && this.playbackPhase === "narration");
      this.narrationProgressTimer = setTimeout(tick, 90);
    };

    this.narrationProgressTimer = setTimeout(tick, 90);
  },

  stopNarrationProgressLoop() {
    if (this.narrationProgressTimer !== null) {
      clearTimeout(this.narrationProgressTimer);
      this.narrationProgressTimer = null;
    }
  },

  updateNarrationProgress(progress: number, isPlaying: boolean) {
    this.narrationProgress = progress;
    this.setData({
      narrationChars: buildNarrationChars(this.data.narrationText, progress, isPlaying),
      showMusicFlow: Boolean(this.data.currentTrack && this.data.isPlaybackPlaying && !this.data.isNarrationPlaying)
    });
  },

  handleMusicLoginTap() {
    void this.startMusicLogin({ refresh: Boolean(this.data.qrSession) });
  },

  async startMusicLogin(options: { refresh?: boolean } = {}) {
    this.clearQrPolling();
    this.clearQrRefreshTimer();
    this.setData({
      isStartingMusicLogin: true,
      qrSession: null,
      qrImageSrc: null,
      qrStatusMessage: options.refresh ? "正在刷新网易云二维码。" : "正在生成网易云二维码。",
      error: null
    });

    try {
      const response = await createMusicQrLogin();
      this.setData({
        qrSession: response.session,
        qrImageSrc: materializeQrImage(response.session),
        qrStatusMessage: options.refresh ? "二维码已刷新，请用网易云音乐 App 扫码。" : "请用网易云音乐 App 扫码并确认登录。"
      });
      this.pollQrLogin(response.session.key);
      this.scheduleQrRefresh(response.session);
      void this.refreshMusicBootstrap();
    } catch (error) {
      this.setData({ qrStatusMessage: errorMessage(error, "网易云二维码生成失败") });
    } finally {
      this.setData({ isStartingMusicLogin: false });
    }
  },

  pollQrLogin(key: string) {
    this.activeQrPollingKey = key;
    const poll = async () => {
      if (this.activeQrPollingKey !== key) {
        return;
      }

      try {
        const response = await checkMusicQrLogin(key);
        this.syncMusicLoginState(response.music);
        this.setData({
          qrStatusMessage:
            response.status.authorized || response.music.loggedIn
              ? "网易云已连接，电台会优先从你的歌单里选歌。"
              : response.status.state === "expired"
                ? "二维码已过期，请重新生成。"
                : response.status.message
        });

        if (response.status.authorized || response.music.loggedIn) {
          this.clearQrPolling();
          this.clearQrRefreshTimer();
          return;
        }

        if (response.status.state === "expired") {
          this.clearQrPolling();
          this.clearQrRefreshTimer();
          this.setData({
            qrSession: null,
            qrImageSrc: null,
            qrStatusMessage: "二维码已过期，正在刷新。"
          });
          void this.startMusicLogin({ refresh: true });
          return;
        }
      } catch (error) {
        this.setData({ qrStatusMessage: errorMessage(error, "网易云登录状态检查失败") });
      }

      this.qrPollingTimer = setTimeout(poll, 2_000);
    };

    void poll();
  },

  clearQrPolling() {
    if (this.qrPollingTimer !== null) {
      clearTimeout(this.qrPollingTimer);
      this.qrPollingTimer = null;
    }
    this.activeQrPollingKey = null;
  },

  clearQrRefreshTimer() {
    if (this.qrRefreshTimer !== null) {
      clearTimeout(this.qrRefreshTimer);
      this.qrRefreshTimer = null;
    }
  },

  scheduleQrRefresh(session: NeteaseQrLoginSession) {
    this.clearQrRefreshTimer();
    this.qrRefreshTimer = setTimeout(() => {
      if (this.data.music?.loggedIn || this.data.qrSession?.key !== session.key) {
        this.qrRefreshTimer = null;
        return;
      }

      this.qrRefreshTimer = null;
      void this.startMusicLogin({ refresh: true });
    }, qrRefreshDelay(session));
  },

  async disconnectMusic() {
    this.setData({ isLoggingOutMusic: true, qrStatusMessage: null });
    try {
      const response = await logoutMusic();
      this.clearQrPolling();
      this.clearQrRefreshTimer();
      this.syncMusicLoginState(response.music);
      this.setData({ qrStatusMessage: "已断开网易云。" });
    } catch (error) {
      this.setData({ qrStatusMessage: errorMessage(error, "网易云退出登录失败") });
    } finally {
      this.setData({ isLoggingOutMusic: false });
    }
  }
});
