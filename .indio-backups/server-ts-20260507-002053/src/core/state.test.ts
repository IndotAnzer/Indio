import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { StateStore } from "./state.js";

let tempDirs: string[] = [];

function createStore() {
  return mkdtemp(resolve(tmpdir(), "indio-state-")).then((dir) => {
    tempDirs.push(dir);
    const config = {
      stateDbPath: resolve(dir, "state.db")
    } as AppConfig;
    return new StateStore(config);
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("StateStore", () => {
  it("persists messages, plans, and closes cleanly", async () => {
    const store = await createStore();

    store.saveMessage("user", "hello", { source: "test" });
    store.replacePlan("2026-04-25", [
      {
        id: "wake",
        slot: "07:00",
        title: "清晨校准",
        summary: "ready",
        status: "ready"
      }
    ]);

    expect(store.listRecentMessages(1)[0]?.content).toBe("hello");
    expect(store.getPlan("2026-04-25")).toHaveLength(1);

    store.close();
  });
});
