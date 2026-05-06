import type { AppConfig } from "../config.js";
import { StateStore } from "../core/state.js";
import { NeteaseApiClient } from "./netease/client.js";
import {
  primaryArtistKey,
  radioSortLibraryTracks,
  samePrimaryArtist,
  trackKey
} from "./netease/radio.js";
import {
  defaultMusicLibrary,
  MusicStateRepository,
  type StoredMusicLibrary,
  type StoredNeteaseAuth
} from "./netease/state.js";
import type {
  MusicBootstrap,
  MusicStatus,
  NeteasePlaylistSummary,
  NeteaseQrLoginSession,
  NeteaseQrLoginStatus,
  TrackNarrationContext,
  NeteaseUserSummary,
  PlaybackSource,
  Track,
  TrackRequest
} from "@indio/contracts";

const LIBRARY_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6;
const MAX_PLAYLISTS_TO_INDEX = 8;
const MAX_TRACKS_PER_PLAYLIST = 120;

const CATALOG: Track[] = [
  {
    id: "track-morning-haze",
    neteaseId: null,
    title: "Morning Haze",
    artist: "Lumen Bay",
    album: "Blue Window",
    mood: "morning",
    durationSec: 214,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-window-seat",
    neteaseId: null,
    title: "Window Seat",
    artist: "Kite Hotel",
    album: "Transit Weather",
    mood: "focus",
    durationSec: 238,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-slow-current",
    neteaseId: null,
    title: "Slow Current",
    artist: "North Harbor",
    album: "Quiet Maps",
    mood: "quiet",
    durationSec: 268,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-parallel-lines",
    neteaseId: null,
    title: "Parallel Lines",
    artist: "Night Paper",
    album: "Warm Transit",
    mood: "focus",
    durationSec: 223,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-soft-circuit",
    neteaseId: null,
    title: "Soft Circuit",
    artist: "June Archive",
    album: "Static Bloom",
    mood: "work",
    durationSec: 244,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-warm-transit",
    neteaseId: null,
    title: "Warm Transit",
    artist: "Signal Garden",
    album: "Metro Flora",
    mood: "work",
    durationSec: 231,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-rain-radio",
    neteaseId: null,
    title: "Rain Radio",
    artist: "Cloud Service",
    album: "Silver Drizzle",
    mood: "rain",
    durationSec: 205,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  },
  {
    id: "track-sunset-glow",
    neteaseId: null,
    title: "Sunset Glow",
    artist: "Amber Loop",
    album: "Late Light",
    mood: "evening",
    durationSec: 249,
    streamUrl: null,
    artworkUrl: null,
    platformUrl: null,
    playbackSource: "fallback"
  }
];

type ResourceObject = Record<string, unknown>;

interface LibraryTrack extends Track {
  playlistIds: string[];
  playlistNames: string[];
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function asObject(value: unknown): ResourceObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as ResourceObject;
  }

  return null;
}

function asObjectArray(value: unknown): ResourceObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asObject(entry))
    .filter((entry): entry is ResourceObject => Boolean(entry));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return asString(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function artistLabel(song: ResourceObject): string | null {
  const buckets = [asObjectArray(song.ar), asObjectArray(song.artists)];

  for (const bucket of buckets) {
    const names = bucket
      .map((artist) => asString(artist.name))
      .filter((name): name is string => Boolean(name));

    if (names.length > 0) {
      return names.join(" / ");
    }
  }

  return null;
}

function albumLabel(song: ResourceObject): string | null {
  const buckets = [asObject(song.al), asObject(song.album)];

  for (const bucket of buckets) {
    const name = asString(bucket?.name);
    if (name) {
      return name;
    }
  }

  return null;
}

function artworkUrlFromSong(song: ResourceObject): string | null {
  const buckets = [asObject(song.al), asObject(song.album)];

  for (const bucket of buckets) {
    const url = asString(bucket?.picUrl);
    if (url) {
      return url;
    }
  }

  return null;
}

function compactText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const text = value
    .replace(/\s+/g, " ")
    .trim();

  return text ? text : null;
}

function uniqueStrings(items: Array<string | null | undefined>, limit = 8): string[] {
  const values = items
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  return [...new Set(values)].slice(0, limit);
}

