import type { Decision, NowState, ProviderInfo } from "@indio/contracts";

export type RoutedIntent =
  | {
      kind: "control";
      decision: Decision;
    }
  | {
      kind: "plan";
      moodHint?: string;
      quietMode?: boolean;
    };

function buildControlDecision(nowState: NowState | null, kind: "next" | "pause" | "quiet"): Decision {
  const provider: ProviderInfo = {
    kind: "local-control",
    state: "ready",
    authMode: "none",
    model: null,
    detail: "Matched a local control intent without calling Codex.",
    durationMs: 0
  };

  if (kind === "pause") {
    return {
      say: "先停一下，我保留当前节奏，等你下一次唤醒。",
      play: [],
      reason: "用户请求暂停播放。",
      segue: "当前输出已收住。",
      mood: nowState?.mood ?? "quiet",
      mode: "music-only",
      provider
    };
  }

  if (kind === "quiet") {
    return {
      say: "我把解说收短一点，队列也会更柔一点。",
      play: [
        {
          query: "quiet",
          reason: "用户明确要求更安静的氛围。"
        }
      ],
      reason: "用户请求降低密度。",
      segue: "留一点空白，让音乐自己说话。",
      mood: "quiet",
      mode: "music-only",
      provider
    };
  }

  return {
    say: "换一首，把刚才那段收住，听一首更合适的。",
    play: [
      {
        query: nowState?.mood ?? "focus",
        reason: "延续当前心境，切到新的曲目。"
      }
    ],
    reason: "用户请求下一首。",
    segue: "下一首来了，我们听听看。",
    mood: nowState?.mood ?? "focus",
    mode: "narrated",
    provider
  };
}

export class RouterService {
  route(input: string | undefined, nowState: NowState | null): RoutedIntent {
    const normalized = input?.trim().toLowerCase();

    if (!normalized) {
      return { kind: "plan" };
    }

    if (/(暂停|停一下|先别放|pause|stop)/.test(normalized)) {
      return {
        kind: "control",
        decision: buildControlDecision(nowState, "pause")
      };
    }

    if (/(下一首|换一首|skip|next)/.test(normalized)) {
      return {
        kind: "control",
        decision: buildControlDecision(nowState, "next")
      };
    }

    if (/(安静|轻一点|quiet|soft)/.test(normalized)) {
      return {
        kind: "control",
        decision: buildControlDecision(nowState, "quiet")
      };
    }

    if (/(早安|morning|清晨)/.test(normalized)) {
      return { kind: "plan", moodHint: "morning" };
    }

    if (/(专注|focus|工作|写代码)/.test(normalized)) {
      return { kind: "plan", moodHint: "focus" };
    }

    if (/(晚上|晚一点|夜里|evening)/.test(normalized)) {
      return { kind: "plan", moodHint: "evening" };
    }

    return { kind: "plan" };
  }
}
