import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import type { CalendarAdapter } from "../adapters/calendar.js";
import type { WeatherAdapter } from "../adapters/weather.js";
import type { ContextBundle, TriggerSource, UserProfile } from "@indio/contracts";
import { StateStore } from "./state.js";

export class ContextService {
  constructor(
    private readonly config: AppConfig,
    private readonly state: StateStore,
    private readonly weather: WeatherAdapter,
    private readonly calendar: CalendarAdapter
  ) {}

  async loadProfile(): Promise<UserProfile> {
    const [taste, routines, moodRules, playlistsJson] = await Promise.all([
      readFile(resolve(this.config.userDir, "taste.md"), "utf8"),
      readFile(resolve(this.config.userDir, "routines.md"), "utf8"),
      readFile(resolve(this.config.userDir, "mood-rules.md"), "utf8"),
      readFile(resolve(this.config.userDir, "playlists.json"), "utf8")
    ]);

    return {
      taste,
      routines,
      moodRules,
      playlists: JSON.parse(playlistsJson) as UserProfile["playlists"]
    };
  }

  async build(params: { source: TriggerSource; userInput?: string }): Promise<ContextBundle> {
    const [systemPrompt, profile, weather, calendar] = await Promise.all([
      readFile(this.config.promptPath, "utf8"),
      this.loadProfile(),
      this.weather.getSnapshot(),
      this.calendar.getEventsForToday()
    ]);

    return {
      systemPrompt,
      profile,
      weather,
      calendar,
      recentMessages: this.state.listRecentMessages(6),
      recentPlays: this.state.listRecentPlays(4),
      currentTime: new Date().toISOString(),
      source: params.source,
      userInput: params.userInput
    };
  }

  async getTasteSummary(): Promise<{
    tasteHighlights: string[];
    routineHighlights: string[];
    playlists: UserProfile["playlists"];
  }> {
    const profile = await this.loadProfile();

    const toHighlights = (value: string) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("-"))
        .map((line) => line.replace(/^-+\s*/, ""))
        .slice(0, 4);

    return {
      tasteHighlights: toHighlights(profile.taste),
      routineHighlights: toHighlights(profile.routines),
      playlists: profile.playlists
    };
  }
}

