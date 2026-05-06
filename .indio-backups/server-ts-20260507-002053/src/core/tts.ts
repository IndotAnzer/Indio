import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import type { TtsStatus, VoiceAsset } from "@indio/contracts";
import { MimoTtsAdapter } from "../adapters/mimo-tts.js";

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export class TtsService {
  constructor(
    private readonly config: AppConfig,
    private readonly mimo: MimoTtsAdapter
  ) {}

  getStatus(): TtsStatus {
    return this.mimo.getStatus();
  }

  async synthesize(text: string): Promise<VoiceAsset | null> {
    const normalized = text.trim();
    if (!normalized) {
      return null;
    }

    const id = createHash("sha1")
      .update(
        JSON.stringify({
          text: normalized,
          provider: this.mimo.getStatus().provider,
          model: this.config.mimoTtsModel,
          voice: this.config.mimoTtsVoice,
          format: this.config.mimoTtsFormat
        })
      )
      .digest("hex")
      .slice(0, 16);
    const metadataPath = resolve(this.config.cacheDir, `${id}.json`);

    try {
      const cached = JSON.parse(await readFile(metadataPath, "utf8")) as VoiceAsset;
      const cachedFormat = cached.format ?? this.config.mimoTtsFormat;
      const cachedAudioPath = resolve(this.config.cacheDir, `${id}.${cachedFormat}`);
      await access(cachedAudioPath);

      return {
        ...cached,
        audioUrl: `${this.config.publicBaseUrl}/media/tts/${id}.${cachedFormat}`,
        cached: true
      };
    } catch {
      // Continue to synthesis below.
    }

    if (!this.getStatus().configured) {
      return null;
    }

    try {
      const created = await this.mimo.synthesize(normalized);
      const audioPath = resolve(this.config.cacheDir, `${id}.${created.format}`);
      const asset: VoiceAsset = {
        id,
        text: normalized,
        audioUrl: `${this.config.publicBaseUrl}/media/tts/${id}.${created.format}`,
        provider: created.provider,
        format: created.format,
        mimeType: created.mimeType,
        createdAt: new Date().toISOString(),
        cached: false
      };

      await writeFile(audioPath, created.buffer);
      await writeFile(metadataPath, JSON.stringify(asset, null, 2), "utf8");

      return asset;
    } catch (error) {
      console.warn(`Mimo synthesis failed: ${clip(String(error), 240)}`);
      return null;
    }
  }
}
