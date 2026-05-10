import {
  INDIO_API_BASE_URL,
  INDIO_REQUEST_TIMEOUT_MS,
  cloudContainerRequestConfig,
  indioNetworkConfigError,
  shouldUseCloudContainer
} from "./config";
import { getSessionToken } from "./storage";
import type {
  AdvanceResponse,
  BootstrapResponse,
  ChatResponse,
  MusicBootstrapResponse,
  MusicLogoutResponse,
  MusicQrCheckResponse,
  MusicQrCreateResponse,
  NowResponse
} from "./types";

type HttpMethod = "GET" | "POST";

interface RequestOptions {
  method?: HttpMethod;
  data?: unknown;
  timeout?: number;
  dataType?: "json" | "text";
  responseType?: "text" | "arraybuffer";
}

export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${INDIO_API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function websocketUrl(path: string): string {
  const base = INDIO_API_BASE_URL.replace(/^http/i, "ws").replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}

const mediaFileCache = new Map<string, Promise<string>>();

export function resolveMediaUrl(url: string): Promise<string> {
  if (!url || /^https?:\/\//i.test(url)) {
    return Promise.resolve(url);
  }

  if (!shouldUseCloudContainer()) {
    return Promise.resolve(apiUrl(url));
  }

  const cached = mediaFileCache.get(url);
  if (cached) {
    return cached;
  }

  const materialized = materializeCloudContainerMedia(url);
  mediaFileCache.set(url, materialized);
  return materialized;
}

export function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const configError = indioNetworkConfigError();
  if (configError) {
    return Promise.reject(new Error(configError));
  }

  if (shouldUseCloudContainer()) {
    return callCloudContainer<T>(path, options);
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: apiUrl(path),
      method: options.method ?? "GET",
      data: options.data,
      timeout: options.timeout ?? INDIO_REQUEST_TIMEOUT_MS,
      header: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      success(response: any) {
        const status = Number(response.statusCode ?? 0);
        const payload = response.data;

        if (status >= 200 && status < 300) {
          resolve(payload as T);
          return;
        }

        const detail =
          typeof payload?.detail === "string"
            ? payload.detail
            : typeof payload?.error === "string"
              ? payload.error
              : `Request failed: ${status}`;
        reject(new Error(detail));
      },
      fail(error: any) {
        const message = error?.errMsg || "Indio API 请求失败";
        if (message.includes("domain list") || message.includes("合法域名")) {
          reject(
            new Error(
              `${message}。当前 API 域名是 ${INDIO_API_BASE_URL}，请把它加入小程序 request 合法域名，并确认线上配置使用 HTTPS。`
            )
          );
          return;
        }

        reject(new Error(message));
      }
    });
  });
}

export function requestArrayBuffer(path: string): Promise<ArrayBuffer> {
  const configError = indioNetworkConfigError();
  if (configError) {
    return Promise.reject(new Error(configError));
  }

  if (shouldUseCloudContainer()) {
    return callCloudContainer<ArrayBuffer>(path, {
      method: "GET",
      dataType: "text",
      responseType: "arraybuffer"
    });
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    wx.request({
      url: apiUrl(path),
      method: "GET",
      timeout: INDIO_REQUEST_TIMEOUT_MS,
      responseType: "arraybuffer",
      header: authHeaders(),
      success(response: any) {
        const status = Number(response.statusCode ?? 0);
        if (status >= 200 && status < 300) {
          resolve(response.data as ArrayBuffer);
          return;
        }
        reject(new Error(`Request failed: ${status}`));
      },
      fail(error: any) {
        reject(new Error(error?.errMsg || "Indio 媒体请求失败"));
      }
    });
  });
}

function callCloudContainer<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = cloudContainerRequestConfig();
  return new Promise<T>((resolve, reject) => {
    wx.cloud.callContainer({
      config: base.config,
      path: path.startsWith("/") ? path : `/${path}`,
      method: options.method ?? "GET",
      data: options.data,
      timeout: options.timeout ?? INDIO_REQUEST_TIMEOUT_MS,
      dataType: options.dataType ?? "json",
      responseType: options.responseType ?? "text",
      header: {
        ...base.header,
        "Content-Type": "application/json",
        ...authHeaders()
      },
      success(response: any) {
        const status = Number(response.statusCode ?? 0);
        const payload = response.data;

        if (status >= 200 && status < 300) {
          resolve(payload as T);
          return;
        }

        const detail =
          typeof payload?.detail === "string"
            ? payload.detail
            : typeof payload?.error === "string"
              ? payload.error
              : `Cloud container request failed: ${status}`;
        reject(new Error(detail));
      },
      fail(error: any) {
        reject(new Error(error?.errMsg || "Indio 云托管请求失败"));
      }
    });
  });
}

async function materializeCloudContainerMedia(path: string): Promise<string> {
  const buffer = await requestArrayBuffer(path);
  const filepath = `${wx.env.USER_DATA_PATH}/${mediaCacheFilename(path)}`;
  wx.getFileSystemManager().writeFileSync(filepath, buffer);
  return filepath;
}

function mediaCacheFilename(path: string): string {
  const clean = path.split("?")[0].replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return clean || "indio-media.bin";
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return requestJson<BootstrapResponse>("/api/bootstrap");
}

export function fetchNow(): Promise<NowResponse> {
  return requestJson<NowResponse>("/api/radio/now");
}

export function fetchMusicBootstrap(): Promise<MusicBootstrapResponse> {
  return requestJson<MusicBootstrapResponse>("/api/integrations/music/bootstrap");
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
  return requestJson<ChatResponse>("/api/radio/turn/async", {
    method: "POST",
    data: { message }
  });
}

export function advanceRadio(currentSegmentId: string): Promise<AdvanceResponse> {
  return requestJson<AdvanceResponse>("/api/radio/advance", {
    method: "POST",
    data: { currentSegmentId }
  });
}
