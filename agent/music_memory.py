from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from datetime import timedelta
from pathlib import Path
from typing import Any

from openai import OpenAI

from core.user_context import DEFAULT_USER_ID, get_current_user_id, safe_user_id
from env_loader import load_project_env


def _runtime_root() -> Path:
    default_root = Path(os.getenv("INDIO_PROJECT_ROOT", Path(__file__).resolve().parent.parent)) / "indio"
    return Path(os.getenv("INDIO_RUNTIME_ROOT", default_root))


MEMORY_DIR = Path(os.getenv("INDIO_MEMORY_ROOT", _runtime_root() / "memory"))
USER_MEMORY_ROOT = Path(os.getenv("INDIO_USER_MEMORY_ROOT", _runtime_root() / "users"))
TASTE_PATH = MEMORY_DIR / "TASTE.md"
HABIT_PATH = MEMORY_DIR / "HABIT.md"
HABIT_EVENTS_PATH = MEMORY_DIR / "HABIT_EVENTS.jsonl"
MEMORY_META_PATH = MEMORY_DIR / "MEMORY_META.json"

MAX_PROFILE_CHARS = 6000
MAX_HABIT_EVENTS = 200
HABIT_LLM_EVENT_INTERVAL = 5
HABIT_LLM_MIN_INTERVAL = timedelta(minutes=30)
DEFAULT_AGENT_BASE_URL = "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1"
DEFAULT_SUMMARY_MODEL = "qwen3.5-flash"


@dataclass(frozen=True)
class MemoryPaths:
    directory: Path
    taste: Path
    habit: Path
    habit_events: Path
    meta: Path


def _memory_paths(user_id: str | None = None) -> MemoryPaths:
    resolved_user_id = user_id or get_current_user_id()
    directory = MEMORY_DIR if resolved_user_id == DEFAULT_USER_ID else USER_MEMORY_ROOT / safe_user_id(resolved_user_id) / "memory"
    return MemoryPaths(
        directory=directory,
        taste=directory / "TASTE.md",
        habit=directory / "HABIT.md",
        habit_events=directory / "HABIT_EVENTS.jsonl",
        meta=directory / "MEMORY_META.json",
    )


def ensure_music_memory_files(user_id: str | None = None) -> None:
    paths = _memory_paths(user_id)
    paths.directory.mkdir(parents=True, exist_ok=True)
    if not paths.taste.exists():
        paths.taste.write_text(_empty_taste_markdown(), encoding="utf-8")
    if not paths.habit.exists():
        paths.habit.write_text(_empty_habit_markdown(), encoding="utf-8")


def update_taste_profile(
    user: Any,
    playlists: list[Any],
    tracks: list[Any],
    *,
    refreshed_at: str | None = None,
    user_id: str | None = None,
) -> None:
    paths = _memory_paths(user_id)
    ensure_music_memory_files(user_id)
    digest = _taste_digest(user, playlists, tracks, refreshed_at=refreshed_at)
    markdown = _summarize_taste_with_llm(digest)
    paths.taste.write_text(_clean_markdown(markdown, "# TASTE"), encoding="utf-8")
    meta = _read_meta(paths)
    meta["taste"] = {
        "updatedAt": _now_iso(),
        "source": "llm",
        "model": _summary_model(),
        "trackCount": digest["snapshot"]["indexedTracks"],
        "playlistCount": digest["snapshot"]["indexedPlaylists"],
    }
    _write_meta(meta, paths)


def record_habit_event(
    *,
    request: str,
    track: Any,
    previous_track: Any | None = None,
    action: str = "turn",
    user_id: str | None = None,
) -> bool:
    if not _is_user_radio_request_action(action):
        return False

    paths = _memory_paths(user_id)
    ensure_music_memory_files(user_id)
    now = datetime.now().astimezone()
    track_obj = _normalize_track(track)
    previous_obj = _normalize_track(previous_track) if previous_track else None
    event = {
        "createdAt": now.isoformat(timespec="seconds"),
        "hour": now.hour,
        "weekday": now.strftime("%A"),
        "daypart": _daypart(now.hour),
        "action": action,
        "request": _clip(request.strip(), 240) if request else "",
        "track": track_obj,
        "previousTrack": previous_obj,
    }
    with paths.habit_events.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    try:
        maybe_update_habit_profile(user_id=user_id)
    except Exception:
        return True
    return True


