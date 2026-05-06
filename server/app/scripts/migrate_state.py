from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from app.config import load_config
from app.core.state import StateStore
from app.models import (
    CodexAuthSource,
    CompatibleResponsesFormat,
    NeteasePlaylistSummary,
    NeteaseQrLoginSession,
    NeteaseUserSummary,
    NowState,
    PlanEntry,
    Track,
    utc_now_iso,
)


def _json(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _find_legacy_db(root: Path) -> Path | None:
    direct = root / "server" / "data" / "state.db"
    if direct.exists():
        return direct
    backups = sorted((root / ".indio-backups").glob("server-ts-*/data/state.db"), reverse=True)
    return backups[0] if backups else None


def _read_kv(db: sqlite3.Connection, key: str, fallback: Any = None) -> Any:
    row = db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return _json(row[0], fallback) if row else fallback


def migrate(old_db: Path, new_db: Path) -> dict[str, int]:
    config = load_config()
    state = StateStore(config, new_db)
    old = sqlite3.connect(old_db)
    old.row_factory = sqlite3.Row
    counts = {
        "settings": 0,
        "messages": 0,
        "plays": 0,
        "plans": 0,
        "musicTracks": 0,
    }

    for key, writer in [
        ("codex_auth_source", lambda value: state.save_codex_auth_source(CodexAuthSource(value))),
        ("project_codex_api_key", state.save_project_codex_api_key),
        ("compatible_codex_api_key", state.save_compatible_codex_api_key),
        ("compatible_codex_base_url", state.save_compatible_codex_base_url),
        ("compatible_codex_model", state.save_compatible_codex_model),
        ("compatible_codex_response_format", lambda value: state.save_compatible_codex_response_format(CompatibleResponsesFormat(value))),
    ]:
        value = _read_kv(old, key)
        if value is not None:
            writer(value)
            counts["settings"] += 1

    now_state = _read_kv(old, "now_state")
    if now_state:
        try:
            state.save_now_state(NowState.model_validate(now_state))
            counts["settings"] += 1
        except Exception:
            pass

    qr_session = _read_kv(old, "netease_qr_session")
    if qr_session:
        try:
            state.save_qr_session(NeteaseQrLoginSession.model_validate(qr_session))
        except Exception:
            pass
    pending_cookie = _read_kv(old, "netease_pending_auth_cookie")
    if pending_cookie:
        state.save_pending_auth_cookie(pending_cookie)

    auth = _read_kv(old, "netease_auth")
    if isinstance(auth, dict) and auth.get("cookie") and auth.get("user"):
        try:
            state.save_music_auth(
                auth["cookie"],
                NeteaseUserSummary.model_validate(auth["user"]),
                auth.get("loggedInAt") or auth.get("logged_in_at") or utc_now_iso(),
            )
        except Exception:
            pass

    library = _read_kv(old, "netease_library", {})
    if isinstance(library, dict):
        playlists = []
        tracks = []
        for item in library.get("playlists") or []:
            try:
                playlists.append(NeteasePlaylistSummary.model_validate(item))
            except Exception:
                pass
        for item in library.get("tracks") or []:
            try:
                tracks.append(Track.model_validate(item))
            except Exception:
                pass
        if playlists or tracks:
            state.save_music_library(
                NeteaseUserSummary.model_validate(library["user"]) if library.get("user") else None,
                playlists,
                tracks,
                library.get("refreshedAt") or library.get("refreshed_at"),
            )
            counts["musicTracks"] = len(tracks)

    with state._lock, state.db:
        for row in old.execute("SELECT role, content, metadata, created_at FROM messages ORDER BY id ASC"):
            state.db.execute(
                "INSERT INTO messages (role, content, metadata, created_at) VALUES (?, ?, ?, ?)",
                (row["role"], row["content"], row["metadata"], row["created_at"]),
            )
            counts["messages"] += 1

        for row in old.execute(
            """
            SELECT track_id, netease_id, title, artist, album, mood, duration_sec,
                   stream_url, artwork_url, platform_url, playback_source, reason, created_at
            FROM plays ORDER BY id ASC
            """
        ):
            state.db.execute(
                """
                INSERT INTO plays (
                  track_id, netease_id, title, artist, album, mood, duration_sec,
                  stream_url, artwork_url, platform_url, playback_source, source_playlists,
                  reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["track_id"],
                    row["netease_id"],
                    row["title"],
                    row["artist"],
                    row["album"],
                    row["mood"],
                    row["duration_sec"],
                    row["stream_url"],
                    row["artwork_url"],
                    row["platform_url"],
                    row["playback_source"],
                    "[]",
                    row["reason"],
                    row["created_at"],
                ),
            )
            counts["plays"] += 1

        for row in old.execute("SELECT day, id, slot, title, summary, status FROM daily_plan ORDER BY day, slot"):
            state.db.execute(
                """
                INSERT OR REPLACE INTO daily_plans (day, id, slot, title, summary, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (row["day"], row["id"], row["slot"], row["title"], row["summary"], row["status"]),
            )
            counts["plans"] += 1

    old.close()
    state.close()
    return counts


def main() -> None:
    config = load_config()
    parser = argparse.ArgumentParser(description="Migrate Indio TypeScript state.db to Python indio-v2.db.")
    parser.add_argument("--old-db", type=Path, default=None)
    parser.add_argument("--new-db", type=Path, default=config.state_db_path)
    args = parser.parse_args()
    old_db = args.old_db or _find_legacy_db(config.root_dir)
    if not old_db or not old_db.exists():
        raise SystemExit("No legacy state.db found. Pass --old-db explicitly.")
    counts = migrate(old_db, args.new_db)
    print(json.dumps({"oldDb": str(old_db), "newDb": str(args.new_db), "migrated": counts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
