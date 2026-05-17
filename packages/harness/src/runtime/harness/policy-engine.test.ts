import { describe, expect, it } from "bun:test";
import { HarnessPolicyEngine, type HarnessPolicyRule } from "./policy-engine.js";

describe("HarnessPolicyEngine", () => {
  it("allows read tools", async () => {
    const policy = new HarnessPolicyEngine();
    const result = await policy.authorize({ toolName: "readFile", args: { filePath: "a.ts" } });
    expect(result.allowed).toBe(true);
  });

  it("denies dangerous bash commands", async () => {
    const policy = new HarnessPolicyEngine();
    const result = await policy.authorize({ toolName: "bash", args: { command: "rm -rf /tmp/x" } });
    expect(result.allowed).toBe(false);
    expect(result.decision.action).toBe("deny");
  });

  it("requires approval for edit tools", async () => {
    const policy = new HarnessPolicyEngine();
    const result = await policy.authorize(
      { toolName: "editFile", args: { filePath: "a.ts" } },
      async () => true,
    );
    expect(result.allowed).toBe(true);
    expect(result.decision.action).toBe("ask");
  });

  it("applies higher priority rule first", () => {
    const rules: HarnessPolicyRule[] = [
      {
        id: "allow-all-bash",
        priority: 10,
        permission: "bash",
        action: "allow",
        reason: "allow all bash",
        tool: "bash",
      },
      {
        id: "deny-rm",
        priority: 20,
        permission: "bash",
        action: "deny",
        reason: "deny rm",
        tool: "bash",
        when: { bashPrefixes: ["rm -rf"] },
      },
    ];
    const policy = new HarnessPolicyEngine({ rules });
    const decision = policy.classify({ toolName: "bash", args: { command: "rm -rf ./tmp" } });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("deny rm");
  });

  it("supports wildcard tool patterns", () => {
    const rules: HarnessPolicyRule[] = [
      {
        id: "read-wildcard",
        priority: 100,
        permission: "read",
        action: "allow",
        reason: "read wildcard",
        tool: "read*",
      },
    ];
    const policy = new HarnessPolicyEngine({ rules });
    const decision = policy.classify({ toolName: "readFile", args: {} });
    expect(decision.action).toBe("allow");
  });

  it("supports mode-scoped rules", () => {
    const rules: HarnessPolicyRule[] = [
      {
        id: "deny-edit-answer",
        priority: 100,
        permission: "edit",
        action: "deny",
        reason: "no edits in answer",
        tool: "editFile",
        mode: "answer",
      },
      {
        id: "ask-edit-default",
        priority: 10,
        permission: "edit",
        action: "ask",
        reason: "ask edit",
        tool: "editFile",
      },
    ];
    const policy = new HarnessPolicyEngine({ rules });
    const answerDecision = policy.classify({
      toolName: "editFile",
      args: {},
      mode: "answer",
    });
    const changeDecision = policy.classify({
      toolName: "editFile",
      args: {},
      mode: "change",
    });
    expect(answerDecision.action).toBe("deny");
    expect(changeDecision.action).toBe("ask");
  });

  it("supports argument regex patterns", () => {
    const rules: HarnessPolicyRule[] = [
      {
        id: "allow-read-src",
        priority: 100,
        permission: "read",
        action: "allow",
        reason: "read from src",
        tool: "readFile",
        when: {
          argsPattern: { filePath: "re:^src/.+\\.ts$" },
        },
      },
      {
        id: "ask-read-default",
        priority: 10,
        permission: "read",
        action: "ask",
        reason: "ask read",
        tool: "readFile",
      },
    ];
    const policy = new HarnessPolicyEngine({ rules });
    const allowed = policy.classify({
      toolName: "readFile",
      args: { filePath: "src/index.ts" },
    });
    const asked = policy.classify({
      toolName: "readFile",
      args: { filePath: "README.md" },
    });
    expect(allowed.action).toBe("allow");
    expect(asked.action).toBe("ask");
  });

  it("supports layered policy precedence for same priority", () => {
    const policy = new HarnessPolicyEngine({
      rules: [
        {
          id: "default-edit",
          priority: 100,
          permission: "edit",
          action: "ask",
          reason: "default ask",
          tool: "editFile",
        },
      ],
      layers: {
        project: [
          {
            id: "project-deny",
            priority: 100,
            permission: "edit",
            action: "deny",
            reason: "project deny",
            tool: "editFile",
          },
        ],
        session: [
          {
            id: "session-allow",
            priority: 100,
            permission: "edit",
            action: "allow",
            reason: "session allow",
            tool: "editFile",
          },
        ],
      },
    });
    const decision = policy.classify({ toolName: "editFile", args: {} });
    expect(decision.action).toBe("allow");
    expect(decision.reason).toContain("session allow");
  });
});
