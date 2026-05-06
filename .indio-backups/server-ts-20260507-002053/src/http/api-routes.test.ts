import { describe, expect, it } from "vitest";
import type { IndioRuntime } from "../runtime.js";
import { createHttpApp } from "./app.js";
import { StreamHub } from "./stream-hub.js";

describe("HTTP routes", () => {
  it("exposes health and now endpoints without changing the wire shape", async () => {
    const runtime = {
      getConfigMode: () => "oauth-cli",
      getCodexStatus: async () => ({
        kind: "fallback",
        state: "disabled",
        authMode: "none",
        model: null,
        detail: null,
        durationMs: 0
      }),
      getMusicStatus: () => ({
        configured: false,
        provider: "fallback",
        baseUrl: null,
        cookieConfigured: false,
        unblockEnabled: false,
        loggedIn: false,
        user: null,
        playlistCount: 0,
        libraryTrackCount: 0,
        detail: null
      }),
      getTtsStatus: () => ({
        configured: false,
        provider: "tts-disabled",
        format: "mp3",
        voiceConfigured: false,
        detail: null
      }),
      getNowState: () => null,
      getTodayPlan: () => [],
      shutdown: async () => {}
    } as unknown as IndioRuntime;
    const app = await createHttpApp(
      {
        pwaUrl: "http://localhost:5173",
        cacheDir: "/tmp/indio-test-cache"
      } as never,
      runtime,
      new StreamHub()
    );

    const health = await app.inject({ method: "GET", url: "/health" });
    const now = await app.inject({ method: "GET", url: "/api/now" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, mode: "oauth-cli" });
    expect(now.json()).toEqual({ now: null });

    await app.close();
  });
});
