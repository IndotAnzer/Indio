import { spawn } from "node:child_process";
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type {
  CodexAuthSource,
  CompatibleResponsesFormat,
  ContextBundle,
  Decision,
  ProviderInfo,
  Track,
  TrackNarrationContext
} from "@indio/contracts";
import {
  buildDecisionPrompt,
  buildNarrationPrompt,
  type CodexIntent
} from "./codex/prompt-builders.js";

export type { CodexIntent } from "./codex/prompt-builders.js";

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function tail(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function compactLines(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const text = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return text ? clip(text, 240) : null;
}

function markdownHighlights(value: string, maxItems: number, maxLength: number): string[] {
  const bullets = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, ""))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => clip(line, maxLength));

  if (bullets.length > 0) {
    return bullets;
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => clip(line, maxLength));
}

function normalizeError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
}

function sameTrack(left: Track, right: Track): boolean {
  return (left.neteaseId ?? left.id) === (right.neteaseId ?? right.id);
}

const decisionOutputSchema = z.object({
  say: z.string().min(1),
  play: z
    .array(
      z
        .object({
          query: z.string().min(1).optional(),
          trackId: z.string().min(1).optional(),
          reason: z.string().min(1)
        })
        .refine((item) => Boolean(item.query || item.trackId), "query or trackId is required")
    )
    .max(3),
  reason: z.string().min(1),
  segue: z.string().min(1),
  mood: z.string().min(1),
  mode: z.enum(["narrated", "music-only"])
});

const narrationOutputSchema = z.object({
  narration: z.string().min(1).max(520)
});

const unwantedNarrationPatterns = [
  /\d{2,3}\s*(?:BPM|拍)/i,
  /(?:作词|填词|作曲|编曲|制作人|词曲|词是|词由|曲是|曲由|曲、编|一起写(?:出|成|下|的|来)|共同写)/,
  /(?:先)?安静接住|接住(?:你|你的|听众|心事|情绪|夜色|日常|这一段)?/,
  /把.{0,12}空气.{0,12}(?:拉|放|留|收|沉|柔)|空气.{0,8}(?:拉得|自动|收拢|变松|柔下来)/,
  /(?:同一条)?气流|纹理/,
  /(?:我们)?直接(?:把)?.{0,8}接上|直接接上|把.{0,8}接上/
];

