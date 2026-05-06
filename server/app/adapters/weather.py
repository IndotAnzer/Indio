from __future__ import annotations

from app.models import WeatherSnapshot


class WeatherAdapter:
    async def get_snapshot(self) -> WeatherSnapshot:
        return WeatherSnapshot(
            condition="cloudy",
            temperature_c=24,
            summary="云层有点厚，体感温和，适合把节奏放稳一点。",
        )
