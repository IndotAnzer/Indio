import { describe, expect, it } from "vitest";
import { RouterService } from "./router.js";

describe("RouterService", () => {
  it("routes direct playback controls locally", () => {
    const router = new RouterService();

    expect(router.route("下一首", null).kind).toBe("control");
    expect(router.route("pause", null).kind).toBe("control");
    expect(router.route("安静一点", null).kind).toBe("control");
  });

  it("extracts mood hints without creating control decisions", () => {
    const router = new RouterService();

    expect(router.route("适合写代码的专注流", null)).toEqual({
      kind: "plan",
      moodHint: "focus"
    });
  });
});
