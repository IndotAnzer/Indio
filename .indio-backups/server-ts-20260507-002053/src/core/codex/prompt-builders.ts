import type { ContextBundle, Decision, Track, TrackNarrationContext } from "@indio/contracts";

export interface CodexIntent {
  moodHint?: string;
  quietMode?: boolean;
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function getChinaTimeParts(isoTime: string): { clock: string; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(new Date(isoTime));
  const valueOf = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(valueOf("hour"));

  return {
    clock: `${valueOf("hour")}:${valueOf("minute")}`,
    hour: Number.isFinite(hour) ? hour : new Date(isoTime).getHours(),
    weekday: valueOf("weekday")
  };
}

function inferRadioFrame(isoTime: string, mood: string): string {
  const { hour, weekday } = getChinaTimeParts(isoTime);
  const isWeekend = weekday === "周六" || weekday === "周日";

  if (isWeekend && hour >= 19 && hour < 24) {
    return "weekend-party";
  }

  if (hour >= 5 && hour < 10) {
    return "morning-city";
  }

  if (hour >= 11 && hour < 15) {
    return "noon-easy";
  }

  if (hour >= 22 || hour < 2 || mood === "evening") {
    return "late-night";
  }

  return mood === "focus" ? "workday-focus" : "music-companion";
}

function markdownHighlights(value: string, maxItems: number, maxLength: number): string[] {
  const bullets = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, ""))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => clip(line, maxLength));

  if (bullets.length > 0) {
    return bullets;
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => clip(line, maxLength));
}

function sameTrack(left: Track, right: Track): boolean {
  return (left.neteaseId ?? left.id) === (right.neteaseId ?? right.id);
}

function firstClause(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const clause = compact.split(/[，。！？；,.!?;]/)[0]?.trim() ?? compact;
  return clip(clause || compact, maxLength);
}

function recentAssistantNarrations(context: ContextBundle): Array<{ opener: string; text: string }> {
  return context.recentMessages
    .filter((message) => message.role === "assistant")
    .slice(-4)
    .map((message) => ({
      opener: firstClause(message.content, 28),
      text: clip(message.content, 120)
    }))
    .filter((message) => message.opener.length > 0);
}

