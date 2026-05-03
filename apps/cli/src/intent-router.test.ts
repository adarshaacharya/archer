import { describe, expect, it } from "bun:test";
import { inferExplicitIntent, planPreRoute, prerouteInput } from "./intent-router.js";

describe("prerouteInput", () => {
  it("short-circuits casual greetings to direct answers", () => {
    expect(prerouteInput("how are you")).toMatchObject({
      mode: "direct-answer",
      shouldQuery: false,
      source: "fast-path",
    });
    expect(prerouteInput("yo")).toMatchObject({
      mode: "direct-answer",
      shouldQuery: false,
      source: "fast-path",
    });
  });

  it("keeps general knowledge questions out of repository scanning", () => {
    expect(prerouteInput("what is rust")).toBeNull();
  });

  it("keeps only obvious repository markers in the deterministic fast-path", () => {
    expect(prerouteInput("where is turn routing implemented")).toBeNull();
    expect(prerouteInput("check codex and claude once")).toBeNull();
    expect(prerouteInput("open apps/cli/src/task-runner.ts")).toMatchObject({
      mode: "repo-context",
      shouldQuery: true,
      source: "fast-path",
    });
    expect(prerouteInput("what changed in this repo")).toBeNull();
  });

  it("detects explicit code change requests early", () => {
    expect(prerouteInput("fix the task router")).toMatchObject({
      mode: "change",
      shouldQuery: true,
      source: "fast-path",
    });
    expect(prerouteInput("please add a pre-router before research")).toMatchObject({
      mode: "change",
      shouldQuery: true,
      source: "fast-path",
    });
  });
});

describe("planPreRoute", () => {
  it("returns a classifier plan for ambiguous prompts", () => {
    expect(planPreRoute("what is rust")).toEqual({
      status: "needs-classification",
      rationale: "ambiguous input should be classified before any repository inspection",
      allowedToolNames: ["submitTurnDecision"],
    });
  });
});

describe("inferExplicitIntent", () => {
  it("maps prerouting decisions to turn intents", () => {
    expect(inferExplicitIntent("fix the router")).toBe("change");
    expect(inferExplicitIntent("what is rust")).toBeNull();
    expect(inferExplicitIntent("where is the runtime loop")).toBeNull();
  });
});
