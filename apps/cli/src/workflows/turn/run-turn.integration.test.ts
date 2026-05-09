import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SessionState } from "../../features/sessions/session-state.js";
import { runTurnWithDeps } from "./run-turn.js";

const runTaskMock = mock(async () => ({
  status: "completed" as const,
  intent: "question" as const,
  task: "what is the code doing right now",
  summary: {
    success: true,
    steps: 7,
    durationMs: 1200,
    promptTokens: 100,
    completionTokens: 50,
    estimatedCostUsd: 0.01,
  },
}));

const appendTurnResultMock = mock(async () => {});
const getTurnResultsMock = mock(async () => []);
const maybePruneSessionBeforeTurnMock = mock(async () => ({
  prunedCount: 0,
  modelMessagesPruned: 0,
  artifactCreated: false,
}));
const resetSessionByIdMock = mock(() => {});

function createState(): SessionState {
  return {
    sessionId: "session_test",
    sessionTitle: "test",
    projectRoot: "/tmp/project",
    approvalMode: "workspace-write",
    provider: "openai",
    modelId: "gpt-4o-mini",
    authSource: null,
    webProvider: null,
    webAuthSource: null,
    openHarnessConfig: {
      projectInstructions: true,
      skills: { paths: [] },
      subagents: { enabled: true },
    },
  };
}

function createTui() {
  return {
    renderApprovalPrompt: mock(() => {}),
    renderAssistantMessage: mock(() => {}),
  } as unknown as {
    renderApprovalPrompt: ReturnType<typeof mock>;
    renderAssistantMessage: ReturnType<typeof mock>;
  };
}

describe("runTurn integration", () => {
  beforeEach(() => {
    runTaskMock.mockClear();
    appendTurnResultMock.mockClear();
    getTurnResultsMock.mockClear();
    maybePruneSessionBeforeTurnMock.mockClear();
    resetSessionByIdMock.mockClear();
  });

  it("runs normal turns through the main task runner with the default intent", async () => {
    const tui = createTui();
    const state = createState();

    const result = await runTurnWithDeps(
      {
        getTurnResults: getTurnResultsMock as never,
        maybePruneSessionBeforeTurn: maybePruneSessionBeforeTurnMock as never,
        resetSessionById: resetSessionByIdMock as never,
        runTask: runTaskMock as never,
        appendTurnResult: appendTurnResultMock as never,
      },
      "what is the code doing right now",
      tui as never,
      state,
    );

    expect(runTaskMock).toHaveBeenCalledTimes(1);
    const runTaskCalls = runTaskMock.mock.calls as unknown[][];
    expect(runTaskCalls[0]?.[0]).toMatchObject({
      text: "what is the code doing right now",
      mentions: [],
      attachments: [],
    });
    expect(runTaskCalls[0]?.[4]).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(appendTurnResultMock).toHaveBeenCalledTimes(1);
    const appendTurnResultCalls = appendTurnResultMock.mock.calls as unknown[][];
    expect(appendTurnResultCalls[0]?.[0]).toMatchObject({
      sessionId: "session_test",
      intent: "question",
      status: "completed",
      task: "what is the code doing right now",
    });
  });

  it("runs non-empty input through the main task runner without CLI intent inference", async () => {
    const tui = createTui();
    const state = createState();

    const result = await runTurnWithDeps(
      {
        getTurnResults: getTurnResultsMock as never,
        maybePruneSessionBeforeTurn: maybePruneSessionBeforeTurnMock as never,
        resetSessionById: resetSessionByIdMock as never,
        runTask: runTaskMock as never,
        appendTurnResult: appendTurnResultMock as never,
      },
      "yo",
      tui as never,
      state,
    );

    expect(runTaskMock).toHaveBeenCalledTimes(1);
    const runTaskCalls = runTaskMock.mock.calls as unknown[][];
    expect(runTaskCalls[0]?.[0]).toMatchObject({
      text: "yo",
      mentions: [],
      attachments: [],
    });
    expect(runTaskCalls[0]?.[4]).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(tui.renderAssistantMessage).not.toHaveBeenCalled();
    expect(appendTurnResultMock).toHaveBeenCalledTimes(1);
  });

  it("resets cached session state when pre-turn compaction changes history", async () => {
    const tui = createTui();
    const state = createState();
    maybePruneSessionBeforeTurnMock.mockResolvedValueOnce({
      prunedCount: 2,
      modelMessagesPruned: 1,
      artifactCreated: true,
    });

    await runTurnWithDeps(
      {
        getTurnResults: getTurnResultsMock as never,
        maybePruneSessionBeforeTurn: maybePruneSessionBeforeTurnMock as never,
        resetSessionById: resetSessionByIdMock as never,
        runTask: runTaskMock as never,
        appendTurnResult: appendTurnResultMock as never,
      },
      "what is the code doing right now",
      tui as never,
      state,
    );

    expect(resetSessionByIdMock).toHaveBeenCalledTimes(1);
    expect(resetSessionByIdMock).toHaveBeenCalledWith("session_test");
    expect(tui.renderApprovalPrompt).toHaveBeenCalled();
  });

  it("persists turn results with the original task text", async () => {
    const tui = createTui();
    const state = createState();

    await runTurnWithDeps(
      {
        getTurnResults: getTurnResultsMock as never,
        maybePruneSessionBeforeTurn: maybePruneSessionBeforeTurnMock as never,
        resetSessionById: resetSessionByIdMock as never,
        runTask: runTaskMock as never,
        appendTurnResult: appendTurnResultMock as never,
      },
      "yo",
      tui as never,
      state,
    );

    const appendTurnResultCalls = appendTurnResultMock.mock.calls as unknown[][];
    expect(appendTurnResultCalls[0]?.[0]).toMatchObject({
      sessionId: "session_test",
      intent: "question",
      status: "completed",
      task: "what is the code doing right now",
    });
  });

  it("still clarifies truly empty input", async () => {
    const tui = createTui();
    const state = createState();

    const result = await runTurnWithDeps(
      {
        getTurnResults: getTurnResultsMock as never,
        maybePruneSessionBeforeTurn: maybePruneSessionBeforeTurnMock as never,
        resetSessionById: resetSessionByIdMock as never,
        runTask: runTaskMock as never,
        appendTurnResult: appendTurnResultMock as never,
      },
      "   ",
      tui as never,
      state,
    );

    expect(runTaskMock).not.toHaveBeenCalled();
    expect(result.status).toBe("clarify");
    expect(tui.renderAssistantMessage).toHaveBeenCalledTimes(1);
    const appendTurnResultCalls = appendTurnResultMock.mock.calls as unknown[][];
    expect(appendTurnResultCalls[0]?.[0]).toMatchObject({
      sessionId: "session_test",
      intent: "question",
      status: "clarify",
      task: "",
    });
  });
});
