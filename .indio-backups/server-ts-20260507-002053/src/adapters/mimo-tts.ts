import type { AppConfig } from "../config.js";
import type { TtsStatus } from "@indio/contracts";
import { ProxyAgent, fetch as undiciFetch } from "undici";

interface SynthesizedAudio {
  buffer: Buffer;
  provider: string;
  format: string;
  mimeType: string;
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export class MimoTtsAdapter {
  private static readonly REQUEST_TIMEOUT_MS = 12_000;
  private readonly proxyAgent: ProxyAgent | null;

  constructor(private readonly config: AppConfig) {
    this.proxyAgent = config.mimoProxyUrl ? new ProxyAgent(config.mimoProxyUrl) : null;
  }

  getStatus(): TtsStatus {
    const configured = Boolean(this.config.mimoApiKey && this.config.mimoTtsVoice);

    return {
      configured,
      provider: configured ? "mimo" : "tts-disabled",
      format: this.config.mimoTtsFormat,
      voiceConfigured: Boolean(this.config.mimoTtsVoice),
      detail: configured
        ? this.config.mimoProxyUrl
          ? `Mimo chat-completions TTS is ready via proxy ${this.config.mimoProxyUrl}.`
          : "Mimo chat-completions TTS is ready."
        : "Missing MIMO_API_KEY or MIMO_TTS_VOICE. Narration audio is disabled."
    };
  }

  async synthesize(text: string): Promise<SynthesizedAudio> {
    if (!this.config.mimoApiKey || !this.config.mimoTtsVoice) {
      throw new Error("Mimo TTS is not configured.");
    }

    let response: Awaited<ReturnType<typeof undiciFetch>>;

    try {
      response = await undiciFetch(joinUrl(this.config.mimoBaseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.config.mimoApiKey
        },
        body: JSON.stringify({
          model: this.config.mimoTtsModel,
          messages: [
            {
              role: "user",
              content: "请用清晰自然的普通话逐字朗读下一条 assistant 消息。不要改写，不要解释，不要加入任何额外内容。"
            },
            {
              role: "assistant",
              content: text
            }
          ],
          audio: {
            format: this.config.mimoTtsFormat,
            voice: this.config.mimoTtsVoice
          }
        }),
        signal: AbortSignal.timeout(MimoTtsAdapter.REQUEST_TIMEOUT_MS),
        ...(this.proxyAgent ? { dispatcher: this.proxyAgent } : {})
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`Mimo request timed out after ${MimoTtsAdapter.REQUEST_TIMEOUT_MS}ms.`);
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(`Mimo request failed (${response.status}): ${clip(await response.text(), 200)}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    if (!contentType.includes("application/json")) {
      throw new Error(`Unexpected Mimo content-type: ${contentType}`);
    }

    const payload = asObject(await response.json());
    const choices = asArray(payload?.choices);
    const firstChoice = asObject(choices?.[0]);
    const message = asObject(firstChoice?.message);
    const audio = asObject(message?.audio);
    const base64Audio = asString(audio?.data);

    if (!base64Audio) {
      throw new Error("Mimo returned JSON without choices[0].message.audio.data.");
    }

    return {
      buffer: Buffer.from(base64Audio, "base64"),
      provider: "mimo",
      format: this.config.mimoTtsFormat,
      mimeType: this.mimeTypeForFormat(this.config.mimoTtsFormat)
    };
  }

  private mimeTypeForFormat(format: string): string {
    if (format === "wav") {
      return "audio/wav";
    }

    if (format === "ogg" || format === "opus") {
      return "audio/ogg";
    }

    if (format === "flac") {
      return "audio/flac";
    }

    if (format === "aac") {
      return "audio/aac";
    }

    return "audio/mpeg";
  }
}
