import { describe, expect, it } from "bun:test";
import {
  buildPriorTurnPlanningGuidance,
  buildQuestionStrategy,
  createQuestionExplorationState,
  evaluateQuestionAnswerReadiness,
  type QuestionExplorationState,
} from "@archer/harness";
import { prerouteInput } from "../../features/routing/intent-router.js";
import { resolveTaskExecutionRoute } from "../run-task/route.js";

function exploration(overrides: Partial<QuestionExplorationState> = {}): QuestionExplorationState {
  return { ...createQuestionExplorationState(), ...overrides };
}

describe("buildPriorTurnPlanningGuidance", () => {
  it("summarizes recent failed turns for planning", () => {
    const guidance = buildPriorTurnPlanningGuidance([
      {
        status: "failed",
        task: "fix lint errors in cli",
        summary: { steps: 52, durationMs: 4200 },
        message: "Run exceeded maxSteps=256",
      },
    ]);

    expect(guidance).toContain("Prior failed turn");
    expect(guidance).toContain("fix lint errors in cli");
    expect(guidance).toContain("steps=52");
    expect(guidance).toContain("message=Run exceeded maxSteps=256");
  });

  it("adds a caution for repeated step-heavy turns", () => {
    const guidance = buildPriorTurnPlanningGuidance([
      {
        status: "completed",
        task: "task one",
        summary: { steps: 45 },
      },
      {
        status: "completed",
        task: "task two",
        summary: { steps: 44 },
      },
    ]);

    expect(guidance).toContain("Recent turns were step-heavy");
  });
});

describe("evaluateQuestionAnswerReadiness", () => {
  it("keeps a new question exploring before evidence is gathered", () => {
    const strategy = buildQuestionStrategy("what is the project about", "question");
    const decision = evaluateQuestionAnswerReadiness(strategy, exploration());

    expect(decision.ready).toBe(false);
  });

  it("does not force-stop just because root evidence is covered", () => {
    const strategy = buildQuestionStrategy("what is the project about", "question");
    const decision = evaluateQuestionAnswerReadiness(
      strategy,
      exploration({
        manifestsDocsCovered: new Set(["package.json"]),
        filesRead: new Set(["package.json"]),
        toolCalls: 3,
      }),
    );

    expect(decision.ready).toBe(false);
  });

  it("does not force-stop just because search found and read a match", () => {
    const strategy = buildQuestionStrategy("where is turn routing implemented", "question");
    const decision = evaluateQuestionAnswerReadiness(
      strategy,
      exploration({
        searchHits: 1,
        filesRead: new Set(["apps/cli/src/turn-runner.ts"]),
        toolCalls: 2,
      }),
    );

    expect(decision.ready).toBe(false);
  });

  it("cuts off speculative misses at the exploration limit", () => {
    const strategy = buildQuestionStrategy("what is the project about", "question");
    const decision = evaluateQuestionAnswerReadiness(
      strategy,
      exploration({
        misses: new Set(["SCHEMA.md", "PLAN.md", "STEPS.md"]),
        toolCalls: 3,
      }),
    );

    expect(decision.ready).toBe(true);
    expect(decision.reason).toContain("misses");
  });
});

describe("resolveTaskExecutionRoute", () => {
  it("routes external URLs through the web path instead of the no-tools direct-answer path", () => {
    const preRoute = prerouteInput("https://stripe.com/pricing");
    expect(preRoute).toMatchObject({
      mode: "web-context",
      shouldQuery: true,
    });
    expect(resolveTaskExecutionRoute(preRoute, "question")).toBe("web-context");
  });

  it("keeps casual chat on the direct-answer path", () => {
    const preRoute = prerouteInput("how are you");
    expect(preRoute).toMatchObject({
      mode: "direct-answer",
      shouldQuery: false,
    });
    expect(resolveTaskExecutionRoute(preRoute, "question")).toBe("direct-answer");
  });
});
