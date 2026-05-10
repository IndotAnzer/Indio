from tools.netease_music import query_netease_music
from tools.music_background import search_music_background
from tools.music_profile import get_user_music_profile
from tools.narration_context import get_previous_narration_context
from tools.narration_style import get_narration_style_brief

TOOLS = [
    {
        "type": "function",
        "name": "get_previous_narration_context",
        "description": "Return the previous radio segment's narration and track context so the next DJ narration can make a natural transition instead of starting abruptly.",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "get_narration_style_brief",
        "description": "Return this segment's randomized creative constraints, pacing, sentence shape, material-use rules, and anti-repeat guidance so consecutive DJ narrations stay varied without forcing a fixed template.",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "get_user_music_profile",
        "description": "Return distilled user music preference files TASTE.md and HABIT.md. Use before choosing a track so broad requests follow the user's long-term taste and time/scene habits.",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "query_netease_music",
        "description": "Search Netease Cloud Music and return candidate songs. When includeStreamUrl is true, each result is resolved to a playable stream URL when available.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Song name, artist, mood, or natural language search keywords.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of tracks to return, from 1 to 10.",
                    "minimum": 1,
                    "maximum": 10,
                    "default": 6,
                },
                "includeStreamUrl": {
                    "type": "boolean",
                    "description": "Whether to resolve playable stream URLs for the returned tracks.",
                    "default": True,
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "search_music_background",
        "description": "Search for song background material for radio narration, including release facts, credits, lyric imagery, style tags, artist context, and listener memories. Use after choosing the playable track.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Selected song title.",
                },
                "artist": {
                    "type": "string",
                    "description": "Selected song artist.",
                },
                "album": {
                    "type": "string",
                    "description": "Selected song album, when available.",
                },
                "trackId": {
                    "type": "string",
                    "description": "Selected Netease song ID, when available.",
                },
            },
            "required": ["title", "artist"],
            "additionalProperties": False,
        },
    }
]

TOOL_HANDLERS = {
    "get_previous_narration_context": get_previous_narration_context,
    "get_narration_style_brief": get_narration_style_brief,
    "get_user_music_profile": get_user_music_profile,
    "query_netease_music": query_netease_music,
    "search_music_background": search_music_background,
}
