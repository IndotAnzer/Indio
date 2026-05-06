from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.models import ContextBundle, Decision, Track, TrackNarrationContext


@dataclass(frozen=True)
class CodexIntent:
    mood_hint: str | None = None
    quiet_mode: bool = False


def _clip(value: str, max_length: int) -> str:
    return value if len(value) <= max_length else value[:max_length] + "..."


def _highlights(value: str, max_items: int, max_length: int) -> list[str]:
    bullets = [
        line.strip().removeprefix("-").strip()
        for line in value.splitlines()
        if line.strip().startswith("-")
    ]
    source = bullets or [line.strip() for line in re.split(r"\n+", value) if line.strip()]
    return [_clip(line, max_length) for line in source[:max_items]]


def _local_time_parts(iso_time: str) -> tuple[str, int, str]:
    raw = iso_time.replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(ZoneInfo("Asia/Shanghai"))
    weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    return local.strftime("%H:%M"), local.hour, weekdays[local.weekday()]


def _radio_frame(iso_time: str, mood: str) -> str:
    _, hour, weekday = _local_time_parts(iso_time)
    if weekday in {"周六", "周日"} and 19 <= hour < 24:
        return "weekend-party"
    if 5 <= hour < 10:
        return "morning-city"
    if 11 <= hour < 15:
        return "noon-easy"
    if hour >= 22 or hour < 2 or mood == "evening":
        return "late-night"
    return "workday-focus" if mood == "focus" else "music-companion"


def _same_track(left: Track, right: Track) -> bool:
    return (left.netease_id or left.id) == (right.netease_id or right.id)


def _first_clause(value: str, max_length: int) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    clause = re.split(r"[，。！？；,.!?;]", compact)[0].strip()
    return _clip(clause or compact, max_length)


def _recent_narrations(context: ContextBundle) -> list[dict[str, str]]:
    result = []
    for message in context.recent_messages:
        if message.role == "assistant":
            opener = _first_clause(message.content, 28)
            if opener:
                result.append({"opener": opener, "text": _clip(message.content, 120)})
    return result[-4:]


def build_decision_prompt(context: ContextBundle, intent: CodexIntent) -> str:
    payload = {
        "currentTime": context.current_time,
        "source": context.source,
        "userInput": context.user_input,
        "intent": {"moodHint": intent.mood_hint, "quietMode": intent.quiet_mode},
        "systemPrompt": _clip(context.system_prompt, 1600),
        "userProfile": {
            "taste": _clip(context.profile.taste, 1600),
            "routines": _clip(context.profile.routines, 1200),
            "moodRules": _clip(context.profile.mood_rules, 1200),
            "playlists": [item.model_dump(mode="json", by_alias=True) for item in context.profile.playlists],
        },
        "weather": context.weather.model_dump(mode="json", by_alias=True),
        "calendar": [item.model_dump(mode="json", by_alias=True) for item in context.calendar],
        "recentMessages": [item.model_dump(mode="json", by_alias=True) for item in context.recent_messages],
        "recentPlays": [item.model_dump(mode="json", by_alias=True) for item in context.recent_plays],
    }
    return "\n".join(
        [
            "You are Indio's radio decision engine.",
            "Return only JSON that matches the provided schema.",
            "Do not use tools.",
            "Do not read or write files.",
            "Do not browse the web.",
            "Use only the context below.",
            "Write all user-facing text in natural Simplified Chinese.",
            "Prefer concise narration and Netease-friendly search queries.",
            "The `say` field is only the emotional angle for this turn, not the final full on-air song introduction.",
            "When quietMode is true, set mode to music-only and keep narration brief.",
            "",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


def build_narration_prompt(
    *,
    context: ContextBundle,
    decision: Decision,
    now_playing: Track,
    now_playing_context: TrackNarrationContext | None,
    queued_tracks: list[Track],
) -> str:
    clock, _, weekday = _local_time_parts(context.current_time)
    previous = next((track for track in context.recent_plays if not _same_track(track, now_playing)), None)
    payload = {
        "currentTime": context.current_time,
        "localTime": {"timezone": "Asia/Shanghai", "clock": clock, "weekday": weekday},
        "radioFrame": _radio_frame(context.current_time, decision.mood),
        "userInput": context.user_input,
        "personaGuidance": _clip(context.system_prompt, 1500),
        "tasteHighlights": _highlights(context.profile.taste, 5, 90),
        "routineHighlights": _highlights(context.profile.routines, 2, 80),
        "moodRules": _highlights(context.profile.mood_rules, 4, 80),
        "weather": context.weather.summary,
        "antiRepetition": {
            "recentNarrations": _recent_narrations(context),
            "forbiddenWeatherCopies": ["午后这会儿", "云层有点厚", context.weather.summary],
            "instruction": "Use these only to avoid repetition. Do not quote or paraphrase recent openers.",
        },
        "decision": {"say": decision.say, "segue": decision.segue, "mood": decision.mood, "mode": decision.mode},
        "nowPlaying": {
            "title": now_playing.title,
            "artist": now_playing.artist,
            "album": now_playing.album,
            "mood": now_playing.mood,
        },
        "nowPlayingContext": now_playing_context.model_dump(mode="json", by_alias=True) if now_playing_context else None,
        "previousTrack": {"title": previous.title, "artist": previous.artist} if previous else None,
        "nextTrack": {"title": queued_tracks[0].title, "artist": queued_tracks[0].artist} if queued_tracks else None,
    }
    return "\n".join(
        [
            "You write the final spoken on-air narration for Indio, a personal radio host.",
            "Return only JSON that matches the provided schema.",
            "Write all user-facing text in natural Simplified Chinese.",
            "This is the actual spoken radio copy for the current song, not notes and not metadata.",
            "Make it feel like a real radio DJ: relaxed, conversational, musically aware, and present in the moment, not like an encyclopedia or a generated song card.",
            "Within the first sentence, mention the song title, artist, or a concrete auditory trait of the song.",
            "Use at most one metadata fact, and only if it genuinely makes the spoken transition better.",
            "Do not mention BPM, lyricists, composers, arrangers, producers, or credits unless the user explicitly asks for that kind of information.",
            "Write one short paragraph of 2 to 4 sentences, or 1 to 2 sentences if the turn should be quieter.",
            "Do not mention models, providers, APIs, playlists, fallback, queues, or technical system state.",
            "If lyric preview is provided, use it only to infer theme or imagery; do not quote lyrics verbatim for more than 8 consecutive Chinese characters.",
            "Avoid empty fake-empathy phrases such as '先安静接住', '接住你的心事', '把情绪接住', or similar wording.",
            "",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )
