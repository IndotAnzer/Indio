import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceRadio, fetchBootstrap, fetchNow, requestJson, submitChat } from "./api";

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

    await expect(requestJson("/api/radio/turn")).rejects.toThrow("not ready");
  });

  it("fails stuck requests with a readable timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }))
    );

    const request = expect(requestJson("/api/radio/turn")).rejects.toThrow("电台请求超时");
    await vi.advanceTimersByTimeAsync(180_000);

    await request;
    vi.useRealTimers();
  });
});

describe("radio API helpers", () => {
  it("targets the Indio radio endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchBootstrap();
    await fetchNow();
    await submitChat("来一首适合写代码的歌");
    await advanceRadio("segment-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8900/api/bootstrap",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8900/api/radio/now",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8900/api/radio/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "来一首适合写代码的歌" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://localhost:8900/api/radio/advance",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentSegmentId: "segment-1" })
      })
    );
  });
});
