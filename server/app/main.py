from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import load_config
from app.runtime import IndioRuntime
from app.stream import StreamHub


def create_app() -> FastAPI:
    config = load_config()
    stream_hub = StreamHub()
    runtime = IndioRuntime(config, stream_hub.publish_nowait)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await runtime.bootstrap()
        try:
            yield
        finally:
            await runtime.shutdown()

    app = FastAPI(title="Indio", version="0.2.0", lifespan=lifespan)
    app.state.config = config
    app.state.stream_hub = stream_hub
    app.state.runtime = runtime

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.pwa_url],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.exception_handler(Exception)
    async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"error": str(exc) or "Indio server error."})

    return app


app = create_app()
