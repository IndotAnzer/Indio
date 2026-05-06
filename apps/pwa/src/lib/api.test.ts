import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("returns parsed JSON for successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    }));

    await expect(requestJson("/health")).resolves.toEqual({ ok: true });
  });

  it("surfaces API error payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "not ready" })
    }));

    await expect(requestJson("/api/chat")).rejects.toThrow("not ready");
  });
});
