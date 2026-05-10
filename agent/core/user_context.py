from __future__ import annotations

import re
from contextvars import ContextVar


DEFAULT_USER_ID = "local"

_current_user_id: ContextVar[str] = ContextVar("indio_current_user_id", default=DEFAULT_USER_ID)
_current_netease_cookie: ContextVar[str | None] = ContextVar("indio_current_netease_cookie", default=None)


def get_current_user_id() -> str:
    return _current_user_id.get() or DEFAULT_USER_ID


def set_current_user_id(user_id: str):
    return _current_user_id.set(user_id or DEFAULT_USER_ID)


def reset_current_user_id(token) -> None:
    _current_user_id.reset(token)


def get_current_netease_cookie() -> str | None:
    return _current_netease_cookie.get()


def set_current_netease_cookie(cookie: str | None):
    return _current_netease_cookie.set(cookie)


def reset_current_netease_cookie(token) -> None:
    _current_netease_cookie.reset(token)


def safe_user_id(user_id: str | None) -> str:
    value = user_id or DEFAULT_USER_ID
    value = value.replace(":", "_")
    value = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return value or DEFAULT_USER_ID
