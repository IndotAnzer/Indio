from __future__ import annotations

import asyncio
import json

from fastapi import WebSocket

from app.models import NowState, PlanEntry


class StreamHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket, *, now_state: NowState | None, plan: list[PlanEntry]) -> None:
        await websocket.accept()
        self.clients.add(websocket)
        if now_state:
            await websocket.send_text(self._event("radio.state", now_state))
        await websocket.send_text(self._event("plan.updated", plan))

    def disconnect(self, websocket: WebSocket) -> None:
        self.clients.discard(websocket)

    def publish_nowait(self, event_type: str, payload: NowState | list[PlanEntry]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.publish(event_type, payload))

    async def publish(self, event_type: str, payload: NowState | list[PlanEntry]) -> None:
        data = self._event(event_type, payload)
        dead: list[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_text(data)
            except Exception:
                dead.append(client)
        for client in dead:
            self.disconnect(client)

    def _event(self, event_type: str, payload: NowState | list[PlanEntry]) -> str:
        if isinstance(payload, list):
            serialized = [item.model_dump(mode="json", by_alias=True) for item in payload]
        else:
            serialized = payload.model_dump(mode="json", by_alias=True)
        return json.dumps({"type": event_type, "payload": serialized}, ensure_ascii=False)
