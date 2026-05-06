from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class IndioModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        use_enum_values=True,
    )


class TriggerSource(StrEnum):
    MANUAL = "manual"
    SCHEDULE = "schedule"
    SYSTEM = "system"


class ProviderKind(StrEnum):
    CODEX_CLI = "codex-cli"
    FALLBACK = "fallback"
    LOCAL_CONTROL = "local-control"
    RESPONSES_API = "responses-api"


class ProviderState(StrEnum):
    READY = "ready"
    FALLBACK = "fallback"
    ERROR = "error"
    DISABLED = "disabled"


class AuthMode(StrEnum):
    CHATGPT = "chatgpt"
    API_KEY = "api-key"
    NONE = "none"
    UNKNOWN = "unknown"


class CodexAuthSource(StrEnum):
    SHARED_CLI = "shared-cli"
    PROJECT_API = "project-api"
    OPENAI_COMPATIBLE = "openai-compatible"


class CompatibleResponsesFormat(StrEnum):
    JSON_OBJECT = "json-object"
    JSON_SCHEMA = "json-schema"


class PlaybackSource(StrEnum):
    NETEASE = "netease"
    FALLBACK = "fallback"


class PlaylistSeed(IndioModel):
    id: str
    name: str
    mood: str
    tracks: list[str]


class UserProfile(IndioModel):
    taste: str
    routines: str
    mood_rules: str
    playlists: list[PlaylistSeed]


class WeatherSnapshot(IndioModel):
    condition: Literal["clear", "cloudy", "rain"]
    temperature_c: int
    summary: str


class CalendarEvent(IndioModel):
    id: str
    title: str
    start_at: str
    end_at: str


class MessageRecord(IndioModel):
    id: int
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: str
    metadata: dict[str, Any] | None = None


class Track(IndioModel):
    id: str
    netease_id: str | None = None
    title: str
    artist: str
    album: str
    mood: str
    duration_sec: int
    stream_url: str | None = None
    artwork_url: str | None = None
    platform_url: str | None = None
    playback_source: PlaybackSource
    source_playlists: list[str] = Field(default_factory=list)


class TrackNarrationCredits(IndioModel):
    lyricist: list[str] = Field(default_factory=list)
    composer: list[str] = Field(default_factory=list)
    arranger: list[str] = Field(default_factory=list)
    producer: list[str] = Field(default_factory=list)


class PrimaryArtistContext(IndioModel):
    id: str | None = None
    name: str
    aliases: list[str] = Field(default_factory=list)
    brief: str | None = None
    highlights: list[str] = Field(default_factory=list)


class TrackNarrationContext(IndioModel):
    source_playlists: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    release_year: int | None = None
    language: str | None = None
    bpm: str | None = None
    styles: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    awards: list[str] = Field(default_factory=list)
    scenes: list[str] = Field(default_factory=list)
    review_snippet: str | None = None
    lyric_preview: list[str] = Field(default_factory=list)
    credits: TrackNarrationCredits = Field(default_factory=TrackNarrationCredits)
    primary_artist: PrimaryArtistContext | None = None


class TrackRequest(IndioModel):
    query: str | None = None
    track_id: str | None = None
    reason: str | None = None


class ProviderInfo(IndioModel):
    kind: ProviderKind
    state: ProviderState
    auth_mode: AuthMode
    model: str | None = None
    detail: str | None = None
    duration_ms: int | None = None


class CodexSettings(IndioModel):
    auth_source: CodexAuthSource
    project_api_key_configured: bool
    project_api_key_label: str | None = None
    compatible_api_key_configured: bool
    compatible_api_key_label: str | None = None
    compatible_base_url: str
    compatible_model: str
    compatible_response_format: CompatibleResponsesFormat


class Decision(IndioModel):
    say: str
    play: list[TrackRequest]
    reason: str
    segue: str
    mood: str
    mode: Literal["narrated", "music-only"]
    provider: ProviderInfo


class VoiceAsset(IndioModel):
    id: str
    audio_url: str | None = None
    text: str
    cached: bool
    provider: str
    format: str | None = None
    mime_type: str | None = None
    created_at: str


class NeteaseUserSummary(IndioModel):
    uid: str
    nickname: str
    avatar_url: str | None = None


