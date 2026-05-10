from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from tools.netease_music import (
    _album_label,
    _artist_label,
    _as_id,
    _as_list,
    _as_num,
    _as_obj,
    _as_str,
    _netease_request_json,
)


def search_music_background(
    title: str,
    artist: str,
    album: str | None = None,
    trackId: str | None = None,
) -> dict[str, Any]:
    title = (title or "").strip()
    artist = (artist or "").strip()
    album = (album or "").strip() or None
    track_id = _as_id(trackId)

    if not title or not artist:
        return {
            "ok": False,
            "error": "title and artist are required",
            "backgroundFacts": [],
            "storySnippets": [],
        }

    song = _fetch_song(track_id, title, artist)
    if song:
        track_id = _as_id(song.get("id")) or track_id
        title = _as_str(song.get("name")) or title
        artist = _artist_label(song) or artist
        album = _album_label(song) or album

    lyric_payload = _safe_netease_json("/lyric", {"id": track_id}) if track_id else None
    wiki_payload = _safe_netease_json("/song/wiki/summary", {"id": track_id}) if track_id else None
    artist_payload = _safe_artist_payload(song)
    comments_payload = _safe_netease_json(
        "/comment/hot",
        {"id": track_id, "type": "0", "limit": "5"},
    ) if track_id else None

    lyric = _as_str(_as_obj(_as_obj(lyric_payload).get("lrc")).get("lyric"))
    credits = _parse_credits(lyric)
    lyric_preview = _pick_lyric_preview(lyric)
    wiki = _parse_wiki(wiki_payload)
    artist_context = _parse_artist_context(artist_payload)
    listener_memories = _parse_listener_memories(comments_payload)
    release_year = _release_year(song)

    facts = _unique(
        [
            f"收录于《{album}》" if album else None,
            f"{release_year} 年发行" if release_year else None,
            *_credit_facts(credits),
            *[f"网易云百科标记为「{item}」" for item in wiki["styles"][:3]],
        ],
        8,
    )

    return {
        "ok": True,
        "track": {
            "trackId": track_id,
            "title": title,
            "artist": artist,
            "album": album,
            "aliases": _unique([*_as_list(_as_obj(song).get("alia")), *_as_list(_as_obj(song).get("tns"))], 4),
            "releaseYear": release_year,
        },
        "backgroundFacts": facts,
        "credits": credits,
        "storySnippets": wiki["storySnippets"],
        "styles": wiki["styles"],
        "tags": wiki["tags"],
        "lyricImages": lyric_preview,
        "artistContext": artist_context,
        "listenerMemories": listener_memories,
        "usageGuidance": [
            "优先引用 backgroundFacts、storySnippets、lyricImages 中的一到两条素材。",
            "listenerMemories 只能当作听众共鸣氛围，不能当成歌曲创作事实。",
            "如果 storySnippets 为空，不要编造创作背景；改用词曲制作、歌词意象或歌手背景做自然串场。",
        ],
    }


def _fetch_song(track_id: str | None, title: str, artist: str) -> dict[str, Any]:
    if track_id:
        payload = _safe_netease_json("/song/detail", {"ids": track_id})
        songs = _as_list(_as_obj(payload).get("songs"))
        if songs:
            return _as_obj(songs[0])

    payload = _safe_netease_json(
        "/cloudsearch",
        {"keywords": f"{title} {artist}", "type": "1", "limit": "3"},
    )
    for song in _as_list(_as_obj(_as_obj(payload).get("result")).get("songs")):
        candidate = _as_obj(song)
        candidate_title = _as_str(candidate.get("name")) or ""
        candidate_artist = _artist_label(candidate) or ""
        if _similar_text(title, candidate_title) and _similar_text(artist, candidate_artist):
            return candidate
    return {}


def _safe_artist_payload(song: dict[str, Any]) -> dict[str, Any] | None:
    artists = _as_list(_as_obj(song).get("ar") or _as_obj(song).get("artists"))
    first_artist = _as_obj(artists[0]) if artists else {}
    artist_id = _as_id(first_artist.get("id"))
    if not artist_id:
        return None
    return _safe_netease_json("/artist/detail", {"id": artist_id})


def _safe_netease_json(path: str, params: dict[str, str | None]) -> dict[str, Any] | None:
    try:
        payload = _netease_request_json(path, {key: value for key, value in params.items() if value}, with_auth=True)
        return _as_obj(payload)
    except Exception:
        return None


def _release_year(song: dict[str, Any]) -> int | None:
    publish_time = _as_num(_as_obj(song).get("publishTime"))
    if not publish_time:
        return None
    try:
        return datetime.utcfromtimestamp(publish_time / 1000).year
    except (OverflowError, OSError, ValueError):
        return None


