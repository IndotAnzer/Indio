from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from adapters.netease_music import NeteaseMusicAdapter
from adapters.mimo_tts import MimoTtsAdapter
from api_contract import (
    agent_settings_response,
    agent_status_response,
    music_bootstrap_response,
    now_state_from_prepared_segment,
    now_state_response,
    prepared_segment_response,
    to_api,
    tts_status_response,
)
from agent import MODEL as AGENT_MODEL, agent_loop
from app_config import AppConfig
from core.auth import (
    AuthError,
    UserContext,
    create_session_token,
    exchange_wechat_login_code,
    extract_bearer_token,
    parse_session_token,
)
from core.state import StateStore
from core.user_context import safe_user_id
from models import utc_now_iso
from music_memory import ensure_music_memory_files, record_habit_event
from utils.now_state_builder import build_now_state

logger = logging.getLogger("indio.server")

# ---------- 内存状态 ----------
_current_states: dict[str, dict[str, Any]] = {}
_ws_clients: dict[str, set[WebSocket]] = {}
_preparing_next_segments: set[tuple[str, str]] = set()
_state_stores: dict[str, StateStore] = {}
_music_adapters: dict[str, NeteaseMusicAdapter] = {}
_turn_generation_tasks: dict[str, asyncio.Task[None]] = {}

# ---------- TTS ----------
def runtime_root() -> Path:
    return Path(os.getenv("INDIO_RUNTIME_ROOT", Path(os.getenv("INDIO_PROJECT_ROOT", Path(__file__).resolve().parent.parent)) / "indio"))


