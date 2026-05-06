import { resolveMediaUrl } from "./api";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    WeixinJSBridge?: {
      invoke: (
        name: string,
        data?: Record<string, unknown>,
        callback?: (() => void) | ((response: unknown) => void)
      ) => void;
    };
  }
}

const SILENT_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

export function stopAudio(audio: HTMLAudioElement | null): void {
  if (!audio) {
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  audio.onended = null;
  audio.onerror = null;
  audio.removeAttribute("src");
  audio.load();
}

export function playbackErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "当前浏览器拦住了音频输出，点播放后再试一次。";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function createPlaybackAbortError(): DOMException {
  return new DOMException("Playback was superseded.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function playAudioElement(
  audio: HTMLAudioElement | null,
  url: string,
  signal?: AbortSignal,
  onStarted?: () => void
): Promise<void> {
  if (!audio) {
    return Promise.resolve();
  }

  if (signal?.aborted) {
    return Promise.reject(createPlaybackAbortError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const clear = () => {
      audio.onended = null;
      audio.onerror = null;
      signal?.removeEventListener("abort", handleAbort);
    };
    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      clear();
      resolve();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clear();
      reject(error);
    };
    const handleAbort = () => {
      stopAudio(audio);
      rejectOnce(createPlaybackAbortError());
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    audio.src = url;
    audio.load();
    audio.onended = resolveOnce;
    audio.onerror = () => rejectOnce(new Error("Audio playback failed."));
    audio.play().then(() => {
      onStarted?.();
    }).catch(rejectOnce);
  });
}

export async function playNarrationAudio(
  audio: HTMLAudioElement | null,
  url: string,
  signal?: AbortSignal,
  onStarted?: () => void
): Promise<void> {
  if (signal?.aborted) {
    throw createPlaybackAbortError();
  }

  const response = await fetch(resolveMediaUrl(url), { signal });

  if (!response.ok) {
    throw new Error(`播报音频请求失败（${response.status}）`);
  }

  const blob = await response.blob();

  if (signal?.aborted) {
    throw createPlaybackAbortError();
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    await playAudioElement(audio, objectUrl, signal, onStarted);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function createUnlockAudioContext(): AudioContext | null {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;

  if (!AudioContextCtor) {
    return null;
  }

  try {
    return new AudioContextCtor();
  } catch {
    return null;
  }
}

async function warmAudioElement(audio: HTMLAudioElement): Promise<boolean> {
  try {
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "true");
    audio.preload = "auto";
    audio.muted = true;
    audio.src = SILENT_AUDIO_DATA_URL;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    audio.muted = false;
    return true;
  } catch {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    audio.muted = false;
    return false;
  }
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("timeout"));
    }, ms);

    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function unlockAudioElement(
  audio: HTMLAudioElement,
  contextRef: { current: AudioContext | null }
): Promise<boolean> {
  if (!contextRef.current) {
    contextRef.current = createUnlockAudioContext();
  }

  let unlocked = false;

  if (contextRef.current) {
    try {
      if (contextRef.current.state !== "running") {
        await withTimeout(contextRef.current.resume(), 500);
      }

      const buffer = contextRef.current.createBuffer(1, 1, 22050);
      const source = contextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(contextRef.current.destination);
      source.start(0);
      unlocked = contextRef.current.state === "running";
    } catch {
      unlocked = false;
    }
  }

  const warmed = await withTimeout(warmAudioElement(audio), 1000).catch(() => false);
  return unlocked || warmed;
}