function sanitizeLyricLine(line: string): string {
  return line
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCreditNames(raw: string): string[] {
  return uniqueStrings(
    raw
      .split(/[\/、，,&]| feat\.?/i)
      .map((name) => name.trim())
      .filter(Boolean),
    6
  );
}

function parseLyricCredits(lyric: string | null): TrackNarrationContext["credits"] {
  const credits: TrackNarrationContext["credits"] = {
    lyricist: [],
    composer: [],
    arranger: [],
    producer: []
  };

  if (!lyric) {
    return credits;
  }

  const patterns: Array<[keyof TrackNarrationContext["credits"], RegExp]> = [
    ["lyricist", /^(?:作词|填词|词)\s*:\s*(.+)$/i],
    ["composer", /^(?:作曲|曲)\s*:\s*(.+)$/i],
    ["arranger", /^(?:编曲)\s*:\s*(.+)$/i],
    ["producer", /^(?:制作人|监制|produced by|producer)\s*:\s*(.+)$/i]
  ];

  for (const rawLine of lyric.split("\n")) {
    const line = sanitizeLyricLine(rawLine);

    if (!line) {
      continue;
    }

    for (const [key, pattern] of patterns) {
      const matched = line.match(pattern);

      if (matched?.[1]) {
        credits[key] = uniqueStrings([...credits[key], ...splitCreditNames(matched[1])], 6);
      }
    }
  }

  return credits;
}

function pickLyricPreview(lyric: string | null): string[] {
  if (!lyric) {
    return [];
  }

  const preview = lyric
    .split("\n")
    .map((line) => sanitizeLyricLine(line))
    .filter((line) => line.length > 0)
    .filter((line) => !/^(?:作词|填词|词|作曲|曲|编曲|制作人|监制|录音|混音|母带|弦乐|OP|SP)\s*:/i.test(line))
    .filter((line) => !/[A-Za-z]{4,}/.test(line))
    .slice(0, 3)
    .map((line) => clip(line, 28));

  return uniqueStrings(preview, 3);
}

function extractCreativeTexts(creative: ResourceObject): {
  resourceTitles: string[];
  textLinks: string[];
  descriptions: string[];
} {
  const resources = asObjectArray(creative.resources);
  const resourceTitles = resources
    .map((resource) => {
      const resourceUi = asObject(resource.uiElement);
      const mainTitle = asObject(resourceUi?.mainTitle);
      return asString(mainTitle?.title);
    })
    .filter((value): value is string => Boolean(value));
  const uiElement = asObject(creative.uiElement);
  const textLinks = asObjectArray(uiElement?.textLinks)
    .map((entry) => asString(entry.text))
    .filter((value): value is string => Boolean(value));
  const descriptions = asObjectArray(uiElement?.descriptions)
    .map((entry) => asString(entry.description))
    .filter((value): value is string => Boolean(value));

  for (const resource of resources) {
    const resourceUi = asObject(resource.uiElement);
    descriptions.push(
      ...asObjectArray(resourceUi?.descriptions)
        .map((entry) => asString(entry.description))
        .filter((value): value is string => Boolean(value))
    );
  }

  return {
    resourceTitles: uniqueStrings(resourceTitles, 8),
    textLinks: uniqueStrings(textLinks, 6),
    descriptions: uniqueStrings(descriptions, 4)
  };
}

function parseWikiSummary(payload: unknown): Omit<
  TrackNarrationContext,
  "sourcePlaylists" | "aliases" | "releaseYear" | "credits" | "lyricPreview" | "primaryArtist"
> {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const blocks = asObjectArray(data?.blocks);
  const basicBlock = blocks.find((block) => asString(block.code) === "SONG_PLAY_ABOUT_SONG_BASIC");
  const creatives = asObjectArray(basicBlock?.creatives);

  const byType = (creativeType: string) =>
    creatives.find((creative) => asString(creative.creativeType) === creativeType);

  const styles = extractCreativeTexts(byType("songTag") ?? {}).resourceTitles;
  const tags = extractCreativeTexts(byType("songBizTag") ?? {}).resourceTitles;
  const language = extractCreativeTexts(byType("language") ?? {}).textLinks[0] ?? null;
  const bpm = extractCreativeTexts(byType("bpm") ?? {}).textLinks[0] ?? null;
  const awards = extractCreativeTexts(byType("songAward") ?? {}).resourceTitles;
  const scenes = extractCreativeTexts(byType("entertainment") ?? {}).resourceTitles;
  const commentInfo = extractCreativeTexts(byType("songComment") ?? {});

  return {
    language,
    bpm,
    styles,
    tags,
    awards,
    scenes,
    reviewSnippet: commentInfo.descriptions[0] ?? null
  };
}

function artistHighlightsFromDesc(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return uniqueStrings(
    value
      .split(/[\n。！？]/)
      .map((sentence) => compactText(sentence))
      .filter((sentence): sentence is string => Boolean(sentence))
      .map((sentence) => clip(sentence, 72)),
    3
  );
}

function playbackSourceFromTrack(track: Track): PlaybackSource {
  return track.streamUrl ? "netease" : "fallback";
}

function dedupeTracks(items: Track[]): Track[] {
  const deduped = new Map<string, Track>();

  for (const item of items) {
    deduped.set(item.neteaseId ?? item.id, item);
  }

  return [...deduped.values()];
}

function scoreFallbackTrack(track: Track, query: string): number {
  const normalized = query.toLowerCase();
  let score = 0;

  if (track.title.toLowerCase().includes(normalized)) {
    score += 5;
  }

  if (track.album.toLowerCase().includes(normalized)) {
    score += 3;
  }

  if (track.artist.toLowerCase().includes(normalized)) {
    score += 2;
  }

  if (normalized.includes(track.mood.toLowerCase())) {
    score += 4;
  }

  return score;
}

export class NeteaseMusicAdapter {
  private readonly musicState: MusicStateRepository;
  private readonly client: NeteaseApiClient;
  private activeQrSession: NeteaseQrLoginSession | null;
  private pendingAuthCookie: string | null;

  constructor(
    private readonly config: AppConfig,
    private readonly state: StateStore
  ) {
    this.musicState = new MusicStateRepository(state);
    this.client = new NeteaseApiClient(config, () => this.getActiveCookie());
    this.activeQrSession = this.musicState.getQrSession();
    this.pendingAuthCookie = this.musicState.getPendingAuthCookie();
  }

  getStatus(): MusicStatus {
    const configured = Boolean(this.config.neteaseApiBaseUrl);
    const auth = this.getStoredAuth();
    const library = this.getStoredLibrary();
    const cookieConfigured = Boolean(this.getActiveCookie());

    return {
      configured,
      provider: configured ? "netease-api-enhanced" : "fallback",
      baseUrl: configured ? this.config.neteaseApiBaseUrl : null,
      cookieConfigured,
      unblockEnabled: this.config.neteaseEnableUnblock,
      loggedIn: Boolean(auth?.user),
      user: auth?.user ?? null,
      playlistCount: library.playlists.length,
      libraryTrackCount: library.tracks.length,
      detail: configured
        ? auth?.user
          ? `已连接网易云账号「${auth.user.nickname}」，选歌会优先从你的歌单里抽取。`
          : "api-enhanced 已配置，但还没有绑定网易云账号，当前不会走公开搜歌，只会回退到本地占位曲库。"
        : "未配置 api-enhanced 服务，当前会退回到本地 fallback 曲库。"
    };
  }

  getBootstrap(): MusicBootstrap {
    const status = this.getStatus();
    const library = this.getStoredLibrary();

    return {
      configured: status.configured,
      provider: status.provider,
      baseUrl: status.baseUrl,
      cookieConfigured: status.cookieConfigured,
      unblockEnabled: status.unblockEnabled,
      loggedIn: status.loggedIn,
      user: status.user,
      playlists: library.playlists.slice(0, 12),
      libraryTrackCount: library.tracks.length,
      loginSession: this.musicState.getQrSession() ?? this.activeQrSession,
      detail: status.detail
    };
  }

  async createQrLoginSession(): Promise<NeteaseQrLoginSession> {
    const timestamp = String(Date.now());
    const keyPayload = await this.requestJson(`/login/qr/key?timestamp=${timestamp}`, {
      withAuth: false
    });
    const keyRoot = asObject(keyPayload);
    const keyData = asObject(keyRoot?.data);
    const key = asString(keyData?.unikey);

    if (!key) {
      throw new Error("网易云二维码 key 返回为空。");
    }

    const qrPayload = await this.requestJson(
      `/login/qr/create?${new URLSearchParams({
        key,
        qrimg: "true",
        timestamp
      }).toString()}`,
      { withAuth: false }
    );
    const qrRoot = asObject(qrPayload);
    const qrData = asObject(qrRoot?.data);
    const qrUrl = asString(qrData?.qrurl);
    const qrImage = asString(qrData?.qrimg);

    if (!qrUrl) {
      throw new Error("网易云二维码创建失败。");
    }

    const session: NeteaseQrLoginSession = {
      key,
      qrUrl,
      qrImage,
      createdAt: new Date().toISOString()
    };

    this.activeQrSession = session;
    this.musicState.saveQrSession(session);
    return session;
  }

  async checkQrLoginSession(key: string): Promise<NeteaseQrLoginStatus> {
    if (await this.tryFinalizePendingLogin()) {
      return {
        code: 803,
        authorized: true,
        state: "confirmed",
        message: "网易云登录成功"
      };
    }

    const payload = await this.requestJson(
      `/login/qr/check?${new URLSearchParams({
        key,
        noCookie: "true",
        timestamp: String(Date.now())
      }).toString()}`,
      { withAuth: false }
    );

    const root = asObject(payload);
    const code = asNumber(root?.code) ?? 500;
    const message = asString(root?.message) ?? "未知登录状态";
    const cookie = asString(root?.cookie);

    if (code === 803 && cookie) {
      try {
        await this.finishAuthorizedLogin(cookie);
        return {
          code,
          authorized: true,
          state: "confirmed",
          message: "网易云登录成功"
        };
      } catch {
        this.pendingAuthCookie = cookie;
        this.musicState.savePendingAuthCookie(cookie);
        return {
          code,
          authorized: false,
          state: "confirmed",
          message: "已扫码确认，正在同步网易云账号资料…"
        };
      }
    }

    if (code === 802) {
      return {
        code,
        authorized: false,
        state: "scanned",
        message
      };
    }

    if (code === 801) {
      return {
        code,
        authorized: false,
        state: "waiting",
        message
      };
    }

    if (code === 800) {
      if (await this.tryFinalizePendingLogin()) {
        return {
          code: 803,
          authorized: true,
          state: "confirmed",
          message: "网易云登录成功"
        };
      }

      if (this.getStoredAuth()?.user) {
        this.activeQrSession = null;
        this.musicState.saveQrSession(null);
        return {
          code: 803,
          authorized: true,
          state: "confirmed",
          message: "网易云登录成功"
        };
      }

      this.activeQrSession = null;
      this.musicState.saveQrSession(null);
      return {
        code,
        authorized: false,
        state: "expired",
        message
      };
    }

    return {
      code,
      authorized: false,
      state: "error",
      message
    };
  }

  async logout(): Promise<void> {
    const cookie = this.getActiveCookie();

    if (cookie && this.config.neteaseApiBaseUrl) {
      try {
        await this.requestJson(`/logout?timestamp=${Date.now()}`);
      } catch {
        // Ignore logout failures; local state still gets cleared.
      }
    }

    this.musicState.saveAuth(null);
    this.musicState.saveLibrary(defaultMusicLibrary());
    this.activeQrSession = null;
    this.pendingAuthCookie = null;
    this.musicState.savePendingAuthCookie(null);
    this.musicState.saveQrSession(null);
  }

  async search(query: string): Promise<Track[]> {
    const fallbackResults = this.searchFallbackCatalog(query);
    const library = await this.ensurePersonalLibrary();
    const recentTrackIds = new Set(
      this.state.listRecentPlays(24).map((track) => track.neteaseId ?? track.id)
    );
    const libraryResults = await this.pickPlayableTracks(
      radioSortLibraryTracks({
        tracks: library.tracks,
        hint: query,
        recentTrackIds
      }),
      6,
      { diversifyArtists: true }
    );

    if (libraryResults.length > 0) {
      return libraryResults;
    }

    if (this.getStoredAuth()?.user && library.tracks.length > 0) {
      return this.pickPlayableTracks(
        radioSortLibraryTracks({
          tracks: library.tracks,
          hint: query || "late night radio",
          recentTrackIds
        }),
        6,
        { diversifyArtists: true }
      );
    }

    if (!this.config.neteaseApiBaseUrl || !this.getStoredAuth()?.user) {
      return fallbackResults;
    }

    try {
      const results = await this.searchCatalog(query);
      return results.length > 0 ? results : fallbackResults;
    } catch {
      return fallbackResults;
    }
  }

  async getTrack(trackId: string): Promise<Track | null> {
    const library = await this.ensurePersonalLibrary();
    const personal = library.tracks.find((track) => track.id === trackId || track.neteaseId === trackId);

    if (personal) {
      return this.resolvePlayableSource(personal);
    }

    const local = CATALOG.find((track) => track.id === trackId);
    if (local) {
      return local;
    }

    if (!this.config.neteaseApiBaseUrl) {
      return null;
    }

    try {
      return await this.fetchSongDetail(trackId);
    } catch {
      return null;
    }
  }

  async getRecommendations(seed: { mood?: string; query?: string }): Promise<Track[]> {
    const hint = (seed.query ?? seed.mood ?? "focus").toLowerCase();
    const library = await this.ensurePersonalLibrary();
    const recentTrackIds = new Set(
      this.state.listRecentPlays(24).map((track) => track.neteaseId ?? track.id)
    );
    const rankedPersonal = await this.pickPlayableTracks(
      radioSortLibraryTracks({
        tracks: library.tracks,
        hint,
        recentTrackIds
      }),
      6,
      { diversifyArtists: true }
    );

    if (rankedPersonal.length > 0) {
      return rankedPersonal.slice(0, 6);
    }

    if (library.tracks.length > 0) {
      return this.pickPlayableTracks(
        radioSortLibraryTracks({
          tracks: library.tracks,
          hint,
          recentTrackIds
        }),
        6,
        { diversifyArtists: true }
      );
    }

    if (this.config.neteaseApiBaseUrl && this.getStoredAuth()?.user) {
      try {
        const matches = await this.searchCatalog(hint);
        if (matches.length > 0) {
          return matches;
        }
      } catch {
        // Continue to fallback catalog.
      }
    }

    const exact = CATALOG.filter((track) => track.mood.toLowerCase() === hint);

    if (exact.length > 0) {
      return exact;
    }

    if (hint.includes("quiet") || hint.includes("soft")) {
      return CATALOG.filter((track) => ["quiet", "morning"].includes(track.mood));
    }

    if (hint.includes("morning")) {
      return CATALOG.filter((track) => ["morning", "focus"].includes(track.mood));
    }

    return CATALOG.filter((track) => ["focus", "work", "evening"].includes(track.mood));
  }

  async getRadioContinuation(seed: {
    mood: string;
    currentTrack?: Track | null;
    queuedTracks?: Track[];
    limit?: number;
  }): Promise<Track[]> {
    const limit = seed.limit ?? 4;
    const library = await this.ensurePersonalLibrary();

    if (library.tracks.length > 0) {
      const recentTrackIds = new Set(
        this.state.listRecentPlays(30).map((track) => track.neteaseId ?? track.id)
      );
      const avoidTrackIds = new Set(
        (seed.queuedTracks ?? []).map((track) => track.neteaseId ?? track.id)
      );

      if (seed.currentTrack) {
        recentTrackIds.add(trackKey(seed.currentTrack));
      }

      const followArtist = Math.random() < 0.22;
      const hint = uniqueStrings([
        seed.mood,
        followArtist ? (seed.currentTrack?.artist ?? null) : null,
        seed.currentTrack?.album ?? null,
        ...(seed.currentTrack?.sourcePlaylists ?? [])
      ], 8).join(" ");
      const curated = radioSortLibraryTracks({
        tracks: library.tracks,
        hint,
        recentTrackIds,
        currentTrack: seed.currentTrack,
        avoidTrackIds
      });
      const playable = await this.pickPlayableTracks(curated, limit, {
        diversifyArtists: true,
        avoidArtistOf: seed.currentTrack ?? null
      });

      if (playable.length > 0) {
        return playable;
      }
    }

    return this.getRecommendations({
      mood: seed.mood,
      query: seed.currentTrack?.artist ?? seed.mood
    });
  }

  async getNarrationContext(track: Track): Promise<TrackNarrationContext | null> {
    const fallbackContext = this.emptyNarrationContext(track);
    const baseContext: TrackNarrationContext = fallbackContext ?? {
      sourcePlaylists: [],
      aliases: [],
      releaseYear: null,
      language: null,
      bpm: null,
      styles: [],
      tags: [],
      awards: [],
      scenes: [],
      reviewSnippet: null,
      lyricPreview: [],
      credits: {
        lyricist: [],
        composer: [],
        arranger: [],
        producer: []
      },
      primaryArtist: null
    };

    if (!track.neteaseId || !this.config.neteaseApiBaseUrl) {
      return fallbackContext;
    }

    try {
      const song = await this.fetchSongSnapshot(track.neteaseId);

      if (!song) {
        return fallbackContext;
      }

      const artists = asObjectArray(song.ar ?? song.artists);
      const firstArtist = artists[0];
      const firstArtistId = asId(firstArtist?.id);
      const firstArtistName = asString(firstArtist?.name) ?? track.artist;
      const songAliases = uniqueStrings([
        ...asStringArray(song.alia),
        ...asStringArray(song.tns)
      ], 4);
      const releaseYear = (() => {
        const publishTime = asNumber(song.publishTime);
        return publishTime ? new Date(publishTime).getUTCFullYear() : null;
      })();

      const [wikiResult, lyricResult, artistResult] = await Promise.allSettled([
        this.requestJson(`/song/wiki/summary?${new URLSearchParams({ id: track.neteaseId }).toString()}`),
        this.requestJson(`/lyric?${new URLSearchParams({ id: track.neteaseId }).toString()}`),
        firstArtistId
          ? this.requestJson(`/artist/detail?${new URLSearchParams({ id: firstArtistId }).toString()}`)
          : Promise.resolve(null)
      ]);

      const lyricPayload = lyricResult.status === "fulfilled" ? asObject(lyricResult.value) : null;
      const rawLyric = asString(asObject(lyricPayload?.lrc)?.lyric);
      const wiki = wikiResult.status === "fulfilled" ? parseWikiSummary(wikiResult.value) : parseWikiSummary(null);
      const artistPayload = artistResult.status === "fulfilled" ? asObject(artistResult.value) : null;
      const artistData = asObject(asObject(artistPayload?.data)?.artist);
      const artistBrief = compactText(asString(artistData?.briefDesc));
      const artistAliases = uniqueStrings([
        ...asStringArray(artistData?.transNames),
        ...asStringArray(artistData?.alias)
      ], 4);

      return {
        ...baseContext,
        aliases: songAliases,
        releaseYear,
        language: wiki.language,
        bpm: wiki.bpm,
        styles: wiki.styles,
        tags: wiki.tags,
        awards: wiki.awards,
        scenes: wiki.scenes,
        reviewSnippet: wiki.reviewSnippet,
        lyricPreview: pickLyricPreview(rawLyric),
        credits: parseLyricCredits(rawLyric),
        primaryArtist: {
          id: firstArtistId,
          name: firstArtistName,
          aliases: artistAliases,
          brief: artistBrief ? clip(artistBrief, 240) : null,
          highlights: artistHighlightsFromDesc(artistBrief)
        }
      };
    } catch {
      return fallbackContext;
    }
  }

  buildQueue(items: Track[]): Track[] {
    return dedupeTracks(items).slice(0, 3);
  }

  async resolveQueue(requests: TrackRequest[], fallbackMood: string): Promise<Track[]> {
    const resolved: Track[] = [];

    for (const request of requests) {
      if (request.trackId) {
        const byId = await this.getTrack(request.trackId);
        if (byId) {
          resolved.push(byId);
          continue;
        }
      }

      if (request.query) {
        resolved.push(...(await this.search(request.query)).slice(0, 2));
      }
    }

    if (resolved.length === 0) {
      resolved.push(...(await this.getRecommendations({ mood: fallbackMood })).slice(0, 2));
    }

    const queue = this.buildQueue(resolved);
    return Promise.all(queue.map((track) => this.resolvePlayableSource(track)));
  }

  private async finishAuthorizedLogin(cookie: string): Promise<void> {
    const user = await this.resolveAuthorizedUser(cookie);

    if (!user) {
      throw new Error("网易云登录成功，但没拿到用户资料。");
    }

    this.musicState.saveAuth({
      cookie,
      user,
      loggedInAt: new Date().toISOString()
    });
    this.activeQrSession = null;
    this.pendingAuthCookie = null;
    this.musicState.savePendingAuthCookie(null);
    this.musicState.saveQrSession(null);
    try {
      await this.refreshPersonalLibrary(true);
    } catch {
      // Keep the login session even if playlist sync is temporarily unavailable.
    }
  }

  private async tryFinalizePendingLogin(): Promise<boolean> {
    if (!this.pendingAuthCookie) {
      return false;
    }

    try {
      await this.finishAuthorizedLogin(this.pendingAuthCookie);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveAuthorizedUser(cookie: string): Promise<NeteaseUserSummary | null> {
    const attempts = [0, 350, 900];

    for (const waitMs of attempts) {
      if (waitMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
      }

      const accountUser = await this.fetchAuthorizedUserFromAccount(cookie);
      if (accountUser) {
        return accountUser;
      }

      const loginStatusUser = await this.fetchAuthorizedUserFromLoginStatus(cookie);
      if (loginStatusUser) {
        return loginStatusUser;
      }
    }

    return null;
  }

  private async fetchAuthorizedUserFromAccount(cookie: string): Promise<NeteaseUserSummary | null> {
    try {
      const payload = await this.requestJson(`/user/account?timestamp=${Date.now()}`, {
        withAuth: false,
        cookie
      });
      const root = asObject(payload);
      const profile = asObject(root?.profile);
      const account = asObject(root?.account);
      const uid = asId(profile?.userId) ?? asId(account?.id);
      const nickname = asString(profile?.nickname);

      if (!uid || !nickname) {
        return null;
      }

      return {
        uid,
        nickname,
        avatarUrl: asString(profile?.avatarUrl)
      };
    } catch {
      return null;
    }
  }

  private async fetchAuthorizedUserFromLoginStatus(cookie: string): Promise<NeteaseUserSummary | null> {
    try {
      const payload = await this.requestJson(`/login/status?timestamp=${Date.now()}`, {
        withAuth: false,
        cookie
      });
      const root = asObject(payload);
      const data = asObject(root?.data);
      const profile = asObject(data?.profile);
      const account = asObject(data?.account);
      const uid = asId(profile?.userId) ?? asId(account?.id);
      const nickname = asString(profile?.nickname);

      if (!uid || !nickname) {
        return null;
      }

      return {
        uid,
        nickname,
        avatarUrl: asString(profile?.avatarUrl)
      };
    } catch {
      return null;
    }
  }

  private searchFallbackCatalog(query: string): Track[] {
    const results = CATALOG
      .map((track) => ({ track, score: scoreFallbackTrack(track, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.track);

    return results.length > 0 ? results : CATALOG.filter((track) => track.mood === "focus");
  }

  private async ensurePersonalLibrary(): Promise<StoredMusicLibrary<LibraryTrack>> {
    const auth = this.getStoredAuth();

    if (!auth?.user) {
      return this.getStoredLibrary();
    }

    const library = this.getStoredLibrary();
    const refreshedAt = library.refreshedAt ? new Date(library.refreshedAt).getTime() : 0;

    if (library.tracks.length > 0 && refreshedAt + LIBRARY_REFRESH_INTERVAL_MS > Date.now()) {
      return library;
    }

    return this.refreshPersonalLibrary(false);
  }

  private async refreshPersonalLibrary(force: boolean): Promise<StoredMusicLibrary<LibraryTrack>> {
    const auth = this.getStoredAuth();

    if (!auth?.user) {
      const empty = defaultMusicLibrary<LibraryTrack>();
      this.musicState.saveLibrary(empty);
      return empty;
    }

    const current = this.getStoredLibrary();
    if (
      !force &&
      current.tracks.length > 0 &&
      current.refreshedAt &&
      new Date(current.refreshedAt).getTime() + LIBRARY_REFRESH_INTERVAL_MS > Date.now()
    ) {
      return current;
    }

    const playlistPayload = await this.requestJson(
      `/user/playlist?${new URLSearchParams({
        uid: auth.user.uid,
        limit: "1000",
        timestamp: String(Date.now())
      }).toString()}`
    );
    const playlistRoot = asObject(playlistPayload);
    const playlists = asObjectArray(playlistRoot?.playlist);
    const summaries = playlists
      .map((playlist) => this.toPlaylistSummary(playlist, auth.user.uid))
      .filter((playlist): playlist is NeteasePlaylistSummary => Boolean(playlist));
    const selected = this.pickPlaylistsForLibrary(summaries);
    const trackBuckets = await Promise.all(selected.map((playlist) => this.fetchPlaylistTracks(playlist)));
    const dedupedTracks = new Map<string, LibraryTrack>();

    for (const bucket of trackBuckets) {
      for (const track of bucket) {
        const key = track.neteaseId ?? track.id;
        const existing = dedupedTracks.get(key);

        if (!existing) {
          dedupedTracks.set(key, track);
          continue;
        }

        dedupedTracks.set(key, {
          ...existing,
          playlistIds: [...new Set([...existing.playlistIds, ...track.playlistIds])],
          playlistNames: [...new Set([...existing.playlistNames, ...track.playlistNames])]
        });
      }
    }

    const nextLibrary: StoredMusicLibrary<LibraryTrack> = {
      user: auth.user,
      playlists: summaries,
      tracks: [...dedupedTracks.values()],
      refreshedAt: new Date().toISOString()
    };

    this.musicState.saveLibrary(nextLibrary);
    return nextLibrary;
  }

  private pickPlaylistsForLibrary(playlists: NeteasePlaylistSummary[]): NeteasePlaylistSummary[] {
    const sorted = [...playlists].sort((left, right) => {
      if (left.ownedByUser !== right.ownedByUser) {
        return Number(right.ownedByUser) - Number(left.ownedByUser);
      }

      return right.trackCount - left.trackCount;
    });

    return sorted.slice(0, MAX_PLAYLISTS_TO_INDEX);
  }

  private async fetchPlaylistTracks(playlist: NeteasePlaylistSummary): Promise<LibraryTrack[]> {
    const payload = await this.requestJson(
      `/playlist/track/all?${new URLSearchParams({
        id: playlist.id,
        limit: String(MAX_TRACKS_PER_PLAYLIST),
        offset: "0",
        timestamp: String(Date.now())
      }).toString()}`
    );
    const root = asObject(payload);
    const songs = asObjectArray(root?.songs);
    const tracks = await Promise.all(songs.map((song) => this.toLibraryTrack(song, playlist)));
    return tracks.filter((track): track is LibraryTrack => Boolean(track));
  }

  private async searchCatalog(query: string): Promise<Track[]> {
    const payload = await this.requestJson(
      `/cloudsearch?${new URLSearchParams({
        keywords: query,
        type: "1",
        limit: "6"
      }).toString()}`
    );

    const root = asObject(payload);
    const result = asObject(root?.result);
    const songs = asObjectArray(result?.songs).slice(0, 6);
    const tracks = await Promise.all(songs.map((song) => this.toTrack(song)));
    return dedupeTracks(tracks.filter((track): track is Track => Boolean(track)));
  }

  private emptyNarrationContext(track: Track): TrackNarrationContext | null {
    const sourcePlaylists = uniqueStrings(track.sourcePlaylists ?? [], 4);

    if (!track.neteaseId && sourcePlaylists.length === 0) {
      return null;
    }

    return {
      sourcePlaylists,
      aliases: [],
      releaseYear: null,
      language: null,
      bpm: null,
      styles: [],
      tags: [],
      awards: [],
      scenes: [],
      reviewSnippet: null,
      lyricPreview: [],
      credits: {
        lyricist: [],
        composer: [],
        arranger: [],
        producer: []
      },
      primaryArtist: null
    };
  }

  private async fetchSongSnapshot(trackId: string): Promise<ResourceObject | null> {
    const payload = await this.requestJson(
      `/song/detail?${new URLSearchParams({
        ids: trackId
      }).toString()}`
    );

    const root = asObject(payload);
    const songs = asObjectArray(root?.songs);
    return songs[0] ?? null;
  }

  private async fetchSongDetail(trackId: string): Promise<Track | null> {
    const first = await this.fetchSongSnapshot(trackId);
    return first ? this.toTrack(first) : null;
  }

  private async toTrack(song: ResourceObject): Promise<Track | null> {
    const id = asId(song.id);
    const title = asString(song.name);
    const artist = artistLabel(song);

    if (!id || !title || !artist) {
      return null;
    }

    const streamUrl = await this.requestStreamUrl(id);

    return {
      id,
      neteaseId: id,
      title,
      artist,
      album: albumLabel(song) ?? "网易云音乐",
      mood: "catalog",
      durationSec: Math.round((asNumber(song.dt) ?? asNumber(song.duration) ?? 0) / 1000),
      streamUrl,
      artworkUrl: artworkUrlFromSong(song),
      platformUrl: `https://music.163.com/#/song?id=${encodeURIComponent(id)}`,
      playbackSource: streamUrl ? "netease" : "fallback",
      sourcePlaylists: []
    };
  }

  private async toLibraryTrack(
    song: ResourceObject,
    playlist: NeteasePlaylistSummary
  ): Promise<LibraryTrack | null> {
    const id = asId(song.id);
    const title = asString(song.name);
    const artist = artistLabel(song);

    if (!id || !title || !artist) {
      return null;
    }

    return {
      id,
      neteaseId: id,
      title,
      artist,
      album: albumLabel(song) ?? "网易云音乐",
      mood: "library",
      durationSec: Math.round((asNumber(song.dt) ?? asNumber(song.duration) ?? 0) / 1000),
      streamUrl: null,
      artworkUrl: artworkUrlFromSong(song),
      platformUrl: `https://music.163.com/#/song?id=${encodeURIComponent(id)}`,
      playbackSource: "fallback",
      sourcePlaylists: [playlist.name],
      playlistIds: [playlist.id],
      playlistNames: [playlist.name]
    };
  }

  private toPlaylistSummary(
    playlist: ResourceObject,
    currentUserId: string
  ): NeteasePlaylistSummary | null {
    const id = asId(playlist.id);
    const name = asString(playlist.name);

    if (!id || !name) {
      return null;
    }

    const creator = asObject(playlist.creator);
    const creatorId = asId(creator?.userId);

    return {
      id,
      name,
      trackCount: asNumber(playlist.trackCount) ?? 0,
      coverImgUrl: asString(playlist.coverImgUrl),
      creatorName: asString(creator?.nickname),
      ownedByUser: creatorId === currentUserId
    };
  }

  private async resolvePlayableSource(track: Track): Promise<Track> {
    if (!track.neteaseId || !this.config.neteaseApiBaseUrl) {
      return {
        ...track,
        playbackSource: playbackSourceFromTrack(track)
      };
    }

    if (track.streamUrl) {
      return {
        ...track,
        playbackSource: playbackSourceFromTrack(track)
      };
    }

    try {
      const streamUrl = await this.requestStreamUrl(track.neteaseId);
      return {
        ...track,
        streamUrl,
        playbackSource: playbackSourceFromTrack({
          ...track,
          streamUrl
        })
      };
    } catch {
      return {
        ...track,
        playbackSource: playbackSourceFromTrack(track)
      };
    }
  }

  private async pickPlayableTracks(
    tracks: Track[],
    limit: number,
    options?: {
      diversifyArtists?: boolean;
      avoidArtistOf?: Track | null;
    }
  ): Promise<Track[]> {
    const playable: Track[] = [];
    const deferred: Track[] = [];
    const usedArtists = new Set<string>();

    for (const track of tracks) {
      if (options?.avoidArtistOf && samePrimaryArtist(options.avoidArtistOf, track)) {
        continue;
      }

      const resolved = await this.resolvePlayableSource(track);

      if (!resolved.streamUrl) {
        continue;
      }

      const artistKey = primaryArtistKey(resolved);
      if (options?.diversifyArtists && artistKey && usedArtists.has(artistKey)) {
        deferred.push(resolved);
        continue;
      }

      playable.push(resolved);
      if (artistKey) {
        usedArtists.add(artistKey);
      }

      if (playable.length >= limit) {
        break;
      }
    }

    return [...playable, ...deferred].slice(0, limit);
  }

  private async requestStreamUrl(trackId: string): Promise<string | null> {
    const payload = await this.requestJson(
      `/song/url/v1?${new URLSearchParams({
        id: trackId,
        level: this.config.neteasePlaybackLevel,
        ...(this.config.neteaseEnableUnblock ? { unblock: "true" } : {}),
        ...(this.config.neteaseUnblockSource ? { source: this.config.neteaseUnblockSource } : {})
      }).toString()}`
    );

    const root = asObject(payload);
    const data = asObjectArray(root?.data);
    return asString(data[0]?.url);
  }

  private getStoredAuth(): StoredNeteaseAuth | null {
    return this.musicState.getAuth();
  }

  private getStoredLibrary(): StoredMusicLibrary<LibraryTrack> {
    return this.musicState.getLibrary<LibraryTrack>();
  }

  private getActiveCookie(): string | null {
    return this.getStoredAuth()?.cookie ?? this.config.neteaseCookie ?? null;
  }

  private async requestJson(
    path: string,
    options?: {
      withAuth?: boolean;
      cookie?: string;
    }
  ): Promise<unknown> {
    return this.client.requestJson(path, options);
  }
}
