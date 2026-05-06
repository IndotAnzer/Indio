import type {
  AdvanceRequest,
  AdvanceResponse,
  BootstrapResponse,
  CodexSettingsResponse,
  ChatRequest,
  ChatResponse,
  MusicBootstrapResponse,
  MusicLogoutResponse,
  MusicQrCheckResponse,
  MusicQrCreateResponse,
  NowResponse,
  UpdateCodexSettingsRequest,
  UpdateCodexSettingsResponse
} from "@indio/contracts";

export const API_BASE = import.meta.env.VITE_INDIO_API_URL ?? "http://localhost:8787";

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    try {
      const payload = (await response.json()) as { error?: string; detail?: string };
      if (payload?.error || payload?.detail) {
        throw new Error(payload.error ?? payload.detail);
      }
    } catch (error) {
      if (error instanceof Error && error.message) {
        throw error;
      }
    }

    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function resolveMediaUrl(url: string): string {
  try {
    const apiBase = new URL(API_BASE);
    const mediaUrl = new URL(url, API_BASE);
    return new URL(`${mediaUrl.pathname}${mediaUrl.search}${mediaUrl.hash}`, apiBase.origin).toString();
  } catch {
    return url;
  }
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return requestJson<BootstrapResponse>("/api/bootstrap");
}

export function fetchMusicBootstrap(): Promise<MusicBootstrapResponse> {
  return requestJson<MusicBootstrapResponse>("/api/integrations/music/bootstrap");
}

export function fetchCodexSettings(): Promise<CodexSettingsResponse> {
  return requestJson<CodexSettingsResponse>("/api/settings/codex");
}

export function fetchNow(): Promise<NowResponse> {
  return requestJson<NowResponse>("/api/radio/now");
}

export function createMusicQrLogin(): Promise<MusicQrCreateResponse> {
  return requestJson<MusicQrCreateResponse>("/api/integrations/music/login/qr", {
    method: "POST"
  });
}

export function checkMusicQrLogin(key: string): Promise<MusicQrCheckResponse> {
  return requestJson<MusicQrCheckResponse>(`/api/integrations/music/login/qr?key=${encodeURIComponent(key)}`);
}

export function logoutMusic(): Promise<MusicLogoutResponse> {
  return requestJson<MusicLogoutResponse>("/api/integrations/music/logout", {
    method: "POST"
  });
}

export function submitChat(message: string): Promise<ChatResponse> {
  const body: ChatRequest = { message };
  return requestJson<ChatResponse>("/api/radio/turn", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateCodexSettings(body: UpdateCodexSettingsRequest): Promise<UpdateCodexSettingsResponse> {
  return requestJson<UpdateCodexSettingsResponse>("/api/settings/codex", {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export function advanceRadio(currentSegmentId: string): Promise<AdvanceResponse> {
  const body: AdvanceRequest = { currentSegmentId };
  return requestJson<AdvanceResponse>("/api/radio/advance", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
