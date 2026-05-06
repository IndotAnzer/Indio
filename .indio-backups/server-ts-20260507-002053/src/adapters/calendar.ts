import type { CalendarEvent } from "@indio/contracts";

export class CalendarAdapter {
  async getEventsForToday(now = new Date()): Promise<CalendarEvent[]> {
    const isoDate = now.toISOString().slice(0, 10);

    return [
      {
        id: "standup",
        title: "项目对齐",
        startAt: `${isoDate}T09:30:00.000Z`,
        endAt: `${isoDate}T10:00:00.000Z`
      },
      {
        id: "deep-work",
        title: "深度工作块",
        startAt: `${isoDate}T13:30:00.000Z`,
        endAt: `${isoDate}T15:00:00.000Z`
      }
    ];
  }
}