def maybe_update_habit_profile(*, force: bool = False, user_id: str | None = None) -> bool:
    paths = _memory_paths(user_id)
    ensure_music_memory_files(user_id)
    events = [event for event in _read_habit_events(paths) if _is_user_radio_request_action(event.get("action"))]
    if not events:
        return False
    meta = _read_meta(paths)
    habit_meta = _to_obj(meta.get("habit"))
    summarized_count = int(habit_meta.get("eventCount") or 0)
    last_updated = _parse_datetime(_as_text(habit_meta.get("updatedAt")))
    needs_filtered_resync = summarized_count > len(events)
    enough_new_events = len(events) - summarized_count >= HABIT_LLM_EVENT_INTERVAL
    enough_time = not last_updated or datetime.now().astimezone() - last_updated >= HABIT_LLM_MIN_INTERVAL
    needs_first_summary = not habit_meta or summarized_count == 0
    if not force and not needs_first_summary and not needs_filtered_resync and not (enough_new_events and enough_time):
        return False

    markdown = _summarize_habit_with_llm(events, paths.taste.read_text(encoding="utf-8") if paths.taste.exists() else "")
    paths.habit.write_text(_clean_markdown(markdown, "# HABIT"), encoding="utf-8")
    meta["habit"] = {
        "updatedAt": _now_iso(),
        "source": "llm",
        "model": _summary_model(),
        "eventCount": len(events),
    }
    _write_meta(meta, paths)
    return True


def get_user_music_profile(user_id: str | None = None) -> dict[str, Any]:
    paths = _memory_paths(user_id)
    ensure_music_memory_files(user_id)
    taste = _clip(paths.taste.read_text(encoding="utf-8"), MAX_PROFILE_CHARS)
    habit = _clip(paths.habit.read_text(encoding="utf-8"), MAX_PROFILE_CHARS)
    return {
        "ok": True,
        "tastePath": str(paths.taste),
        "habitPath": str(paths.habit),
        "taste": taste,
        "habit": habit,
        "usageGuidance": [
            "TASTE is long-term library preference; use it as the default taste prior.",
            "HABIT is time, scene, and request behavior; use it to interpret broad requests like '下一首' or '轻松一点'.",
            "Use TASTE/HABIT to judge fit, not to force the source; catalog discoveries are fine when they match the user's taste.",
            "Do not quote these files in the narration; use them silently for selection.",
        ],
    }


def _read_habit_events(paths: MemoryPaths) -> list[dict[str, Any]]:
    if not paths.habit_events.exists():
        return []
    events: list[dict[str, Any]] = []
    for raw in paths.habit_events.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events[-MAX_HABIT_EVENTS:]


def _is_user_radio_request_action(action: Any) -> bool:
    value = _as_text(action) or "turn"
    return value.lower() == "turn"


def _taste_digest(
    user: Any,
    playlists: list[Any],
    tracks: list[Any],
    *,
    refreshed_at: str | None = None,
) -> dict[str, Any]:
    user_obj = _to_obj(user)
    playlist_objs = [_to_obj(item) for item in playlists]
    track_objs = [_normalize_track(item) for item in tracks]
    track_objs = [item for item in track_objs if item]

    artist_counts = Counter(track["artist"] for track in track_objs if track.get("artist"))
    album_counts = Counter(track["album"] for track in track_objs if track.get("album"))
    playlist_counts = Counter(
        playlist
        for track in track_objs
        for playlist in track.get("sourcePlaylists", [])
    )
    language_counts = Counter(_language_signal(track) for track in track_objs)
    instrumental_tracks = [track for track in track_objs if _looks_instrumental(track)]
    owned_playlists = [item for item in playlist_objs if item.get("ownedByUser") or item.get("owned_by_user")]
    samples = _sample_tracks_by_playlist(track_objs, 90)

    return {
        "snapshot": {
            "refreshedAt": refreshed_at or _now_iso(),
            "user": _as_text(user_obj.get("nickname")) or "unknown",
            "indexedPlaylists": len(playlist_objs),
            "ownedPlaylists": len(owned_playlists),
            "indexedTracks": len(track_objs),
            "instrumentalRatio": round(len(instrumental_tracks) / len(track_objs), 3) if track_objs else 0,
        },
        "topArtists": artist_counts.most_common(30),
        "topAlbums": album_counts.most_common(20),
        "topPlaylists": playlist_counts.most_common(30),
        "languageSignals": language_counts.most_common(8),
        "playlistSummaries": [
            {
                "name": _as_text(item.get("name")),
                "trackCount": item.get("trackCount") or item.get("track_count"),
                "ownedByUser": bool(item.get("ownedByUser") or item.get("owned_by_user")),
            }
            for item in playlist_objs[:50]
        ],
        "sampleTracks": samples,
    }


