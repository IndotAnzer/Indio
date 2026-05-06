from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from app.config import AppConfig
from app.core.codex.prompt_builders import CodexIntent, build_decision_prompt, build_narration_prompt
from app.models import (
    AuthMode,
    CodexAuthSource,
    CompatibleResponsesFormat,
    ContextBundle,
    Decision,
    ProviderInfo,
    ProviderKind,
    ProviderState,
    Track,
    TrackNarrationContext,
)


def _clip(value: str, max_length: int) -> str:
    return value if len(value) <= max_length else value[:max_length] + "..."


def _compact_lines(value: str | None) -> str | None:
    if not value:
        return None
    text = " ".join(line.strip() for line in value.splitlines() if line.strip())
    return _clip(text, 240) if text else None


def _normalize_error(value: BaseException) -> str:
    return str(value) or value.__class__.__name__


UNWANTED_NARRATION_PATTERNS = [
    "BPM",
    "作词",
    "填词",
    "作曲",
    "编曲",
    "制作人",
    "先安静接住",
    "接住你的心事",
    "同一条气流",
    "纹理",
]


@dataclass(frozen=True)
class CodexAuthSettings:
    auth_source: CodexAuthSource
    project_api_key: str | None
    compatible_api_key: str | None
    compatible_base_url: str
    compatible_model: str
    compatible_response_format: CompatibleResponsesFormat


@dataclass(frozen=True)
class ProcessResult:
    code: int | None
    stdout: str
    stderr: str
    timed_out: bool


