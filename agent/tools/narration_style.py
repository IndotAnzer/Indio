from __future__ import annotations

from contextvars import ContextVar
from random import SystemRandom
from typing import Any


_rng = SystemRandom()
_narration_style_brief: ContextVar[dict[str, Any] | None] = ContextVar(
    "narration_style_brief",
    default=None,
)


_OPENING_CONSTRAINTS = [
    "开头不要提歌名，先从一个可以听见或看见的细节进入。",
    "开头不要承接上一首歌名，只承接上一段留下的情绪。",
    "开头直接进入当下场景，不问候、不铺垫。",
    "开头用半句话制造一点悬念，但不要像标题党。",
    "开头先说一个很短的判断，后面再让歌曲补足。",
    "开头像主播临场想到的一句旁白，不要像正式介绍。",
    "开头不要出现“你”，先让画面自己站住。",
]

_PRIMARY_LENSES = [
    "声音质感：只抓一个编曲、人声、节奏或前奏细节。",
    "生活画面：只抓一个很小的日常瞬间，不展开成散文。",
    "歌词意象：只借一个歌词画面或主题意象，不逐句解释。",
    "歌曲事实：只使用一条 search_music_background 返回的事实，像顺口提到一样自然。",
    "听众处境：只照顾正在收听的人此刻可能的状态，不过度煽情。",
    "情绪转向：只处理上一段到新歌之间的氛围变化。",
    "留白感：少解释，把未说完的部分交给音乐。",
]

_MATERIAL_USE = [
    "背景素材最多用一条，藏进半句里，不要列资料。",
    "如果有歌词意象，优先用意象；没有就用声音细节。",
    "不要使用创作背景，除非工具明确返回 storySnippets。",
    "这段可以完全不用背景素材，只用歌曲情绪和播放场景。",
    "使用 listenerMemories 时，只说共鸣氛围，不当成事实。",
]

_EMOTIONAL_DISTANCE = [
    "离听众近一点，像隔着桌面轻声说话。",
    "离作品近一点，多听歌本身，少讲人生道理。",
    "保持一点距离，不替听众下结论。",
    "轻一点，允许一句话说完就停。",
    "暖一点，但不要使用祝福模板。",
]

_SENTENCE_PLANS = [
    {"maxSentences": 2, "sentenceShape": "1 到 2 句；第一句不超过 18 个汉字，第二句把歌接进来。"},
    {"maxSentences": 2, "sentenceShape": "2 句；一句画面，一句播放动作。"},
    {"maxSentences": 3, "sentenceShape": "最多 3 句；短、短、稍长，末句不要超过 30 个汉字。"},
    {"maxSentences": 3, "sentenceShape": "最多 3 句；允许一个轻问句，其余都用陈述句。"},
    {"maxSentences": 1, "sentenceShape": "只写 1 句，像真实电台里很干净的一次交接。"},
]

_ENDING_CONSTRAINTS = [
    "结尾像按下播放键，不要说“请欣赏”。",
    "结尾停在一个动作或声音上，不做总结。",
    "结尾不要祝福听众，把空间留给歌曲。",
    "结尾不要重复歌名，让音乐自己进来。",
    "结尾只做轻轻一推，不拔高意义。",
]

_PACES = [
    "轻快一点，像两首歌之间的顺手交接。",
    "放慢一点，留一点呼吸和空白。",
    "中等语速，干净、稳，不拖泥带水。",
    "低声一点，适合夜里或独处时听。",
]

_TEXTURES = [
    "更像直播间里的即兴口播。",
    "更像深夜电台的低声陪伴。",
    "更像朋友随手分享一首歌。",
    "更像专业主播的短串场。",
    "更像听完前奏后自然冒出的一句话。",
]

_OPENING_AVOIDANCE = [
    "接下来",
    "下面这首歌",
    "刚才我们听到",
    "如果说",
    "在这个",
    "这首歌",
    "送给每一个",
]

_ENDING_AVOIDANCE = [
    "让我们一起聆听",
    "希望你会喜欢",
    "送给每一个正在收听的你",
    "接下来请欣赏",
    "一起进入这首歌",
]

_WILDCARDS = [
    "整段不要使用“治愈”这个词。",
    "整段不要出现“故事”这个词，除非工具返回了明确故事素材。",
    "不要用排比。",
    "不要用比喻，只用具体声音或动作。",
    "不要说“我们”，像一对一陪伴。",
    "不要说“我”，把注意力放回歌曲。",
    "不要先解释为什么选这首，先让情绪出现。",
]


