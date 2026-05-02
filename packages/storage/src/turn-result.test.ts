import { afterEach, describe, expect, test } from "bun:test";
import {
  appendTurnResult,
  createSession,
  deleteSession,
  getTurnResults,
} from "./index.js";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  for (const sessionId of createdSessionIds) {
    await deleteSession(sessionId);
  }
  createdSessionIds.clear();
});

function makeSessionId(label: string): string {
  return `turn-result-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestSession(label: string): Promise<string> {
  const sessionId = makeSessionId(label);
  createdSessionIds.add(sessionId);
  await createSession({
    id: sessionId,
    title: label,
    cwd: "/tmp/xeq-test",
    project_root: "/tmp/xeq-test",
    provider: "openai",
    model: "gpt-4o-mini",
  });
  return sessionId;
}

describe("turn result storage", () => {
  test("persists summaries and supports limiting recent results", async () => {
    const sessionId = await createTestSession("persist");

    await appendTurnResult({
      id: `${sessionId}-t1`,
      sessionId,
      turnKind: "commit",
      intent: "research",
      status: "completed",
      task: "Inspect current compaction state",
      summary: { steps: 3, durationMs: 1200 },
      message: "Research completed",
      createdAt: Date.now() - 2000,
    });

    await appendTurnResult({
      id: `${sessionId}-t2`,
      sessionId,
      turnKind: "compact",
      intent: "change",
      status: "failed",
      task: "Patch verification flow",
      summary: { steps: 6, durationMs: 5400 },
      message: "Verification failed",
      createdAt: Date.now() - 1000,
    });

    const all = await getTurnResults(sessionId);
    expect(all).toHaveLength(2);
    expect(all[0]?.turnKind).toBe("commit");
    expect(all[0]?.intent).toBe("research");
    expect(all[0]?.summary).toEqual({ steps: 3, durationMs: 1200 });
    expect(all[1]?.status).toBe("failed");
    expect(all[1]?.turnKind).toBe("compact");
    expect(all[1]?.message).toBe("Verification failed");

    const recent = await getTurnResults(sessionId, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.task).toBe("Patch verification flow");
    expect(recent[0]?.summary).toEqual({ steps: 6, durationMs: 5400 });
  });
});
