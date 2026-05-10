from __future__ import annotations

import random
import re

from models import Track


def track_key(track: Track) -> str:
    return track.netease_id or track.id


def primary_artist_key(track: Track) -> str:
    first = re.split(r"[/,，、&＆]", track.artist)[0] if track.artist else ""
    return re.sub(r"\s+", " ", first).strip().lower()


def same_primary_artist(left: Track | None, right: Track) -> bool:
    if not left:
        return False
    return bool(primary_artist_key(left) and primary_artist_key(left) == primary_artist_key(right))


def _score_library_track(track: Track, query: str) -> float:
    normalized = query.lower()
    haystacks = [
        track.title.lower(),
        track.artist.lower(),
        track.album.lower(),
        *(name.lower() for name in track.source_playlists),
    ]
    score = sum(6 for haystack in haystacks if normalized and normalized in haystack)
    playlist_text = " ".join(track.source_playlists)
    if any(word in normalized for word in ("focus", "专注", "工作")):
        score += 5 if re.search(r"专注|focus|工作|coding|study", playlist_text, re.I) else 0
    if any(word in normalized for word in ("quiet", "安静", "轻")):
        score += 5 if re.search(r"安静|轻|night|sleep|chill", playlist_text, re.I) else 0
    if any(word in normalized for word in ("morning", "早")):
        score += 5 if re.search(r"早|morning|sunrise", playlist_text, re.I) else 0
    if any(word in normalized for word in ("evening", "晚", "夜")):
        score += 5 if re.search(r"夜|晚|midnight|evening|late", playlist_text, re.I) else 0
    return score


def radio_sort_library_tracks(
    tracks: list[Track],
    hint: str,
    recent_track_ids: set[str],
    current_track: Track | None = None,
    avoid_track_ids: set[str] | None = None,
) -> list[Track]:
    normalized = hint.lower()
    words = [word.strip() for word in re.split(r"[\s,，。/|·:：;；]+", normalized) if len(word.strip()) >= 2]

    def score(track: Track) -> float:
        text = " ".join(
            [track.title, track.artist, track.album, track.mood, *track.source_playlists]
        ).lower()
        direct = _score_library_track(track, hint)
        word_score = sum(1.2 for word in words if word in text)
        recent_penalty = 12 if track_key(track) in recent_track_ids else 0
        avoid_penalty = 4 if avoid_track_ids and track_key(track) in avoid_track_ids else 0
        same_track_penalty = 100 if current_track and track_key(current_track) == track_key(track) else 0
        same_artist = random.random() * 2 - 2.5 if same_primary_artist(current_track, track) else 0
        playlist_score = min(2, len(track.source_playlists) * 0.35)
        return direct + word_score + same_artist + playlist_score + random.random() * 6 - recent_penalty - avoid_penalty - same_track_penalty

    ranked = [(track, score(track)) for track in tracks]
    return [track for track, value in sorted(ranked, key=lambda item: item[1], reverse=True) if value > -5]
