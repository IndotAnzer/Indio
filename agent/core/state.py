from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from core.user_context import DEFAULT_USER_ID, safe_user_id
from models import NeteasePlaylistSummary, NeteaseQrLoginSession, NeteaseUserSummary, Track


def _project_root() -> Path:
    return Path(os.getenv("INDIO_PROJECT_ROOT", Path(__file__).resolve().parents[2]))


def _state_root() -> Path:
    return Path(os.getenv("INDIO_STATE_ROOT", _project_root() / "indio" / "users"))


class StateStore:
    def __init__(self, user_id: str = DEFAULT_USER_ID) -> None:
        self.user_id = user_id or DEFAULT_USER_ID
        self._state_path = _state_root() / safe_user_id(self.user_id) / "state.json"
        self._music_auth: tuple[str, NeteaseUserSummary, str] | None = None
        self._music_library: tuple[NeteaseUserSummary | None, list[NeteasePlaylistSummary], list[Track], str | None] = (None, [], [], None)
        self._qr_session: NeteaseQrLoginSession | None = None
        self._pending_auth_cookie: str | None = None
        self._recent_plays: list[Track] = []
        self._load()

    def get_music_auth(self) -> tuple[str, NeteaseUserSummary, str] | None:
        return self._music_auth

    def save_music_auth(self, cookie: str, user: NeteaseUserSummary) -> None:
        self._music_auth = (cookie, user, "")
        self._persist()

    def clear_music_auth(self) -> None:
        self._music_auth = None
        self._music_library = (None, [], [], None)
        self._persist()

    def get_music_library(self) -> tuple[NeteaseUserSummary | None, list[NeteasePlaylistSummary], list[Track], str | None]:
        return self._music_library

    def save_music_library(
        self,
        user: NeteaseUserSummary | None,
        playlists: list[NeteasePlaylistSummary],
        tracks: list[Track],
        refreshed_at: str | None = None,
    ) -> None:
        self._music_library = (user, playlists, tracks, refreshed_at)
        self._persist()

    def get_qr_session(self) -> NeteaseQrLoginSession | None:
        return self._qr_session

    def save_qr_session(self, session: NeteaseQrLoginSession | None) -> None:
        self._qr_session = session
        self._persist()

    def get_pending_auth_cookie(self) -> str | None:
        return self._pending_auth_cookie

    def save_pending_auth_cookie(self, cookie: str | None) -> None:
        self._pending_auth_cookie = cookie
        self._persist()

    def list_recent_plays(self, hours: int = 24) -> list[Track]:
        return self._recent_plays

    def add_recent_play(self, track: Track) -> None:
        self._recent_plays.append(track)
        self._recent_plays = self._recent_plays[-100:]
        self._persist()

    def _load(self) -> None:
        if not self._state_path.exists():
            return
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return

        auth = _as_obj(payload.get("musicAuth"))
        auth_cookie = _as_text(auth.get("cookie"))
        auth_user = _parse_user(auth.get("user"))
        if auth_cookie and auth_user:
            self._music_auth = (auth_cookie, auth_user, _as_text(auth.get("refreshedAt")) or "")

        library = _as_obj(payload.get("musicLibrary"))
        library_user = _parse_user(library.get("user"))
        playlists = [_parse_playlist(item) for item in _as_list(library.get("playlists"))]
        tracks = [_parse_track(item) for item in _as_list(library.get("tracks"))]
        self._music_library = (
            library_user,
            [item for item in playlists if item],
            [item for item in tracks if item],
            _as_text(library.get("refreshedAt")),
        )
        self._qr_session = _parse_qr_session(payload.get("qrSession"))
        self._pending_auth_cookie = _as_text(payload.get("pendingAuthCookie"))
        self._recent_plays = [item for item in (_parse_track(item) for item in _as_list(payload.get("recentPlays"))) if item][-100:]

    def _persist(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        auth_payload = None
        if self._music_auth:
            cookie, user, refreshed_at = self._music_auth
            auth_payload = {
                "cookie": cookie,
                "user": _dump_model(user),
                "refreshedAt": refreshed_at,
            }
        library_user, playlists, tracks, refreshed_at = self._music_library
        payload = {
            "userId": self.user_id,
            "musicAuth": auth_payload,
            "musicLibrary": {
                "user": _dump_model(library_user),
                "playlists": [_dump_model(item) for item in playlists],
                "tracks": [_dump_model(item) for item in tracks],
                "refreshedAt": refreshed_at,
            },
            "qrSession": _dump_model(self._qr_session),
            "pendingAuthCookie": self._pending_auth_cookie,
            "recentPlays": [_dump_model(item) for item in self._recent_plays[-100:]],
        }
        self._state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _dump_model(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return value.dict()
    return value


def _parse_user(value: Any) -> NeteaseUserSummary | None:
    obj = _as_obj(value)
    if not obj:
        return None
    try:
        return NeteaseUserSummary(**obj)
    except Exception:
        return None


def _parse_playlist(value: Any) -> NeteasePlaylistSummary | None:
    obj = _as_obj(value)
    if not obj:
        return None
    try:
        return NeteasePlaylistSummary(**obj)
    except Exception:
        return None


def _parse_track(value: Any) -> Track | None:
    obj = _as_obj(value)
    if not obj:
        return None
    try:
        return Track(**obj)
    except Exception:
        return None


def _parse_qr_session(value: Any) -> NeteaseQrLoginSession | None:
    obj = _as_obj(value)
    if not obj:
        return None
    try:
        return NeteaseQrLoginSession(**obj)
    except Exception:
        return None


def _as_obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
