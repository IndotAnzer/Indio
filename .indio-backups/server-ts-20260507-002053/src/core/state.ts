import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type {
  CodexAuthSource,
  CompatibleResponsesFormat,
  MessageRecord,
  NowState,
  PlanEntry,
  Track
} from "@indio/contracts";

interface KeyValueRow {
  value: string;
}

interface MessageRow {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata: string | null;
}

interface PlayRow {
  track_id: string;
  netease_id: string | null;
  title: string;
  artist: string;
  album: string;
  mood: string;
  duration_sec: number;
  stream_url: string | null;
  artwork_url: string | null;
  platform_url: string | null;
  playback_source: "netease" | "fallback";
}

interface PlanRow {
  id: string;
  slot: string;
  title: string;
  summary: string;
  status: "pending" | "ready" | "done";
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class StateStore {
  private readonly db: DatabaseSync;

  constructor(config: AppConfig) {
    this.db = new DatabaseSync(config.stateDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        mood TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        preview_url TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_plan (
        day TEXT NOT NULL,
        id TEXT NOT NULL,
        slot TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (day, id)
      );
    `);

    this.ensureColumn("plays", "netease_id", "TEXT");
    this.ensureColumn("plays", "artwork_url", "TEXT");
    this.ensureColumn("plays", "stream_url", "TEXT");
    this.ensureColumn("plays", "platform_url", "TEXT");
    this.ensureColumn("plays", "playback_source", "TEXT NOT NULL DEFAULT 'fallback'");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare(`
        INSERT INTO kv (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, JSON.stringify(value));
  }

  getJson<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as KeyValueRow | undefined;
    return parseJson(row?.value, fallback);
  }

  saveCodexAuthSource(source: CodexAuthSource): void {
    this.setJson("codex_auth_source", source);
  }

  getCodexAuthSource(): CodexAuthSource {
    return this.getJson<CodexAuthSource>("codex_auth_source", "shared-cli");
  }

  saveProjectCodexApiKey(apiKey: string | null): void {
    this.setJson("project_codex_api_key", apiKey);
  }

  getProjectCodexApiKey(): string | null {
    return this.getJson<string | null>("project_codex_api_key", null);
  }

  saveCompatibleCodexApiKey(apiKey: string | null): void {
    this.setJson("compatible_codex_api_key", apiKey);
  }

  getCompatibleCodexApiKey(): string | null {
    return this.getJson<string | null>("compatible_codex_api_key", null);
  }

  saveCompatibleCodexBaseUrl(baseUrl: string): void {
    this.setJson("compatible_codex_base_url", baseUrl);
  }

  getCompatibleCodexBaseUrl(): string {
    return this.getJson<string>("compatible_codex_base_url", "https://api.openai.com/v1");
  }

  saveCompatibleCodexModel(model: string): void {
    this.setJson("compatible_codex_model", model);
  }

  getCompatibleCodexModel(fallbackModel: string | null): string {
    return this.getJson<string>("compatible_codex_model", fallbackModel ?? "gpt-5.4-mini");
  }

  saveCompatibleCodexResponseFormat(format: CompatibleResponsesFormat): void {
    this.setJson("compatible_codex_response_format", format);
  }

  getCompatibleCodexResponseFormat(): CompatibleResponsesFormat {
    return this.getJson<CompatibleResponsesFormat>("compatible_codex_response_format", "json-object");
  }

  saveMessage(
    role: MessageRecord["role"],
    content: string,
    metadata?: Record<string, unknown>
  ): void {
    this.db
      .prepare(
        "INSERT INTO messages (role, content, metadata, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(role, content, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
  }

  listRecentMessages(limit = 6): MessageRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, role, content, metadata, created_at FROM messages ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as unknown as MessageRow[];

    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      metadata: parseJson<Record<string, unknown> | undefined>(row.metadata, undefined)
    }));
  }

  savePlay(track: Track, reason: string): void {
    this.db
      .prepare(
        `
          INSERT INTO plays (
            track_id,
            netease_id,
            title,
            artist,
            album,
            mood,
            duration_sec,
            stream_url,
            artwork_url,
            platform_url,
            playback_source,
            reason,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        track.id,
        track.neteaseId,
        track.title,
        track.artist,
        track.album,
        track.mood,
        track.durationSec,
        track.streamUrl,
        track.artworkUrl,
        track.platformUrl,
        track.playbackSource,
        reason,
        new Date().toISOString()
      );
  }

  listRecentPlays(limit = 5): Track[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            track_id,
            netease_id,
            title,
            artist,
            album,
            mood,
            duration_sec,
            stream_url,
            artwork_url,
            platform_url,
            playback_source
          FROM plays
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(limit) as unknown as PlayRow[];

    return rows.map((row) => ({
      id: row.track_id,
      neteaseId: row.netease_id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      mood: row.mood,
      durationSec: row.duration_sec,
      streamUrl: row.stream_url,
      artworkUrl: row.artwork_url,
      platformUrl: row.platform_url,
      playbackSource: row.playback_source
    }));
  }

  saveNowState(state: NowState): void {
    this.setJson("now_state", state);
  }

  getNowState(): NowState | null {
    return this.getJson<NowState | null>("now_state", null);
  }
  replacePlan(day: string, entries: PlanEntry[]): void {
    const deleteStatement = this.db.prepare("DELETE FROM daily_plan WHERE day = ?");
    const insertStatement = this.db.prepare(
      `
        INSERT INTO daily_plan (day, id, slot, title, summary, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    );

    this.db.exec("BEGIN");
    try {
      deleteStatement.run(day);
      for (const entry of entries) {
        insertStatement.run(day, entry.id, entry.slot, entry.title, entry.summary, entry.status);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getPlan(day: string): PlanEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, slot, title, summary, status FROM daily_plan WHERE day = ? ORDER BY slot ASC"
      )
      .all(day) as unknown as PlanRow[];

    return rows.map((row) => ({
      id: row.id,
      slot: row.slot,
      title: row.title,
      summary: row.summary,
      status: row.status
    }));
  }

  close(): void {
    this.db.close();
  }
}
