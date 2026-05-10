from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx

from adapters.netease.radio import (
    primary_artist_key,
    radio_sort_library_tracks,
    same_primary_artist,
    track_key,
)
from app_config import AppConfig
from core.state import StateStore
from models import (
    MusicBootstrap,
    MusicStatus,
    NeteasePlaylistSummary,
    NeteaseQrLoginSession,
    NeteaseQrLoginStatus,
    NeteaseUserSummary,
    PlaybackSource,
    Track,
    TrackNarrationContext,
    TrackRequest,
    utc_now_iso,
)
from music_memory import update_taste_profile

LIBRARY_REFRESH_INTERVAL = timedelta(hours=6)
MAX_PLAYLISTS_TO_INDEX = 8
MAX_TRACKS_PER_PLAYLIST = 120


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


def _unique(items: list[str | None], limit: int = 8) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item and item.strip() and item.strip() not in seen:
            seen.append(item.strip())
        if len(seen) >= limit:
            break
    return seen


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


def _dedupe(tracks: list[Track]) -> list[Track]:
    seen: set[str] = set()
    result: list[Track] = []
    for track in tracks:
        key = track_key(track)
        if key in seen:
            continue
        seen.add(key)
        result.append(track)
    return result


class NeteaseMusicAdapter:
    def __init__(self, config: AppConfig, state: StateStore) -> None:
        self.config = config
        self.state = state
        self.user_id = state.user_id
        self.active_qr_session = state.get_qr_session()
        self.pending_auth_cookie = state.get_pending_auth_cookie()

    def get_status(self) -> MusicStatus:
        configured = bool(self.config.netease_api_base_url)
        auth = self.state.get_music_auth()
        user, playlists, tracks, _ = self.state.get_music_library()
        active_user = auth[1] if auth else user
        cookie_configured = bool(self.get_active_cookie())
        return MusicStatus(
            configured=configured,
            provider="netease-api-enhanced",
            base_url=self.config.netease_api_base_url if configured else None,
            cookie_configured=cookie_configured,
            unblock_enabled=self.config.netease_enable_unblock,
            logged_in=bool(active_user),
            user=active_user,
            playlist_count=len(playlists),
            library_track_count=len(tracks),
            detail=(
                f"已连接网易云账号「{active_user.nickname}」，选歌会优先从你的歌单里抽取。"
                if configured and active_user
                else "api-enhanced 已配置，但还没有绑定网易云账号；agent 只会使用真实可用的网易云搜索结果。"
                if configured
                else "未配置 api-enhanced 服务，agent 无法搜索或解析真实音乐。"
            ),
        )

    def get_bootstrap(self) -> MusicBootstrap:
        status = self.get_status()
        _, playlists, tracks, _ = self.state.get_music_library()
        return MusicBootstrap(
            **status.model_dump(),
            playlists=playlists[:12],
            login_session=self.state.get_qr_session() or self.active_qr_session,
        )

    async def create_qr_login_session(self) -> NeteaseQrLoginSession:
        timestamp = str(int(datetime.now().timestamp() * 1000))
        key_payload = await self.request_json(f"/login/qr/key?timestamp={timestamp}", with_auth=False)
        key = _as_str(_as_obj(_as_obj(key_payload).get("data")).get("unikey"))
        if not key:
            raise RuntimeError("网易云二维码 key 返回为空。")

        qr_payload = await self.request_json(
            f"/login/qr/create?{urlencode({'key': key, 'qrimg': 'true', 'timestamp': timestamp})}",
            with_auth=False,
        )
        qr_data = _as_obj(_as_obj(qr_payload).get("data"))
        qr_url = _as_str(qr_data.get("qrurl"))
        if not qr_url:
            raise RuntimeError("网易云二维码创建失败。")
        session = NeteaseQrLoginSession(
            key=key,
            qr_url=qr_url,
            qr_image=_as_str(qr_data.get("qrimg")),
            created_at=utc_now_iso(),
        )
        self.active_qr_session = session
        self.state.save_qr_session(session)
        return session

    async def check_qr_login_session(self, key: str) -> NeteaseQrLoginStatus:
        if await self._try_finalize_pending_login():
            return NeteaseQrLoginStatus(code=803, authorized=True, state="confirmed", message="网易云登录成功")

        payload = await self.request_json(
            f"/login/qr/check?{urlencode({'key': key, 'noCookie': 'true', 'timestamp': str(int(datetime.now().timestamp() * 1000))})}",
            with_auth=False,
        )
        root = _as_obj(payload)
        code = int(_as_num(root.get("code")) or 500)
        message = _as_str(root.get("message")) or "未知登录状态"
        cookie = _as_str(root.get("cookie"))

        if code == 803 and cookie:
            try:
                await self._finish_authorized_login(cookie)
                return NeteaseQrLoginStatus(code=code, authorized=True, state="confirmed", message="网易云登录成功")
            except Exception:
                self.pending_auth_cookie = cookie
                self.state.save_pending_auth_cookie(cookie)
                return NeteaseQrLoginStatus(
                    code=code,
                    authorized=False,
                    state="confirmed",
                    message="已扫码确认，正在同步网易云账号资料…",
                )
        if code == 802:
            return NeteaseQrLoginStatus(code=code, authorized=False, state="scanned", message=message)
        if code == 801:
            return NeteaseQrLoginStatus(code=code, authorized=False, state="waiting", message=message)
        if code == 800:
            if await self._try_finalize_pending_login() or self.state.get_music_auth():
                self.active_qr_session = None
                self.state.save_qr_session(None)
                return NeteaseQrLoginStatus(code=803, authorized=True, state="confirmed", message="网易云登录成功")
            self.active_qr_session = None
            self.state.save_qr_session(None)
            return NeteaseQrLoginStatus(code=code, authorized=False, state="expired", message=message)
        return NeteaseQrLoginStatus(code=code, authorized=False, state="error", message=message)

    async def logout(self) -> None:
        if self.get_active_cookie() and self.config.netease_api_base_url:
            try:
                await self.request_json(f"/logout?timestamp={int(datetime.now().timestamp() * 1000)}")
            except Exception:
                pass
        self.state.clear_music_auth()
        self.active_qr_session = None
        self.pending_auth_cookie = None
        self.state.save_pending_auth_cookie(None)
        self.state.save_qr_session(None)

    async def search(self, query: str) -> list[Track]:
        library = await self.ensure_personal_library()
        recent = {track_key(track) for track in self.state.list_recent_plays(24)}
        library_results = await self._pick_playable_tracks(
            radio_sort_library_tracks(library, query, recent),
            6,
            diversify_artists=True,
        )
        if library_results:
            return library_results
        if self.state.get_music_auth() and library:
            broader_library_results = await self._pick_playable_tracks(
                radio_sort_library_tracks(library, query or "late night radio", recent),
                6,
                diversify_artists=True,
            )
            if broader_library_results:
                return broader_library_results
        if not self.config.netease_api_base_url:
            return []
        try:
            return await self._search_catalog(query)
        except Exception:
            return []

    async def get_track(self, track_id: str) -> Track | None:
        library = await self.ensure_personal_library()
        for track in library:
            if track.id == track_id or track.netease_id == track_id:
                return await self.resolve_playable_source(track)
        if not self.config.netease_api_base_url:
            return None
        try:
            return await self._fetch_song_detail(track_id)
        except Exception:
            return None

    async def get_recommendations(self, mood: str | None = None, query: str | None = None) -> list[Track]:
        hint = (query or mood or "focus").lower()
        library = await self.ensure_personal_library()
        recent = {track_key(track) for track in self.state.list_recent_plays(24)}
        ranked = await self._pick_playable_tracks(
            radio_sort_library_tracks(library, hint, recent),
            6,
            diversify_artists=True,
        )
        if ranked:
            return ranked[:6]
        if library:
            broader_library_results = await self._pick_playable_tracks(
                radio_sort_library_tracks(library, hint, recent),
                6,
                diversify_artists=True,
            )
            if broader_library_results:
                return broader_library_results
        if self.config.netease_api_base_url:
            try:
                matches = await self._search_catalog(hint)
                if matches:
                    return matches
            except Exception:
                pass
        return []

    async def get_radio_continuation(
        self,
        mood: str,
        current_track: Track | None = None,
        queued_tracks: list[Track] | None = None,
        limit: int = 4,
    ) -> list[Track]:
        library = await self.ensure_personal_library()
        if library:
            recent = {track_key(track) for track in self.state.list_recent_plays(30)}
            avoid = {track_key(track) for track in queued_tracks or []}
            if current_track:
                recent.add(track_key(current_track))
            hint = " ".join(_unique([mood, current_track.artist if current_track else None, *(current_track.source_playlists if current_track else [])]))
            curated = radio_sort_library_tracks(library, hint, recent, current_track=current_track, avoid_track_ids=avoid)
            playable = await self._pick_playable_tracks(
                curated,
                limit,
                diversify_artists=True,
                avoid_artist_of=current_track,
            )
            if playable:
                return playable
        return await self.get_recommendations(mood=mood, query=current_track.artist if current_track else mood)

    async def get_narration_context(self, track: Track) -> TrackNarrationContext | None:
        source_playlists = _unique(track.source_playlists, 4)
        if not track.netease_id and not source_playlists:
            return None
        base = TrackNarrationContext(source_playlists=source_playlists)
        if not track.netease_id or not self.config.netease_api_base_url:
            return base
        try:
            song = await self._fetch_song_snapshot(track.netease_id)
            if not song:
                return base
            artists = _as_list(song.get("ar") or song.get("artists"))
            first_artist = _as_obj(artists[0]) if artists else {}
            first_artist_id = _as_id(first_artist.get("id"))
            first_artist_name = _as_str(first_artist.get("name")) or track.artist
            release_year = None
            publish_time = _as_num(song.get("publishTime"))
            if publish_time:
                release_year = datetime.utcfromtimestamp(publish_time / 1000).year

            lyric_payload, artist_payload = await asyncio.gather(
                self.request_json(f"/lyric?{urlencode({'id': track.netease_id})}"),
                self.request_json(f"/artist/detail?{urlencode({'id': first_artist_id})}") if first_artist_id else self._null(),
                return_exceptions=True,
            )
            lyric = _as_str(_as_obj(_as_obj(lyric_payload).get("lrc")).get("lyric")) if not isinstance(lyric_payload, Exception) else None
            artist = _as_obj(_as_obj(_as_obj(artist_payload).get("data")).get("artist")) if not isinstance(artist_payload, Exception) else {}
            brief = _as_str(artist.get("briefDesc"))
            return TrackNarrationContext(
                source_playlists=source_playlists,
                aliases=_unique([*_as_list(song.get("alia")), *_as_list(song.get("tns"))], 4),
                release_year=release_year,
                lyric_preview=self._pick_lyric_preview(lyric),
                primary_artist={
                    "id": first_artist_id,
                    "name": first_artist_name,
                    "aliases": _unique([*_as_list(artist.get("transNames")), *_as_list(artist.get("alias"))], 4),
                    "brief": brief[:240] if brief else None,
                    "highlights": self._artist_highlights(brief),
                },
            )
        except Exception:
            return base

    def build_queue(self, items: list[Track]) -> list[Track]:
        return _dedupe(items)[:3]

    async def resolve_queue(self, requests: list[TrackRequest], fallback_mood: str) -> list[Track]:
        resolved: list[Track] = []
        for request in requests:
            if request.track_id:
                by_id = await self.get_track(request.track_id)
                if by_id:
                    resolved.append(by_id)
                    continue
            if request.query:
                resolved.extend((await self.search(request.query))[:2])
        if not resolved:
            resolved.extend((await self.get_recommendations(mood=fallback_mood))[:2])
        queue = self.build_queue(resolved)
        return [await self.resolve_playable_source(track) for track in queue]

    async def ensure_personal_library(self) -> list[Track]:
        auth = self.state.get_music_auth()
        _, _, tracks, refreshed_at = self.state.get_music_library()
        if not auth:
            return tracks
        if tracks and refreshed_at:
            try:
                if datetime.fromisoformat(refreshed_at.replace("Z", "+00:00")).replace(tzinfo=None) + LIBRARY_REFRESH_INTERVAL > datetime.utcnow():
                    return tracks
            except ValueError:
                pass
        _, _, tracks, _ = await self.refresh_personal_library(force=False)
        return tracks

    async def refresh_personal_library(self, force: bool) -> tuple[NeteaseUserSummary | None, list[NeteasePlaylistSummary], list[Track], str | None]:
        auth = self.state.get_music_auth()
        if not auth:
            self.state.save_music_library(None, [], [], refreshed_at=None)
            return None, [], [], None
        _, user, _ = auth
        current_user, playlists, tracks, refreshed_at = self.state.get_music_library()
        if not force and tracks and refreshed_at:
            try:
                if datetime.fromisoformat(refreshed_at.replace("Z", "+00:00")).replace(tzinfo=None) + LIBRARY_REFRESH_INTERVAL > datetime.utcnow():
                    return current_user, playlists, tracks, refreshed_at
            except ValueError:
                pass

        payload = await self.request_json(
            f"/user/playlist?{urlencode({'uid': user.uid, 'limit': '1000', 'timestamp': str(int(datetime.now().timestamp() * 1000))})}"
        )
        summaries = [
            item
            for item in (self._to_playlist_summary(_as_obj(playlist), user.uid) for playlist in _as_list(_as_obj(payload).get("playlist")))
            if item
        ]
        selected = sorted(summaries, key=lambda item: (not item.owned_by_user, -item.track_count))[:MAX_PLAYLISTS_TO_INDEX]
        buckets = await asyncio.gather(*(self._fetch_playlist_tracks(playlist) for playlist in selected), return_exceptions=True)
        deduped: dict[str, Track] = {}
        for bucket in buckets:
            if isinstance(bucket, Exception):
                continue
            for track in bucket:
                key = track_key(track)
                if key not in deduped:
                    deduped[key] = track
                else:
                    deduped[key].source_playlists = _unique([*deduped[key].source_playlists, *track.source_playlists], 20)
        next_tracks = list(deduped.values())
        refreshed = utc_now_iso()
        self.state.save_music_library(user, summaries, next_tracks, refreshed_at=refreshed)
        try:
            await asyncio.to_thread(update_taste_profile, user, summaries, next_tracks, refreshed_at=refreshed, user_id=self.user_id)
        except Exception:
            pass
        return user, summaries, next_tracks, refreshed

    async def resolve_playable_source(self, track: Track) -> Track:
        if not track.netease_id or not self.config.netease_api_base_url:
            track.playback_source = PlaybackSource.NETEASE if track.stream_url else PlaybackSource.UNAVAILABLE
            return track
        if track.stream_url:
            track.playback_source = PlaybackSource.NETEASE
            return track
        try:
            stream_url = await self._request_stream_url(track.netease_id)
            return track.model_copy(update={
                "stream_url": stream_url,
                "playback_source": PlaybackSource.NETEASE if stream_url else PlaybackSource.UNAVAILABLE,
            })
        except Exception:
            return track.model_copy(update={"playback_source": PlaybackSource.UNAVAILABLE})

    async def request_json(self, path: str, *, with_auth: bool = True, cookie: str | None = None) -> Any:
        if not self.config.netease_api_base_url:
            raise RuntimeError("NETEASE_API_BASE_URL 未配置，无法访问 netease-api 服务。")
        active_cookie = cookie or (self.get_active_cookie() if with_auth else None)
        url = httpx.URL(urljoin(self.config.netease_api_base_url.rstrip("/") + "/", path.lstrip("/")))
        params = dict(url.params)
        if active_cookie:
            params["cookie"] = active_cookie
        async with httpx.AsyncClient(timeout=12, trust_env=False) as client:
            response = await client.get(
                str(url.copy_with(params=params)),
                headers={"Cookie": active_cookie} if active_cookie else None,
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"Netease request failed ({response.status_code}): {response.text[:200]}")
        return response.json()

    def get_active_cookie(self) -> str | None:
        auth = self.state.get_music_auth()
        return auth[0] if auth else self.config.netease_cookie

    async def _finish_authorized_login(self, cookie: str) -> None:
        user = await self._resolve_authorized_user(cookie)
        if not user:
            raise RuntimeError("网易云登录成功，但没拿到用户资料。")
        self.state.save_music_auth(cookie, user)
        self.active_qr_session = None
        self.pending_auth_cookie = None
        self.state.save_pending_auth_cookie(None)
        self.state.save_qr_session(None)
        try:
            await self.refresh_personal_library(force=True)
        except Exception:
            pass

    async def _try_finalize_pending_login(self) -> bool:
        if not self.pending_auth_cookie:
            return False
        try:
            await self._finish_authorized_login(self.pending_auth_cookie)
            return True
        except Exception:
            return False

    async def _resolve_authorized_user(self, cookie: str) -> NeteaseUserSummary | None:
        for wait in (0, 0.35, 0.9):
            if wait:
                await asyncio.sleep(wait)
            user = await self._fetch_authorized_user("/user/account", cookie)
            if user:
                return user
            user = await self._fetch_authorized_user("/login/status", cookie)
            if user:
                return user
        return None

    async def _fetch_authorized_user(self, path: str, cookie: str) -> NeteaseUserSummary | None:
        try:
            payload = await self.request_json(f"{path}?timestamp={int(datetime.now().timestamp() * 1000)}", with_auth=False, cookie=cookie)
            root = _as_obj(payload)
            data = _as_obj(root.get("data"))
            profile = _as_obj(root.get("profile") or data.get("profile"))
            account = _as_obj(root.get("account") or data.get("account"))
            uid = _as_id(profile.get("userId")) or _as_id(account.get("id"))
            nickname = _as_str(profile.get("nickname"))
            if not uid or not nickname:
                return None
            return NeteaseUserSummary(uid=uid, nickname=nickname, avatar_url=_as_str(profile.get("avatarUrl")))
        except Exception:
            return None

    async def _search_catalog(self, query: str) -> list[Track]:
        payload = await self.request_json(f"/cloudsearch?{urlencode({'keywords': query, 'type': '1', 'limit': '6'})}")
        songs = _as_list(_as_obj(_as_obj(payload).get("result")).get("songs"))[:6]
        tracks = [track for track in await asyncio.gather(*(self._to_track(_as_obj(song)) for song in songs)) if track]
        return _dedupe(tracks)

    async def _fetch_playlist_tracks(self, playlist: NeteasePlaylistSummary) -> list[Track]:
        payload = await self.request_json(
            f"/playlist/track/all?{urlencode({'id': playlist.id, 'limit': str(MAX_TRACKS_PER_PLAYLIST), 'offset': '0', 'timestamp': str(int(datetime.now().timestamp() * 1000))})}"
        )
        tracks: list[Track] = []
        for song in _as_list(_as_obj(payload).get("songs")):
            track = self._to_library_track(_as_obj(song), playlist)
            if track:
                tracks.append(track)
        return tracks

    async def _fetch_song_snapshot(self, track_id: str) -> dict[str, Any] | None:
        payload = await self.request_json(f"/song/detail?{urlencode({'ids': track_id})}")
        songs = _as_list(_as_obj(payload).get("songs"))
        return _as_obj(songs[0]) if songs else None

    async def _fetch_song_detail(self, track_id: str) -> Track | None:
        song = await self._fetch_song_snapshot(track_id)
        return await self._to_track(song) if song else None

    async def _to_track(self, song: dict[str, Any]) -> Track | None:
        track_id = _as_id(song.get("id"))
        title = _as_str(song.get("name"))
        artist = _artist_label(song)
        if not track_id or not title or not artist:
            return None
        stream_url = await self._request_stream_url(track_id)
        return Track(
            id=track_id,
            netease_id=track_id,
            title=title,
            artist=artist,
            album=_album_label(song) or "网易云音乐",
            mood="catalog",
            duration_sec=round((_as_num(song.get("dt")) or _as_num(song.get("duration")) or 0) / 1000),
            stream_url=stream_url,
            artwork_url=_artwork_url(song),
            platform_url=f"https://music.163.com/#/song?id={track_id}",
            playback_source=PlaybackSource.NETEASE if stream_url else PlaybackSource.UNAVAILABLE,
            source_playlists=[],
        )

    def _to_library_track(self, song: dict[str, Any], playlist: NeteasePlaylistSummary) -> Track | None:
        track_id = _as_id(song.get("id"))
        title = _as_str(song.get("name"))
        artist = _artist_label(song)
        if not track_id or not title or not artist:
            return None
        return Track(
            id=track_id,
            netease_id=track_id,
            title=title,
            artist=artist,
            album=_album_label(song) or "网易云音乐",
            mood="library",
            duration_sec=round((_as_num(song.get("dt")) or _as_num(song.get("duration")) or 0) / 1000),
            stream_url=None,
            artwork_url=_artwork_url(song),
            platform_url=f"https://music.163.com/#/song?id={track_id}",
            playback_source=PlaybackSource.UNAVAILABLE,
            source_playlists=[playlist.name],
        )

    def _to_playlist_summary(self, playlist: dict[str, Any], current_user_id: str) -> NeteasePlaylistSummary | None:
        playlist_id = _as_id(playlist.get("id"))
        name = _as_str(playlist.get("name"))
        if not playlist_id or not name:
            return None
        creator = _as_obj(playlist.get("creator"))
        return NeteasePlaylistSummary(
            id=playlist_id,
            name=name,
            track_count=int(_as_num(playlist.get("trackCount")) or 0),
            cover_img_url=_as_str(playlist.get("coverImgUrl")),
            creator_name=_as_str(creator.get("nickname")),
            owned_by_user=_as_id(creator.get("userId")) == current_user_id,
        )

    async def _request_stream_url(self, track_id: str) -> str | None:
        params: dict[str, str] = {
            "id": track_id,
            "level": self.config.netease_playback_level,
        }
        if self.config.netease_enable_unblock:
            params["unblock"] = "true"
        if self.config.netease_unblock_source:
            params["source"] = self.config.netease_unblock_source
        payload = await self.request_json(f"/song/url/v1?{urlencode(params)}")
        data = _as_list(_as_obj(payload).get("data"))
        return _as_str(_as_obj(data[0] if data else {}).get("url"))

    async def _pick_playable_tracks(
        self,
        tracks: list[Track],
        limit: int,
        *,
        diversify_artists: bool = False,
        avoid_artist_of: Track | None = None,
    ) -> list[Track]:
        playable: list[Track] = []
        deferred: list[Track] = []
        used_artists: set[str] = set()
        for track in tracks:
            if avoid_artist_of and same_primary_artist(avoid_artist_of, track):
                continue
            resolved = await self.resolve_playable_source(track)
            if not resolved.stream_url:
                continue
            artist = primary_artist_key(resolved)
            if diversify_artists and artist and artist in used_artists:
                deferred.append(resolved)
                continue
            playable.append(resolved)
            if artist:
                used_artists.add(artist)
            if len(playable) >= limit:
                break
        return [*playable, *deferred][:limit]

    def _pick_lyric_preview(self, lyric: str | None) -> list[str]:
        if not lyric:
            return []
        lines = []
        for raw in lyric.splitlines():
            line = re.sub(r"\[[^\]]+\]", "", raw).strip()
            if not line or re.search(r"^(?:作词|填词|词|作曲|曲|编曲|制作人|监制|录音|混音|母带|弦乐|OP|SP)\s*:", line, re.I):
                continue
            if re.search(r"[A-Za-z]{4,}", line):
                continue
            lines.append(line[:80])
            if len(lines) >= 4:
                break
        return lines

    def _artist_highlights(self, brief: str | None) -> list[str]:
        if not brief:
            return []
        return [part.strip()[:90] for part in re.split(r"[\n。！？]", brief) if part.strip()][:3]

    async def _null(self) -> None:
        return None