class NeteasePlaylistSummary(IndioModel):
    id: str
    name: str
    track_count: int
    cover_img_url: str | None = None
    creator_name: str | None = None
    owned_by_user: bool


class NeteaseQrLoginSession(IndioModel):
    key: str
    qr_url: str
    qr_image: str | None = None
    created_at: str


class NeteaseQrLoginStatus(IndioModel):
    code: int
    authorized: bool
    state: Literal["waiting", "scanned", "confirmed", "expired", "error"]
    message: str


class MusicStatus(IndioModel):
    configured: bool
    provider: Literal["netease-api-enhanced", "fallback"]
    base_url: str | None = None
    cookie_configured: bool
    unblock_enabled: bool
    logged_in: bool
    user: NeteaseUserSummary | None = None
    playlist_count: int
    library_track_count: int
    detail: str | None = None


class MusicBootstrap(MusicStatus):
    playlists: list[NeteasePlaylistSummary]
    login_session: NeteaseQrLoginSession | None = None


class TtsStatus(IndioModel):
    configured: bool
    provider: str
    format: str
    voice_configured: bool
    detail: str | None = None


class ContextBundle(IndioModel):
    system_prompt: str
    profile: UserProfile
    weather: WeatherSnapshot
    calendar: list[CalendarEvent]
    recent_messages: list[MessageRecord]
    recent_plays: list[Track]
    current_time: str
    source: TriggerSource
    user_input: str | None = None


class PlanEntry(IndioModel):
    id: str
    slot: str
    title: str
    summary: str
    status: Literal["pending", "ready", "done"]


class PreparedSegment(IndioModel):
    segment_id: str
    source: TriggerSource
    mood: str
    mode: Literal["narrated", "music-only"]
    provider: ProviderInfo
    narration_text: str
    narration_audio_url: str | None = None
    segue: str
    reason: str
    output_device: str
    now_playing: Track | None = None
    queued_tracks: list[Track]
    prepared_at: str


class NowState(IndioModel):
    segment_id: str
    updated_at: str
    source: TriggerSource
    mood: str
    mode: Literal["narrated", "music-only"]
    provider: ProviderInfo
    narration_text: str
    narration_audio_url: str | None = None
    segue: str
    reason: str
    output_device: str
    now_playing: Track | None = None
    queued_tracks: list[Track]
    prepared_next: PreparedSegment | None = None


class RunTurnResult(IndioModel):
    decision: Decision
    now_state: NowState
    plan: list[PlanEntry]
    voice: VoiceAsset | None = None


class RadioEvent(IndioModel):
    type: Literal["radio.state", "plan.updated"]
    payload: NowState | list[PlanEntry]


class HealthResponse(IndioModel):
    ok: Literal[True]
    mode: str
    codex: ProviderInfo
    music: MusicStatus
    tts: TtsStatus


class BootstrapResponse(IndioModel):
    now: NowState | None
    plan: list[PlanEntry]
    music: MusicBootstrap
    codex: CodexSettings
    codex_status: ProviderInfo
    tts: TtsStatus


class NowResponse(IndioModel):
    now: NowState | None


class MusicBootstrapResponse(IndioModel):
    music: MusicBootstrap


class CodexSettingsResponse(IndioModel):
    settings: CodexSettings
    status: ProviderInfo


class MusicQrCreateResponse(IndioModel):
    session: NeteaseQrLoginSession


class MusicQrCheckResponse(IndioModel):
    status: NeteaseQrLoginStatus
    music: MusicBootstrap


class MusicLogoutResponse(IndioModel):
    ok: Literal[True]
    music: MusicBootstrap


class UpdateCodexSettingsRequest(IndioModel):
    auth_source: CodexAuthSource
    project_api_key: str | None = None
    clear_project_api_key: bool = False
    compatible_api_key: str | None = None
    compatible_base_url: str | None = None
    compatible_model: str | None = None
    compatible_response_format: CompatibleResponsesFormat | None = None
    clear_compatible_api_key: bool = False


class ChatRequest(IndioModel):
    message: str


class AdvanceRequest(IndioModel):
    current_segment_id: str | None = None


class AdvanceResponse(IndioModel):
    now_state: NowState


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
