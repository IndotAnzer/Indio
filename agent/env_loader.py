from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    configured = os.getenv("INDIO_PROJECT_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent.parent


def project_env_path() -> Path:
    return project_root() / ".env"


def load_project_env() -> Path | None:
    env_path = project_env_path()
    if not env_path.exists():
        return None

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))
    return env_path
