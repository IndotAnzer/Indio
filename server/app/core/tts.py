from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.adapters.mimo_tts import MimoTtsAdapter
from app.config import AppConfig
from app.models import TtsStatus, VoiceAsset, utc_now_iso


class TtsService:
    def __init__(self, config: AppConfig, mimo: MimoTtsAdapter) -> None:
        self.config = config
        self.mimo = mimo

    def get_status(self) -> TtsStatus:
        return self.mimo.get_status()

    async def synthesize(self, text: str) -> VoiceAsset | None:
        normalized = text.strip()
        if not normalized:
            return None
        voice_id = hashlib.sha1(
            json.dumps(
                {
                    "text": normalized,
                    "provider": self.mimo.get_status().provider,
                    "model": self.config.mimo_tts_model,
                    "voice": self.config.mimo_tts_voice,
                    "format": self.config.mimo_tts_format,
                },
                ensure_ascii=False,
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()[:16]
        metadata_path = self.config.cache_dir / f"{voice_id}.json"
        try:
            cached = VoiceAsset.model_validate(json.loads(metadata_path.read_text(encoding="utf-8")))
            fmt = cached.format or self.config.mimo_tts_format
            if (self.config.cache_dir / f"{voice_id}.{fmt}").exists():
                return cached.model_copy(
                    update={
                        "audio_url": f"{self.config.public_base_url}/media/tts/{voice_id}.{fmt}",
                        "cached": True,
                    }
                )
        except Exception:
            pass

        if not self.get_status().configured:
            return None
        try:
            created = await self.mimo.synthesize(normalized)
            audio_path = self.config.cache_dir / f"{voice_id}.{created.format}"
            asset = VoiceAsset(
                id=voice_id,
                text=normalized,
                audio_url=f"{self.config.public_base_url}/media/tts/{voice_id}.{created.format}",
                provider=created.provider,
                format=created.format,
                mime_type=created.mime_type,
                created_at=utc_now_iso(),
                cached=False,
            )
            audio_path.write_bytes(created.buffer)
            metadata_path.write_text(json.dumps(asset.model_dump(mode="json", by_alias=True), ensure_ascii=False, indent=2), encoding="utf-8")
            return asset
        except Exception as error:
            print(f"Mimo synthesis failed: {str(error)[:240]}")
            return None