def _parse_credits(lyric: str | None) -> list[dict[str, str]]:
    if not lyric:
        return []

    label_map = {
        "作词": "作词",
        "填词": "作词",
        "词": "作词",
        "作曲": "作曲",
        "曲": "作曲",
        "编曲": "编曲",
        "制作人": "制作人",
        "制作": "制作人",
        "监制": "监制",
    }
    credits: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for raw in lyric.splitlines()[:36]:
        line = re.sub(r"\[[^\]]+\]", "", raw).strip()
        match = re.match(r"^(作词|填词|词|作曲|曲|编曲|制作人|制作|监制)\s*[:：]\s*(.+)$", line)
        if not match:
            continue
        role = label_map[match.group(1)]
        names = _clean_credit_names(match.group(2))
        if not names:
            continue
        key = (role, names)
        if key in seen:
            continue
        seen.add(key)
        credits.append({"role": role, "name": names})
        if len(credits) >= 6:
            break
    return credits


def _clean_credit_names(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" /,，;；")
    value = re.sub(r"\s*(OP|SP|Publisher|Producer)\s*:.*$", "", value, flags=re.I).strip()
    return value[:80]


def _pick_lyric_preview(lyric: str | None) -> list[str]:
    if not lyric:
        return []
    lines: list[str] = []
    for raw in lyric.splitlines():
        line = re.sub(r"\[[^\]]+\]", "", raw).strip()
        if not line or re.search(r"^[\u4e00-\u9fffA-Za-z（）() ]{1,16}\s*[:：]", line):
            continue
        if re.search(r"[A-Za-z]{4,}", line):
            continue
        lines.append(line[:80])
        if len(lines) >= 4:
            break
    return lines


def _parse_wiki(payload: dict[str, Any] | None) -> dict[str, list[str]]:
    styles: list[str] = []
    tags: list[str] = []
    snippets: list[str] = []

    for block in _as_list(_as_obj(_as_obj(payload).get("data")).get("blocks")):
        block_obj = _as_obj(block)
        block_title = _ui_title(_as_obj(block_obj.get("uiElement")))
        for creative in _as_list(block_obj.get("creatives")):
            creative_obj = _as_obj(creative)
            creative_title = _ui_title(_as_obj(creative_obj.get("uiElement")))
            for resource in _as_list(creative_obj.get("resources")):
                resource_obj = _as_obj(resource)
                resource_title = _ui_title(_as_obj(resource_obj.get("uiElement")))
                resource_desc = _ui_description(_as_obj(resource_obj.get("uiElement")))
                if not resource_title:
                    continue
                if "曲风" in creative_title or "风格" in creative_title:
                    styles.append(resource_title)
                elif "标签" in creative_title or "推荐" in creative_title:
                    tags.append(resource_title)
                elif resource_desc:
                    snippets.append(f"{resource_title}：{resource_desc}")
                elif block_title and block_title not in {"相似歌曲", "相关歌单"}:
                    snippets.append(f"{block_title}：{resource_title}")

    return {
        "styles": _unique(styles, 6),
        "tags": _unique(tags, 6),
        "storySnippets": _unique([item for item in snippets if len(item) >= 8], 5),
    }


def _ui_title(ui: dict[str, Any]) -> str:
    return _as_str(_as_obj(ui.get("mainTitle")).get("title")) or ""


def _ui_description(ui: dict[str, Any]) -> str:
    return _as_str(_as_obj(ui.get("description")).get("text")) or ""


def _parse_artist_context(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    artist = _as_obj(_as_obj(_as_obj(payload).get("data")).get("artist"))
    name = _as_str(artist.get("name"))
    brief = _as_str(artist.get("briefDesc"))
    if not name and not brief:
        return None
    return {
        "name": name,
        "aliases": _unique([*_as_list(artist.get("transNames")), *_as_list(artist.get("alias"))], 4),
        "highlights": _artist_highlights(brief),
    }


def _artist_highlights(brief: str | None) -> list[str]:
    if not brief:
        return []
    return [part.strip()[:96] for part in re.split(r"[\n。！？]", brief) if part.strip()][:3]


def _parse_listener_memories(payload: dict[str, Any] | None) -> list[str]:
    memories: list[str] = []
    for comment in _as_list(_as_obj(payload).get("hotComments")):
        content = _as_str(_as_obj(comment).get("content"))
        if not content:
            continue
        content = re.sub(r"\s+", " ", content)
        if len(content) < 8:
            continue
        memories.append(content[:120])
        if len(memories) >= 3:
            break
    return memories


def _credit_facts(credits: list[dict[str, str]]) -> list[str]:
    return [f"{item['role']}：{item['name']}" for item in credits[:4] if item.get("role") and item.get("name")]


def _similar_text(left: str, right: str) -> bool:
    left = re.sub(r"\s+", "", left).lower()
    right = re.sub(r"\s+", "", right).lower()
    return bool(left and right and (left in right or right in left))


def _unique(items: list[str | None], limit: int) -> list[str]:
    result: list[str] = []
    for item in items:
        value = item.strip() if isinstance(item, str) else None
        if not value or value in result:
            continue
        result.append(value)
        if len(result) >= limit:
            break
    return result