def _summarize_taste_with_llm(digest: dict[str, Any]) -> str:
    return _call_summary_llm(
        instructions=(
            "You write durable music taste memory for a personal AI radio agent. "
            "Return only Markdown. Start with '# TASTE'. Do not invent facts beyond the digest. "
            "Infer stable preference patterns from playlist names, artists, albums, language signals, and sampled tracks. "
            "Be concise, concrete, and useful for future song selection."
        ),
        user_content=(
            "Create TASTE.md from this distilled Netease playlist digest.\n\n"
            "Required sections:\n"
            "- Snapshot\n"
            "- Defaults\n"
            "- Strong Signals\n"
            "- Taste Clusters\n"
            "- Avoid By Default\n"
            "- Selection Rules\n\n"
            "Important: distinguish relaxed vocal preference from pure music/BGM. "
            "If instrumental ratio is low, say not to interpret broad relaxed requests as instrumental-only. "
            "Do not write rules that force the agent to play only from the user's playlists; the memory describes taste, not a hard source constraint.\n\n"
            f"Digest JSON:\n{json.dumps(digest, ensure_ascii=False, indent=2)}"
        ),
    )


def _summarize_habit_with_llm(events: list[dict[str, Any]], taste_markdown: str) -> str:
    compact_events = [
        {
            "createdAt": event.get("createdAt"),
            "daypart": event.get("daypart"),
            "weekday": event.get("weekday"),
            "action": event.get("action"),
            "request": event.get("request"),
            "track": event.get("track"),
            "previousTrack": event.get("previousTrack"),
        }
        for event in events[-MAX_HABIT_EVENTS:]
    ]
    return _call_summary_llm(
        instructions=(
            "You write listening habit memory for a personal AI radio agent. "
            "Return only Markdown. Start with '# HABIT'. Do not invent facts beyond the events. "
            "Summarize time, scene, request wording, and transition behavior. "
            "This file should help interpret broad requests without overriding explicit user intent. "
            "Only user-sent radio requests count as habit evidence; do not infer habits from automatic advance playback."
        ),
        user_content=(
            "Create HABIT.md from recent radio events.\n\n"
            "Required sections:\n"
            "- Snapshot\n"
            "- Time Patterns\n"
            "- Request Interpretation\n"
            "- Transition Habits\n"
            "- Negative Signals\n"
            "- Operating Rules\n\n"
            "Use TASTE.md only as supporting context, not as event evidence.\n\n"
            "Do not write rules that force the agent to play only from the user's playlists; describe habits and fit instead.\n\n"
            f"TASTE.md excerpt:\n{_clip(taste_markdown, 3000)}\n\n"
            f"Events JSON:\n{json.dumps(compact_events, ensure_ascii=False, indent=2)}"
        ),
    )


def _call_summary_llm(*, instructions: str, user_content: str) -> str:
    load_project_env()
    api_key = _summary_api_key()
    if not api_key:
        raise RuntimeError("No API key configured for music memory LLM summarizer.")
    client = OpenAI(api_key=api_key, base_url=_summary_base_url())
    response = client.responses.create(
        model=_summary_model(),
        instructions=instructions,
        input=[{"role": "user", "content": user_content}],
    )
    output = _as_text(getattr(response, "output_text", None))
    if not output:
        raise RuntimeError("Music memory LLM returned empty output.")
    return output


def _clean_markdown(value: str, expected_heading: str) -> str:
    value = value.strip()
    fenced = re.match(r"^```(?:markdown|md)?\s*(.*?)\s*```$", value, flags=re.I | re.S)
    if fenced:
        value = fenced.group(1).strip()
    if not value.startswith(expected_heading):
        value = f"{expected_heading}\n\n{value}"
    return value.rstrip() + "\n"


