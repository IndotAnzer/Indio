import type { AppConfig } from "../../config.js";

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

export class NeteaseApiClient {
  private static readonly REQUEST_TIMEOUT_MS = 12_000;

  constructor(
    private readonly config: AppConfig,
    private readonly getActiveCookie: () => string | null
  ) {}

  async requestJson(
    path: string,
    options?: {
      withAuth?: boolean;
      cookie?: string;
    }
  ): Promise<unknown> {
    const cookie = options?.cookie ?? (options?.withAuth === false ? null : this.getActiveCookie());
    const url = new URL(path, this.config.neteaseApiBaseUrl);

    if (cookie) {
      url.searchParams.set("cookie", cookie);
    }

    let response: Response;

    try {
      response = await fetch(url, {
        headers: cookie
          ? {
              Cookie: cookie
            }
          : undefined,
        signal: AbortSignal.timeout(NeteaseApiClient.REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`Netease request timed out after ${NeteaseApiClient.REQUEST_TIMEOUT_MS}ms: ${url.pathname}`);
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(`Netease request failed (${response.status}): ${clip(await response.text(), 200)}`);
    }

    return response.json();
  }
}
