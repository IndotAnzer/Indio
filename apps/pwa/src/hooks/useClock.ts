import { useEffect, useState } from "react";
import { currentClockLabel } from "../lib/format";

export function useClock(): string {
  const [clockText, setClockText] = useState(currentClockLabel);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockText(currentClockLabel());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return clockText;
}
