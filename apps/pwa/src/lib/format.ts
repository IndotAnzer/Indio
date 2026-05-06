export function durationLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${mins}:${rest}`;
}

export function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function currentClockLabel(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}
