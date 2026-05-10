from __future__ import annotations

from typing import Any

from music_memory import get_user_music_profile as _get_user_music_profile


def get_user_music_profile() -> dict[str, Any]:
    return _get_user_music_profile()
