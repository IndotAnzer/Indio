from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import AuthMode, Decision, NowState, ProviderInfo, ProviderKind, ProviderState, TrackRequest


@dataclass(frozen=True)
class RoutedControl:
    decision: Decision


@dataclass(frozen=True)
class RoutedPlan:
    mood_hint: str | None = None
    quiet_mode: bool = False


RoutedIntent = RoutedControl | RoutedPlan


def _control_provider() -> ProviderInfo:
    return ProviderInfo(
        kind=ProviderKind.LOCAL_CONTROL,
        state=ProviderState.READY,
        auth_mode=AuthMode.NONE,
        model=None,
        detail="Matched a local control intent without calling Codex.",
        duration_ms=0,
    )


def _control_decision(now_state: NowState | None, kind: str) -> Decision:
    provider = _control_provider()
    if kind == "pause":
        return Decision(
            say="先停一下，我保留当前节奏，等你下一次唤醒。",
            play=[],
            reason="用户请求暂停播放。",
            segue="当前输出已收住。",
            mood=now_state.mood if now_state else "quiet",
            mode="music-only",
            provider=provider,
        )
    if kind == "quiet":
        return Decision(
            say="我把解说收短一点，队列也会更柔一点。",
            play=[TrackRequest(query="quiet", reason="用户明确要求更安静的氛围。")],
            reason="用户请求降低密度。",
            segue="留一点空白，让音乐自己说话。",
            mood="quiet",
            mode="music-only",
            provider=provider,
        )
    return Decision(
        say="换一首，把刚才那段收住，听一首更合适的。",
        play=[TrackRequest(query=now_state.mood if now_state else "focus", reason="延续当前心境，切到新的曲目。")],
        reason="用户请求下一首。",
        segue="下一首来了，我们听听看。",
        mood=now_state.mood if now_state else "focus",
        mode="narrated",
        provider=provider,
    )


class RouterService:
    def route(self, text: str | None, now_state: NowState | None) -> RoutedIntent:
        normalized = (text or "").strip().lower()
        if not normalized:
            return RoutedPlan()
        if re.search(r"暂停|停一下|先别放|pause|stop", normalized):
            return RoutedControl(_control_decision(now_state, "pause"))
        if re.search(r"下一首|换一首|skip|next", normalized):
            return RoutedControl(_control_decision(now_state, "next"))
        if re.search(r"安静|轻一点|quiet|soft", normalized):
            return RoutedControl(_control_decision(now_state, "quiet"))
        if re.search(r"早安|morning|清晨", normalized):
            return RoutedPlan(mood_hint="morning")
        if re.search(r"专注|focus|工作|写代码", normalized):
            return RoutedPlan(mood_hint="focus")
        if re.search(r"晚上|晚一点|夜里|evening", normalized):
            return RoutedPlan(mood_hint="evening")
        return RoutedPlan()