def set_narration_style_brief(
    previous_state: dict[str, Any] | None = None,
    user_input: str | None = None,
) -> None:
    _narration_style_brief.set(_make_brief(previous_state, user_input))


def clear_narration_style_brief() -> None:
    _narration_style_brief.set(None)


def get_narration_style_brief() -> dict[str, Any]:
    brief = _narration_style_brief.get()
    if not brief:
        brief = _make_brief(None, None)
        _narration_style_brief.set(brief)

    return {
        "ok": True,
        **brief,
        "usageGuidance": [
            "这些是本轮创作边界，不是模板；不要逐字照搬 constraint 文案。",
            "只选一个主角度来写，其他素材只服务这个角度。",
            "可以有自然发挥，但不能违反 hardLimits、antiRepeat 和 forbiddenPhrases。",
            "如果创作边界和歌曲背景素材冲突，优先保证事实准确和口语自然。",
        ],
    }


def _make_brief(
    previous_state: dict[str, Any] | None,
    user_input: str | None,
) -> dict[str, Any]:
    sentence_plan = dict(_rng.choice(_SENTENCE_PLANS))
    primary_lens = _rng.choice(_PRIMARY_LENSES)
    previous_opening = _previous_opening(previous_state)
    previous_sentence_count = _previous_sentence_count(previous_state)

    avoid_openings = _sample(_OPENING_AVOIDANCE, 4)
    if previous_opening:
        avoid_openings.append(previous_opening)

    anti_repeat = [
        "不要复用上一段的开头句式、结尾动作或叙述顺序。",
        "如果上一段介绍了资料，这段优先写声音或场景；如果上一段写了场景，这段优先写声音、歌词意象或干净交接。",
    ]
    if previous_sentence_count:
        anti_repeat.append(f"上一段大约 {previous_sentence_count} 句，这段不要写成同样的句数和节奏。")

    return {
        "briefType": "creative-constraints",
        "openingConstraint": _rng.choice(_OPENING_CONSTRAINTS),
        "primaryLens": primary_lens,
        "materialUse": _material_use_for(primary_lens),
        "emotionalDistance": _rng.choice(_EMOTIONAL_DISTANCE),
        "sentenceShape": sentence_plan["sentenceShape"],
        "endingConstraint": _rng.choice(_ENDING_CONSTRAINTS),
        "pace": _rng.choice(_PACES),
        "texture": _rng.choice(_TEXTURES),
        "wildcards": _sample(_WILDCARDS, _rng.choice([1, 2])),
        "hardLimits": {
            "maxSentences": sentence_plan["maxSentences"],
            "maxQuestionMarks": _rng.choice([0, 1]),
            "maxBackgroundFacts": 1,
        },
        "antiRepeat": anti_repeat,
        "forbiddenPhrases": {
            "opening": avoid_openings,
            "ending": _sample(_ENDING_AVOIDANCE, 3),
        },
        "userIntentHint": _clip(user_input, 80),
    }


def _material_use_for(primary_lens: str) -> str:
    if primary_lens.startswith("歌曲事实"):
        return "背景素材最多用一条，必须来自 search_music_background 明确返回的信息，像顺口提到一样自然。"
    if primary_lens.startswith("歌词意象"):
        return "优先使用 search_music_background 返回的 lyricImages；没有歌词意象时，改用歌曲情绪，不要编造歌词。"
    if primary_lens.startswith("声音质感"):
        return "优先用声音、节奏、人声或编曲感受；背景素材只在能自然贴合这个声音细节时使用。"
    return _rng.choice(_MATERIAL_USE)


def _sample(items: list[str], count: int) -> list[str]:
    if count >= len(items):
        return list(items)
    return _rng.sample(items, count)


def _previous_opening(state: dict[str, Any] | None) -> str | None:
    if not isinstance(state, dict):
        return None
    narration = state.get("narrationText")
    if not isinstance(narration, str):
        return None
    first = narration.strip().split("，", 1)[0].split("。", 1)[0].strip()
    if len(first) < 3 or len(first) > 18:
        return None
    return first


def _previous_sentence_count(state: dict[str, Any] | None) -> int | None:
    if not isinstance(state, dict):
        return None
    narration = state.get("narrationText")
    if not isinstance(narration, str) or not narration.strip():
        return None
    count = sum(narration.count(mark) for mark in ("。", "？", "！", "?", "!"))
    return count or None


def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    value = value.strip()
    return value if len(value) <= limit else value[:limit].rstrip() + "..."