function hasUnwantedNarrationStyle(value: string): boolean {
  return unwantedNarrationPatterns.some((pattern) => pattern.test(value));
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

interface CodexAuthSettings {
  authSource: CodexAuthSource;
  projectApiKey: string | null;
  compatibleApiKey: string | null;
  compatibleBaseUrl: string;
  compatibleModel: string;
  compatibleResponseFormat: CompatibleResponsesFormat;
}

export class CodexAdapter {
  private statusCache:
    | {
        expiresAt: number;
        key: string;
        value: ProviderInfo;
      }
    | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly getAuthSettings: () => CodexAuthSettings
  ) {}

  async decide(context: ContextBundle, intent: CodexIntent = {}): Promise<Decision> {
    const authSettings = this.getAuthSettings();

    if (authSettings.authSource === "openai-compatible") {
      const startedAt = Date.now();

      try {
        const output = await this.runCompatibleResponses(
          buildDecisionPrompt(context, intent),
          this.config.codexDecisionSchemaPath,
          "indio_decision",
          20_000
        );
        const parsed = decisionOutputSchema.parse(JSON.parse(output));

        return {
          ...parsed,
          provider: this.buildProvider({
            kind: "responses-api",
            state: "ready",
            authMode: "api-key",
            model: authSettings.compatibleModel,
            detail: `Used OpenAI-compatible Responses API at ${authSettings.compatibleBaseUrl} (${authSettings.compatibleResponseFormat}).`,
            durationMs: Date.now() - startedAt
          })
        };
      } catch (error) {
        throw new Error(`兼容 Responses API 执行失败：${clip(normalizeError(error), 260)}`);
      }
    }

    if (this.config.codexMode !== "oauth-cli") {
      throw new Error(`CODEX_MODE=${this.config.codexMode}，当前没有启用 Codex CLI。`);
    }

    const loginStatus = await this.getLoginStatus(true);

    if (loginStatus.state !== "ready") {
      throw new Error(loginStatus.detail ?? "Codex CLI 尚未认证。");
    }

    const startedAt = Date.now();

    try {
      const output = await this.runCodexExec(
        buildDecisionPrompt(context, intent),
        this.config.codexDecisionSchemaPath,
        12_000
      );
      const parsed = decisionOutputSchema.parse(JSON.parse(output));
      const provider = this.buildProvider({
        kind: "codex-cli",
        state: "ready",
        authMode: loginStatus.authMode,
        model: loginStatus.model,
        detail: "Used the local Codex CLI session authenticated with OAuth.",
        durationMs: Date.now() - startedAt
      });

      this.cacheStatus(provider);

      return {
        ...parsed,
        provider
      };
    } catch (error) {
      throw new Error(`Codex CLI 执行失败：${clip(normalizeError(error), 180)}`);
    }
  }

  async getStatus(forceRefresh = false): Promise<ProviderInfo> {
    return this.getLoginStatus(forceRefresh);
  }

  async composeOnAirNarration(params: {
    context: ContextBundle;
    decision: Decision;
    nowPlaying: Track | null;
    nowPlayingContext: TrackNarrationContext | null;
    queuedTracks: Track[];
  }): Promise<string | null> {
    if (params.decision.mode === "music-only") {
      return null;
    }

    if (!params.nowPlaying) {
      return null;
    }

    const authSettings = this.getAuthSettings();

    if (authSettings.authSource === "openai-compatible") {
      try {
        const output = await this.runCompatibleResponses(
          buildNarrationPrompt({
            context: params.context,
            decision: params.decision,
            nowPlaying: params.nowPlaying,
            nowPlayingContext: params.nowPlayingContext,
            queuedTracks: params.queuedTracks
          }),
          this.config.codexNarrationSchemaPath,
          "indio_narration",
          20_000
        );
        const parsed = narrationOutputSchema.parse(JSON.parse(output));
        const narration = parsed.narration.trim();
        if (narration.length === 0 || hasUnwantedNarrationStyle(narration)) {
          return null;
        }

        return narration;
      } catch {
        return null;
      }
    }

    if (this.config.codexMode !== "oauth-cli") {
      return null;
    }

    const loginStatus = await this.getLoginStatus(true);

    if (loginStatus.state !== "ready") {
      return null;
    }

    try {
      const output = await this.runCodexExec(
        buildNarrationPrompt({
          context: params.context,
          decision: params.decision,
          nowPlaying: params.nowPlaying,
          nowPlayingContext: params.nowPlayingContext,
          queuedTracks: params.queuedTracks
        }),
        this.config.codexNarrationSchemaPath,
        12_000
      );
      const parsed = narrationOutputSchema.parse(JSON.parse(output));
      const narration = parsed.narration.trim();
      if (narration.length === 0 || hasUnwantedNarrationStyle(narration)) {
        return null;
      }

      return narration;
    } catch {
      return null;
    }
  }

  private buildProvider(params: {
    kind: ProviderInfo["kind"];
    state: ProviderInfo["state"];
    authMode: ProviderInfo["authMode"];
    model?: string | null;
    detail: string | null;
    durationMs: number | null;
  }): ProviderInfo {
    return {
      kind: params.kind,
      state: params.state,
      authMode: params.authMode,
      model: params.model ?? this.config.codexModel ?? "default",
      detail: params.detail,
      durationMs: params.durationMs
    };
  }

  private cacheStatus(value: ProviderInfo): void {
    const authSettings = this.getAuthSettings();

    this.statusCache = {
      expiresAt: Date.now() + 60_000,
      key: this.cacheKeyFor(authSettings),
      value
    };
  }

  private async getLoginStatus(forceRefresh: boolean): Promise<ProviderInfo> {
    const authSettings = this.getAuthSettings();

    if (
      !forceRefresh &&
      this.statusCache &&
      this.statusCache.expiresAt > Date.now() &&
      this.statusCache.key === this.cacheKeyFor(authSettings)
    ) {
      return this.statusCache.value;
    }

    if (this.config.codexMode !== "oauth-cli") {
      const disabled = this.buildProvider({
        kind: "fallback",
        state: "disabled",
        authMode: "none",
        detail: `CODEX_MODE=${this.config.codexMode}`,
        durationMs: 0
      });

      this.cacheStatus(disabled);
      return disabled;
    }

    if (authSettings.authSource === "openai-compatible") {
      const compatibleError = this.validateCompatibleSettings(authSettings);
      const provider = compatibleError
        ? this.buildProvider({
            kind: "responses-api",
            state: "error",
            authMode: "api-key",
            model: authSettings.compatibleModel,
            detail: compatibleError,
            durationMs: 0
          })
        : this.buildProvider({
            kind: "responses-api",
            state: "ready",
            authMode: "api-key",
            model: authSettings.compatibleModel,
            detail: `OpenAI-compatible Responses API is configured at ${authSettings.compatibleBaseUrl} (${authSettings.compatibleResponseFormat}).`,
            durationMs: 0
          });

      this.cacheStatus(provider);
      return provider;
    }

    if (authSettings.authSource === "project-api") {
      const validatedDetail = await this.validateApiKeyAuth(authSettings.projectApiKey);

      if (validatedDetail) {
        const invalid = this.buildProvider({
          kind: "fallback",
          state: "error",
          authMode: "api-key",
          detail: validatedDetail,
          durationMs: 0
        });

        this.cacheStatus(invalid);
        return invalid;
      }

      const ready = this.buildProvider({
        kind: "codex-cli",
        state: "ready",
        authMode: "api-key",
        detail: "Using project-scoped OpenAI API key.",
        durationMs: 0
      });

      this.cacheStatus(ready);
      return ready;
    }

    try {
      const result = await this.runProcess(["login", "status"], {
        timeoutMs: 5_000,
        env: this.buildCodexEnv()
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const authMode = await this.detectAuthMode(output);

      if (result.code === 0 && authMode !== "none") {
        const validatedDetail = authMode === "api-key" ? await this.validateApiKeyAuth(this.readSharedApiKey()) : null;

        if (validatedDetail) {
          const invalid = this.buildProvider({
            kind: "fallback",
            state: "error",
            authMode,
            detail: validatedDetail,
            durationMs: 0
          });

          this.cacheStatus(invalid);
          return invalid;
        }

        const ready = this.buildProvider({
          kind: "codex-cli",
          state: "ready",
          authMode,
          detail: authMode === "chatgpt" ? "Authenticated via ChatGPT OAuth." : "Authenticated via API key.",
          durationMs: 0
        });

        this.cacheStatus(ready);
        return ready;
      }

      const fallback = this.buildProvider({
        kind: "fallback",
        state: "error",
        authMode,
        detail: compactLines(output) ?? "Run `codex login` to authenticate the local CLI.",
        durationMs: 0
      });

      this.cacheStatus(fallback);
      return fallback;
    } catch (error) {
      const failure = this.buildProvider({
        kind: "fallback",
        state: "error",
        authMode: "unknown",
        detail: `Unable to inspect Codex login status. ${clip(normalizeError(error), 180)}`,
        durationMs: 0
      });

      this.cacheStatus(failure);
      return failure;
    }
  }

  private async detectAuthMode(output: string): Promise<ProviderInfo["authMode"]> {
    const parsed = this.parseAuthMode(output);

    if (parsed !== "unknown") {
      return parsed;
    }

    try {
      const auth = JSON.parse(await readFile(resolve(this.config.codexHomeDir, "auth.json"), "utf8")) as {
        OPENAI_API_KEY?: string;
      };

      if (auth.OPENAI_API_KEY?.trim()) {
        return "api-key";
      }
    } catch {
      // Fall through to unknown.
    }

    return "unknown";
  }

  private parseAuthMode(output: string): ProviderInfo["authMode"] {
    if (/Logged in using ChatGPT/i.test(output)) {
      return "chatgpt";
    }

    if (/Logged in using (?:an )?API key/i.test(output) || /api key/i.test(output)) {
      return "api-key";
    }

    if (/not logged in|logged out/i.test(output)) {
      return "none";
    }

    return "unknown";
  }

  private async validateApiKeyAuth(apiKey: string | null): Promise<string | null> {
    try {
      return await this.validateApiKeyValue(apiKey);
    } catch (error) {
      return `Codex API key 校验失败：${clip(normalizeError(error), 180)}`;
    }
  }

  private async validateApiKeyValue(apiKey: string | null): Promise<string | null> {
    if (!apiKey) {
      return "当前没有可用的 OpenAI API key。";
    }

    const curlConfig = [
      'url = "https://api.openai.com/v1/models"',
      "silent",
      "show-error",
      "max-time = 10",
      `header = "Authorization: Bearer ${apiKey}"`
    ];

    if (this.config.codexProxyUrl) {
      curlConfig.push(`proxy = "${this.config.codexProxyUrl}"`);
    }

    return this.runBinary("curl", ["--config", "-"], {
      stdin: `${curlConfig.join("\n")}\n`,
      timeoutMs: 12_000
    }).then((result) => {
      if (result.timedOut) {
        return "OpenAI API key 校验超时，请检查代理或外网连接。";
      }

      const output = `${result.stdout}\n${result.stderr}`.trim();

      if (/invalid_api_key|Incorrect API key provided/i.test(output)) {
        return "Codex 当前使用的 OpenAI API key 无效，请重新填写。";
      }

      if (result.code !== 0) {
        return `Codex API key 校验失败：${compactLines(output) ?? `curl exited with code ${String(result.code)}`}`;
      }

      return null;
    });
  }

  private async runCodexExec(
    prompt: string,
    outputSchemaPath: string,
    timeoutMs = this.config.codexExecTimeoutMs
  ): Promise<string> {
    const authSettings = this.getAuthSettings();
    const runtimeHome = await mkdtemp(join(this.config.dataDir, "codex-home-"));
    const outputPath = resolve(runtimeHome, "last-message.json");

    try {
      await this.prepareRuntimeAuth(runtimeHome, authSettings);

      const args = [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--disable",
        "plugins",
        "--disable",
        "apps",
        "--disable",
        "browser_use",
        "--disable",
        "in_app_browser",
        "--disable",
        "computer_use",
        "--disable",
        "general_analytics",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-C",
        this.config.rootDir,
        "-c",
        'approval_policy="never"',
        "-c",
        'analytics.enabled=false',
        "-c",
        'features.apps=false',
        "-c",
        'web_search="disabled"',
        "-c",
        `model_reasoning_effort="${this.config.codexReasoningEffort}"`,
        "-c",
        'model_verbosity="low"',
        "--color",
        "never",
        "--output-schema",
        outputSchemaPath,
        "-o",
        outputPath,
        "-"
      ];

      if (this.config.codexModel) {
        args.splice(4, 0, "-m", this.config.codexModel);
      }

      const env = this.buildCodexEnv(runtimeHome);

      const result = await this.runProcess(args, {
        cwd: this.config.rootDir,
        env,
        stdin: prompt,
        timeoutMs
      });

      if (result.timedOut) {
        throw new Error(`Timed out after ${timeoutMs}ms.`);
      }

      if (result.code !== 0) {
        throw new Error(
          compactLines(result.stderr) ??
            compactLines(result.stdout) ??
            `Codex exited with code ${String(result.code)}${result.signal ? ` (${result.signal})` : ""}.`
        );
      }

      const output = await readFile(outputPath, "utf8");
      return output.trim();
    } finally {
      await rm(runtimeHome, { recursive: true, force: true });
    }
  }

  private async runCompatibleResponses(
    prompt: string,
    outputSchemaPath: string,
    schemaName: string,
    timeoutMs: number
  ): Promise<string> {
    const authSettings = this.getAuthSettings();
    const compatibleError = this.validateCompatibleSettings(authSettings);

    if (compatibleError) {
      throw new Error(compatibleError);
    }

    const apiKey = authSettings.compatibleApiKey?.trim();
    if (!apiKey) {
      throw new Error("兼容接口 API key 为空。");
    }

    const schema = JSON.parse(await readFile(outputSchemaPath, "utf8"));
    const requestUrl = this.joinResponsesUrl(authSettings.compatibleBaseUrl);
    const payload = await this.postCompatibleResponses(
      requestUrl,
      apiKey,
      this.buildResponsesRequestBody(authSettings, prompt, schemaName, schema),
      timeoutMs
    );
    const output = this.extractResponsesText(payload);

    if (!output) {
      throw new Error("Responses API returned no output text.");
    }

    return output;
  }

  private buildResponsesRequestBody(
    authSettings: CodexAuthSettings,
    prompt: string,
    schemaName: string,
    schema: unknown
  ): Record<string, unknown> {
    if (authSettings.compatibleResponseFormat === "json-schema") {
      return {
        model: authSettings.compatibleModel,
        input: prompt,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            schema,
            strict: true
          }
        }
      };
    }

    return {
      model: authSettings.compatibleModel,
      input: [
        prompt,
        "",
        `Return only one valid JSON object that matches this JSON Schema named "${schemaName}".`,
        "Do not include Markdown fences, comments, or any text outside the JSON object.",
        JSON.stringify(schema)
      ].join("\n"),
      store: false,
      text: {
        format: {
          type: "json_object"
        }
      }
    };
  }

  private async postCompatibleResponses(
    requestUrl: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const curlConfig = [
      `url = "${requestUrl}"`,
      'request = "POST"',
      "silent",
      "show-error",
      `max-time = ${Math.ceil(timeoutMs / 1000)}`,
      'header = "Content-Type: application/json"',
      `header = "Authorization: Bearer ${apiKey}"`,
      `data = ${JSON.stringify(JSON.stringify(body))}`
    ];

    if (this.config.codexProxyUrl) {
      curlConfig.push(`proxy = "${this.config.codexProxyUrl}"`);
    }

    const result = await this.runBinary("curl", ["--config", "-", "--write-out", "\n__INDIO_HTTP_STATUS__:%{http_code}"], {
      stdin: `${curlConfig.join("\n")}\n`,
      timeoutMs: timeoutMs + 2_000
    });

    if (result.timedOut) {
      throw new Error(`Responses request timed out after ${timeoutMs}ms at ${requestUrl}.`);
    }

    const marker = "\n__INDIO_HTTP_STATUS__:";
    const markerIndex = result.stdout.lastIndexOf(marker);
    const responseText = markerIndex >= 0 ? result.stdout.slice(0, markerIndex) : result.stdout;
    const statusText = markerIndex >= 0 ? result.stdout.slice(markerIndex + marker.length).trim() : "";
    const statusCode = Number(statusText);

    if (result.code !== 0) {
      throw new Error(
        `Responses request failed before HTTP response at ${requestUrl}: ${
          compactLines(result.stderr) ?? compactLines(responseText) ?? `curl exited with code ${String(result.code)}`
        }`
      );
    }

    if (!Number.isFinite(statusCode) || statusCode < 100) {
      throw new Error(`Responses request returned no HTTP status at ${requestUrl}: ${clip(responseText, 240)}`);
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Responses request failed (${statusCode}) at ${requestUrl}: ${clip(responseText, 240)}`);
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw new Error(`Responses request returned non-JSON body at ${requestUrl}: ${clip(responseText, 240)}`);
    }
  }

  private validateCompatibleSettings(authSettings: CodexAuthSettings): string | null {
    if (!authSettings.compatibleApiKey?.trim()) {
      return "兼容接口 API key 为空。";
    }

    if (!authSettings.compatibleModel?.trim()) {
      return "兼容接口模型名为空。";
    }

    if (!["json-object", "json-schema"].includes(authSettings.compatibleResponseFormat)) {
      return "兼容接口响应格式无效。";
    }

    try {
      new URL(authSettings.compatibleBaseUrl);
    } catch {
      return "兼容接口 Base URL 不是有效 URL。";
    }

    return null;
  }

  private joinResponsesUrl(baseUrl: string): string {
    const url = new URL(baseUrl);

    if (url.pathname.replace(/\/+$/, "").endsWith("/responses")) {
      return url.toString();
    }

    const normalized = url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
    return new URL("responses", normalized).toString();
  }

  private extractResponsesText(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const root = payload as {
      output_text?: unknown;
      output?: unknown;
    };

    if (typeof root.output_text === "string" && root.output_text.trim()) {
      return root.output_text.trim();
    }

    if (!Array.isArray(root.output)) {
      return null;
    }

    for (const item of root.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const value = part as { text?: unknown; type?: unknown };
        if (
          (value.type === "output_text" || value.type === "text" || typeof value.type !== "string") &&
          typeof value.text === "string" &&
          value.text.trim()
        ) {
          return value.text.trim();
        }
      }
    }

    return null;
  }

  private buildCodexEnv(runtimeHome?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env
    };

    if (runtimeHome) {
      env.CODEX_HOME = runtimeHome;
    }

    if (this.config.codexProxyUrl) {
      env.HTTP_PROXY = this.config.codexProxyUrl;
      env.HTTPS_PROXY = this.config.codexProxyUrl;
      env.ALL_PROXY = this.config.codexProxyUrl;
      env.http_proxy = this.config.codexProxyUrl;
      env.https_proxy = this.config.codexProxyUrl;
      env.all_proxy = this.config.codexProxyUrl;
      env.NO_PROXY = env.NO_PROXY ?? "127.0.0.1,localhost";
      env.no_proxy = env.no_proxy ?? "127.0.0.1,localhost";
    }

    return env;
  }

  private async prepareRuntimeAuth(runtimeHome: string, authSettings: CodexAuthSettings): Promise<void> {
    if (authSettings.authSource === "project-api") {
      if (!authSettings.projectApiKey) {
        throw new Error("项目 API key 未配置。");
      }

      await writeFile(
        resolve(runtimeHome, "auth.json"),
        JSON.stringify(
          {
            OPENAI_API_KEY: authSettings.projectApiKey
          },
          null,
          2
        ),
        "utf8"
      );
      return;
    }

    await this.copyIfPresent(resolve(this.config.codexHomeDir, "auth.json"), resolve(runtimeHome, "auth.json"));
    await this.copyIfPresent(
      resolve(this.config.codexHomeDir, "installation_id"),
      resolve(runtimeHome, "installation_id")
    );
  }

  private readSharedApiKey(): string | null {
    try {
      const auth = JSON.parse(readFileSync(resolve(this.config.codexHomeDir, "auth.json"), "utf8")) as {
        OPENAI_API_KEY?: string;
      };

      return auth.OPENAI_API_KEY?.trim() || null;
    } catch {
      return null;
    }
  }

  private cacheKeyFor(authSettings: CodexAuthSettings): string {
    return [
      authSettings.authSource,
      authSettings.projectApiKey?.slice(-6) ?? "none",
      authSettings.compatibleApiKey?.slice(-6) ?? "none",
      authSettings.compatibleBaseUrl,
      authSettings.compatibleModel,
      authSettings.compatibleResponseFormat
    ].join(":");
  }

  private async copyIfPresent(sourcePath: string, targetPath: string): Promise<void> {
    try {
      await access(sourcePath, fsConstants.F_OK);
      await copyFile(sourcePath, targetPath);
    } catch {
      // The auth file may live in a keychain-backed store instead of a file.
    }
  }

  private runProcess(
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdin?: string;
      timeoutMs: number;
    }
  ): Promise<ProcessResult> {
    return this.runBinary(this.config.codexCliCommand, args, options);
  }

  private runBinary(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdin?: string;
      timeoutMs: number;
    }
  ): Promise<ProcessResult> {
    return new Promise((resolveProcess, rejectProcess) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");

        setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, 500).unref();
      }, options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout = tail(stdout + chunk.toString(), 8_000);
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = tail(stderr + chunk.toString(), 12_000);
      });

      child.on("error", (error) => {
        settled = true;
        clearTimeout(timer);
        rejectProcess(error);
      });

      child.on("close", (code, signal) => {
        settled = true;
        clearTimeout(timer);
        resolveProcess({
          code,
          stdout,
          stderr,
          timedOut,
          signal
        });
      });

      if (options.stdin) {
        child.stdin.write(options.stdin);
      }

      child.stdin.end();
    });
  }
}
