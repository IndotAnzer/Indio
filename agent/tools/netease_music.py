import json
import os
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from core.user_context import get_current_netease_cookie


def _as_obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _as_id(value: Any) -> str | None:
    if isinstance(value, int | float):
        return str(int(value))
    return _as_str(value)


def _as_num(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _artist_label(song: dict[str, Any]) -> str | None:
    for bucket in (_as_list(song.get("ar")), _as_list(song.get("artists"))):
        names = [_as_str(_as_obj(artist).get("name")) for artist in bucket]
        names = [name for name in names if name]
        if names:
            return " / ".join(names)
    return None


def _album_label(song: dict[str, Any]) -> str | None:
    for bucket in (_as_obj(song.get("al")), _as_obj(song.get("album"))):
        name = _as_str(bucket.get("name"))
        if name:
            return name
    return None


def _artwork_url(song: dict[str, Any]) -> str | None:
    for bucket in (_as_obj(song.get("al")), _as_obj(song.get("album"))):
        url = _as_str(bucket.get("picUrl"))
        if url:
            return url
    return None


def _coerce_limit(value: Any) -> int:
    try:
        limit = int(value or 6)
    except (TypeError, ValueError):
        limit = 6
    return max(1, min(limit, 10))


def _netease_api_base_url() -> str:
    return os.getenv("NETEASE_API_BASE_URL", "http://localhost:3000").rstrip("/")


def _netease_cookie() -> str | None:
    return get_current_netease_cookie() or _as_str(os.getenv("NETEASE_COOKIE"))


def _netease_request_json(path: str, params: dict[str, str], *, with_auth: bool = True) -> Any:
    base_url = _netease_api_base_url()
    if not base_url:
        raise RuntimeError("NETEASE_API_BASE_URL is not configured.")

    query = dict(params)
    cookie = _netease_cookie() if with_auth else None
    if cookie:
        query["cookie"] = cookie

    url = urljoin(base_url + "/", path.lstrip("/"))
    if query:
        url = f"{url}?{urlencode(query)}"

    request = Request(url, headers={"Cookie": cookie} if cookie else {})
    try:
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))
    except URLError as exc:
        raise RuntimeError(f"Netease API request failed: {exc}") from exc


def _resolve_netease_stream_url(track_id: str) -> str | None:
    params = {
        "id": track_id,
        "level": os.getenv("NETEASE_PLAYBACK_LEVEL", "standard"),
    }
    if os.getenv("NETEASE_ENABLE_UNBLOCK", "").lower() in {"1", "true", "yes", "on"}:
        params["unblock"] = "true"
    if os.getenv("NETEASE_UNBLOCK_SOURCE"):
        params["source"] = os.environ["NETEASE_UNBLOCK_SOURCE"]

    payload = _netease_request_json("/song/url/v1", params)
    data = _as_list(_as_obj(payload).get("data"))
    return _as_str(_as_obj(data[0] if data else {}).get("url"))


def query_netease_music(query: str, limit: int = 6, includeStreamUrl: bool = True) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "query is required", "tracks": []}

    limit = _coerce_limit(limit)
    try:
        payload = _netease_request_json(
            "/cloudsearch",
            {"keywords": query, "type": "1", "limit": str(limit)},
        )
        songs = _as_list(_as_obj(_as_obj(payload).get("result")).get("songs"))[:limit]
        tracks = []
        for song in (_as_obj(item) for item in songs):
            track_id = _as_id(song.get("id"))
            title = _as_str(song.get("name"))
            artist = _artist_label(song)
            if not track_id or not title or not artist:
                continue

            stream_url = _resolve_netease_stream_url(track_id) if includeStreamUrl else None
            tracks.append(
                {
                    "trackId": track_id,
                    "title": title,
                    "artist": artist,
                    "album": _album_label(song) or "网易云音乐",
                    "durationSec": round((_as_num(song.get("dt")) or _as_num(song.get("duration")) or 0) / 1000),
                    "streamUrl": stream_url,
                    "playable": bool(stream_url) if includeStreamUrl else None,
                    "artworkUrl": _artwork_url(song),
                    "platformUrl": f"https://music.163.com/#/song?id={track_id}",
                }
            )
        return {"ok": True, "query": query, "tracks": tracks}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "tracks": []}
