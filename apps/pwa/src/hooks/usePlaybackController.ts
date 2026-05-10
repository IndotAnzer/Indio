import { useCallback, useEffect, useRef, useState } from "react";
import type { NowState, PreparedSegment } from "@indio/contracts";
import { advanceRadio, resolveMediaUrl } from "../lib/api";
import {
  isAbortError,
  playAudioElement,
  playbackErrorMessage,
  playNarrationAudio,
  stopAudio,
  unlockAudioElement
} from "../lib/audio";

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

function estimateNarrationDurationMs(text: string): number {
  const speakableCount = Array.from(text).reduce((count, char) => count + (/\s/.test(char) ? 0 : 1), 0);
  return Math.min(18_000, Math.max(2_400, speakableCount * 170 + 700));
}

function playbackKeyForState(state: NowState): string {
  return `${state.segmentId}:${state.narrationAudioUrl ?? "pending-narration"}`;
}

export function buildNarrationChars(text: string, progress: number, isPlaying: boolean): Array<{
  char: string;
  state: "idle" | "read" | "active" | "space" | "break";
}> {
  const chars = Array.from(text);
  const speakableCount = chars.reduce((count, char) => count + (/\s/.test(char) ? 0 : 1), 0);
  const spokenCount =
    speakableCount === 0 ? 0 : Math.min(speakableCount, Math.floor(progress * speakableCount));
  let cursor = 0;

  return chars.map((char) => {
    if (char === "\n") {
      return { char, state: "break" };
    }

    if (/\s/.test(char)) {
      return { char, state: "space" };
    }

    const currentIndex = cursor;
    cursor += 1;

    if (spokenCount >= speakableCount || currentIndex < spokenCount) {
      return { char, state: "read" };
    }

    if (isPlaying && currentIndex === spokenCount) {
      return { char, state: "active" };
    }

    return { char, state: "idle" };
  });
}