CACHE_DIR = Path(os.getenv("INDIO_TTS_CACHE_ROOT", runtime_root() / "cache" / "tts"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_config = AppConfig()
_tts = MimoTtsAdapter(_config)
ensure_music_memory_files("local")


# ---------- 请求/响应模型 ----------
class ChatRequest(BaseModel):
    message: str


class AdvanceRequest(BaseModel):
    currentSegmentId: str | None = None


class WechatLoginRequest(BaseModel):
    code: str


# ---------- 生命周期 ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for clients in tuple(_ws_clients.values()):
        for ws in tuple(clients):
            await ws.close()
    _ws_clients.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 用户状态 ----------
def resolve_user_context(request: Request) -> UserContext:
    token = extract_bearer_token(request.headers.get("authorization"))
    if token:
        try:
            return parse_session_token(token)
        except AuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
    cloud_openid = request.headers.get("x-wx-openid")
    if cloud_openid and cloud_openid.strip():
        return UserContext(user_id=f"wechat:{cloud_openid.strip()}", provider="wechat-cloud")
    dev_user = request.headers.get("x-indio-user")
    if dev_user and dev_user.strip():
        return UserContext(user_id=dev_user.strip(), provider="dev")
    return UserContext()


def resolve_websocket_user_context(ws: WebSocket) -> UserContext:
    token = extract_bearer_token(ws.headers.get("authorization")) or extract_bearer_token(ws.query_params.get("token"))
    if token:
        return parse_session_token(token)
    cloud_openid = ws.headers.get("x-wx-openid")
    if cloud_openid and cloud_openid.strip():
        return UserContext(user_id=f"wechat:{cloud_openid.strip()}", provider="wechat-cloud")
    dev_user = ws.headers.get("x-indio-user") or ws.query_params.get("user")
    if dev_user and dev_user.strip():
        return UserContext(user_id=dev_user.strip(), provider="dev")
    return UserContext()


def state_store_for(user_id: str) -> StateStore:
    if user_id not in _state_stores:
        _state_stores[user_id] = StateStore(user_id)
    return _state_stores[user_id]


def music_for(user_id: str) -> NeteaseMusicAdapter:
    if user_id not in _music_adapters:
        _music_adapters[user_id] = NeteaseMusicAdapter(_config, state_store_for(user_id))
    return _music_adapters[user_id]


# ---------- 广播 ----------
async def broadcast_state(user_id: str, state: dict[str, Any]) -> None:
    payload = json.dumps({"type": "radio.state", "payload": state}, ensure_ascii=False)
    dead: set[WebSocket] = set()
    clients = _ws_clients.get(user_id, set())
    for ws in tuple(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


def pending_radio_state(message: str, *, segment_id: str | None = None) -> dict[str, Any]:
    return {
        "segmentId": segment_id or f"pending-{uuid.uuid4().hex[:10]}",
        "updatedAt": utc_now_iso(),
        "source": "manual",
        "mood": "radio",
        "mode": "narrated",
        "provider": {
            **agent_status_response(AGENT_MODEL),
            "state": "ready",
            "detail": "Indio Agent is preparing the next segment.",
        },
        "narrationText": "",
        "narrationAudioUrl": None,
        "segue": "",
        "reason": message,
        "outputDevice": "wechat-miniprogram",
        "nowPlaying": None,
        "queuedTracks": [],
        "preparedNext": None,
    }


def failed_radio_state(message: str, *, segment_id: str) -> dict[str, Any]:
    state = pending_radio_state("", segment_id=segment_id)
    state["provider"] = {
        **agent_status_response(AGENT_MODEL),
        "state": "error",
        "detail": message,
    }
    state["reason"] = message
    return state


# ---------- TTS 后台任务 ----------
async def synthesize_to_file(user_id: str, segment_id: str, text: str) -> str | None:
    if not text:
        return None

    try:
        audio = await _tts.synthesize(text)
    except Exception:
        return None

    filename = f"{segment_id}.{audio.format}"
    user_cache_dir = CACHE_DIR / safe_user_id(user_id)
    user_cache_dir.mkdir(parents=True, exist_ok=True)
    filepath = user_cache_dir / filename
    filepath.write_bytes(audio.buffer)
    return f"/media/tts/{safe_user_id(user_id)}/{filename}"


async def synthesize_and_broadcast(user_id: str, segment_id: str, text: str) -> None:
    audio_url = await synthesize_to_file(user_id, segment_id, text)
    if not audio_url:
        return
    current_state = _current_states.get(user_id)
    if current_state and current_state.get("segmentId") == segment_id:
        current_state["narrationAudioUrl"] = audio_url
        await broadcast_state(user_id, current_state)


# ---------- 下一段预生成 ----------
def schedule_prepare_next(user_id: str, state: dict[str, Any]) -> None:
    segment_id = state.get("segmentId")
    key = (user_id, segment_id)
    if not segment_id or state.get("preparedNext") or key in _preparing_next_segments:
        return
    _preparing_next_segments.add(key)
    asyncio.create_task(prepare_next_segment(user_id, state.copy()))


async def prepare_next_segment(user_id: str, previous_state: dict[str, Any]) -> None:
    segment_id = previous_state.get("segmentId")
    try:
        music = music_for(user_id)
        raw = await asyncio.to_thread(
            agent_loop,
            "下一首",
            previous_state=previous_state,
            user_id=user_id,
            netease_cookie=music.get_active_cookie(),
        )
        agent_output = json.loads(raw)
        state = build_now_state(agent_output)
        next_state = now_state_response(state, agent_status_response(AGENT_MODEL))
        audio_url = await synthesize_to_file(user_id, next_state["segmentId"], agent_output.get("say", ""))
        if next_state.get("narrationText") and not audio_url:
            return
        if audio_url:
            next_state["narrationAudioUrl"] = audio_url
        prepared_next = prepared_segment_response(next_state)

        current_state = _current_states.get(user_id)
        if current_state and current_state.get("segmentId") == segment_id and not current_state.get("preparedNext"):
            current_state["preparedNext"] = prepared_next
            await broadcast_state(user_id, current_state)
    except Exception:
        return
    finally:
        if segment_id:
            _preparing_next_segments.discard((user_id, segment_id))


def schedule_record_radio_habit(user_id: str, message: str, state: dict[str, Any], previous_state: dict[str, Any] | None, action: str) -> None:
    asyncio.create_task(record_radio_habit(user_id, message, state.copy(), previous_state.copy() if previous_state else None, action))


async def record_radio_habit(user_id: str, message: str, state: dict[str, Any], previous_state: dict[str, Any] | None, action: str) -> None:
    try:
        await asyncio.to_thread(
            record_habit_event,
            request=message,
            track=state.get("nowPlaying"),
            previous_track=(previous_state or {}).get("nowPlaying"),
            action=action,
            user_id=user_id,
        )
    except Exception:
        return


async def generate_radio_turn(
    *,
    user_id: str,
    message: str,
    previous_state: dict[str, Any] | None,
    netease_cookie: str | None,
    pending_segment_id: str,
) -> None:
    try:
        raw = await asyncio.to_thread(
            agent_loop,
            message,
            previous_state=previous_state,
            user_id=user_id,
            netease_cookie=netease_cookie,
        )
        agent_output = json.loads(raw)

        state = build_now_state(agent_output)
        state_dict = now_state_response(state, agent_status_response(AGENT_MODEL))

        _current_states[user_id] = state_dict
        await broadcast_state(user_id, state_dict)
        schedule_record_radio_habit(user_id, message, state_dict, previous_state, "turn")
        asyncio.create_task(synthesize_and_broadcast(user_id, state_dict["segmentId"], agent_output.get("say", "")))
        schedule_prepare_next(user_id, state_dict)
    except Exception as exc:
        logger.exception("Failed to generate radio turn for user %s", user_id)
        state_dict = failed_radio_state(str(exc), segment_id=pending_segment_id)
        _current_states[user_id] = state_dict
        await broadcast_state(user_id, state_dict)
    finally:
        task = _turn_generation_tasks.get(user_id)
        if task is asyncio.current_task():
            _turn_generation_tasks.pop(user_id, None)


# ---------- REST API ----------
@app.post("/api/auth/wechat/login")
async def wechat_login(req: WechatLoginRequest):
    try:
        login = await exchange_wechat_login_code(
            req.code,
            app_id=_config.wechat_miniprogram_app_id,
            app_secret=_config.wechat_miniprogram_app_secret,
        )
    except AuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    token = create_session_token(login.user_id, provider="wechat")
    return {
        "session": {
            "token": token,
            "userId": login.user_id,
            "provider": "wechat",
            "openid": login.openid,
            "unionid": login.unionid,
        }
    }


@app.get("/api/bootstrap")
async def bootstrap(request: Request):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)
    return {
        "now": _current_states.get(ctx.user_id),
        "plan": [],
        "music": music_bootstrap_response(music),
        "agent": agent_settings_response(AGENT_MODEL),
        "agentStatus": agent_status_response(AGENT_MODEL),
        "tts": tts_status_response(_tts),
    }


@app.get("/api/integrations/music/bootstrap")
async def music_bootstrap(request: Request):
    ctx = resolve_user_context(request)
    return {"music": music_bootstrap_response(music_for(ctx.user_id))}


@app.post("/api/integrations/music/login/qr")
async def create_music_qr_login(request: Request):
    ctx = resolve_user_context(request)
    try:
        session = await music_for(ctx.user_id).create_qr_login_session()
    except Exception as exc:
        logger.exception("Failed to create Netease QR login session for user %s", ctx.user_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"session": to_api(session)}


@app.get("/api/integrations/music/login/qr")
async def check_music_qr_login(request: Request, key: str = Query(...)):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)
    try:
        status = await music.check_qr_login_session(key)
    except Exception as exc:
        logger.exception("Failed to check Netease QR login session for user %s", ctx.user_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": to_api(status), "music": music_bootstrap_response(music)}


@app.post("/api/integrations/music/logout")
async def logout_music(request: Request):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)
    await music.logout()
    return {"ok": True, "music": music_bootstrap_response(music)}


@app.get("/api/settings/agent")
async def agent_settings():
    return {
        "settings": agent_settings_response(AGENT_MODEL),
        "status": agent_status_response(AGENT_MODEL),
    }


@app.get("/api/agent/runs")
async def agent_runs(limit: int = Query(20, ge=1, le=100)):
    return {"runs": []}


@app.get("/api/agent/runs/{run_id}")
async def agent_run_detail(run_id: str):
    raise HTTPException(status_code=404, detail=f"Agent run {run_id} was not found.")


@app.get("/api/radio/now")
async def radio_now(request: Request):
    ctx = resolve_user_context(request)
    return {"now": _current_states.get(ctx.user_id)}


@app.post("/api/radio/turn")
async def radio_turn(req: ChatRequest, request: Request):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)

    previous_state = _current_states.get(ctx.user_id).copy() if _current_states.get(ctx.user_id) else None
    raw = await asyncio.to_thread(
        agent_loop,
        req.message,
        previous_state=previous_state,
        user_id=ctx.user_id,
        netease_cookie=music.get_active_cookie(),
    )
    agent_output = json.loads(raw)

    state = build_now_state(agent_output)
    state_dict = now_state_response(state, agent_status_response(AGENT_MODEL))

    _current_states[ctx.user_id] = state_dict
    schedule_record_radio_habit(ctx.user_id, req.message, state_dict, previous_state, "turn")
    asyncio.create_task(synthesize_and_broadcast(ctx.user_id, state_dict["segmentId"], agent_output.get("say", "")))
    schedule_prepare_next(ctx.user_id, state_dict)

    return {
        "decision": {
            "say": agent_output.get("say", ""),
            "play": [],
            "reason": "",
            "segue": "",
            "mood": "",
            "mode": "narrated",
            "provider": agent_status_response(AGENT_MODEL),
        },
        "nowState": state_dict,
        "plan": [],
        "voice": None,
        "agentRunId": None,
    }


