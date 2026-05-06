from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from app.config import AppConfig
from app.models import (
    CodexAuthSource,
    CompatibleResponsesFormat,
    MessageRecord,
    NeteasePlaylistSummary,
    NeteaseQrLoginSession,
    NeteaseUserSummary,
    NowState,
    PlanEntry,
    Track,
    utc_now_iso,
)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _model_json(model: Any) -> str:
    return _json_dumps(model.model_dump(mode="json", by_alias=True))


class StateStore:
    def __init__(self, config: AppConfig, db_path: Path | None = None) -> None:
        self.config = config
        self.db_path = db_path or config.state_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self._lock, self.db:
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_state (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  role TEXT NOT NULL,
                  content TEXT NOT NULL,
                  metadata TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plays (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  track_id TEXT NOT NULL,
                  netease_id TEXT,
                  title TEXT NOT NULL,
                  artist TEXT NOT NULL,
                  album TEXT NOT NULL,
                  mood TEXT NOT NULL,
                  duration_sec INTEGER NOT NULL,
                  stream_url TEXT,
                  artwork_url TEXT,
                  platform_url TEXT,
                  playback_source TEXT NOT NULL,
                  source_playlists TEXT NOT NULL DEFAULT '[]',
                  reason TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS daily_plans (
                  day TEXT NOT NULL,
                  id TEXT NOT NULL,
                  slot TEXT NOT NULL,
                  title TEXT NOT NULL,
                  summary TEXT NOT NULL,
                  status TEXT NOT NULL,
                  PRIMARY KEY (day, id)
                );

                CREATE TABLE IF NOT EXISTS music_auth (
                  id TEXT PRIMARY KEY,
                  cookie TEXT NOT NULL,
                  uid TEXT NOT NULL,
                  nickname TEXT NOT NULL,
                  avatar_url TEXT,
                  logged_in_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS music_playlists (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  track_count INTEGER NOT NULL,
                  cover_img_url TEXT,
                  creator_name TEXT,
                  owned_by_user INTEGER NOT NULL,
                  sort_order INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS music_tracks (
                  id TEXT PRIMARY KEY,
                  payload TEXT NOT NULL,
                  refreshed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS music_track_playlists (
                  track_id TEXT NOT NULL,
                  playlist_id TEXT NOT NULL,
                  playlist_name TEXT NOT NULL,
                  PRIMARY KEY (track_id, playlist_id)
                );
                """
            )

    def close(self) -> None:
        with self._lock:
            self.db.close()

    def set_json(self, table: str, key: str, value: Any) -> None:
        if table not in {"settings", "runtime_state"}:
            raise ValueError(f"Unsupported key-value table: {table}")
        with self._lock, self.db:
            self.db.execute(
                f"""
                INSERT INTO {table} (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  value = excluded.value,
                  updated_at = excluded.updated_at
                """,
                (key, _json_dumps(value), utc_now_iso()),
            )

    def get_json(self, table: str, key: str, fallback: Any) -> Any:
        if table not in {"settings", "runtime_state"}:
            raise ValueError(f"Unsupported key-value table: {table}")
        with self._lock:
            row = self.db.execute(f"SELECT value FROM {table} WHERE key = ?", (key,)).fetchone()
        return _json_loads(row["value"] if row else None, fallback)

    def save_codex_auth_source(self, source: CodexAuthSource) -> None:
        self.set_json("settings", "codex_auth_source", source.value)

    def get_codex_auth_source(self) -> CodexAuthSource:
        return CodexAuthSource(self.get_json("settings", "codex_auth_source", CodexAuthSource.SHARED_CLI.value))

    def save_project_codex_api_key(self, api_key: str | None) -> None:
        self.set_json("settings", "project_codex_api_key", api_key)

    def get_project_codex_api_key(self) -> str | None:
        return self.get_json("settings", "project_codex_api_key", None)

    def save_compatible_codex_api_key(self, api_key: str | None) -> None:
        self.set_json("settings", "compatible_codex_api_key", api_key)

    def get_compatible_codex_api_key(self) -> str | None:
        return self.get_json("settings", "compatible_codex_api_key", None)

    def save_compatible_codex_base_url(self, base_url: str) -> None:
        self.set_json("settings", "compatible_codex_base_url", base_url)

    def get_compatible_codex_base_url(self) -> str:
        return self.get_json("settings", "compatible_codex_base_url", "https://api.openai.com/v1")

    def save_compatible_codex_model(self, model: str) -> None:
        self.set_json("settings", "compatible_codex_model", model)

    def get_compatible_codex_model(self, fallback_model: str | None) -> str:
        return self.get_json("settings", "compatible_codex_model", fallback_model or "gpt-5.4-mini")

    def save_compatible_codex_response_format(self, fmt: CompatibleResponsesFormat) -> None:
        self.set_json("settings", "compatible_codex_response_format", fmt.value)

    def get_compatible_codex_response_format(self) -> CompatibleResponsesFormat:
        return CompatibleResponsesFormat(
            self.get_json(
                "settings",
                "compatible_codex_response_format",
                CompatibleResponsesFormat.JSON_OBJECT.value,
            )
        )

    def save_now_state(self, state: NowState) -> None:
        self.set_json("runtime_state", "now_state", state.model_dump(mode="json", by_alias=True))

    def get_now_state(self) -> NowState | None:
        payload = self.get_json("runtime_state", "now_state", None)
        return NowState.model_validate(payload) if payload else None

    def save_message(self, role: str, content: str, metadata: dict[str, Any] | None = None) -> None:
        with self._lock, self.db:
            self.db.execute(
                "INSERT INTO messages (role, content, metadata, created_at) VALUES (?, ?, ?, ?)",
                (role, content, _json_dumps(metadata) if metadata else None, utc_now_iso()),
            )

    def list_recent_messages(self, limit: int = 6) -> list[MessageRecord]:
        with self._lock:
            rows = self.db.execute(
                "SELECT id, role, content, metadata, created_at FROM messages ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            MessageRecord(
                id=row["id"],
                role=row["role"],
                content=row["content"],
                metadata=_json_loads(row["metadata"], None),
                created_at=row["created_at"],
            )
            for row in reversed(rows)
        ]

    def save_play(self, track: Track, reason: str) -> None:
        with self._lock, self.db:
            self.db.execute(
                """
                INSERT INTO plays (
                  track_id, netease_id, title, artist, album, mood, duration_sec,
                  stream_url, artwork_url, platform_url, playback_source, source_playlists,
                  reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    track.id,
                    track.netease_id,
                    track.title,
                    track.artist,
                    track.album,
                    track.mood,
                    track.duration_sec,
                    track.stream_url,
                    track.artwork_url,
                    track.platform_url,
                    track.playback_source.value if hasattr(track.playback_source, "value") else track.playback_source,
                    _json_dumps(track.source_playlists),
                    reason,
                    utc_now_iso(),
                ),
            )

    def list_recent_plays(self, limit: int = 5) -> list[Track]:
        with self._lock:
            rows = self.db.execute(
                """
                SELECT track_id, netease_id, title, artist, album, mood, duration_sec,
                       stream_url, artwork_url, platform_url, playback_source, source_playlists
                FROM plays
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            Track(
                id=row["track_id"],
                netease_id=row["netease_id"],
                title=row["title"],
                artist=row["artist"],
                album=row["album"],
                mood=row["mood"],
                duration_sec=row["duration_sec"],
                stream_url=row["stream_url"],
                artwork_url=row["artwork_url"],
                platform_url=row["platform_url"],
                playback_source=row["playback_source"],
                source_playlists=_json_loads(row["source_playlists"], []),
            )
            for row in rows
        ]

    def replace_plan(self, day: str, entries: list[PlanEntry]) -> None:
        with self._lock, self.db:
            self.db.execute("DELETE FROM daily_plans WHERE day = ?", (day,))
            self.db.executemany(
                """
                INSERT INTO daily_plans (day, id, slot, title, summary, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [(day, item.id, item.slot, item.title, item.summary, item.status) for item in entries],
            )

    def get_plan(self, day: str) -> list[PlanEntry]:
        with self._lock:
            rows = self.db.execute(
                "SELECT id, slot, title, summary, status FROM daily_plans WHERE day = ? ORDER BY slot ASC",
                (day,),
            ).fetchall()
        return [
            PlanEntry(id=row["id"], slot=row["slot"], title=row["title"], summary=row["summary"], status=row["status"])
            for row in rows
        ]

    def get_music_auth(self) -> tuple[str, NeteaseUserSummary, str] | None:
        with self._lock:
            row = self.db.execute("SELECT * FROM music_auth WHERE id = 'active'").fetchone()
        if not row:
            return None
        return (
            row["cookie"],
            NeteaseUserSummary(uid=row["uid"], nickname=row["nickname"], avatar_url=row["avatar_url"]),
            row["logged_in_at"],
        )

    def save_music_auth(self, cookie: str, user: NeteaseUserSummary, logged_in_at: str | None = None) -> None:
        with self._lock, self.db:
            self.db.execute(
                """
                INSERT INTO music_auth (id, cookie, uid, nickname, avatar_url, logged_in_at)
                VALUES ('active', ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  cookie = excluded.cookie,
                  uid = excluded.uid,
                  nickname = excluded.nickname,
                  avatar_url = excluded.avatar_url,
                  logged_in_at = excluded.logged_in_at
                """,
                (cookie, user.uid, user.nickname, user.avatar_url, logged_in_at or utc_now_iso()),
            )

    def clear_music_auth(self) -> None:
        with self._lock, self.db:
            self.db.execute("DELETE FROM music_auth WHERE id = 'active'")
            self.db.execute("DELETE FROM music_playlists")
            self.db.execute("DELETE FROM music_tracks")
            self.db.execute("DELETE FROM music_track_playlists")
            for key in ("netease_qr_session", "netease_pending_auth_cookie"):
                self.db.execute(
                    """
                    INSERT INTO runtime_state (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = excluded.value,
                      updated_at = excluded.updated_at
                    """,
                    (key, "null", utc_now_iso()),
                )

    def save_music_library(
        self,
        user: NeteaseUserSummary | None,
        playlists: list[NeteasePlaylistSummary],
        tracks: list[Track],
        refreshed_at: str | None = None,
    ) -> None:
        stamp = refreshed_at or utc_now_iso()
        with self._lock, self.db:
            self.db.execute("DELETE FROM music_playlists")
            self.db.execute("DELETE FROM music_tracks")
            self.db.execute("DELETE FROM music_track_playlists")
            self.db.executemany(
                """
                INSERT INTO music_playlists (
                  id, name, track_count, cover_img_url, creator_name, owned_by_user, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        playlist.id,
                        playlist.name,
                        playlist.track_count,
                        playlist.cover_img_url,
                        playlist.creator_name,
                        1 if playlist.owned_by_user else 0,
                        index,
                    )
                    for index, playlist in enumerate(playlists)
                ],
            )
            for track in tracks:
                self.db.execute(
                    "INSERT INTO music_tracks (id, payload, refreshed_at) VALUES (?, ?, ?)",
                    (track.netease_id or track.id, _model_json(track), stamp),
                )
                for playlist_name in track.source_playlists:
                    playlist_id = next((playlist.id for playlist in playlists if playlist.name == playlist_name), playlist_name)
                    self.db.execute(
                        """
                        INSERT OR IGNORE INTO music_track_playlists (track_id, playlist_id, playlist_name)
                        VALUES (?, ?, ?)
                        """,
                        (track.netease_id or track.id, playlist_id, playlist_name),
                    )

    def get_music_library(self) -> tuple[NeteaseUserSummary | None, list[NeteasePlaylistSummary], list[Track], str | None]:
        auth = self.get_music_auth()
        with self._lock:
            playlist_rows = self.db.execute(
                "SELECT * FROM music_playlists ORDER BY sort_order ASC, track_count DESC"
            ).fetchall()
            track_rows = self.db.execute("SELECT payload, refreshed_at FROM music_tracks").fetchall()
        playlists = [
            NeteasePlaylistSummary(
                id=row["id"],
                name=row["name"],
                track_count=row["track_count"],
                cover_img_url=row["cover_img_url"],
                creator_name=row["creator_name"],
                owned_by_user=bool(row["owned_by_user"]),
            )
            for row in playlist_rows
        ]
        tracks = [Track.model_validate(_json_loads(row["payload"], {})) for row in track_rows]
        refreshed_at = track_rows[0]["refreshed_at"] if track_rows else None
        return (auth[1] if auth else None, playlists, tracks, refreshed_at)

    def save_qr_session(self, session: NeteaseQrLoginSession | None) -> None:
        self.set_json("runtime_state", "netease_qr_session", session.model_dump(mode="json", by_alias=True) if session else None)

    def get_qr_session(self) -> NeteaseQrLoginSession | None:
        payload = self.get_json("runtime_state", "netease_qr_session", None)
        return NeteaseQrLoginSession.model_validate(payload) if payload else None

    def save_pending_auth_cookie(self, cookie: str | None) -> None:
        self.set_json("runtime_state", "netease_pending_auth_cookie", cookie)

    def get_pending_auth_cookie(self) -> str | None:
        return self.get_json("runtime_state", "netease_pending_auth_cookie", None)
