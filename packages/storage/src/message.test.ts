import { afterEach, describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  appendMessage,
  buildCompactContinuationArtifact,
  createSession,
  deleteSession,
  loadCompactionEvents,
  loadEffectiveModelMessages,
  loadLatestCompactContinuationArtifact,
  loadModelMessages,
  pruneModelMessagesWithArtifact,
  replaceMessages,
  saveCompactionEvent,
  saveCompactContinuationArtifact,
} from "./index.js";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  for (const sessionId of createdSessionIds) {
    await deleteSession(sessionId);
  }
  createdSessionIds.clear();
});

function makeSessionId(label: string): string {
  return `storage-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestSession(label: string): Promise<string> {
  const sessionId = makeSessionId(label);
  createdSessionIds.add(sessionId);
  await createSession({
    id: sessionId,
    title: label,
    cwd: "/tmp/archer-test",
    project_root: "/tmp/archer-test",
    provider: "openai",
    model: "gpt-4o-mini",
  });
  return sessionId;
}

describe("storage messages", () => {
  test("persists and injects the latest compact continuation artifact", async () => {
    const sessionId = await createTestSession("artifact-injection");

    await replaceMessages(sessionId, [
      { role: "user", content: "Initial request" },
      { role: "assistant", content: "Working on src/runner.ts" },
    ] satisfies ModelMessage[]);

    await saveCompactContinuationArtifact({
      sessionId,
      artifact: {
        summary: "Previous turn modified the turn coordinator.",
        criticalFiles: ["apps/cli/src/turn-runner.ts"],
        openRisks: ["verification flow still needs tests"],
        source: "manual",
        createdAt: Date.now(),
      },
    });

    const artifact = await loadLatestCompactContinuationArtifact(sessionId);
    expect(artifact).not.toBeNull();
    expect(artifact?.summary).toContain("turn coordinator");

    const effective = await loadEffectiveModelMessages(sessionId);
    expect(effective[0]?.role).toBe("system");
    expect(typeof effective[0]?.content).toBe("string");
    expect(String(effective[0]?.content)).toContain(
      "Continuation brief from compacted prior session context:",
    );
    expect(String(effective[0]?.content)).toContain("apps/cli/src/turn-runner.ts");
  });

  test("builds compaction artifacts from older assistant transcripts", async () => {
    const sessionId = await createTestSession("artifact-build");

    await appendMessage({
      id: `${sessionId}-m1`,
      session_id: sessionId,
      role: "assistant",
      kind: "transcript",
      content:
        "Updated archer/apps/cli/src/task-runner.ts and noted warning: verification may fail without tests.",
    });
    await appendMessage({
      id: `${sessionId}-m2`,
      session_id: sessionId,
      role: "assistant",
      kind: "transcript",
      content: "Recent transcript that should stay protected.",
    });
    await appendMessage({
      id: `${sessionId}-m3`,
      session_id: sessionId,
      role: "assistant",
      kind: "transcript",
      content: "Newest transcript that should also stay protected.",
    });

    const artifact = await buildCompactContinuationArtifact({ sessionId });
    expect(artifact).not.toBeNull();
    expect(artifact?.summary).toContain("task-runner.ts");
    expect(artifact?.criticalFiles).toContain("archer/apps/cli/src/task-runner.ts");
    expect(artifact?.openRisks.some((risk) => /warning|fail/i.test(risk))).toBe(true);
  });

  test("prunes older model messages and preserves the continuation brief", async () => {
    const sessionId = await createTestSession("model-prune");

    await saveCompactContinuationArtifact({
      sessionId,
      artifact: {
        summary: "Context was compacted before this turn.",
        criticalFiles: ["apps/cli/src/task-runner.ts"],
        openRisks: ["Need to keep verification read-only"],
        source: "preturn-prune",
        createdAt: Date.now(),
      },
    });

    const messages = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index} ${"x".repeat(2000)}`,
    })) satisfies ModelMessage[];

    await replaceMessages(sessionId, messages);

    const result = await pruneModelMessagesWithArtifact({
      sessionId,
      keepRecentMessages: 2,
      minimumPruneTokens: 1,
      protectTokens: 1,
      estimateModelMessageTokens: () => 100,
    });

    expect(result.pruned).toBe(true);
    expect(result.removedCount).toBe(4);

    const nextMessages = await loadModelMessages(sessionId);
    expect(nextMessages).toHaveLength(3);
    expect(nextMessages[0]?.role).toBe("system");
    expect(String(nextMessages[0]?.content)).toContain(
      "Continuation brief from compacted prior session context:",
    );
    expect(String(nextMessages[0]?.content)).toContain("apps/cli/src/task-runner.ts");
    expect(String(nextMessages[1]?.content)).toContain("Message 4");
    expect(String(nextMessages[2]?.content)).toContain("Message 5");
  });

  test("persists explicit compaction events in session history", async () => {
    const sessionId = await createTestSession("compaction-events");

    await saveCompactionEvent({
      sessionId,
      event: {
        trigger: "context-pressure",
        status: "started",
        summary: null,
        criticalFiles: [],
        openRisks: [],
        createdAt: Date.now(),
      },
    });

    await saveCompactionEvent({
      sessionId,
      event: {
        trigger: "context-pressure",
        status: "succeeded",
        summary: "Compacted prior implementation context.",
        criticalFiles: ["apps/cli/src/task-runner.ts"],
        openRisks: ["verification still pending"],
        createdAt: Date.now() + 1,
      },
    });

    const events = await loadCompactionEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events[0]?.status).toBe("started");
    expect(events[1]?.status).toBe("succeeded");
    expect(events[1]?.criticalFiles).toContain("apps/cli/src/task-runner.ts");
  });
});
