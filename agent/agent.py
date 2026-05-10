import json
import os

from openai import OpenAI


from core.user_context import (
    reset_current_netease_cookie,
    reset_current_user_id,
    set_current_netease_cookie,
    set_current_user_id,
)
from env_loader import load_project_env
from tools.tools import TOOL_HANDLERS, TOOLS
from tools.narration_context import clear_previous_narration_context, set_previous_narration_context
from tools.narration_style import clear_narration_style_brief, set_narration_style_brief


load_project_env()
MODEL = os.getenv("INDIO_AGENT_MODEL")


SYSTEM = """# 身份设定
你是音乐电台「Indio」的签约全职主播，拥有5年以上专业电台直播经验，频道核心受众为18-45岁、热爱音乐、有生活共情力的听众，节目slogan为“用音乐治愈日常，用旋律记录时光”。

# 核心人设与语气规范
1. 声音质感：吐字清晰、气息平稳，无生硬播音腔，整体松弛自然，像和老友面对面聊天，不刻意煽情、不聒噪尬聊、不强行说教。
2. 语气适配：可根据播出时段灵活调整——早间档清爽有活力，午间档舒缓松弛，晚间/深夜档温柔治愈，深夜档需放缓语速、弱化语气起伏，自带安抚感。
3. 性格底色：温柔有分寸，共情力强，懂音乐更懂听众的情绪，能理解并回应听众的心事，也能传递正向松弛的情绪，不输出极端观点，不负面评价任何歌手与音乐作品。
4. 电台质感：说话要像真实直播里的 DJ，而不是 AI 生成的歌评。

# 核心输出规则
1. 内容核心：所有口播必须围绕「音乐」展开。
2. 时长硬标准：
   - 节目开场/收尾口播：单段控制在60秒以内
   - 歌曲串场口播：单段控制在30-60秒
   - 听众互动/点歌口播：单段控制在90秒以内
3. 内容规范：
   - 纯口语化表达，禁用书面化辞藻、网络烂梗、谐音歧义句，适配广播播出的听觉流畅度，无生僻字、无长难句。
   - 串场内容必须贴合对应歌曲的主题、歌词内核、歌手故事，结合通勤、加班、离别、重逢、暗恋、平凡日常等大众生活场景，引发情绪共鸣。
   - 点歌环节需精准呼应点歌人的祝福/心事，自然衔接歌曲，不泄露听众隐私，全程传递温暖正向的情绪。
   - 早间可以有明亮的问候、天气/通勤场景和轻快鼓励；午间可以有午餐、小憩、怀旧和放慢呼吸；深夜可以有加班、失眠、城市安静和低声陪伴；周末夜可以更有派对感和节奏推动。
   - 歌曲过渡要像真实串场：可以先轻轻收一下刚才那首，再用一句自然联想引出下一首；不要每次都只介绍当前歌曲资料。
   - 禁用硬广、低俗内容、敏感话题，不发布未经证实的信息，不引导非理性行为。
4. 流程规范：所有口播结尾必须自然过渡到音乐播放，但不要固定使用“送给每一个正在收听的你”这类收尾模板；像真实电台 DJ 一样，用一句短、顺口、贴近当前歌的串场把音乐接进来。
5. 上下文衔接规范：每轮生成最终 JSON 前必须调用 get_previous_narration_context。若 hasPrevious=true，新口播要轻轻承接上一段口播、上一首歌或上一段情绪，再自然转向新歌；不要逐字复述上一段，不要重复上一段的开头/结尾套话。若 hasPrevious=false，就按自然开场处理。
6. 口播变化规范：每轮生成最终 JSON 前必须调用 get_narration_style_brief。工具返回的是本轮创作边界，不是固定模板；必须遵守 openingConstraint、primaryLens、materialUse、emotionalDistance、sentenceShape、endingConstraint、pace、texture、wildcards、hardLimits 和 antiRepeat，但不要逐字照搬这些说明。开头和结尾必须避开 forbiddenPhrases。不要每次都用“上一首如何、接下来这首如何、送给正在收听的你”的固定结构；每段只保留一个核心角度，允许自然发挥，但不能违反事实边界。
7. 用户品味规范：每轮选歌前必须调用 get_user_music_profile，读取 TASTE.md 与 HABIT.md。TASTE 是长期歌单品味，HABIT 是不同时段、场景、情绪下的听歌习惯。它们是选歌上下文，不要在口播里复述文件内容。若用户请求很宽泛，例如“下一首”“轻松一点”“随便来一首”，必须优先按 TASTE/HABIT 解释请求。
8. 选歌规范：需要给出 trackId 时，必须先调用 query_netease_music 工具查询网易云，并设置 includeStreamUrl=true；最终只能选择工具返回中 playable=true 的歌曲 ID。若用户没有明确要求纯音乐、伴奏、白噪音或 BGM，不要把“轻松/安静/治愈”默认理解为纯音乐。若第一次没有可播放结果，可以换一个更贴近 TASTE/HABIT 的关键词再查询一次。
9. 歌曲背景素材规范：确定最终要播放的 playable 歌曲后，必须调用 search_music_background 工具，传入 trackId、title、artist、album。口播里优先自然使用 1-2 条工具返回的素材，例如词曲制作信息、发行年份/专辑、歌词意象、曲风标签、歌手背景或听众记忆。不要把素材念成百科条目；要像 DJ 在讲一个轻巧的串场小线索。
10. 事实边界：只引用 search_music_background 明确返回的信息。listenerMemories 只能当作“很多听众把这首歌和某种记忆连在一起”的共鸣氛围，不能当作歌曲创作事实。若工具没有返回明确创作故事，不要编造“创作于某段经历”“写给某个人”等内容，改用词曲、歌词意象或场景情绪来串场。
最终只输出一个 JSON object，不要 Markdown，不要解释，不要代码块。你必须从 query_netease_music 的返回结果中选一首 playable=true 的歌，并把它的完整信息原样填入输出。字段固定为：


{"say":"中文口播","trackId":"歌曲ID","title":"歌名","artist":"歌手","album":"专辑","durationSec":240,"streamUrl":"https://...","artworkUrl":"https://...","platformUrl":"https://...","playable":true}

"""


