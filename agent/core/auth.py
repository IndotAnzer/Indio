from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from core.user_context import DEFAULT_USER_ID


SESSION_TTL_SECONDS = 60 * 60 * 24 * 30


class AuthError(RuntimeError):
    pass


@dataclass(frozen=True)
class UserContext:
    user_id: str = DEFAULT_USER_ID
    provider: str = "local"
    token: str | None = None


@dataclass(frozen=True)
class WechatLoginResult:
    user_id: str
    openid: str
    unionid: str | None
    session_key: str


def create_session_token(user_id: str, *, provider: str = "wechat", ttl_seconds: int = SESSION_TTL_SECONDS) -> str:
    payload = {
        "uid": user_id,
        "provider": provider,
        "iat": int(time.time()),
        "exp": int(time.time()) + ttl_seconds,
        "v": 1,
    }
    payload_part = _b64url(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = _sign(payload_part)
    return f"{payload_part}.{signature}"


def parse_session_token(token: str | None) -> UserContext:
    if not token:
        return UserContext()
    try:
        payload_part, signature = token.split(".", 1)
    except ValueError as exc:
        raise AuthError("Invalid session token.") from exc
    if not hmac.compare_digest(_sign(payload_part), signature):
        raise AuthError("Invalid session token signature.")
    try:
        payload = json.loads(_b64url_decode(payload_part).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise AuthError("Invalid session token payload.") from exc
    exp = int(payload.get("exp") or 0)
    if exp and exp < int(time.time()):
        raise AuthError("Session token expired.")
    user_id = str(payload.get("uid") or "").strip()
    if not user_id:
        raise AuthError("Session token has no user.")
    return UserContext(user_id=user_id, provider=str(payload.get("provider") or "wechat"), token=token)


def extract_bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    prefix = "Bearer "
    if value.startswith(prefix):
        return value[len(prefix):].strip() or None
    return value.strip() or None


async def exchange_wechat_login_code(code: str, *, app_id: str | None, app_secret: str | None) -> WechatLoginResult:
    if not app_id or not app_secret:
        raise AuthError("WECHAT_MINIPROGRAM_APP_ID/WECHAT_MINIPROGRAM_APP_SECRET are not configured.")
    if not code.strip():
        raise AuthError("Wechat login code is required.")

    query = urlencode({
        "appid": app_id,
        "secret": app_secret,
        "js_code": code.strip(),
        "grant_type": "authorization_code",
    })
    url = f"https://api.weixin.qq.com/sns/jscode2session?{query}"
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        response = await client.get(url)
    if response.status_code < 200 or response.status_code >= 300:
        raise AuthError(f"Wechat code2Session failed ({response.status_code}).")

    payload: dict[str, Any] = response.json()
    if payload.get("errcode"):
        message = payload.get("errmsg") or "Wechat code2Session failed."
        raise AuthError(str(message))

    openid = str(payload.get("openid") or "").strip()
    session_key = str(payload.get("session_key") or "").strip()
    unionid = str(payload.get("unionid") or "").strip() or None
    if not openid or not session_key:
        raise AuthError("Wechat code2Session did not return openid/session_key.")
    return WechatLoginResult(
        user_id=f"wechat:{openid}",
        openid=openid,
        unionid=unionid,
        session_key=session_key,
    )


def _secret() -> bytes:
    return os.getenv("INDIO_SESSION_SECRET", "indio-local-dev-session-secret").encode("utf-8")


def _sign(payload_part: str) -> str:
    digest = hmac.new(_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
    return _b64url(digest)


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
