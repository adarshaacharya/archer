import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  appendPromptHistoryEntry,
  getDatabasePath,
  listPromptHistory,
  resetStorageForTests,
} from "./index.js";

afterEach(() => {
  resetStorageForTests();
  rmSync(getDatabasePath(), { force: true });
  rmSync(`${getDatabasePath()}-shm`, { force: true });
  rmSync(`${getDatabasePath()}-wal`, { force: true });
});

describe("prompt history storage", () => {
  test("persists text-only prompt history by project root", async () => {
    const projectRoot = `/tmp/archer-prompt-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await appendPromptHistoryEntry({
      id: `prompt-a-${Date.now()}`,
      projectRoot,
      sessionId: "session-a",
      text: "first prompt",
      createdAt: Date.now() - 1000,
    });
    await appendPromptHistoryEntry({
      id: `prompt-b-${Date.now()}`,
      projectRoot,
      sessionId: "session-b",
      text: "second prompt",
      createdAt: Date.now(),
    });
    await appendPromptHistoryEntry({
      id: `prompt-other-${Date.now()}`,
      projectRoot: `${projectRoot}-other`,
      sessionId: "session-c",
      text: "other prompt",
      createdAt: Date.now(),
    });

    expect(await listPromptHistory(projectRoot)).toEqual(["first prompt", "second prompt"]);
    expect(await listPromptHistory(projectRoot, 1)).toEqual(["second prompt"]);
  });
});
