from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class PlaybackSource(str, Enum):
    NETEASE = "netease"
    UNAVAILABLE = "unavailable"


class Track(BaseModel, frozen=False):
    id: str
    netease_id: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    mood: str = "radio"
    duration_sec: int = 0
    stream_url: str | None = None
    artwork_url: str | None = None
    platform_url: str | None = None
    playback_source: PlaybackSource = PlaybackSource.UNAVAILABLE
    source_playlists: list[str] = Field(default_factory=list)


class ProviderInfo(BaseModel):
    kind: str = "responses-agent"


class NowState(BaseModel):
    segmentId: str
    updatedAt: str
    mode: str = "narrated"
    provider: ProviderInfo = Field(default_factory=ProviderInfo)
    narrationText: str | None = None
    narrationAudioUrl: str | None = None
    nowPlaying: Track | None = None
    queuedTracks: list[Track] = Field(default_factory=list)
    preparedNext: Track | None = None


class TtsStatus(BaseModel):
    configured: bool = False
    provider: str = "tts-disabled"
    format: str = "mp3"
    voice_configured: bool = False
    detail: str = ""


class WeatherSnapshot(BaseModel):
    condition: str = "clear"
    temperature_c: float = 22.0
    summary: str = ""


class CalendarEvent(BaseModel):
    id: str = ""
    title: str = ""
    start_at: str = ""
    end_at: str = ""


class NeteaseUserSummary(BaseModel):
    uid: str
    nickname: str
    avatar_url: str | None = None


class NeteasePlaylistSummary(BaseModel):
    id: str
    name: str
    track_count: int = 0
    cover_img_url: str | None = None
    creator_name: str | None = None
    owned_by_user: bool = False


class NeteaseQrLoginSession(BaseModel):
    key: str
    qr_url: str
    qr_image: str | None = None
    created_at: str = ""


class NeteaseQrLoginStatus(BaseModel):
    code: int
    authorized: bool = False
    state: str = ""
    message: str = ""


class MusicStatus(BaseModel):
    configured: bool = False
    provider: str = "netease-api-enhanced"
    base_url: str | None = None
    cookie_configured: bool = False
    unblock_enabled: bool = False
    logged_in: bool = False
    user: NeteaseUserSummary | None = None
    playlist_count: int = 0
    library_track_count: int = 0
    detail: str = ""


class MusicBootstrap(MusicStatus):
    playlists: list[NeteasePlaylistSummary] = Field(default_factory=list)
    login_session: NeteaseQrLoginSession | None = None


class TrackNarrationContext(BaseModel):
    source_playlists: list[str] = Field(default_factory=list)
    aliases: list[str] | None = None
    release_year: int | None = None
    lyric_preview: list[str] | None = None
    primary_artist: dict[str, Any] | None = None


class TrackRequest(BaseModel):
    track_id: str | None = None
    query: str | None = None