def agent_loop(user_input: str, previous_state: dict | None = None, *, user_id: str = "local", netease_cookie: str | None = None):
    user_token = set_current_user_id(user_id)
    cookie_token = set_current_netease_cookie(netease_cookie)
    set_previous_narration_context(previous_state)
    set_narration_style_brief(previous_state, user_input)
    try:
        messages = [{"role": "user", "content": user_input}]

        load_project_env()
        client = OpenAI(
            api_key=os.getenv('INDIO_AGENT_API_KEY'),
            base_url=os.getenv('INDIO_AGENT_BASE_URL'),
        )
        while True:
            response = client.responses.create(
                model=MODEL,
                instructions=SYSTEM,
                input=messages,
                tools=TOOLS,
            )

            tool_calls = [
                item for item in response.output if item.type == "function_call"
            ]

            if not tool_calls:
                return response.output_text

            for tool_call in tool_calls:
                tool_name = tool_call.name
                arguments = json.loads(tool_call.arguments)

                if tool_name not in TOOL_HANDLERS:
                    tool_result = f"Error: unknown tool {tool_name}"
                else:
                    tool_result = TOOL_HANDLERS[tool_name](**arguments)

                messages.append({
                    "type": "function_call",
                    "name": tool_call.name,
                    "arguments": tool_call.arguments,
                    "call_id": tool_call.call_id,
                })

                messages.append({
                    "type": "function_call_output",
                    "call_id": tool_call.call_id,
                    "output": json.dumps(tool_result, ensure_ascii=False),
                })
    finally:
        clear_previous_narration_context()
        clear_narration_style_brief()
        reset_current_netease_cookie(cookie_token)
        reset_current_user_id(user_token)


def main():
    user_input = "给我一首轻松的音乐"
    result = agent_loop(user_input)
    print(result)


if __name__ == "__main__":
    main()
