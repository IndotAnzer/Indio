import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { MimoTtsAdapter } from "../adapters/mimo-tts.js";
import { TtsService } from "./tts.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("TtsService", () => {
  it("caches synthesized audio by text and voice configuration", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "indio-tts-"));
    tempDirs.push(dir);
    const config = {
      cacheDir: dir,
      publicBaseUrl: "http://localhost:8787",
      mimoTtsModel: "mimo-v2.5-tts",
      mimoTtsVoice: "茉莉",
      mimoTtsFormat: "mp3"
    } as AppConfig;
    const synthesize = vi.fn().mockResolvedValue({
      buffer: Buffer.from("audio"),
      provider: "mimo",
      format: "mp3",
      mimeType: "audio/mpeg"
    });
    const mimo = {
      getStatus: () => ({
        configured: true,
        provider: "mimo",
        format: "mp3",
        voiceConfigured: true,
        detail: null
      }),
      synthesize
    } as unknown as MimoTtsAdapter;
    const service = new TtsService(config, mimo);

    const first = await service.synthesize("你好，Indio");
    const second = await service.synthesize("你好，Indio");

    expect(first?.audioUrl).toBe(second?.audioUrl);
    expect(second?.cached).toBe(true);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(await readFile(resolve(dir, `${first?.id}.mp3`), "utf8")).toBe("audio");
  });
});
