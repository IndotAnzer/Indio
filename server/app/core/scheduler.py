from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Callable

from app.core.context import ContextService
from app.core.state import StateStore
from app.models import PlanEntry


def today_key(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).date().isoformat()


class SchedulerService:
    def __init__(self, state: StateStore, context: ContextService, publish: Callable[[list[PlanEntry]], None]) -> None:
        self.state = state
        self.context = context
        self.publish = publish
        self._task: asyncio.Task[None] | None = None

    async def ensure_today_plan(self, now: datetime | None = None) -> list[PlanEntry]:
        day = today_key(now)
        existing = self.state.get_plan(day)
        if existing:
            return existing
        bundle = await self.context.build(source="system")
        first_event = bundle.calendar[0] if bundle.calendar else None
        entries = [
            PlanEntry(id="wake", slot="07:00", title="清晨校准", summary=bundle.weather.summary, status="ready"),
            PlanEntry(
                id="focus",
                slot="09:00",
                title="专注启动",
                summary=f"为「{first_event.title}」前留出更干净的专注声场。" if first_event else "把工作流平滑推入专注区。",
                status="pending",
            ),
            PlanEntry(id="reset", slot="14:00", title="午后重启", summary="用一段更轻的播报和更稳的节奏，把注意力拉回来。", status="pending"),
            PlanEntry(id="evening", slot="19:00", title="晚间回收", summary="降低信息密度，让晚间的能量收束下来。", status="pending"),
        ]
        self.state.replace_plan(day, entries)
        self.publish(entries)
        return entries

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while True:
            await self.ensure_today_plan()
            await asyncio.sleep(300)

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    def get_today_plan(self) -> list[PlanEntry]:
        return self.state.get_plan(today_key())
