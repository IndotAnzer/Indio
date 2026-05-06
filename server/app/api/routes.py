from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.config import AppConfig
from app.models import (
    AdvanceRequest,
    AdvanceResponse,
    BootstrapResponse,
    ChatRequest,
    CodexSettingsResponse,
    HealthResponse,
    MusicBootstrapResponse,
    MusicLogoutResponse,
    MusicQrCheckResponse,
    MusicQrCreateResponse,
    NowResponse,
    TriggerSource,
    UpdateCodexSettingsRequest,
)
from app.runtime import IndioRuntime
from app.stream import StreamHub

router = APIRouter()


def runtime(request: Request) -> IndioRuntime:
    return request.app.state.runtime


def config(request: Request) -> AppConfig:
    return request.app.state.config


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    rt = runtime(request)
    return HealthResponse(
        ok=True,
        mode=rt.get_config_mode(),
        codex=await rt.get_codex_status(),
        music=rt.get_music_status(),
        tts=rt.get_tts_status(),
    )


@router.get("/api/bootstrap", response_model=BootstrapResponse)
async def bootstrap(request: Request) -> BootstrapResponse:
    return await runtime(request).get_bootstrap()


@router.get("/api/radio/now", response_model=NowResponse)
async def radio_now(request: Request) -> NowResponse:
    return NowResponse(now=runtime(request).get_now_state())


@router.post("/api/radio/turn")
async def radio_turn(request: Request, body: ChatRequest):
    try:
        return await runtime(request).handle_turn(source=TriggerSource.MANUAL, user_input=body.message)
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error) or "电台这轮还没准备好，请稍等再试。") from error


@router.post("/api/radio/advance", response_model=AdvanceResponse)
async def radio_advance(request: Request, body: AdvanceRequest | None = None) -> AdvanceResponse:
    try:
        state = await runtime(request).advance_prepared_segment(body.current_segment_id if body else None)
        return AdvanceResponse(now_state=state)
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error) or "下一段电台还没准备好，请稍等。") from error


@router.post("/api/radio/pulse")
async def radio_pulse(request: Request):
    try:
        return await runtime(request).handle_turn(source=TriggerSource.SCHEDULE)
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error) or "电台这轮还没准备好，请稍后。") from error


@router.get("/api/settings/codex", response_model=CodexSettingsResponse)
async def get_codex_settings(request: Request) -> CodexSettingsResponse:
    rt = runtime(request)
    return CodexSettingsResponse(settings=rt.get_codex_settings(), status=await rt.get_codex_status())


@router.put("/api/settings/codex", response_model=CodexSettingsResponse)
async def put_codex_settings(request: Request, body: UpdateCodexSettingsRequest) -> CodexSettingsResponse:
    try:
        settings, status = await runtime(request).update_codex_settings(body)
        return CodexSettingsResponse(settings=settings, status=status)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error) or "Codex 设置更新失败。") from error


@router.get("/api/integrations/music/bootstrap", response_model=MusicBootstrapResponse)
async def music_bootstrap(request: Request) -> MusicBootstrapResponse:
    return MusicBootstrapResponse(music=runtime(request).get_music_bootstrap())


@router.post("/api/integrations/music/login/qr", response_model=MusicQrCreateResponse)
async def music_qr_create(request: Request) -> MusicQrCreateResponse:
    return MusicQrCreateResponse(session=await runtime(request).create_music_qr_login())


@router.get("/api/integrations/music/login/qr", response_model=MusicQrCheckResponse)
async def music_qr_check(request: Request, key: str) -> MusicQrCheckResponse:
    rt = runtime(request)
    return MusicQrCheckResponse(status=await rt.check_music_qr_login(key), music=rt.get_music_bootstrap())


@router.post("/api/integrations/music/logout", response_model=MusicLogoutResponse)
async def music_logout(request: Request) -> MusicLogoutResponse:
    rt = runtime(request)
    await rt.logout_music()
    return MusicLogoutResponse(ok=True, music=rt.get_music_bootstrap())


@router.get("/media/tts/{filename}")
async def media_tts(request: Request, filename: str):
    safe_name = filename.replace("/", "").replace("\\", "")
    path = config(request).cache_dir / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="TTS file not found.")
    return FileResponse(path)


@router.websocket("/ws/radio")
async def radio_ws(websocket: WebSocket):
    rt: IndioRuntime = websocket.app.state.runtime
    hub: StreamHub = websocket.app.state.stream_hub
    await hub.connect(websocket, now_state=rt.get_now_state(), plan=rt.get_today_plan())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)
