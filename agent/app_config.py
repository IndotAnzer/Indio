from __future__ import annotations

import os

from env_loader import load_project_env


class AppConfig:
    def __init__(self) -> None:
        load_project_env()

    @property
    def mimo_api_key(self) -> str | None:
        return os.getenv("MIMO_API_KEY") or None

    @property
    def mimo_base_url(self) -> str:
        return os.getenv("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1")

    @property
    def mimo_proxy_url(self) -> str | None:
        return os.getenv("MIMO_PROXY_URL") or None

    @property
    def mimo_tts_model(self) -> str:
        return os.getenv("MIMO_TTS_MODEL", "mimo-v2.5-tts")

    @property
    def mimo_tts_voice(self) -> str | None:
        return os.getenv("MIMO_TTS_VOICE") or None

    @property
    def mimo_tts_format(self) -> str:
        return os.getenv("MIMO_TTS_FORMAT", "mp3")

    @property
    def netease_api_base_url(self) -> str | None:
        return os.getenv("NETEASE_API_BASE_URL") or None

    @property
    def netease_cookie(self) -> str | None:
        return os.getenv("NETEASE_COOKIE") or None

    @property
    def netease_playback_level(self) -> str:
        return os.getenv("NETEASE_PLAYBACK_LEVEL", "standard")

    @property
    def netease_enable_unblock(self) -> bool:
        return os.getenv("NETEASE_ENABLE_UNBLOCK", "true").lower() in ("true", "1", "yes")

    @property
    def netease_unblock_source(self) -> str | None:
        return os.getenv("NETEASE_UNBLOCK_SOURCE") or None

    @property
    def wechat_miniprogram_app_id(self) -> str | None:
        return os.getenv("WECHAT_MINIPROGRAM_APP_ID") or os.getenv("WECHAT_APP_ID") or None

    @property
    def wechat_miniprogram_app_secret(self) -> str | None:
        return os.getenv("WECHAT_MINIPROGRAM_APP_SECRET") or os.getenv("WECHAT_APP_SECRET") or None
