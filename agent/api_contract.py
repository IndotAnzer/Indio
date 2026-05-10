from __future__ import annotations

from enum import Enum
import os
from typing import Any

from pydantic import BaseModel


DEFAULT_AGENT_BASE_URL = "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1"


def to_api(value: Any) -> Any:
    if isinstance(value, BaseModel):
        if hasattr(value, "model_dump"):
            return to_api(value.model_dump(mode="json"))
        return to_api(value.dict())
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, list | tuple):
        return [to_api(item) for item in value]
    if isinstance(value, dict):
        return {
            _camelize_key(key) if isinstance(key, str) else key: to_api(item)
            for key, item in value.items()
        }
    return value


def agent_settings_response(default_model: str) -> dict[str, Any]:
    api_key = _agent_api_key()
    return {
        "apiKeyConfigured": bool(api_key),
        "apiKeyLabel": _api_key_label(api_key),
        "baseUrl": os.getenv("INDIO_AGENT_BASE_URL", DEFAULT_AGENT_BASE_URL),
        "model": os.getenv("INDIO_AGENT_MODEL", default_model),
        "reasoningEffort": os.getenv("INDIO_AGENT_REASONING_EFFORT", "low"),
        "maxTurns": _env_int("INDIO_AGENT_MAX_TURNS", 8),
        "timeoutMs": _env_int("INDIO_AGENT_TIMEOUT_MS", 180_000),
        "traceEnabled": _env_bool("INDIO_AGENT_TRACE_ENABLED", True),
    }


def agent_status_response(default_model: str, duration_ms: int | None = None) -> dict[str, Any]:
    api_key = _agent_api_key()
    return {
        "kind": "responses-agent",
        "state": "ready" if api_key else "disabled",
        "authMode": "api-key" if api_key else "none",
        "model": os.getenv("INDIO_AGENT_MODEL", default_model),
        "detail": "Indio Agent runtime is ready." if api_key else "Agent API key is not configured.",
        "durationMs": duration_ms,
    }


def music_bootstrap_response(music_adapter: Any) -> dict[str, Any]:
    return to_api(music_adapter.get_bootstrap())


def tts_status_response(tts_adapter: Any) -> dict[str, Any]:
    return to_api(tts_adapter.get_status())


def now_state_response(state: Any, provider_status: dict[str, Any]) -> dict[str, Any]:
    payload = to_api(state)
    payload.setdefault("source", "manual")
    payload.setdefault("mood", "radio")
    payload.setdefault("segue", "")
    payload.setdefault("reason", "")
    payload.setdefault("outputDevice", "web")

    provider = payload.get("provider")
    payload["provider"] = {
        **provider_status,
        **(provider if isinstance(provider, dict) else {}),
    }
    return payload


def prepared_segment_response(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "segmentId": state.get("segmentId"),
        "source": state.get("source", "manual"),
        "mood": state.get("mood", "radio"),
        "mode": state.get("mode", "narrated"),
        "provider": state.get("provider"),
        "narrationText": state.get("narrationText"),
        "narrationAudioUrl": state.get("narrationAudioUrl"),
        "segue": state.get("segue", ""),
        "reason": state.get("reason", ""),
        "outputDevice": state.get("outputDevice", "web"),
        "nowPlaying": state.get("nowPlaying"),
        "queuedTracks": state.get("queuedTracks", []),
        "preparedAt": state.get("updatedAt"),
    }


def now_state_from_prepared_segment(segment: dict[str, Any]) -> dict[str, Any]:
    return {
        "segmentId": segment.get("segmentId"),
        "updatedAt": segment.get("preparedAt"),
        "source": segment.get("source", "manual"),
        "mood": segment.get("mood", "radio"),
        "mode": segment.get("mode", "narrated"),
        "provider": segment.get("provider"),
        "narrationText": segment.get("narrationText"),
        "narrationAudioUrl": segment.get("narrationAudioUrl"),
        "segue": segment.get("segue", ""),
        "reason": segment.get("reason", ""),
        "outputDevice": segment.get("outputDevice", "web"),
        "nowPlaying": segment.get("nowPlaying"),
        "queuedTracks": segment.get("queuedTracks", []),
        "preparedNext": None,
    }


def _camelize_key(key: str) -> str:
    parts = key.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _agent_api_key() -> str | None:
    return os.getenv("INDIO_AGENT_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or os.getenv("OPENAI_API_KEY")


def _api_key_label(value: str | None) -> str | None:
    if not value:
        return None
    return f"{value[:3]}...{value[-4:]}" if len(value) > 10 else "configured"
