from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_mimo_voice(value: str | None) -> str:
    voice = (value or "").strip()
    if not voice or voice.lower() == "chloe" or voice == "default_zh":
        return "茉莉"
    return voice


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(Path(__file__).resolve().parents[2] / ".env"), extra="ignore")

    host: str = Field(default="0.0.0.0", alias="INDIO_HOST")
    port: int = Field(default=8787, alias="INDIO_PORT")
    public_base_url: str = Field(default="http://localhost:8787", alias="INDIO_PUBLIC_BASE_URL")
    pwa_url: str = Field(default="http://localhost:5173", alias="INDIO_PWA_URL")

    codex_mode: str = Field(default="oauth-cli", alias="CODEX_MODE")
    codex_cli_command: str = Field(default="codex", alias="CODEX_CLI_COMMAND")
    codex_model: str | None = Field(default="gpt-5.4-mini", alias="CODEX_MODEL")
    codex_reasoning_effort: str = Field(default="low", alias="CODEX_REASONING_EFFORT")
    codex_exec_timeout_ms: int = Field(default=45_000, alias="CODEX_EXEC_TIMEOUT_MS")
    codex_home_dir: str | None = Field(default=None, alias="CODEX_HOME")
    codex_proxy_url: str | None = Field(default=None, alias="CODEX_PROXY_URL")

    netease_api_base_url: str = Field(default="http://localhost:3000", alias="NETEASE_API_BASE_URL")
    netease_cookie: str | None = Field(default=None, alias="NETEASE_COOKIE")
    netease_playback_level: str = Field(default="standard", alias="NETEASE_PLAYBACK_LEVEL")
    netease_enable_unblock: bool = Field(default=True, alias="NETEASE_ENABLE_UNBLOCK")
    netease_unblock_source: str | None = Field(default=None, alias="NETEASE_UNBLOCK_SOURCE")

    mimo_api_key: str | None = Field(default=None, alias="MIMO_API_KEY")
    mimo_base_url: str = Field(default="https://api.xiaomimimo.com/v1", alias="MIMO_BASE_URL")
    mimo_proxy_url: str | None = Field(default=None, alias="MIMO_PROXY_URL")
    mimo_tts_model: str = Field(default="mimo-v2.5-tts", alias="MIMO_TTS_MODEL")
    mimo_tts_voice: str | None = Field(default="茉莉", alias="MIMO_TTS_VOICE")
    mimo_tts_format: str = Field(default="mp3", alias="MIMO_TTS_FORMAT")

    @property
    def root_dir(self) -> Path:
        return Path(__file__).resolve().parents[2]

    @property
    def user_dir(self) -> Path:
        return self.root_dir / "user"

    @property
    def prompt_path(self) -> Path:
        return self.root_dir / "server" / "prompts" / "dj-persona.md"

    @property
    def cache_dir(self) -> Path:
        return self.root_dir / "server" / "cache" / "tts"

    @property
    def data_dir(self) -> Path:
        return self.root_dir / "server" / "data"

    @property
    def state_db_path(self) -> Path:
        return self.data_dir / "indio-v2.db"

    @property
    def legacy_state_db_path(self) -> Path:
        return self.data_dir / "state.db"

    @property
    def codex_decision_schema_path(self) -> Path:
        return self.root_dir / "server" / "schemas" / "codex-decision.schema.json"

    @property
    def codex_narration_schema_path(self) -> Path:
        return self.root_dir / "server" / "schemas" / "codex-narration.schema.json"

    @property
    def resolved_codex_home_dir(self) -> Path:
        if self.codex_home_dir:
            return Path(self.codex_home_dir).expanduser()
        return Path.home() / ".codex"


def load_config() -> AppConfig:
    config = AppConfig()
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    config.data_dir.mkdir(parents=True, exist_ok=True)
    config.mimo_tts_voice = normalize_mimo_voice(config.mimo_tts_voice)
    for key in ("netease_cookie", "netease_unblock_source", "mimo_api_key", "mimo_proxy_url", "codex_proxy_url"):
        value = getattr(config, key)
        if isinstance(value, str) and not value.strip():
            setattr(config, key, None)
    if not config.codex_model or not config.codex_model.strip():
        config.codex_model = "gpt-5.4-mini"
    return config
