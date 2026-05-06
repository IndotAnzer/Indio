import type { ContextService } from "./context.js";
import { StateStore } from "./state.js";
import type { PlanEntry } from "@indio/contracts";

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export class SchedulerService {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly state: StateStore,
    private readonly context: ContextService,
    private readonly publish: (entries: PlanEntry[]) => void
  ) {}

  async ensureTodayPlan(now = new Date()): Promise<PlanEntry[]> {
    const day = todayKey(now);
    const existing = this.state.getPlan(day);
    if (existing.length > 0) {
      return existing;
    }

    const bundle = await this.context.build({ source: "system" });
    const firstEvent = bundle.calendar[0];
    const entries: PlanEntry[] = [
      {
        id: "wake",
        slot: "07:00",
        title: "清晨校准",
        summary: bundle.weather.summary,
        status: "ready"
      },
      {
        id: "focus",
        slot: "09:00",
        title: "专注启动",
        summary: firstEvent
          ? `为「${firstEvent.title}」前留出更干净的专注声场。`
          : "把工作流平滑推入专注区。",
        status: "pending"
      },
      {
        id: "reset",
        slot: "14:00",
        title: "午后重启",
        summary: "用一段更轻的播报和更稳的节奏，把注意力拉回来。",
        status: "pending"
      },
      {
        id: "evening",
        slot: "19:00",
        title: "晚间回收",
        summary: "降低信息密度，让晚间的能量收束下来。",
        status: "pending"
      }
    ];

    this.state.replacePlan(day, entries);
    this.publish(entries);
    return entries;
  }

  start(): void {
    void this.ensureTodayPlan();
    this.intervalHandle = setInterval(() => {
      void this.ensureTodayPlan();
    }, 5 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getTodayPlan(): PlanEntry[] {
    return this.state.getPlan(todayKey());
  }
}

