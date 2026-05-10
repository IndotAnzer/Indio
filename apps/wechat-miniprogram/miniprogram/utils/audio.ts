import { resolveMediaUrl } from "./api";

export interface AudioMetadata {
  title: string;
  epname?: string;
  singer?: string;
  coverImgUrl?: string | null;
}

export type RadioAudioContext = WechatMiniprogram.InnerAudioContext & {
  title?: string;
  epname?: string;
  singer?: string;
  coverImgUrl?: string;
  destroy?: () => void;
};

export class PlaybackStoppedError extends Error {
  constructor() {
    super("Playback stopped.");
    this.name = "PlaybackStoppedError";
  }
}

export function configureRadioAudioSession(): void {
  try {
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      mixWithOther: false
    });
  } catch {
    // Older runtimes may not expose global audio options.
  }
}

export function createRadioAudioContext(): RadioAudioContext {
  configureRadioAudioSession();
  if (typeof wx.getBackgroundAudioManager === "function") {
    return wx.getBackgroundAudioManager() as RadioAudioContext;
  }

  const audio = wx.createInnerAudioContext({
    useWebAudioImplement: false
  }) as RadioAudioContext;
  audio.obeyMuteSwitch = false;
  audio.volume = 1;
  return audio;
}

export function stopAudio(audio: RadioAudioContext | null): void {
  if (!audio) {
    return;
  }

  try {
    audio.stop();
  } catch {
    // Stopping is best-effort; the next play call will reset src.
  }
}

export function playAudioUrl(
  audio: RadioAudioContext,
  url: string,
  onStarted?: () => void,
  metadata?: AudioMetadata,
  onEnded?: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      offAudioEvent(audio, "Play", handlePlay);
      offAudioEvent(audio, "Ended", handleEnded);
      offAudioEvent(audio, "Error", handleError);
      offAudioEvent(audio, "Stop", handleStop);
    };

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    const handlePlay = () => {
      onStarted?.();
    };

    const handleEnded = () => {
      settle(resolve);
      try {
        onEnded?.();
      } catch {
        // Playback state recovery is best-effort; the resolved playback promise
        // still lets the page-level flow continue.
      }
    };

    const handleError = (error: any) => {
      const code = error?.errCode ? ` (${error.errCode})` : "";
      settle(() => reject(new Error(`${error?.errMsg || "音频播放失败"}${code}`)));
    };

    const handleStop = () => {
      settle(() => reject(new PlaybackStoppedError()));
    };

    resolveMediaUrl(url)
      .then((src) => {
        cleanup();
        applyAudioMetadata(audio, metadata);
        onAudioEvent(audio, "Play", handlePlay);
        onAudioEvent(audio, "Ended", handleEnded);
        onAudioEvent(audio, "Error", handleError);
        onAudioEvent(audio, "Stop", handleStop);
        audio.src = src;
        if (typeof audio.play === "function") {
          audio.play();
        }
      })
      .catch((error) => {
        settle(() => reject(error instanceof Error ? error : new Error("音频加载失败")));
      });
  });
}

function applyAudioMetadata(audio: RadioAudioContext, metadata?: AudioMetadata): void {
  const title = metadata?.title?.trim() || "Indio Radio";
  audio.title = title;
  audio.epname = metadata?.epname?.trim() || "Indio";
  audio.singer = metadata?.singer?.trim() || "Indio";
  audio.coverImgUrl = metadata?.coverImgUrl || "";
}

function onAudioEvent(audio: RadioAudioContext, name: string, handler: (...args: any[]) => void): void {
  const method = (audio as any)[`on${name}`];
  if (typeof method === "function") {
    method.call(audio, handler);
  }
}

function offAudioEvent(audio: RadioAudioContext, name: string, handler: (...args: any[]) => void): void {
  const method = (audio as any)[`off${name}`];
  if (typeof method === "function") {
    method.call(audio, handler);
  }
}
