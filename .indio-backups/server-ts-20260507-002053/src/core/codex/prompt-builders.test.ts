import { describe, expect, it } from "vitest";
import type { ContextBundle, Decision, Track } from "@indio/contracts";
import { buildNarrationPrompt } from "./prompt-builders.js";

const provider = {
  kind: "responses-api",
  state: "ready",
  authMode: "api-key",
  model: "gpt-5.4-mini",
  detail: null,
  durationMs: 0
} satisfies Decision["provider"];

const track = {
  id: "1",
  neteaseId: "1",
  title: "Golden Hour",
  artist: "JVKE",
  album: "this is what ____ feels like",
  mood: "warm",
  durationSec: 210,
  streamUrl: null,
  artworkUrl: null,
  platformUrl: null,
  playbackSource: "netease"
} satisfies Track;

describe("buildNarrationPrompt", () => {
  it("carries recent narration openers and forbids copying weather copy", () => {
    const context = {
      systemPrompt: "保持自然、简短。",
      profile: {
        taste: "- 华语流行\n- 轻电子",
        routines: "- 午后容易分心",
        moodRules: "- 天气阴沉时选明亮一点",
        playlists: []
      },
      weather: {
        condition: "cloudy",
        temperatureC: 24,
        summary: "多云，24°C，光线偏柔。"
      },
      calendar: [],
      recentMessages: [
        {
          id: 1,
          role: "assistant",
          content: "午后这会儿，云层有点厚，先把注意力提起来。",
          createdAt: "2026-04-25T03:00:00.000Z"
        }
      ],
      recentPlays: [],
      currentTime: "2026-04-25T03:05:00.000Z",
      source: "manual",
      userInput: "来点轻松的"
    } satisfies ContextBundle;
    const decision = {
      say: "轻松一点",
      play: [],
      reason: "适合午后",
      segue: "自然接歌",
      mood: "noon",
      mode: "narrated",
      provider
    } satisfies Decision;

    const prompt = buildNarrationPrompt({
      context,
      decision,
      nowPlaying: track,
      nowPlayingContext: null,
      queuedTracks: []
    });

    expect(prompt).toContain("recentNarrations");
    expect(prompt).toContain("午后这会儿");
    expect(prompt).toContain("Never copy weather.summary verbatim");
    expect(prompt).toContain("do not reuse '午后这会儿' or '云层有点厚'");
  });
});
