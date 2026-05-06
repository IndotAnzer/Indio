import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  pwaUrl: string;
  rootDir: string;
  userDir: string;
  promptPath: string;
  cacheDir: string;
  dataDir: string;
  stateDbPath: string;
  codexMode: string;
  codexCliCommand: string;
  codexModel: string | null;
  codexReasoningEffort: string;
  codexExecTimeoutMs: number;
  codexHomeDir: string;
  codexProxyUrl: string | null;
  codexDecisionSchemaPath: string;
  codexNarrationSchemaPath: string;
  neteaseApiBaseUrl: string;
  neteaseCookie: string | null;
  neteasePlaybackLevel: string;
  neteaseEnableUnblock: boolean;
  neteaseUnblockSource: string | null;
  mimoApiKey: string | null;
  mimoBaseUrl: string;
  mimoProxyUrl: string | null;
  mimoTtsModel: string;
  mimoTtsVoice: string | null;
  mimoTtsFormat: string;
}

function normalizeMimoTtsVoice(value: string | undefined): string {
  const voice = value?.trim();

  if (!voice || voice.toLowerCase() === "chloe" || voice === "default_zh") {
    return "茉莉";
  }

  return voice;
}

export function loadConfig(): AppConfig {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(currentDir, "../..");
  const config: AppConfig = {
    host: process.env.INDIO_HOST ?? "0.0.0.0",
    port: Number(process.env.INDIO_PORT ?? 8787),
    publicBaseUrl: process.env.INDIO_PUBLIC_BASE_URL ?? "http://localhost:8787",
    pwaUrl: process.env.INDIO_PWA_URL ?? "http://localhost:5173",
    rootDir,
    userDir: resolve(rootDir, "user"),
    promptPath: resolve(rootDir, "server/prompts/dj-persona.md"),
    cacheDir: resolve(rootDir, "server/cache/tts"),
    dataDir: resolve(rootDir, "server/data"),
    stateDbPath: resolve(rootDir, "server/data/state.db"),
    codexMode: process.env.CODEX_MODE ?? "oauth-cli",
    codexCliCommand: process.env.CODEX_CLI_COMMAND ?? "codex",
    codexModel: process.env.CODEX_MODEL?.trim() || "gpt-5.4-mini",
    codexReasoningEffort: process.env.CODEX_REASONING_EFFORT ?? "low",
    codexExecTimeoutMs: Number(process.env.CODEX_EXEC_TIMEOUT_MS ?? 45000),
    codexHomeDir: process.env.CODEX_HOME ?? resolve(homedir(), ".codex"),
    codexProxyUrl:
      process.env.CODEX_PROXY_URL?.trim() ||
      process.env.HTTPS_PROXY?.trim() ||
      process.env.HTTP_PROXY?.trim() ||
      process.env.ALL_PROXY?.trim() ||
      null,
    codexDecisionSchemaPath: resolve(rootDir, "server/schemas/codex-decision.schema.json"),
    codexNarrationSchemaPath: resolve(rootDir, "server/schemas/codex-narration.schema.json"),
    neteaseApiBaseUrl: process.env.NETEASE_API_BASE_URL ?? "http://localhost:3000",
    neteaseCookie: process.env.NETEASE_COOKIE?.trim() || null,
    neteasePlaybackLevel: process.env.NETEASE_PLAYBACK_LEVEL ?? "standard",
    neteaseEnableUnblock: (process.env.NETEASE_ENABLE_UNBLOCK ?? "true").toLowerCase() === "true",
    neteaseUnblockSource: process.env.NETEASE_UNBLOCK_SOURCE?.trim() || null,
    mimoApiKey: process.env.MIMO_API_KEY?.trim() || null,
    mimoBaseUrl: process.env.MIMO_BASE_URL ?? "https://api.xiaomimimo.com/v1",
    mimoProxyUrl: process.env.MIMO_PROXY_URL?.trim() || null,
    mimoTtsModel: process.env.MIMO_TTS_MODEL ?? "mimo-v2.5-tts",
    mimoTtsVoice: normalizeMimoTtsVoice(process.env.MIMO_TTS_VOICE),
    mimoTtsFormat: process.env.MIMO_TTS_FORMAT ?? "wav"
  };

  mkdirSync(config.cacheDir, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });

  return config;
}
