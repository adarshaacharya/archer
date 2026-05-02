import { describe, expect, it } from "bun:test";
import {
  buildDirectAnswerPrompt,
  buildDirectAnswerSystemPrompt,
  buildQuestionStrategy,
  buildResearchAnswerPrompt,
  createTaskPhaseController,
} from "./task-flow.js";

describe("task phase controller", () => {
  it("starts in context phase", () => {
    const controller = createTaskPhaseController();

    expect(controller.phase).toBe("context");
    expect(controller.isContextPhase()).toBe(true);
    expect(controller.isVerificationPhase()).toBe(false);
  });

  it("tracks implementation and verification transitions", () => {
    const controller = createTaskPhaseController("context");

    controller.beginImplementation();
    expect(controller.phase).toBe("implementation");
    expect(controller.isContextPhase()).toBe(false);

    controller.beginVerification();
    expect(controller.phase).toBe("verification");
    expect(controller.isVerificationPhase()).toBe(true);
  });
});

describe("question strategy", () => {
  it("uses generic discovery without semantic question buckets", () => {
    const strategy = buildQuestionStrategy("what is the project about?", "question");
    const prompt = buildResearchAnswerPrompt("what is the project about?", "question", strategy);

    expect(prompt).toContain("Choose the search path from the user's wording");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("README");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).not.toContain("Read PLAN.md");
    expect(prompt).not.toContain("Question subtype:");
    expect(prompt).toContain("missing files must not fail the question turn");
  });

  it("keeps implementation guidance search-first without classifying the turn", () => {
    const strategy = buildQuestionStrategy("where is turn routing implemented?", "question");

    expect(strategy.initialDiscoveryPlan.join("\n")).toContain("search first");
    expect(strategy.explorationBudget.maxSpeculativeMisses).toBeLessThanOrEqual(3);
  });

  it("answers casual questions without repository inspection", () => {
    const prompt = buildDirectAnswerPrompt("how are you");

    expect(prompt).toContain("Do not inspect the repository");
    expect(prompt).toContain("do not call any tools");
  });

  it("uses a direct-answer system prompt without coding-agent inspection rules", () => {
    const prompt = buildDirectAnswerSystemPrompt();

    expect(prompt).toContain("Do not inspect files");
    expect(prompt).not.toContain("Always begin by inspecting");
  });
});
