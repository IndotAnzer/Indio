export type TriggerSource = "manual" | "schedule" | "system";

export interface PlaylistSeed {
  id: string;
  name: string;
  mood: string;
  tracks: string[];
}

export interface UserProfile {
  taste: string;
  routines: string;
  moodRules: string;
  playlists: PlaylistSeed[];
}

export interface WeatherSnapshot {
  condition: "clear" | "cloudy" | "rain";
  temperatureC: number;
  summary: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

export interface MessageRecord {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type PlaybackSource = "netease" | "fallback";

export interface Track {
  id: string;
  neteaseId: string | null;
  title: string;
  artist: string;
  album: string;
  mood: string;
  durationSec: number;
  streamUrl: string | null;
  artworkUrl: string | null;
  platformUrl: string | null;
  playbackSource: PlaybackSource;
  sourcePlaylists?: string[];
}

export interface TrackNarrationContext {
  sourcePlaylists: string[];
  aliases: string[];
  releaseYear: number | null;
  language: string | null;
  bpm: string | null;
  styles: string[];
  tags: string[];
  awards: string[];
  scenes: string[];
  reviewSnippet: string | null;
  lyricPreview: string[];
  credits: {
    lyricist: string[];
    composer: string[];
    arranger: string[];
    producer: string[];
  };
  primaryArtist: {
    id: string | null;
    name: string;
    aliases: string[];
    brief: string | null;
    highlights: string[];
  } | null;
}

export interface TrackRequest {
  query?: string;
  trackId?: string;
  reason?: string;
}

export type ProviderKind = "codex-cli" | "fallback" | "local-control" | "responses-api";
export type ProviderState = "ready" | "fallback" | "error" | "disabled";
export type AuthMode = "chatgpt" | "api-key" | "none" | "unknown";
export type CodexAuthSource = "shared-cli" | "project-api" | "openai-compatible";
export type CompatibleResponsesFormat = "json-object" | "json-schema";

export interface ProviderInfo {
  kind: ProviderKind;
  state: ProviderState;
  authMode: AuthMode;
  model: string | null;
  detail: string | null;
  durationMs: number | null;
}

export interface CodexSettings {
  authSource: CodexAuthSource;
  projectApiKeyConfigured: boolean;
  projectApiKeyLabel: string | null;
  compatibleApiKeyConfigured: boolean;
  compatibleApiKeyLabel: string | null;
  compatibleBaseUrl: string;
  compatibleModel: string;
  compatibleResponseFormat: CompatibleResponsesFormat;
}

export interface Decision {
  say: string;
  play: TrackRequest[];
  reason: string;
  segue: string;
  mood: string;
  mode: "narrated" | "music-only";
  provider: ProviderInfo;
}

export interface VoiceAsset {
  id: string;
  audioUrl: string | null;
  text: string;
  cached: boolean;
  provider: string;
  format: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface NeteaseUserSummary {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface NeteasePlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  coverImgUrl: string | null;
  creatorName: string | null;
  ownedByUser: boolean;
}

export interface NeteaseQrLoginSession {
  key: string;
  qrUrl: string;
  qrImage: string | null;
  createdAt: string;
}

export interface NeteaseQrLoginStatus {
  code: number;
  authorized: boolean;
  state: "waiting" | "scanned" | "confirmed" | "expired" | "error";
  message: string;
}

export interface MusicStatus {
  configured: boolean;
  provider: "netease-api-enhanced" | "fallback";
  baseUrl: string | null;
  cookieConfigured: boolean;
  unblockEnabled: boolean;
  loggedIn: boolean;
  user: NeteaseUserSummary | null;
  playlistCount: number;
  libraryTrackCount: number;
  detail: string | null;
}

export interface MusicBootstrap {
  configured: boolean;
  provider: "netease-api-enhanced" | "fallback";
  baseUrl: string | null;
  cookieConfigured: boolean;
  unblockEnabled: boolean;
  loggedIn: boolean;
  user: NeteaseUserSummary | null;
  playlists: NeteasePlaylistSummary[];
  libraryTrackCount: number;
  loginSession: NeteaseQrLoginSession | null;
  detail: string | null;
}

export interface TtsStatus {
  configured: boolean;
  provider: string;
  format: string;
  voiceConfigured: boolean;
  detail: string | null;
}

export interface ContextBundle {
  systemPrompt: string;
  profile: UserProfile;
  weather: WeatherSnapshot;
  calendar: CalendarEvent[];
  recentMessages: MessageRecord[];
  recentPlays: Track[];
  currentTime: string;
  source: TriggerSource;
  userInput?: string;
}

export interface PlanEntry {
  id: string;
  slot: string;
  title: string;
  summary: string;
  status: "pending" | "ready" | "done";
}

export interface PreparedSegment {
  segmentId: string;
  source: TriggerSource;
  mood: string;
  mode: "narrated" | "music-only";
  provider: ProviderInfo;
  narrationText: string;
  narrationAudioUrl: string | null;
  segue: string;
  reason: string;
  outputDevice: string;
  nowPlaying: Track | null;
  queuedTracks: Track[];
  preparedAt: string;
}

export interface NowState {
  segmentId: string;
  updatedAt: string;
  source: TriggerSource;
  mood: string;
  mode: "narrated" | "music-only";
  provider: ProviderInfo;
  narrationText: string;
  narrationAudioUrl: string | null;
  segue: string;
  reason: string;
  outputDevice: string;
  nowPlaying: Track | null;
  queuedTracks: Track[];
  preparedNext: PreparedSegment | null;
}

export interface RunTurnResult {
  decision: Decision;
  nowState: NowState;
  plan: PlanEntry[];
  voice: VoiceAsset | null;
}

export type StreamEvent =
  | {
      type: "radio.state";
      payload: NowState;
    }
  | {
      type: "plan.updated";
      payload: PlanEntry[];
    };

export interface HealthResponse {
  ok: true;
  mode: string;
  codex: ProviderInfo;
  music: MusicStatus;
  tts: TtsStatus;
}

export interface NowResponse {
  now: NowState | null;
}

export interface BootstrapResponse {
  now: NowState | null;
  plan: PlanEntry[];
  music: MusicBootstrap;
  codex: CodexSettings;
  codexStatus: ProviderInfo;
  tts: TtsStatus;
}

export interface NextResponse {
  next: Track | null;
}

export interface TasteSummaryResponse {
  tasteHighlights: string[];
  routineHighlights: string[];
  playlists: PlaylistSeed[];
}

export interface TodayPlanResponse {
  plan: PlanEntry[];
}

export interface MusicBootstrapResponse {
  music: MusicBootstrap;
}

export interface CodexBootstrapResponse {
  settings: CodexSettings;
  status: ProviderInfo;
}

export type CodexSettingsResponse = CodexBootstrapResponse;

export interface MusicQrCreateResponse {
  session: NeteaseQrLoginSession;
}

export interface MusicQrCheckResponse {
  status: NeteaseQrLoginStatus;
  music: MusicBootstrap;
}

export interface MusicLogoutResponse {
  ok: true;
  music: MusicBootstrap;
}

export interface UpdateCodexSettingsRequest {
  authSource: CodexAuthSource;
  projectApiKey?: string;
  clearProjectApiKey?: boolean;
  compatibleApiKey?: string;
  compatibleBaseUrl?: string;
  compatibleModel?: string;
  compatibleResponseFormat?: CompatibleResponsesFormat;
  clearCompatibleApiKey?: boolean;
}

export interface UpdateCodexSettingsResponse {
  settings: CodexSettings;
  status: ProviderInfo;
}

export interface ChatRequest {
  message: string;
}

export type ChatResponse = RunTurnResult;

export interface AdvanceRequest {
  currentSegmentId?: string;
}

export interface AdvanceResponse {
  nowState: NowState;
}
