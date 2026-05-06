import { describe, expect, it } from "vitest";
import { buildNarrationChars } from "./usePlaybackController";

describe("buildNarrationChars", () => {
  it("marks read and active narration characters while preserving spaces", () => {
    const chars = buildNarrationChars("你好 Indio", 0.5, true);

    expect(chars.some((item) => item.state === "read")).toBe(true);
    expect(chars.some((item) => item.state === "active")).toBe(true);
    expect(chars.some((item) => item.state === "space")).toBe(true);
  });
});
