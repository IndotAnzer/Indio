from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

from app.config import AppConfig
from app.models import TtsStatus


def _clip(value: str, max_length: int) -> str:
    return value if len(value) <= max_length else value[:max_length] + "..."


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


@dataclass(frozen=True)
class SynthesizedAudio:
    buffer: bytes
    provider: str
    format: str
    mime_type: str


class MimoTtsAdapter:
    REQUEST_TIMEOUT_SEC = 12

    def __init__(self, config: AppConfig) -> None:
        self.config = config

    def get_status(self) -> TtsStatus:
        configured = bool(self.config.mimo_api_key and self.config.mimo_tts_voice)
        return TtsStatus(
            configured=configured,
            provider="mimo" if configured else "tts-disabled",
            format=self.config.mimo_tts_format,
            voice_configured=bool(self.config.mimo_tts_voice),
            detail=(
                f"Mimo chat-completions TTS is ready via proxy {self.config.mimo_proxy_url}."
                if configured and self.config.mimo_proxy_url
                else "Mimo chat-completions TTS is ready."
                if configured
                else "Missing MIMO_API_KEY or MIMO_TTS_VOICE. Narration audio is disabled."
            ),
        )

    async def synthesize(self, text: str) -> SynthesizedAudio:
        if not self.config.mimo_api_key or not self.config.mimo_tts_voice:
            raise RuntimeError("Mimo TTS is not configured.")

        async with httpx.AsyncClient(
            timeout=self.REQUEST_TIMEOUT_SEC,
            proxy=self.config.mimo_proxy_url,
        ) as client:
            response = await client.post(
                _join_url(self.config.mimo_base_url, "/chat/completions"),
                headers={
                    "Content-Type": "application/json",
                    "api-key": self.config.mimo_api_key,
                },
                json={
                    "model": self.config.mimo_tts_model,
                    "messages": [
                        {
                            "role": "user",
                            "content": "请用清晰自然的普通话逐字朗读下一条 assistant 消息。不要改写，不要解释，不要加入任何额外内容。",
                        },
                        {"role": "assistant", "content": text},
                    ],
                    "audio": {
                        "format": self.config.mimo_tts_format,
                        "voice": self.config.mimo_tts_voice,
                    },
                },
            )

        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"Mimo request failed ({response.status_code}): {_clip(response.text, 200)}")

        payload = response.json()
        audio = (
            ((payload.get("choices") or [{}])[0].get("message") or {})
            .get("audio")
            or {}
        )
        base64_audio = audio.get("data")
        if not isinstance(base64_audio, str) or not base64_audio.strip():
            raise RuntimeError("Mimo returned JSON without choices[0].message.audio.data.")

        return SynthesizedAudio(
            buffer=base64.b64decode(base64_audio),
            provider="mimo",
            format=self.config.mimo_tts_format,
            mime_type=self._mime_type_for_format(self.config.mimo_tts_format),
        )

    def _mime_type_for_format(self, fmt: str) -> str:
        if fmt == "wav":
            return "audio/wav"
        if fmt in {"ogg", "opus"}:
            return "audio/ogg"
        if fmt == "flac":
            return "audio/flac"
        if fmt == "aac":
            return "audio/aac"
        return "audio/mpeg"