@app.post("/api/radio/turn/async")
async def radio_turn_async(req: ChatRequest, request: Request):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)

    previous_state = _current_states.get(ctx.user_id).copy() if _current_states.get(ctx.user_id) else None
    pending_state = pending_radio_state(req.message)
    _current_states[ctx.user_id] = pending_state
    await broadcast_state(ctx.user_id, pending_state)

    existing = _turn_generation_tasks.get(ctx.user_id)
    if existing and not existing.done():
        existing.cancel()

    task = asyncio.create_task(
        generate_radio_turn(
            user_id=ctx.user_id,
            message=req.message,
            previous_state=previous_state,
            netease_cookie=music.get_active_cookie(),
            pending_segment_id=pending_state["segmentId"],
        )
    )
    _turn_generation_tasks[ctx.user_id] = task

    return {
        "accepted": True,
        "nowState": pending_state,
    }


@app.post("/api/radio/advance")
async def radio_advance(req: AdvanceRequest, request: Request):
    ctx = resolve_user_context(request)
    music = music_for(ctx.user_id)

    current_state = _current_states.get(ctx.user_id)
    previous_state = current_state.copy() if current_state else None
    if current_state and req.currentSegmentId == current_state.get("segmentId") and current_state.get("preparedNext"):
        state_dict = now_state_from_prepared_segment(current_state["preparedNext"])
        _current_states[ctx.user_id] = state_dict
        if state_dict.get("narrationText") and not state_dict.get("narrationAudioUrl"):
            asyncio.create_task(synthesize_and_broadcast(ctx.user_id, state_dict["segmentId"], state_dict["narrationText"]))
        schedule_prepare_next(ctx.user_id, state_dict)
        return {"nowState": state_dict}

    raw = await asyncio.to_thread(
        agent_loop,
        "下一首",
        previous_state=previous_state,
        user_id=ctx.user_id,
        netease_cookie=music.get_active_cookie(),
    )
    agent_output = json.loads(raw)

    state = build_now_state(agent_output)
    state_dict = now_state_response(state, agent_status_response(AGENT_MODEL))

    _current_states[ctx.user_id] = state_dict
    asyncio.create_task(synthesize_and_broadcast(ctx.user_id, state_dict["segmentId"], agent_output.get("say", "")))
    schedule_prepare_next(ctx.user_id, state_dict)

    return {"nowState": state_dict}


# ---------- WebSocket ----------
@app.websocket("/ws/radio")
async def ws_radio(ws: WebSocket):
    try:
        ctx = resolve_websocket_user_context(ws)
    except AuthError:
        await ws.close(code=1008)
        return

    await ws.accept()
    clients = _ws_clients.setdefault(ctx.user_id, set())
    clients.add(ws)

    # 推送当前状态
    current_state = _current_states.get(ctx.user_id)
    if current_state:
        await ws.send_text(json.dumps({"type": "radio.state", "payload": current_state}, ensure_ascii=False))

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


# ---------- 静态文件 ----------
app.mount("/media/tts", StaticFiles(directory=str(CACHE_DIR)), name="tts_cache")


# ---------- 入口 ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8900, reload=True)