export function buildDecisionPrompt(context: ContextBundle, intent: CodexIntent): string {
  const promptPayload = {
    currentTime: context.currentTime,
    source: context.source,
    userInput: context.userInput ?? null,
    intent: {
      moodHint: intent.moodHint ?? null,
      quietMode: intent.quietMode ?? false
    },
    systemPrompt: clip(context.systemPrompt, 1600),
    userProfile: {
      taste: clip(context.profile.taste, 1600),
      routines: clip(context.profile.routines, 1200),
      moodRules: clip(context.profile.moodRules, 1200),
      playlists: context.profile.playlists
    },
    weather: context.weather,
    calendar: context.calendar,
    recentMessages: context.recentMessages,
    recentPlays: context.recentPlays
  };

  return [
    "You are Indio's radio decision engine.",
    "Return only JSON that matches the provided schema.",
    "Do not use tools.",
    "Do not read or write files.",
    "Do not browse the web.",
    "Use only the context below.",
    "Write all user-facing text in natural Simplified Chinese.",
    "Prefer concise narration and Netease-friendly search queries.",
    "The `say` field is only the emotional angle for this turn, not the final full on-air song introduction.",
    "When quietMode is true, set mode to music-only and keep narration brief.",
    "",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

export function buildNarrationPrompt(params: {
  context: ContextBundle;
  decision: Decision;
  nowPlaying: Track;
  nowPlayingContext: TrackNarrationContext | null;
  queuedTracks: Track[];
}): string {
  const { context, decision, nowPlaying, nowPlayingContext, queuedTracks } = params;
  const localTime = getChinaTimeParts(context.currentTime);
  const previousTrack = context.recentPlays.find((track) => !sameTrack(track, nowPlaying)) ?? null;
  const recentNarrations = recentAssistantNarrations(context);
  const promptPayload = {
    currentTime: context.currentTime,
    localTime: {
      timezone: "Asia/Shanghai",
      clock: localTime.clock,
      weekday: localTime.weekday
    },
    radioFrame: inferRadioFrame(context.currentTime, decision.mood),
    userInput: context.userInput ?? null,
    personaGuidance: clip(context.systemPrompt, 1500),
    tasteHighlights: markdownHighlights(context.profile.taste, 5, 90),
    routineHighlights: markdownHighlights(context.profile.routines, 2, 80),
    moodRules: markdownHighlights(context.profile.moodRules, 4, 80),
    weather: context.weather.summary,
    antiRepetition: {
      recentNarrations,
      forbiddenWeatherCopies: ["午后这会儿", "云层有点厚", context.weather.summary],
      instruction: "Use these only to avoid repetition. Do not quote or paraphrase recent openers."
    },
    decision: {
      say: decision.say,
      segue: decision.segue,
      mood: decision.mood,
      mode: decision.mode
    },
    nowPlaying: {
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      album: nowPlaying.album,
      mood: nowPlaying.mood
    },
    nowPlayingContext: nowPlayingContext
      ? {
          aliases: nowPlayingContext.aliases,
          releaseYear: nowPlayingContext.releaseYear,
          language: nowPlayingContext.language,
          styles: nowPlayingContext.styles,
          tags: nowPlayingContext.tags,
          awards: nowPlayingContext.awards,
          scenes: nowPlayingContext.scenes,
          reviewSnippet: nowPlayingContext.reviewSnippet,
          lyricPreview: nowPlayingContext.lyricPreview,
          primaryArtist: nowPlayingContext.primaryArtist
        }
      : null,
    previousTrack: previousTrack
      ? {
          title: previousTrack.title,
          artist: previousTrack.artist
        }
      : null,
    nextTrack:
      queuedTracks[0]
        ? {
            title: queuedTracks[0].title,
            artist: queuedTracks[0].artist
          }
        : null
  };

  return [
    "You write the final spoken on-air narration for Indio, a personal radio host.",
    "Return only JSON that matches the provided schema.",
    "Write all user-facing text in natural Simplified Chinese.",
    "This is the actual spoken radio copy for the current song, not notes and not metadata.",
    "Make it feel like a real radio DJ: relaxed, conversational, musically aware, and present in the moment, not like an encyclopedia or a generated song card.",
    "Radio feel comes from four things: a precise time-of-day scene, a direct address to likely listeners, a concrete musical handoff, and a short spoken sentence that sounds good aloud.",
    "Use the radioFrame as tone guidance: morning-city is bright and useful; noon-easy is unhurried and nostalgic; late-night is low-volume and intimate; weekend-party is energetic; workday-focus is clean and unobtrusive.",
    "Most turns are song transitions, not full show openings. If previousTrack exists, you may briefly close what just played before introducing nowPlaying. If there is no previousTrack, you may give a compact welcome.",
    "You may mention the local clock or weather only when it makes the line feel live and useful; do not force it every time. Never copy weather.summary verbatim.",
    "Avoid opening with time/weather if a recent narration already did. In particular, do not reuse '午后这会儿' or '云层有点厚' as an opener; treat them as overused phrases.",
    "Before writing, compare your first clause with antiRepetition.recentNarrations[].opener. If it feels similar, rewrite the opening from a different angle: the song's sound, the artist/title, the user's request, the previous track, or a direct handoff.",
    "Never invent an FM frequency, hotline number, listener name, station slogan, chart ranking, or audience message. Only mention listener requests when userInput actually contains one.",
    "The narration must revolve around the listening experience of this exact song: what it sounds like, what mood it opens, what image the lyric suggests, or why it fits the listener right now.",
    "Do not drift into generic healing copy before you have anchored the listener in this exact song.",
    "Within the first sentence, mention the song title, artist, or a concrete auditory trait of the song.",
    "Use at most one metadata fact, and only if it genuinely makes the spoken transition better. Prefer audible details, mood, and the user's moment over catalog facts.",
    "Do not mention BPM, lyricists, composers, arrangers, producers, or credits unless the user explicitly asks for that kind of information.",
    "Turn any fact you use into a feeling or listening cue; never list facts mechanically.",
    "Use the user's request and profile to make it feel personal, but keep the song as the center of gravity at all times.",
    "Preferred transition structure: one natural line about the moment or previous song, one line that brings in nowPlaying, then a short handoff back to the music.",
    "For opening-like turns, use a compact version of real radio openings: greeting, time or listener scene, current mood, then the song. Do not make it longer than needed.",
    "For listener-request turns, acknowledge the request in one sentence, keep private details minimal, then let the song carry the message.",
    "Use spoken DJ phrases sparingly, such as '早上好', '下午好', '夜深了', '刚才这首', '接下来我们听到的是', '一起听'. Vary them and do not make every paragraph start the same way.",
    "Write one short paragraph of 2 to 4 sentences, or 1 to 2 sentences if the turn should be quieter.",
    "Avoid canned intros, slogans, bullet-like structure, mechanical phrasing, data-card phrasing, and self-help monologues.",
    "Do not sound like an encyclopedia, album review, product copy, or inspirational social media post.",
    "Do not mention models, providers, APIs, playlists, fallback, queues, or technical system state.",
    "Do not output stage directions, bracketed cues, section titles, or labels such as BGM, opening, ending, or narration.",
    "Do not invent facts about the song or artist beyond the metadata provided.",
    "If lyric preview is provided, use it only to infer theme or imagery; do not quote lyrics verbatim for more than 8 consecutive Chinese characters.",
    "Avoid empty fake-empathy phrases such as '先安静接住', '接住你的心事', '把情绪接住', or similar wording.",
    "Avoid abstract AI-sounding phrases such as '把空气拉得很松', '空气自动收拢', '同一条气流', '纹理更轻', '我们直接接上', or '我们直接把下一首接上'.",
    "For handoffs, prefer concrete spoken radio phrasing: '这首歌给你', '一起来听', '我们听听看', '下一首是...', or '把时间交给这首歌'.",
    "You may borrow the calm cadence of a late-night radio show, but keep the copy grounded in the current song rather than abstract comfort talk.",
    "Vary sentence openings. Do not repeatedly start with phrases like '现在这首' or '接下来这首'.",
    "You may hint gently at the next song only if it feels natural.",
    "",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}