export function usePlaybackController(
  nowState: NowState | null,
  setNowState: (state: NowState) => void,
  setMusicError: (message: string | null) => void
) {
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioReadyRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const unlockPromiseRef = useRef<Promise<boolean> | null>(null);
  const currentNowStateRef = useRef<NowState | null>(null);
  const observedNowStateRef = useRef<NowState | null>(null);
  const previousStatesRef = useRef<NowState[]>([]);
  const suppressHistoryCaptureRef = useRef(false);
  const playbackPhaseRef = useRef<"idle" | "narration" | "music">("idle");
  const lastSpokenSegmentId = useRef<string | null>(null);
  const lastPlaybackKey = useRef<string | null>(null);
  const advancingSegmentRef = useRef<string | null>(null);
  const skipPlaybackCleanupForSegmentRef = useRef<string | null>(null);
  const playbackRunId = useRef(0);
  const playbackAbortControllerRef = useRef<AbortController | null>(null);
  const narrationProgressRafRef = useRef<number | null>(null);
  const narrationVisualStartedAtRef = useRef(0);
  const narrationVisualDurationMsRef = useRef(0);

  const [audioReady, setAudioReady] = useState(false);
  const [isUnlockingAudio, setIsUnlockingAudio] = useState(false);
  const [narrationProgress, setNarrationProgress] = useState(0);
  const [isNarrationPlaying, setIsNarrationPlaying] = useState(false);
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);
  const [canPlayPrevious, setCanPlayPrevious] = useState(false);

  const publishNowStateUpdate = useCallback((nextState: NowState) => {
    currentNowStateRef.current = nextState;
    setNowState(nextState);
    setMusicError(null);
  }, [setMusicError, setNowState]);

  const unlockAudioPlayback = useCallback(async (): Promise<boolean> => {
    if (audioReadyRef.current) {
      return true;
    }

    if (unlockPromiseRef.current) {
      return unlockPromiseRef.current;
    }

    const audio = narrationAudioRef.current;

    if (!audio) {
      return false;
    }

    const unlockAttempt = (async () => {
      setIsUnlockingAudio(true);
      try {
        const unlocked = await unlockAudioElement(audio, audioContextRef);
        audioReadyRef.current = unlocked;
        setAudioReady(unlocked);

        if (unlocked) {
          setMusicError(null);
          return true;
        }

        setMusicError("这个内嵌浏览器还没放行音频，再点一次播放试试。");
        return false;
      } finally {
        setIsUnlockingAudio(false);
        unlockPromiseRef.current = null;
      }
    })();

    unlockPromiseRef.current = unlockAttempt;
    return unlockAttempt;
  }, [setMusicError]);

  const requestAdvancedState = useCallback(async (finishedSegmentId: string): Promise<NowState> => {
    const response = await advanceRadio(finishedSegmentId);
    if (!response.nowState) {
      throw new Error("下一首还没生成出来，请再试一次。");
    }
    return response.nowState;
  }, []);

  const stopNarrationProgressLoop = useCallback(() => {
    if (narrationProgressRafRef.current !== null) {
      window.cancelAnimationFrame(narrationProgressRafRef.current);
      narrationProgressRafRef.current = null;
    }
  }, []);

  const startNarrationProgressLoop = useCallback((
    text: string,
    audio: HTMLAudioElement | null,
    signal: AbortSignal
  ) => {
    stopNarrationProgressLoop();
    narrationVisualStartedAtRef.current = window.performance.now();
    narrationVisualDurationMsRef.current = estimateNarrationDurationMs(text);

    const tick = () => {
      if (signal.aborted || playbackPhaseRef.current !== "narration") {
        narrationProgressRafRef.current = null;
        return;
      }

      const audioDurationMs =
        audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0;
      const visualDurationMs = audioDurationMs || narrationVisualDurationMsRef.current;
      const audioElapsedMs =
        audio && Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime * 1000 : 0;
      const visualElapsedMs = window.performance.now() - narrationVisualStartedAtRef.current;
      const progress = visualDurationMs > 0 ? Math.min(0.995, (audioElapsedMs || visualElapsedMs) / visualDurationMs) : 0;

      setNarrationProgress(progress);
      narrationProgressRafRef.current = window.requestAnimationFrame(tick);
    };

    setNarrationProgress(0);
    narrationProgressRafRef.current = window.requestAnimationFrame(tick);
  }, [stopNarrationProgressLoop]);

  const playNowState = useCallback(async (
    state: NowState,
    options?: { requireUnlock?: boolean; skipNarration?: boolean }
  ): Promise<void> => {
    if (!state.nowPlaying) {
      return;
    }

    if (options?.requireUnlock) {
      const unlocked = await unlockAudioPlayback();
      if (!unlocked) {
        return;
      }
    } else if (!audioReadyRef.current) {
      setMusicError("点播放开始播放。");
      return;
    }

    playbackRunId.current += 1;
    const runId = playbackRunId.current;
    playbackAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    playbackAbortControllerRef.current = abortController;
    const outputAudio = narrationAudioRef.current;
    const isCurrentPlayback = () =>
      playbackRunId.current === runId &&
      playbackAbortControllerRef.current === abortController &&
      !abortController.signal.aborted;

    playbackPhaseRef.current = "idle";
    setIsPlaybackPlaying(false);
    setIsPlaybackPaused(false);
    stopAudio(outputAudio);

    if (state.mode === "narrated" && !options?.skipNarration && lastSpokenSegmentId.current !== state.segmentId) {
      if (!state.narrationAudioUrl) {
        setNarrationProgress(0);
        setIsNarrationPlaying(false);
        setIsPlaybackPlaying(false);
        setIsPlaybackPaused(false);
        setMusicError("口播音频准备中，稍等一下。");
        return;
      }

      try {
        if (!isCurrentPlayback()) {
          return;
        }

        playbackPhaseRef.current = "narration";
        setNarrationProgress(0);
        setIsNarrationPlaying(true);
        setIsPlaybackPlaying(true);
        setIsPlaybackPaused(false);
        await playNarrationAudio(outputAudio, state.narrationAudioUrl, abortController.signal, () => {
          startNarrationProgressLoop(state.narrationText, outputAudio, abortController.signal);
        });

        if (!isCurrentPlayback()) {
          return;
        }

        stopNarrationProgressLoop();
        lastSpokenSegmentId.current = state.segmentId;
        setNarrationProgress(1);
        setIsNarrationPlaying(false);
      } catch (playError: unknown) {
        if (isAbortError(playError) || !isCurrentPlayback()) {
          return;
        }

        stopNarrationProgressLoop();
        playbackPhaseRef.current = "idle";
        setIsNarrationPlaying(false);
        setIsPlaybackPlaying(false);
        setIsPlaybackPaused(false);
        setMusicError(playbackErrorMessage(playError, "播报音频加载失败，请稍后重试。"));
        return;
      }
    }

    if (!isCurrentPlayback() || !state.nowPlaying) {
      return;
    }

    if (state.nowPlaying.streamUrl) {
      setMusicError(null);

      try {
        playbackPhaseRef.current = "music";
        setIsPlaybackPlaying(true);
        setIsPlaybackPaused(false);
        await playAudioElement(outputAudio, state.nowPlaying.streamUrl, abortController.signal);

        if (!isCurrentPlayback()) {
          return;
        }

        const current = currentNowStateRef.current;
        if (!current || current.segmentId !== state.segmentId) {
          playbackPhaseRef.current = "idle";
          return;
        }

        if (current.preparedNext) {
          const promoted = materializePreparedSegment(current.preparedNext);
          skipPlaybackCleanupForSegmentRef.current = state.segmentId;
          lastPlaybackKey.current = playbackKeyForState(promoted);
          publishNowStateUpdate(promoted);
          void requestAdvancedState(state.segmentId).then((syncedState) => {
            if (syncedState.segmentId === promoted.segmentId) {
              publishNowStateUpdate({
                ...syncedState,
                updatedAt: currentNowStateRef.current?.updatedAt ?? syncedState.updatedAt
              });
            }
          }).catch((advanceError: unknown) => {
            setMusicError(advanceError instanceof Error ? advanceError.message : "下一段电台还没准备好。");
          });
          void playNowState(promoted);
          return;
        }

        try {
          if (advancingSegmentRef.current === state.segmentId) {
            return;
          }
          advancingSegmentRef.current = state.segmentId;
          const advancedState = await requestAdvancedState(state.segmentId);
          advancingSegmentRef.current = null;

          if (advancedState.segmentId !== state.segmentId) {
            lastPlaybackKey.current = playbackKeyForState(advancedState);
            publishNowStateUpdate(advancedState);
            void playNowState(advancedState);
            return;
          }
        } catch (advanceError: unknown) {
          advancingSegmentRef.current = null;
          setMusicError(advanceError instanceof Error ? advanceError.message : "下一段电台还没准备好。");
        }

        playbackPhaseRef.current = "idle";
        if (playbackAbortControllerRef.current === abortController) {
          playbackAbortControllerRef.current = null;
        }
      } catch (playError: unknown) {
        if (isAbortError(playError) || !isCurrentPlayback()) {
          return;
        }

        playbackPhaseRef.current = "idle";
        setIsPlaybackPlaying(false);
        setIsPlaybackPaused(false);
        setMusicError(playError instanceof Error ? playError.message : "音乐播放失败");
      }
    } else if (state.nowPlaying.platformUrl) {
      setIsPlaybackPlaying(false);
      setIsPlaybackPaused(false);
      setMusicError("当前曲目没有直连音频，已经保留网易云跳转链接。");
    } else {
      setIsPlaybackPlaying(false);
      setIsPlaybackPaused(false);
      setMusicError("当前队列没有可直接播放的音频链接。");
    }
  }, [publishNowStateUpdate, requestAdvancedState, setMusicError, unlockAudioPlayback]);

  const pauseCurrentPlayback = useCallback(() => {
    const audio = narrationAudioRef.current;

    if (!audio || audio.paused || audio.ended) {
      return;
    }

    audio.pause();
    setIsPlaybackPlaying(false);
    setIsPlaybackPaused(Boolean(audio.currentSrc || audio.src));
  }, []);

  const resumeCurrentPlayback = useCallback(async () => {
    const audio = narrationAudioRef.current;

    if (!audio || playbackPhaseRef.current === "idle" || audio.ended || !Boolean(audio.currentSrc || audio.src)) {
      if (nowState) {
        await playNowState(nowState, { requireUnlock: true });
      }
      return;
    }

    const unlocked = await unlockAudioPlayback();

    if (!unlocked) {
      return;
    }

    try {
      setIsPlaybackPlaying(true);
      setIsPlaybackPaused(false);
      await audio.play();
      setMusicError(null);
    } catch (resumeError: unknown) {
      setIsPlaybackPlaying(false);
      setIsPlaybackPaused(true);
      setMusicError(playbackErrorMessage(resumeError, "播放恢复失败。"));
    }
  }, [nowState, playNowState, setMusicError, unlockAudioPlayback]);

  const handlePlayPause = useCallback(async () => {
    if (!nowState?.nowPlaying) {
      return;
    }

    const audio = narrationAudioRef.current;
    const hasActiveAudio = Boolean(audio?.currentSrc || audio?.src);

    if (audio && hasActiveAudio && !audio.paused && !audio.ended) {
      pauseCurrentPlayback();
      return;
    }

    if (audio && hasActiveAudio && audio.paused && !audio.ended && playbackPhaseRef.current !== "idle") {
      await resumeCurrentPlayback();
      return;
    }

    await playNowState(nowState, { requireUnlock: true });
  }, [nowState, pauseCurrentPlayback, playNowState, resumeCurrentPlayback]);

  const playPrevious = useCallback(async () => {
    const previousState = previousStatesRef.current.pop();

    if (!previousState) {
      setCanPlayPrevious(false);
      setMusicError("还没有上一首。");
      return;
    }

    setCanPlayPrevious(previousStatesRef.current.length > 0);
    suppressHistoryCaptureRef.current = true;
    skipPlaybackCleanupForSegmentRef.current = currentNowStateRef.current?.segmentId ?? null;
    lastPlaybackKey.current = playbackKeyForState(previousState);
    publishNowStateUpdate(previousState);
    await playNowState(previousState, { requireUnlock: true });
  }, [playNowState, publishNowStateUpdate, setMusicError]);

  const playNext = useCallback(async () => {
    if (!nowState?.nowPlaying) {
      return;
    }

    const unlocked = await unlockAudioPlayback();

    if (!unlocked) {
      return;
    }

    if (nowState.preparedNext) {
      const promoted = materializePreparedSegment(nowState.preparedNext);
      skipPlaybackCleanupForSegmentRef.current = nowState.segmentId;
      lastPlaybackKey.current = playbackKeyForState(promoted);
      publishNowStateUpdate(promoted);
      void requestAdvancedState(nowState.segmentId).then((syncedState) => {
        if (syncedState.segmentId === promoted.segmentId) {
          publishNowStateUpdate({
            ...syncedState,
            updatedAt: currentNowStateRef.current?.updatedAt ?? syncedState.updatedAt
          });
        }
      }).catch((advanceError: unknown) => {
        setMusicError(advanceError instanceof Error ? advanceError.message : "下一段电台还没准备好。");
      });
      await playNowState(promoted);
      return;
    }

    try {
      if (advancingSegmentRef.current === nowState.segmentId) {
        return;
      }

      advancingSegmentRef.current = nowState.segmentId;
      const advancedState = await requestAdvancedState(nowState.segmentId);
      advancingSegmentRef.current = null;

      if (advancedState.segmentId !== nowState.segmentId) {
        skipPlaybackCleanupForSegmentRef.current = nowState.segmentId;
        lastPlaybackKey.current = playbackKeyForState(advancedState);
        publishNowStateUpdate(advancedState);
        await playNowState(advancedState);
      }
    } catch (advanceError: unknown) {
      advancingSegmentRef.current = null;
      setMusicError(advanceError instanceof Error ? advanceError.message : "下一段电台还没准备好。");
    }
  }, [
    nowState,
    playNowState,
    publishNowStateUpdate,
    requestAdvancedState,
    setMusicError,
    unlockAudioPlayback
  ]);

  useEffect(() => {
    currentNowStateRef.current = nowState;
  }, [nowState]);

  useEffect(() => {
    const observedState = observedNowStateRef.current;

    if (!nowState) {
      observedNowStateRef.current = null;
      previousStatesRef.current = [];
      suppressHistoryCaptureRef.current = false;
      setCanPlayPrevious(false);
      return;
    }

    if (!observedState) {
      observedNowStateRef.current = nowState;
      return;
    }

    if (observedState.segmentId === nowState.segmentId) {
      observedNowStateRef.current = nowState;
      return;
    }

    if (suppressHistoryCaptureRef.current) {
      suppressHistoryCaptureRef.current = false;
      observedNowStateRef.current = nowState;
      return;
    }

    previousStatesRef.current = [
      ...previousStatesRef.current.filter((state) => state.segmentId !== observedState.segmentId),
      observedState
    ].slice(-20);
    observedNowStateRef.current = nowState;
    setCanPlayPrevious(true);
  }, [nowState]);

  useEffect(() => {
    const preparedNext = nowState?.preparedNext;

    if (!preparedNext) {
      if (preloadMusicAudioRef.current) {
        preloadMusicAudioRef.current.removeAttribute("src");
        preloadMusicAudioRef.current.load();
      }
      return;
    }

    if (preparedNext.narrationAudioUrl) {
      void fetch(resolveMediaUrl(preparedNext.narrationAudioUrl)).catch(() => {
        // Playback still attempts on demand.
      });
    }

    if (preparedNext.nowPlaying?.streamUrl && preloadMusicAudioRef.current) {
      preloadMusicAudioRef.current.src = preparedNext.nowPlaying.streamUrl;
      preloadMusicAudioRef.current.preload = "auto";
      preloadMusicAudioRef.current.load();
    }
  }, [nowState?.preparedNext]);

  useEffect(() => {
    const audio = narrationAudioRef.current;

    if (!audio) {
      return;
    }

    let rafId: number | null = null;

    const pushProgress = () => {
      const isNarrationPhase = playbackPhaseRef.current === "narration";
      const hasActivePlayback = playbackPhaseRef.current !== "idle";
      const hasSource = Boolean(audio.currentSrc || audio.src);
      const playbackPlaying = hasActivePlayback && !audio.paused && !audio.ended;
      const playbackPaused = hasActivePlayback && hasSource && audio.paused && !audio.ended;

      if (isNarrationPhase) {
        const audioDurationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0;
        const visualDurationMs = audioDurationMs || narrationVisualDurationMsRef.current;
        const audioElapsedMs =
          Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime * 1000 : 0;
        const visualElapsedMs = window.performance.now() - narrationVisualStartedAtRef.current;
        const progress = visualDurationMs > 0 ? Math.min(0.995, (audioElapsedMs || visualElapsedMs) / visualDurationMs) : 0;
        setNarrationProgress(progress);
      }

      setIsNarrationPlaying(isNarrationPhase && !audio.paused && !audio.ended);
      setIsPlaybackPlaying(playbackPlaying);
      setIsPlaybackPaused(playbackPaused);

      if (!audio.paused && !audio.ended) {
        rafId = window.requestAnimationFrame(pushProgress);
      }
    };

    const start = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      pushProgress();
    };

    const stop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (playbackPhaseRef.current === "narration") {
        const audioDurationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0;
        const visualDurationMs = audioDurationMs || narrationVisualDurationMsRef.current;
        const audioElapsedMs =
          Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime * 1000 : 0;
        const visualElapsedMs = window.performance.now() - narrationVisualStartedAtRef.current;
        const progress = visualDurationMs > 0 ? Math.min(0.995, (audioElapsedMs || visualElapsedMs) / visualDurationMs) : 0;
        setNarrationProgress(audio.ended && visualDurationMs > 0 ? 1 : progress);
      }

      setIsNarrationPlaying(playbackPhaseRef.current === "narration" && !audio.paused && !audio.ended);
      setIsPlaybackPlaying(false);
      setIsPlaybackPaused(playbackPhaseRef.current !== "idle" && Boolean(audio.currentSrc || audio.src) && !audio.ended);
    };

    const reset = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      stopNarrationProgressLoop();
      playbackPhaseRef.current = "idle";
      setNarrationProgress(0);
      setIsNarrationPlaying(false);
      setIsPlaybackPlaying(false);
      setIsPlaybackPaused(false);
    };

    const resetWhenIdle = () => {
      if (playbackPhaseRef.current === "idle") {
        reset();
      }
    };

    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("loadedmetadata", pushProgress);
    audio.addEventListener("emptied", resetWhenIdle);
    audio.addEventListener("error", reset);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
      audio.removeEventListener("loadedmetadata", pushProgress);
      audio.removeEventListener("emptied", resetWhenIdle);
      audio.removeEventListener("error", reset);
    };
  }, [stopNarrationProgressLoop]);

  useEffect(() => {
    setNarrationProgress(0);
    setIsNarrationPlaying(false);
    setIsPlaybackPaused(false);
  }, [nowState?.updatedAt]);

  useEffect(() => {
    const prime = () => {
      if (!audioReadyRef.current) {
        void unlockAudioPlayback();
      }
    };

    window.addEventListener("pointerdown", prime, { passive: true });
    window.addEventListener("touchstart", prime, { passive: true });
    window.addEventListener("keydown", prime);

    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("touchstart", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [unlockAudioPlayback]);

  useEffect(() => {
    const bridgeUnlock = () => {
      void unlockAudioPlayback();
    };

    document.addEventListener("WeixinJSBridgeReady", bridgeUnlock as EventListener, false);

    if (window.WeixinJSBridge) {
      try {
        window.WeixinJSBridge.invoke("getNetworkType", {}, bridgeUnlock);
      } catch {
        // Direct user gestures still unlock audio.
      }
    }

    return () => {
      document.removeEventListener("WeixinJSBridgeReady", bridgeUnlock as EventListener, false);
    };
  }, [unlockAudioPlayback]);

  useEffect(() => {
    if (!nowState?.nowPlaying) {
      return;
    }

    const playbackKey = playbackKeyForState(nowState);
    const playbackSegmentId = nowState.segmentId;

    if (lastPlaybackKey.current === playbackKey) {
      return;
    }

    lastPlaybackKey.current = playbackKey;
    void playNowState(nowState);

    return () => {
      if (skipPlaybackCleanupForSegmentRef.current === playbackSegmentId) {
        skipPlaybackCleanupForSegmentRef.current = null;
        return;
      }

      playbackRunId.current += 1;
      playbackAbortControllerRef.current?.abort();
      playbackAbortControllerRef.current = null;
      playbackPhaseRef.current = "idle";
      stopNarrationProgressLoop();
      stopAudio(narrationAudioRef.current);
    };
  }, [nowState, playNowState, stopNarrationProgressLoop]);

  return {
    narrationAudioRef,
    preloadMusicAudioRef,
    audioReady,
    isUnlockingAudio,
    narrationProgress,
    isNarrationPlaying,
    isPlaybackPlaying,
    isPlaybackPaused,
    canPlayPrevious,
    playbackControlLabel: isUnlockingAudio ? "准备中" : isPlaybackPlaying ? "暂停" : isPlaybackPaused ? "继续" : "播放",
    unlockAudioPlayback,
    handlePlayPause,
    playPrevious,
    playNext
  };
}
