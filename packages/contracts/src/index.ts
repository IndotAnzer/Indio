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

export type PlaybackSource = "netease" | "unavailable";

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

export type ProviderKind = "responses-agent" | "local-control-tool" | "netease" | "error";
export type ProviderState = "ready" | "error" | "disabled";
export type AuthMode = "chatgpt" | "api-key" | "none" | "unknown";

export interface ProviderInfo {
  kind: ProviderKind;
  state: ProviderState;
  authMode: AuthMode;
  model: string | null;
  detail: string | null;
  durationMs: number | null;
}

export interface AgentSettings {
  apiKeyConfigured: boolean;
  apiKeyLabel: string | null;
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  maxTurns: number;
  timeoutMs: number;
  traceEnabled: boolean;
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
  provider: "netease-api-enhanced";
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
  provider: "netease-api-enhanced";
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
  agentRunId: string | null;
}

export type AgentRunStatus = "running" | "completed" | "failed";
export type AgentStepType = "response" | "tool-call" | "final" | "error";
export type ToolPermission = "read-only" | "controlled-write" | "requires-approval";

export interface AgentRun {
  id: string;
  source: TriggerSource;
  userInput: string | null;
  status: AgentRunStatus;
  model: string;
  responseId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  finalOutput: Record<string, unknown> | null;
  error: string | null;
}

export interface AgentStep {
  id: string;
  runId: string;
  agentName: string | null;
  stepType: AgentStepType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentToolCall {
  id: string;
  runId: string;
  agentName: string | null;
  toolName: string;
  permission: ToolPermission;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
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
  agent: ProviderInfo;
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
  agent: AgentSettings;
  agentStatus: ProviderInfo;
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

export interface AgentBootstrapResponse {
  settings: AgentSettings;
  status: ProviderInfo;
}

export type AgentSettingsResponse = AgentBootstrapResponse;

export interface AgentRunsResponse {
  runs: AgentRun[];
}

export interface AgentRunDetailResponse {
  run: AgentRun;
  steps: AgentStep[];
  toolCalls: AgentToolCall[];
}

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
