from __future__ import annotations

import uuid
from typing import Any

from models import NowState, PlaybackSource, ProviderInfo, Track, utc_now_iso


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def build_now_state(agent_output: dict[str, Any]) -> NowState:
    track = Track(
        id=str(agent_output.get("trackId", "")),
        netease_id=str(agent_output.get("trackId", "")),
        title=agent_output.get("title", ""),
        artist=agent_output.get("artist", ""),
        album=agent_output.get("album", ""),
        mood="radio",
        duration_sec=agent_output.get("durationSec", 0),
        stream_url=agent_output.get("streamUrl"),
        artwork_url=agent_output.get("artworkUrl"),
        platform_url=agent_output.get("platformUrl"),
        playback_source=PlaybackSource.NETEASE if agent_output.get("playable") else PlaybackSource.UNAVAILABLE,
        source_playlists=[
            item.strip()
            for item in _as_list(agent_output.get("sourcePlaylists"))
            if isinstance(item, str) and item.strip()
        ],
    )

    narration_text = agent_output.get("say", "")
    return NowState(
        segmentId=uuid.uuid4().hex[:12],
        updatedAt=utc_now_iso(),
        mode="narrated" if narration_text else "music-only",
        provider=ProviderInfo(kind="responses-agent"),
        narrationText=narration_text,
        narrationAudioUrl=None,
        nowPlaying=track,
        queuedTracks=[],
        preparedNext=None,
    )