class CodexAdapter:
    def __init__(self, config: AppConfig, get_auth_settings: callable) -> None:
        self.config = config
        self.get_auth_settings = get_auth_settings
        self._status_cache: tuple[float, str, ProviderInfo] | None = None

    async def decide(self, context: ContextBundle, intent: CodexIntent | None = None) -> Decision:
        intent = intent or CodexIntent()
        auth = self.get_auth_settings()
        if auth.auth_source == CodexAuthSource.OPENAI_COMPATIBLE:
            started = time.monotonic()
            try:
                output = await self._run_compatible_responses(
                    build_decision_prompt(context, intent),
                    self.config.codex_decision_schema_path,
                    "indio_decision",
                    20,
                )
                parsed = Decision.model_validate(
                    {
                        **json.loads(output),
                        "provider": self._provider(
                            ProviderKind.RESPONSES_API,
                            ProviderState.READY,
                            AuthMode.API_KEY,
                            model=auth.compatible_model,
                            detail=f"Used OpenAI-compatible Responses API at {auth.compatible_base_url} ({auth.compatible_response_format}).",
                            duration_ms=int((time.monotonic() - started) * 1000),
                        ).model_dump(mode="json", by_alias=True),
                    }
                )
                return parsed
            except Exception as error:
                raise RuntimeError(f"兼容 Responses API 执行失败：{_clip(_normalize_error(error), 260)}") from error

        if self.config.codex_mode != "oauth-cli":
            raise RuntimeError(f"CODEX_MODE={self.config.codex_mode}，当前没有启用 Codex CLI。")

        login_status = await self.get_status(force_refresh=True)
        if login_status.state != ProviderState.READY:
            raise RuntimeError(login_status.detail or "Codex CLI 尚未认证。")

        started = time.monotonic()
        try:
            output = await self._run_codex_exec(
                build_decision_prompt(context, intent),
                self.config.codex_decision_schema_path,
                timeout_sec=min(60, max(1, self.config.codex_exec_timeout_ms // 1000)),
            )
            provider = self._provider(
                ProviderKind.CODEX_CLI,
                ProviderState.READY,
                login_status.auth_mode,
                model=login_status.model,
                detail="Used the local Codex CLI session authenticated with OAuth or API key.",
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            parsed = Decision.model_validate({**json.loads(output), "provider": provider.model_dump(mode="json", by_alias=True)})
            self._cache_status(provider, auth)
            return parsed
        except Exception as error:
            raise RuntimeError(f"Codex CLI 执行失败：{_clip(_normalize_error(error), 180)}") from error

    async def get_status(self, force_refresh: bool = False) -> ProviderInfo:
        return await self._get_login_status(force_refresh)

    async def compose_on_air_narration(
        self,
        *,
        context: ContextBundle,
        decision: Decision,
        now_playing: Track | None,
        now_playing_context: TrackNarrationContext | None,
        queued_tracks: list[Track],
    ) -> str | None:
        if decision.mode == "music-only" or not now_playing:
            return None
        auth = self.get_auth_settings()
        try:
            if auth.auth_source == CodexAuthSource.OPENAI_COMPATIBLE:
                output = await self._run_compatible_responses(
                    build_narration_prompt(
                        context=context,
                        decision=decision,
                        now_playing=now_playing,
                        now_playing_context=now_playing_context,
                        queued_tracks=queued_tracks,
                    ),
                    self.config.codex_narration_schema_path,
                    "indio_narration",
                    20,
                )
            else:
                status = await self.get_status(force_refresh=True)
                if status.state != ProviderState.READY:
                    return None
                output = await self._run_codex_exec(
                    build_narration_prompt(
                        context=context,
                        decision=decision,
                        now_playing=now_playing,
                        now_playing_context=now_playing_context,
                        queued_tracks=queued_tracks,
                    ),
                    self.config.codex_narration_schema_path,
                    timeout_sec=12,
                )
            payload = json.loads(output)
            narration = str(payload.get("narration") or "").strip()
            if not narration or any(pattern in narration for pattern in UNWANTED_NARRATION_PATTERNS):
                return None
            return narration
        except Exception:
            return None

    def _provider(
        self,
        kind: ProviderKind,
        state: ProviderState,
        auth_mode: AuthMode,
        *,
        model: str | None = None,
        detail: str | None,
        duration_ms: int | None,
    ) -> ProviderInfo:
        return ProviderInfo(
            kind=kind,
            state=state,
            auth_mode=auth_mode,
            model=model or self.config.codex_model or "default",
            detail=detail,
            duration_ms=duration_ms,
        )

    async def _get_login_status(self, force_refresh: bool) -> ProviderInfo:
        auth = self.get_auth_settings()
        key = self._cache_key(auth)
        if not force_refresh and self._status_cache and self._status_cache[0] > time.time() and self._status_cache[1] == key:
            return self._status_cache[2]

        if self.config.codex_mode != "oauth-cli":
            provider = self._provider(
                ProviderKind.FALLBACK,
                ProviderState.DISABLED,
                AuthMode.NONE,
                detail=f"CODEX_MODE={self.config.codex_mode}",
                duration_ms=0,
            )
            self._cache_status(provider, auth)
            return provider

        if auth.auth_source == CodexAuthSource.OPENAI_COMPATIBLE:
            error = self._validate_compatible_settings(auth)
            provider = (
                self._provider(
                    ProviderKind.RESPONSES_API,
                    ProviderState.ERROR,
                    AuthMode.API_KEY,
                    model=auth.compatible_model,
                    detail=error,
                    duration_ms=0,
                )
                if error
                else self._provider(
                    ProviderKind.RESPONSES_API,
                    ProviderState.READY,
                    AuthMode.API_KEY,
                    model=auth.compatible_model,
                    detail=f"OpenAI-compatible Responses API is configured at {auth.compatible_base_url} ({auth.compatible_response_format}).",
                    duration_ms=0,
                )
            )
            self._cache_status(provider, auth)
            return provider

        if auth.auth_source == CodexAuthSource.PROJECT_API:
            detail = await self._validate_api_key_auth(auth.project_api_key)
            provider = (
                self._provider(ProviderKind.FALLBACK, ProviderState.ERROR, AuthMode.API_KEY, detail=detail, duration_ms=0)
                if detail
                else self._provider(ProviderKind.CODEX_CLI, ProviderState.READY, AuthMode.API_KEY, detail="Using project-scoped OpenAI API key.", duration_ms=0)
            )
            self._cache_status(provider, auth)
            return provider

        try:
            result = await self._run_process([self.config.codex_cli_command, "login", "status"], timeout_sec=5)
            output = "\n".join(part for part in (result.stdout, result.stderr) if part)
            auth_mode = self._detect_auth_mode(output)
            if result.code == 0 and auth_mode != AuthMode.NONE:
                if auth_mode == AuthMode.API_KEY:
                    detail = await self._validate_api_key_auth(self._read_shared_api_key())
                    if detail:
                        provider = self._provider(ProviderKind.FALLBACK, ProviderState.ERROR, auth_mode, detail=detail, duration_ms=0)
                        self._cache_status(provider, auth)
                        return provider
                provider = self._provider(
                    ProviderKind.CODEX_CLI,
                    ProviderState.READY,
                    auth_mode,
                    detail="Authenticated via ChatGPT OAuth." if auth_mode == AuthMode.CHATGPT else "Authenticated via API key.",
                    duration_ms=0,
                )
                self._cache_status(provider, auth)
                return provider
            provider = self._provider(
                ProviderKind.FALLBACK,
                ProviderState.ERROR,
                auth_mode,
                detail=_compact_lines(output) or "Run `codex login` to authenticate the local CLI.",
                duration_ms=0,
            )
            self._cache_status(provider, auth)
            return provider
        except Exception as error:
            provider = self._provider(
                ProviderKind.FALLBACK,
                ProviderState.ERROR,
                AuthMode.UNKNOWN,
                detail=f"Unable to inspect Codex login status. {_clip(_normalize_error(error), 180)}",
                duration_ms=0,
            )
            self._cache_status(provider, auth)
            return provider

    def _detect_auth_mode(self, output: str) -> AuthMode:
        if "Logged in using ChatGPT" in output:
            return AuthMode.CHATGPT
        if "API key" in output or "api key" in output:
            return AuthMode.API_KEY
        if "not logged in" in output.lower() or "logged out" in output.lower():
            return AuthMode.NONE
        if self._read_shared_api_key():
            return AuthMode.API_KEY
        return AuthMode.UNKNOWN

    async def _validate_api_key_auth(self, api_key: str | None) -> str | None:
        if not api_key:
            return "当前没有可用的 OpenAI API key。"
        try:
            async with httpx.AsyncClient(timeout=10, proxy=self.config.codex_proxy_url) as client:
                response = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if response.status_code == 401 or "invalid_api_key" in response.text:
                return "Codex 当前使用的 OpenAI API key 无效，请重新填写。"
            if response.status_code < 200 or response.status_code >= 300:
                return f"Codex API key 校验失败：{_clip(response.text, 180)}"
            return None
        except Exception as error:
            return f"Codex API key 校验失败：{_clip(_normalize_error(error), 180)}"

    async def _run_codex_exec(self, prompt: str, output_schema_path: Path, timeout_sec: int) -> str:
        auth = self.get_auth_settings()
        with tempfile.TemporaryDirectory(prefix="codex-home-", dir=self.config.data_dir) as runtime_home:
            runtime_home_path = Path(runtime_home)
            output_path = runtime_home_path / "last-message.json"
            self._prepare_runtime_auth(runtime_home_path, auth)
            args = [
                self.config.codex_cli_command,
                "exec",
                "--ignore-user-config",
                "--ignore-rules",
                "--ephemeral",
                "--disable",
                "plugins",
                "--disable",
                "apps",
                "--disable",
                "browser_use",
                "--disable",
                "in_app_browser",
                "--disable",
                "computer_use",
                "--disable",
                "general_analytics",
                "-s",
                "read-only",
                "--skip-git-repo-check",
                "-C",
                str(self.config.root_dir),
                "-c",
                'approval_policy="never"',
                "-c",
                'analytics.enabled=false',
                "-c",
                'features.apps=false',
                "-c",
                'web_search="disabled"',
                "-c",
                f'model_reasoning_effort="{self.config.codex_reasoning_effort}"',
                "-c",
                'model_verbosity="low"',
                "--color",
                "never",
                "--output-schema",
                str(output_schema_path),
                "-o",
                str(output_path),
                "-",
            ]
            if self.config.codex_model:
                args[4:4] = ["-m", self.config.codex_model]
            result = await self._run_process(args, cwd=self.config.root_dir, env=self._codex_env(runtime_home_path), stdin=prompt, timeout_sec=timeout_sec)
            if result.timed_out:
                raise RuntimeError(f"Timed out after {timeout_sec * 1000}ms.")
            if result.code != 0:
                raise RuntimeError(_compact_lines(result.stderr) or _compact_lines(result.stdout) or f"Codex exited with code {result.code}.")
            return output_path.read_text(encoding="utf-8").strip()

    async def _run_compatible_responses(self, prompt: str, output_schema_path: Path, schema_name: str, timeout_sec: int) -> str:
        auth = self.get_auth_settings()
        error = self._validate_compatible_settings(auth)
        if error:
            raise RuntimeError(error)
        assert auth.compatible_api_key
        schema = json.loads(output_schema_path.read_text(encoding="utf-8"))
        body = self._responses_body(auth, prompt, schema_name, schema)
        async with httpx.AsyncClient(timeout=timeout_sec, proxy=self.config.codex_proxy_url) as client:
            response = await client.post(
                self._responses_url(auth.compatible_base_url),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {auth.compatible_api_key}"},
                json=body,
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"Responses request failed ({response.status_code}): {_clip(response.text, 240)}")
        output = self._extract_responses_text(response.json())
        if not output:
            raise RuntimeError("Responses API returned no output text.")
        return output

    def _responses_body(self, auth: CodexAuthSettings, prompt: str, schema_name: str, schema: Any) -> dict[str, Any]:
        if auth.compatible_response_format == CompatibleResponsesFormat.JSON_SCHEMA:
            return {
                "model": auth.compatible_model,
                "input": prompt,
                "store": False,
                "text": {"format": {"type": "json_schema", "name": schema_name, "schema": schema, "strict": True}},
            }
        return {
            "model": auth.compatible_model,
            "input": "\n".join(
                [
                    prompt,
                    "",
                    f'Return only one valid JSON object that matches this JSON Schema named "{schema_name}".',
                    "Do not include Markdown fences, comments, or any text outside the JSON object.",
                    json.dumps(schema, ensure_ascii=False),
                ]
            ),
            "store": False,
            "text": {"format": {"type": "json_object"}},
        }

    def _extract_responses_text(self, payload: Any) -> str | None:
        if isinstance(payload, dict) and isinstance(payload.get("output_text"), str):
            return payload["output_text"].strip()
        if not isinstance(payload, dict):
            return None
        for item in payload.get("output") or []:
            if not isinstance(item, dict):
                continue
            for part in item.get("content") or []:
                if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip():
                    return part["text"].strip()
        return None

    def _responses_url(self, base_url: str) -> str:
        return base_url.rstrip("/") + "/responses"

    def _validate_compatible_settings(self, auth: CodexAuthSettings) -> str | None:
        if not auth.compatible_api_key:
            return "兼容接口 API key 为空。"
        if not auth.compatible_base_url.startswith(("http://", "https://")):
            return "兼容接口 Base URL 不是有效 URL。"
        if not auth.compatible_model:
            return "兼容接口模型名为空。"
        return None

    def _codex_env(self, runtime_home: Path | None = None) -> dict[str, str]:
        env = dict(os.environ)
        if runtime_home:
            env["CODEX_HOME"] = str(runtime_home)
        if self.config.codex_proxy_url:
            for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
                env[key] = self.config.codex_proxy_url
            env.setdefault("NO_PROXY", "127.0.0.1,localhost")
            env.setdefault("no_proxy", "127.0.0.1,localhost")
        return env

    def _prepare_runtime_auth(self, runtime_home: Path, auth: CodexAuthSettings) -> None:
        if auth.auth_source == CodexAuthSource.PROJECT_API:
            if not auth.project_api_key:
                raise RuntimeError("项目 API key 未配置。")
            (runtime_home / "auth.json").write_text(json.dumps({"OPENAI_API_KEY": auth.project_api_key}, indent=2), encoding="utf-8")
            return
        for name in ("auth.json", "installation_id"):
            source = self.config.resolved_codex_home_dir / name
            if source.exists():
                shutil.copyfile(source, runtime_home / name)

    def _read_shared_api_key(self) -> str | None:
        try:
            payload = json.loads((self.config.resolved_codex_home_dir / "auth.json").read_text(encoding="utf-8"))
            value = payload.get("OPENAI_API_KEY")
            return value.strip() if isinstance(value, str) and value.strip() else None
        except Exception:
            return None

    async def _run_process(
        self,
        args: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        stdin: str | None = None,
        timeout_sec: int,
    ) -> ProcessResult:
        process = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd) if cwd else None,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(stdin.encode("utf-8") if stdin is not None else None),
                timeout=timeout_sec,
            )
            return ProcessResult(process.returncode, stdout.decode("utf-8", "replace")[-8000:], stderr.decode("utf-8", "replace")[-12000:], False)
        except TimeoutError:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=0.5)
            except TimeoutError:
                process.kill()
            return ProcessResult(process.returncode, "", "", True)

    def _cache_key(self, auth: CodexAuthSettings) -> str:
        return ":".join(
            [
                auth.auth_source.value,
                (auth.project_api_key or "none")[-6:],
                (auth.compatible_api_key or "none")[-6:],
                auth.compatible_base_url,
                auth.compatible_model,
                auth.compatible_response_format.value,
            ]
        )

    def _cache_status(self, value: ProviderInfo, auth: CodexAuthSettings) -> None:
        self._status_cache = (time.time() + 60, self._cache_key(auth), value)
