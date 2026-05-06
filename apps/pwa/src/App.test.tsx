import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, listener: (event: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/bootstrap")) {
      return {
        ok: true,
        json: async () => ({
          now: null,
          plan: [],
          music: {
            configured: false,
            provider: "fallback",
            baseUrl: null,
            cookieConfigured: false,
            unblockEnabled: false,
            loggedIn: false,
            user: null,
            playlists: [],
            libraryTrackCount: 0,
            loginSession: null,
            detail: null
          },
          codex: {
            authSource: "shared-cli",
            projectApiKeyConfigured: false,
            projectApiKeyLabel: null,
            compatibleApiKeyConfigured: false,
            compatibleApiKeyLabel: null,
            compatibleBaseUrl: "https://api.openai.com/v1",
            compatibleModel: "gpt-5.4-mini",
            compatibleResponseFormat: "json-object"
          },
          codexStatus: {
            kind: "codex-cli",
            state: "ready",
            authMode: "api-key",
            model: "gpt-5.4-mini",
            detail: "Authenticated via API key.",
            durationMs: 0
          },
          tts: {
            configured: false,
            provider: "tts-disabled",
            format: "mp3",
            voiceConfigured: false,
            detail: null
          }
        })
      };
    }

    throw new Error(`Unexpected fetch ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  MockWebSocket.instances = [];
});

describe("App", () => {
  it("renders the immersive standby first screen", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("等待开播")).toBeInTheDocument();
    });

    expect(screen.getByText("Personal Record Radio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "控制台" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "连接网易云" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "控制台" }));

    expect(screen.getByRole("button", { name: "连接网易云" })).toBeInTheDocument();
  });
});
