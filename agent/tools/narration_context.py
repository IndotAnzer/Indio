from __future__ import annotations

from contextvars import ContextVar
from typing import Any


_previous_narration_context: ContextVar[dict[str, Any] | None] = ContextVar(
    "previous_narration_context",
    default=None,
)


def set_previous_narration_context(state: dict[str, Any] | None) -> None:
    _previous_narration_context.set(_extract_previous_context(state))


def clear_previous_narration_context() -> None:
    _previous_narration_context.set(None)


def get_previous_narration_context() -> dict[str, Any]:
    context = _previous_narration_context.get()
    if not context:
        return {
            "ok": True,
            "hasPrevious": False,
            "usageGuidance": [
                "没有上一段口播时，按自然开场处理。",
                "不要假装刚刚播放过歌曲，也不要编造上一段内容。",
            ],
        }

    return {
        "ok": True,
        "hasPrevious": True,
        **context,
        "usageGuidance": [
            "用上一段口播和上一首歌作为轻微承接，不要逐字复述。",
            "可以承接上一段的情绪、时间感或歌曲意象，再自然转到新歌。",
            "避免重复上一段的开头、结尾和固定套话。",
        ],
    }


def _extract_previous_context(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(state, dict):
        return None

    narration_text = _as_str(state.get("narrationText"))
    track = state.get("nowPlaying")
    track_obj = track if isinstance(track, dict) else {}
    track_title = _as_str(track_obj.get("title"))
    track_artist = _as_str(track_obj.get("artist"))

    if not narration_text and not track_title:
        return None

    return {
        "previousSegmentId": _as_str(state.get("segmentId")),
        "previousUpdatedAt": _as_str(state.get("updatedAt")),
        "previousMood": _as_str(state.get("mood")),
        "previousMode": _as_str(state.get("mode")),
        "previousReason": _as_str(state.get("reason")),
        "previousSegue": _as_str(state.get("segue")),
        "previousNarration": _clip(narration_text, 360),
        "previousTrack": {
            "title": track_title,
            "artist": track_artist,
            "album": _as_str(track_obj.get("album")),
            "mood": _as_str(track_obj.get("mood")),
            "platformUrl": _as_str(track_obj.get("platformUrl")),
        },
    }


def _as_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value if len(value) <= limit else value[:limit].rstrip() + "..."