def _sample_tracks_by_playlist(tracks: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    seen: set[str] = set()
    by_playlist: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for track in tracks:
        playlists = track.get("sourcePlaylists") or ["unknown"]
        for playlist in playlists:
            by_playlist[playlist].append(track)
    for playlist, playlist_tracks in sorted(by_playlist.items(), key=lambda item: len(item[1]), reverse=True):
        for track in playlist_tracks[:8]:
            key = track.get("trackId") or f"{track.get('title')}::{track.get('artist')}"
            if key in seen:
                continue
            seen.add(key)
            samples.append({
                "title": track.get("title"),
                "artist": track.get("artist"),
                "album": track.get("album"),
                "sourcePlaylist": playlist,
            })
            if len(samples) >= limit:
                return samples
    return samples


def _normalize_track(value: Any) -> dict[str, Any] | None:
    track = _to_obj(value)
    track_id = _as_text(track.get("trackId") or track.get("neteaseId") or track.get("netease_id") or track.get("id"))
    title = _as_text(track.get("title"))
    artist = _as_text(track.get("artist"))
    if not track_id and not title:
        return None
    return {
        "trackId": track_id,
        "title": title,
        "artist": artist,
        "album": _as_text(track.get("album")),
        "mood": _as_text(track.get("mood")),
        "sourcePlaylists": [
            item for item in (_as_text(value) for value in _as_list(track.get("sourcePlaylists") or track.get("source_playlists"))) if item
        ],
    }


def _language_signal(track: dict[str, Any]) -> str:
    text = " ".join(_as_text(track.get(key)) or "" for key in ("title", "artist", "album"))
    if re.search(r"[\u4e00-\u9fff]", text):
        return "CJK / Chinese-character music"
    if re.search(r"[A-Za-z]", text):
        return "Latin-title music"
    return "Unknown language"


def _looks_instrumental(track: dict[str, Any]) -> bool:
    text = " ".join(
        [
            _as_text(track.get("title")) or "",
            _as_text(track.get("artist")) or "",
            _as_text(track.get("album")) or "",
            " ".join(_as_list(track.get("sourcePlaylists"))),
        ]
    )
    return bool(re.search(r"纯音乐|轻音乐|钢琴曲|伴奏|BGM|白噪音|自然音|instrumental|piano cover|lofi beats", text, re.I))


def _read_meta(paths: MemoryPaths) -> dict[str, Any]:
    if not paths.meta.exists():
        return {}
    try:
        payload = json.loads(paths.meta.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_meta(value: dict[str, Any], paths: MemoryPaths) -> None:
    paths.meta.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _summary_api_key() -> str | None:
    return (
        os.getenv("INDIO_MEMORY_API_KEY")
        or os.getenv("INDIO_AGENT_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )


def _summary_base_url() -> str:
    return os.getenv("INDIO_MEMORY_BASE_URL") or os.getenv("INDIO_AGENT_BASE_URL") or DEFAULT_AGENT_BASE_URL


def _summary_model() -> str:
    return os.getenv("INDIO_MEMORY_MODEL") or os.getenv("INDIO_AGENT_MODEL") or DEFAULT_SUMMARY_MODEL


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _daypart(hour: int) -> str:
    if 5 <= hour < 11:
        return "morning"
    if 11 <= hour < 14:
        return "midday"
    if 14 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 23:
        return "evening"
    return "late_night"


def _to_obj(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return value.dict()
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _clip(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[:limit].rstrip() + "\n..."


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _empty_taste_markdown() -> str:
    return "\n".join(
        [
            "# TASTE",
            "",
            "This file will be distilled from the user's Netease playlists after the personal library is refreshed.",
            "",
            "## Defaults",
            "- Use this profile to judge taste fit, not to force playback source.",
            "- Catalog discovery is allowed when it matches the user's taste.",
            "- Avoid pure music/BGM by default unless the user explicitly asks for it.",
        ]
    ) + "\n"


def _empty_habit_markdown() -> str:
    return "\n".join(
        [
            "# HABIT",
            "",
            "This file will be distilled from user radio requests over time.",
            "",
            "## Time Patterns",
            "- Not enough listening events yet.",
        ]
    ) + "\n"
