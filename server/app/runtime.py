from __future__ import annotations

import asyncio
import time
from dataclasses import asdict
from typing import Callable

from app.adapters.calendar import CalendarAdapter
from app.adapters.mimo_tts import MimoTtsAdapter
from app.adapters.netease_music import NeteaseMusicAdapter
from app.adapters.speaker import SpeakerAdapter
from app.adapters.weather import WeatherAdapter
from app.config import AppConfig
from app.core.codex.prompt_builders import CodexIntent
from app.core.codex_adapter import CodexAdapter, CodexAuthSettings
from app.core.context import ContextService
from app.core.router import RoutedControl, RoutedPlan, RouterService
from app.core.scheduler import SchedulerService
from app.core.state import StateStore
from app.core.tts import TtsService
from app.models import (
    AuthMode,
    BootstrapResponse,
    CodexAuthSource,
    CodexSettings,
    CompatibleResponsesFormat,
    ContextBundle,
    Decision,
    MusicBootstrap,
    MusicStatus,
    NeteaseQrLoginSession,
    NeteaseQrLoginStatus,
    NowState,
    PlanEntry,
    PreparedSegment,
    ProviderInfo,
    ProviderKind,
    ProviderState,
    RunTurnResult,
    Track,
    TriggerSource,
    TtsStatus,
    UpdateCodexSettingsRequest,
    VoiceAsset,
    utc_now_iso,
)


