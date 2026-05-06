import type { WeatherSnapshot } from "@indio/contracts";

export class WeatherAdapter {
  async getSnapshot(now = new Date()): Promise<WeatherSnapshot> {
    const hour = now.getHours();

    if (hour < 8) {
      return {
        condition: "clear",
        temperatureC: 19,
        summary: "晴，19°C，清晨偏凉。"
      };
    }

    if (hour < 18) {
      return {
        condition: "cloudy",
        temperatureC: 24,
        summary: "多云，24°C，光线偏柔。"
      };
    }

    return {
      condition: "rain",
      temperatureC: 21,
      summary: "小雨，21°C，晚间偏湿。"
    };
  }
}
