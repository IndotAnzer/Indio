export type PlaybackSource = "netease" | "unavailable";
export type ProviderState = "ready" | "error" | "disabled";

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

export interface ProviderInfo {
  kind: string;
  state: ProviderState;
  authMode: string;
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

export interface PreparedSegment {
  segmentId: string;
  source: string;
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
  source: string;
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

export interface BootstrapResponse {
  now: NowState | null;
  plan: unknown[];
  music: MusicBootstrap;
  agent: AgentSettings;
  agentStatus: ProviderInfo;
  tts: TtsStatus;
}

export interface NowResponse {
  now: NowState | null;
}

export interface MusicBootstrapResponse {
  music: MusicBootstrap;
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

export interface ChatResponse {
  nowState: NowState;
}

export interface AdvanceResponse {
  nowState: NowState;
}

export interface AuthSession {
  token: string;
  userId: string;
  provider: string;
  openid?: string;
  unionid?: string | null;
}

export interface AuthSessionResponse {
  session: AuthSession;
}

export type StreamEvent =
  | {
      type: "radio.state";
      payload: NowState;
    }
  | {
      type: "plan.updated";
      payload: unknown[];
    };