class IndioRuntime:
    def __init__(self, config: AppConfig, publish: Callable[[str, NowState | list[PlanEntry]], None]) -> None:
        self.config = config
        self.publish = publish
        self.state = StateStore(config)
        self.weather = WeatherAdapter()
        self.calendar = CalendarAdapter()
        self.music = NeteaseMusicAdapter(config, self.state)
        self.speaker = SpeakerAdapter()
        self.mimo = MimoTtsAdapter(config)
        self.context = ContextService(config, self.state, self.weather, self.calendar)
        self.router = RouterService()
        self.codex = CodexAdapter(config, self._auth_settings)
        self.tts = TtsService(config, self.mimo)
        self.scheduler = SchedulerService(
            self.state,
            self.context,
            lambda entries: self.publish("plan.updated", entries),
        )
        self.segment_counter = 0

    async def bootstrap(self) -> None:
        await self.scheduler.ensure_today_plan()
        self.scheduler.start()
        now_state = self.state.get_now_state()
        if now_state and now_state.now_playing and (not now_state.prepared_next or self._should_refresh_prepared_next(now_state)):
            asyncio.create_task(self._prepare_and_publish_next_segment(now_state, replace_existing=bool(now_state.prepared_next)))

    async def shutdown(self) -> None:
        self.scheduler.stop()
        self.state.close()

    async def handle_turn(self, *, source: TriggerSource, user_input: str | None = None) -> RunTurnResult:
        current_state = self.state.get_now_state()
        routed = self.router.route(user_input, current_state)
        context = await self.context.build(source=source, user_input=user_input)
        if isinstance(routed, RoutedControl):
            decision = routed.decision
        else:
            decision = await self.codex.decide(
                context,
                CodexIntent(mood_hint=routed.mood_hint, quiet_mode=routed.quiet_mode),
            )

        queue = await self.music.resolve_queue(decision.play, decision.mood)
        now_playing = queue[0] if queue else None
        queued_tracks = queue[1:] if len(queue) > 1 else []
        output_device = await self.speaker.get_current_output()
        segment, voice = await self._build_segment(
            segment_id=self._create_segment_id(),
            source=source,
            context=context,
            decision=decision,
            now_playing=now_playing,
            queued_tracks=queued_tracks,
            output_device=output_device,
        )
        now_state = self._materialize_segment(segment)
        if user_input:
            self.state.save_message("user", user_input, {"source": source.value})
        if segment.narration_text:
            self.state.save_message("assistant", segment.narration_text, {"mood": decision.mood, "mode": decision.mode})
        if segment.now_playing:
            self.state.save_play(segment.now_playing, decision.reason)
        self.state.save_now_state(now_state)
        self._publish_state(now_state)
        asyncio.create_task(self._prepare_and_publish_next_segment(now_state))
        return RunTurnResult(decision=decision, now_state=now_state, plan=self.scheduler.get_today_plan(), voice=voice)

    async def advance_prepared_segment(self, current_segment_id: str | None = None) -> NowState:
        current_state = self.state.get_now_state()
        if not current_state or not current_state.now_playing:
            raise RuntimeError("当前没有正在播放的电台段落。")
        if current_segment_id and current_state.segment_id != current_segment_id:
            return current_state
        if not current_state.prepared_next:
            raise RuntimeError("下一段电台还在准备，请再等一下。")
        promoted = self._materialize_segment(current_state.prepared_next)
        if promoted.narration_text:
            self.state.save_message("assistant", promoted.narration_text, {"mood": promoted.mood, "mode": promoted.mode})
        if promoted.now_playing:
            self.state.save_play(promoted.now_playing, promoted.reason)
        self.state.save_now_state(promoted)
        self._publish_state(promoted)
        asyncio.create_task(self._prepare_and_publish_next_segment(promoted))
        return promoted

    async def _build_segment(
        self,
        *,
        segment_id: str,
        source: TriggerSource,
        context: ContextBundle,
        decision: Decision,
        now_playing: Track | None,
        queued_tracks: list[Track],
        output_device: str,
    ) -> tuple[PreparedSegment, VoiceAsset | None]:
        if not now_playing or not now_playing.stream_url:
            raise RuntimeError("电台音乐还没准备好，请再等一下。")
        if decision.mode == "music-only":
            narration_text = ""
            voice = None
        else:
            now_playing_context = await self.music.get_narration_context(now_playing)
            narration_text = await self.codex.compose_on_air_narration(
                context=context,
                decision=decision,
                now_playing=now_playing,
                now_playing_context=now_playing_context,
                queued_tracks=queued_tracks,
            )
            if not narration_text:
                narration_text = decision.say
            voice = await self.tts.synthesize(narration_text)
        return (
            PreparedSegment(
                segment_id=segment_id,
                source=source,
                mood=decision.mood,
                mode=decision.mode,
                provider=decision.provider,
                narration_text=narration_text,
                narration_audio_url=voice.audio_url if voice else None,
                segue=decision.segue,
                reason=decision.reason,
                output_device=output_device,
                now_playing=now_playing,
                queued_tracks=queued_tracks,
                prepared_at=utc_now_iso(),
            ),
            voice,
        )

    async def _prepare_and_publish_next_segment(self, base_state: NowState, *, replace_existing: bool = False) -> None:
        current_state = self.state.get_now_state()
        if (
            not current_state
            or not current_state.now_playing
            or current_state.segment_id != base_state.segment_id
            or (current_state.prepared_next and not replace_existing)
        ):
            return
        try:
            prepared_next = await self._prepare_next_segment(current_state)
        except Exception:
            return
        if not prepared_next:
            return
        refreshed = self.state.get_now_state()
        if not refreshed or not refreshed.now_playing or refreshed.segment_id != base_state.segment_id:
            return
        next_state = refreshed.model_copy(update={"prepared_next": prepared_next})
        self.state.save_now_state(next_state)
        self._publish_state(next_state)

    async def _prepare_next_segment(self, state: NowState) -> PreparedSegment | None:
        queue = await self.music.get_radio_continuation(
            mood=state.mood,
            current_track=state.now_playing,
            queued_tracks=state.queued_tracks,
            limit=4,
        )
        next_track = queue[0] if queue else None
        if not next_track or not next_track.stream_url:
            return None
        context = await self.context.build(source=TriggerSource.SYSTEM)
        decision = self._continuation_decision(state)
        segment, _ = await self._build_segment(
            segment_id=self._create_segment_id(),
            source=TriggerSource.SYSTEM,
            context=context,
            decision=decision,
            now_playing=next_track,
            queued_tracks=queue[1:],
            output_device=state.output_device,
        )
        return segment

    def _continuation_decision(self, state: NowState) -> Decision:
        return Decision(
            say="顺着这一段气氛继续往下走。",
            play=[],
            reason=state.reason,
            segue=state.segue,
            mood=state.mood,
            mode=state.mode,
            provider=state.provider,
        )

    def _materialize_segment(self, segment: PreparedSegment) -> NowState:
        return NowState(
            segment_id=segment.segment_id,
            updated_at=utc_now_iso(),
            source=segment.source,
            mood=segment.mood,
            mode=segment.mode,
            provider=segment.provider,
            narration_text=segment.narration_text,
            narration_audio_url=segment.narration_audio_url,
            segue=segment.segue,
            reason=segment.reason,
            output_device=segment.output_device,
            now_playing=segment.now_playing,
            queued_tracks=segment.queued_tracks,
            prepared_next=None,
        )

    def _should_refresh_prepared_next(self, state: NowState) -> bool:
        prepared = state.prepared_next.now_playing if state.prepared_next else None
        queued = state.queued_tracks[0] if state.queued_tracks else None
        return bool(prepared and queued and self._track_identity(prepared) == self._track_identity(queued))

    def _track_identity(self, track: Track) -> str:
        return track.netease_id or track.id

    def _publish_state(self, state: NowState) -> None:
        self.publish("radio.state", state)

    def _create_segment_id(self) -> str:
        self.segment_counter += 1
        return f"{int(time.time() * 1000)}-{self.segment_counter}"

    def get_now_state(self) -> NowState | None:
        return self.state.get_now_state()

    def get_config_mode(self) -> str:
        return self.config.codex_mode

    async def get_taste_summary(self) -> dict[str, object]:
        return await self.context.get_taste_summary()

    def get_today_plan(self) -> list[PlanEntry]:
        return self.scheduler.get_today_plan()

    def get_next_track(self) -> Track | None:
        state = self.state.get_now_state()
        return state.queued_tracks[0] if state and state.queued_tracks else None

    async def get_codex_status(self, force_refresh: bool = False) -> ProviderInfo:
        return await self.codex.get_status(force_refresh)

    def get_codex_settings(self) -> CodexSettings:
        project_key = self.state.get_project_codex_api_key()
        compatible_key = self.state.get_compatible_codex_api_key()
        return CodexSettings(
            auth_source=self.state.get_codex_auth_source(),
            project_api_key_configured=bool(project_key),
            project_api_key_label=self._mask_api_key(project_key) if project_key else None,
            compatible_api_key_configured=bool(compatible_key),
            compatible_api_key_label=self._mask_api_key(compatible_key) if compatible_key else None,
            compatible_base_url=self.state.get_compatible_codex_base_url(),
            compatible_model=self.state.get_compatible_codex_model(self.config.codex_model),
            compatible_response_format=self.state.get_compatible_codex_response_format(),
        )

    async def update_codex_settings(self, payload: UpdateCodexSettingsRequest) -> tuple[CodexSettings, ProviderInfo]:
        next_project_key = None if payload.clear_project_api_key else (payload.project_api_key or "").strip() or self.state.get_project_codex_api_key()
        next_compatible_key = None if payload.clear_compatible_api_key else (payload.compatible_api_key or "").strip() or self.state.get_compatible_codex_api_key()
        next_base_url = (payload.compatible_base_url or "").strip() or self.state.get_compatible_codex_base_url()
        next_model = (payload.compatible_model or "").strip() or self.state.get_compatible_codex_model(self.config.codex_model)
        next_format = payload.compatible_response_format or self.state.get_compatible_codex_response_format()
        if payload.auth_source == CodexAuthSource.PROJECT_API and not next_project_key:
            raise RuntimeError("项目 API key 为空，无法切换到 API 模式。")
        if payload.auth_source == CodexAuthSource.OPENAI_COMPATIBLE:
            if not next_compatible_key:
                raise RuntimeError("兼容接口 API key 为空，无法切换到 Responses API 模式。")
            if not next_base_url.startswith(("http://", "https://")):
                raise RuntimeError("兼容接口 Base URL 不是有效 URL。")
            if not next_model:
                raise RuntimeError("兼容接口模型名为空。")
        if payload.clear_project_api_key or payload.project_api_key is not None:
            self.state.save_project_codex_api_key((payload.project_api_key or "").strip() or None)
        if payload.clear_compatible_api_key or payload.compatible_api_key is not None:
            self.state.save_compatible_codex_api_key((payload.compatible_api_key or "").strip() or None)
        if payload.compatible_base_url and payload.compatible_base_url.strip():
            self.state.save_compatible_codex_base_url(payload.compatible_base_url.strip())
        if payload.compatible_model and payload.compatible_model.strip():
            self.state.save_compatible_codex_model(payload.compatible_model.strip())
        self.state.save_compatible_codex_response_format(next_format)
        self.state.save_codex_auth_source(payload.auth_source)
        return self.get_codex_settings(), await self.get_codex_status(force_refresh=True)

    def get_music_status(self) -> MusicStatus:
        return self.music.get_status()

    def get_music_bootstrap(self) -> MusicBootstrap:
        return self.music.get_bootstrap()

    async def create_music_qr_login(self) -> NeteaseQrLoginSession:
        return await self.music.create_qr_login_session()

    async def check_music_qr_login(self, key: str) -> NeteaseQrLoginStatus:
        return await self.music.check_qr_login_session(key)

    async def logout_music(self) -> None:
        await self.music.logout()

    def get_tts_status(self) -> TtsStatus:
        return self.tts.get_status()

    async def get_bootstrap(self) -> BootstrapResponse:
        return BootstrapResponse(
            now=self.get_now_state(),
            plan=self.get_today_plan(),
            music=self.get_music_bootstrap(),
            codex=self.get_codex_settings(),
            codex_status=await self.get_codex_status(),
            tts=self.get_tts_status(),
        )

    def _auth_settings(self) -> CodexAuthSettings:
        return CodexAuthSettings(
            auth_source=self.state.get_codex_auth_source(),
            project_api_key=self.state.get_project_codex_api_key(),
            compatible_api_key=self.state.get_compatible_codex_api_key(),
            compatible_base_url=self.state.get_compatible_codex_base_url(),
            compatible_model=self.state.get_compatible_codex_model(self.config.codex_model),
            compatible_response_format=self.state.get_compatible_codex_response_format(),
        )

    def _mask_api_key(self, api_key: str) -> str:
        normalized = api_key.strip()
        return normalized if len(normalized) <= 10 else f"{normalized[:6]}***{normalized[-4:]}"
