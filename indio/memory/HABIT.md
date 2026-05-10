# HABIT

## Snapshot
- Recent habit evidence only includes songs selected after the user sent a message to the radio.
- Automatic advance / prepared-next playback is excluded from habit evidence.
- Observed user requests: "随便推荐一首歌".
- Observed selected tracks: 陈奕迅 - 富士山下, 陈奕迅 - 好久不见.

## Time Patterns
- Friday morning around 05:32-05:34: two broad recommendation requests.
- Saturday afternoon around 16:46: one broad recommendation request.

## Request Interpretation
- "随便推荐一首歌" is a user-initiated radio request, not a demand for random exploration.
- With no explicit mood or genre, recent user-initiated requests landed on recognizable Mandarin vocal pop.

## Transition Habits
- No transition habit is established from the filtered evidence yet.
- Do not infer skip tolerance, repetition tolerance, or session pacing from automatic advance playback.

## Negative Signals
- Automatic "下一首" events are not user habit evidence.
- Do not treat agent-selected continuation tracks as proof of user preference.

## Operating Rules
1. Record HABIT only from user messages sent to the radio.
2. Use automatic advance tracks for playback flow only; do not use them to infer habits.
3. For broad user-initiated requests, prefer taste-fit vocal tracks while respecting the explicit user message first.
