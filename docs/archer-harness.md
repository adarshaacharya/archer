# Archer Harness

This document describes the direct replacement for OpenHarness in `archer`.

This is not an adapter plan.

This is a native runtime plan that assumes:

- OpenHarness will be removed
- `archer` will own session semantics directly
- `archer` will own tool orchestration directly
- `archer` will own approvals, sandbox policy, and subagent lifecycle directly
- compatibility with OpenHarness internals is not a goal

## Recommended Name

The best package name is:

- `@archer/harness`

Why:

- short
- native to the product name
- clearly describes the runtime role
- avoids over-specific names like `native-runtime` that get awkward once it becomes the default

Good internal module names:

- `ArcherHarness`
- `HarnessSession`
- `HarnessTurnRunner`
- `HarnessPolicyEngine`
- `HarnessToolRouter`

Good package split if needed later:

- `@archer/harness`
- `@archer/harness-ui`
- `@archer/harness-evals`

Names to avoid:

- `@archer/native`
- `@archer/core-native`
- `@archer/openharness-replacement`
- `@archer/agent-runtime`

Reasons:

- `native` is vague
- `core-native` sounds transitional
- `openharness-replacement` locks the package identity to a dependency we are removing
- `agent-runtime` is accurate but generic and weaker than `harness`

If you want the word `native` visible during the transition, use it in the implementation milestone names, not the package name:

- `Archer Harness phase 1`
- `Archer Harness cutover`

## Objective

Replace OpenHarness with a first-party Archer harness that provides:

- deterministic turn execution
- native plan and change phases
- first-class approval and sandbox control
- explicit subagent boundaries
- better observability
- provider-specific execution without lowest-common-denominator constraints

Quality bar:

- codex-level runtime discipline
- claude-code-level control surfaces
- clean internal boundaries
- scalability without monorepo-runtime sprawl
- predictable behavior under long-running sessions

## Non-Goals

- preserving OpenHarness APIs
- preserving OpenHarness event formats
- preserving OpenHarness session abstractions
- adding another compatibility adapter layer

## Product Constraints

The replacement harness must preserve the product behaviors Archer already cares about:

- terminal-first interaction
- patch-based editing
- approvals before mutations
- constrained shell execution
- subagent support
- session persistence
- long-running task continuity
- compaction
- verification and review flows

## Engineering Standards

The Archer harness is critical product infrastructure.

It must be built like infrastructure, not like a prompt experiment.

Required standards:

- small, explicit interfaces
- no hidden global mutation outside deliberate session registries
- event schemas treated as public internal contracts
- policy checks centralized in one layer
- tool execution paths normalized through one router
- provider-specific code isolated from session logic
- deterministic tests for policy, routing, and state transitions
- traceability for every important runtime decision

If a design choice makes debugging harder, it is probably wrong.

## Architecture Principles

### 1. One Owner Per Concern

Each concern should have one clear owner:

- session truth: session layer
- turn lifecycle: turn runtime
- permissions: policy engine
- tool dispatch: tool router
- shell/filesystem/web execution: runtime backends
- model request/response handling: model loop

Do not let multiple layers partially own the same behavior.

That is how agent runtimes become fragile.

### 2. State Machines Over Implicit Flow

Turn execution, approvals, and subagent lifecycle should be modeled as explicit state machines.

Avoid:

- boolean soup
- event-order assumptions hidden across files
- special-case interception chains

Good runtime code should let you answer:

- what state is this turn in
- what transitions are legal next
- what event caused the transition

### 3. Structured Events Over Ad Hoc Logs

Logs are not enough.

The harness should emit structured events that are:

- testable
- replayable
- inspectable in evals
- usable by TUI and future clients

Free-form logging should be secondary.

### 4. Policy Must Fail Closed

When policy evaluation is uncertain, the runtime should deny or request approval.

Never silently widen permissions because a matcher, parser, or hook failed.

### 5. Provider Isolation

Provider-specific logic belongs under the model loop.

The rest of the harness should not care whether the model is OpenAI, Anthropic, Google, or local.

The harness may depend on provider capabilities.

It must not depend on provider quirks leaking into session semantics.

### 6. Backends Are Replaceable, Semantics Are Not

Backends can vary:

- local shell
- container shell
- remote executor

But the meaning of:

- tool requested
- patch approval requested
- subagent completed
- turn failed

must stay stable across backends.

## Core Design

The harness should be split into six explicit layers.

### 1. Harness Session Layer

Owns:

- session ids
- message history
- compaction state
- turn checkpoints
- subagent lineage
- persisted artifacts

Key rule:

- the source of truth for session state lives in Archer storage, not in a model SDK or agent framework

### 2. Turn Runtime Layer

Owns:

- turn start
- turn cancellation
- turn mode
- step budget
- timeout budget
- phase transitions

Turn modes should be native runtime states:

- `plan`
- `change`
- `answer`
- `review`
- `compact`

This should replace the current pattern where some of these behaviors are expressed through control tools.

### 3. Policy Engine

Owns:

- approval policy
- filesystem policy
- network policy
- protected paths
- subagent restrictions
- trusted command rules
- escalation requests

The policy engine must sit outside the model loop.

The model may request actions.

The policy engine decides whether those actions:

- run
- require approval
- require escalation
- are denied

### Runtime Policy Config (`~/.config/archer/settings.json`)

Archer harness policy rules are now configurable through runtime config.

Path:

- `~/.config/archer/settings.json`

Shape:

- `policy.rules[]` with deterministic priority ordering (higher number wins)
- first matching rule decides action
- if no rule matches, runtime falls back to safe default behavior

Example:

```json
{
  "projectInstructions": true,
  "subagents": {
    "enabled": true
  },
  "policy": {
    "rules": [
      {
        "id": "deny-edits-in-answer",
        "priority": 300,
        "permission": "edit",
        "action": "deny",
        "reason": "answer turns must stay read-only",
        "tool": ["writeFile", "editFile", "deleteFile", "createDirectory"],
        "mode": "answer"
      },
      {
        "id": "allow-safe-bash",
        "priority": 220,
        "permission": "bash",
        "action": "allow",
        "reason": "trusted readonly shell commands",
        "tool": "bash",
        "when": {
          "bashPrefixes": ["ls", "pwd", "cat", "rg", "find", "git status"]
        }
      },
      {
        "id": "deny-destructive-bash",
        "priority": 240,
        "permission": "bash",
        "action": "deny",
        "reason": "destructive shell command",
        "tool": "bash",
        "when": {
          "bashPrefixes": ["rm -rf", "sudo rm", "mkfs", "dd if="]
        }
      },
      {
        "id": "ask-on-edit-change",
        "priority": 120,
        "permission": "edit",
        "action": "ask",
        "reason": "edits in change mode require approval",
        "tool": ["writeFile", "editFile", "deleteFile", "createDirectory"],
        "mode": "change"
      },
      {
        "id": "allow-read-tools",
        "priority": 110,
        "permission": "read",
        "action": "allow",
        "reason": "readonly tools are allowed",
        "tool": ["readFile", "listFiles", "grep"]
      }
    ]
  }
}
```

Notes:

- `tool` supports exact names, arrays, and wildcard patterns like `read*`.
- `mode` can be `answer`, `change`, or `any`.
- `when.argsPattern` supports deep matching and string regex via `re:<pattern>`.
- keep deny rules above allow rules when both could match.

### 4. Tool Router

Owns:

- tool registry
- tool schemas
- tool dispatch
- tool lifecycle events
- tool result normalization
- hook execution around tool calls

Every tool should pass through the same lifecycle:

1. request
2. policy check
3. optional approval
4. execution
5. normalized result
6. trace emission

### 5. Runtime Backend Layer

Owns the actual execution backends for:

- filesystem operations
- shell execution
- web tools
- MCP/app connectors
- background processes

The important boundary:

- the harness owns semantics
- backends only execute capabilities

This layer should be replaceable for:

- local execution
- containerized execution
- remote sandbox execution

### 6. Model Loop Layer

Owns:

- provider request formatting
- streaming parsing
- structured tool-call parsing
- reasoning summary handling
- retry behavior
- provider-specific features

This must not own:

- session truth
- policy decisions
- tool execution rules
- compaction semantics

## Scalability Requirements

The harness should scale in three directions without redesign.

### 1. Session Scale

It must tolerate:

- long conversations
- compaction and resume
- multiple active sessions
- nested subagents
- background work

### 2. Surface Scale

It should support:

- TUI
- non-interactive exec mode
- future desktop or web clients
- future asynchronous job runners

without rewriting the core runtime.

### 3. Capability Scale

It should allow more tools, providers, and runtime backends without turning the core into a dependency graph mess.

Rule:

- new capabilities should add modules, not rewrite the harness center

## Clean Code Rules

These rules matter more than stylistic preference.

### Module Boundaries

- `session/` should not call provider SDKs directly
- `models/` should not mutate persisted session state directly
- `tools/` should not decide policy
- `policy/` should not perform execution
- `backends/` should not invent harness events

### Function Shape

Prefer:

- pure transformation functions
- explicit input/output types
- small orchestrators that call well-scoped helpers

Avoid:

- giant runtime methods that load state, decide policy, call tools, stream text, and persist artifacts all in one place

### Error Handling

Errors should be typed or normalized into clear runtime categories:

- policy denied
- approval rejected
- sandbox escalation denied
- tool execution failed
- provider request failed
- provider stream failed
- turn timed out
- turn cancelled
- session load/save failed

Do not collapse everything into generic failure strings.

### Naming

Use names that describe runtime meaning, not legacy history.

Good:

- `HarnessTurnState`
- `PolicyDecision`
- `ToolExecutionResult`
- `SubagentLifecycleEvent`

Bad:

- `OpenHarnessCompatibleEvent`
- `EngineGlueState`
- `RuntimeShim`

## Testing Strategy

The harness should ship with a real test pyramid.

### Unit Tests

Required for:

- policy matching
- protected path rules
- approval escalation shaping
- tool result normalization
- context ranking
- state-machine transitions

### Integration Tests

Required for:

- full turn execution with fake model output
- patch approval flows
- shell command approval flows
- compaction and resume
- subagent spawn/wait/cancel
- hook behavior

### Golden Trace Tests

Add trace-based fixtures for important workflows:

- answer turn
- plan turn
- change turn
- review turn
- failed tool execution
- timeout
- approval denied

These traces should validate event ordering and persisted state, not just final text output.

### Provider Contract Tests

Each provider integration should prove:

- streaming deltas are parsed correctly
- tool requests are extracted correctly
- usage accounting is correct
- cancellation works
- malformed provider output fails safely

## Observability Requirements

The harness should expose first-party observability from day one.

Minimum required artifacts:

- turn trace
- tool trace
- approval audit trail
- subagent lifecycle trace
- persisted compaction summary
- usage and cost summary

Minimum required operator views:

- why a command was denied
- why a patch needed approval
- why a subagent was spawned
- why a turn stopped
- what state was compacted

If the runtime cannot explain its decisions, it is not production quality.

## Recommended Runtime Shape

```ts
export type HarnessTurnMode = "plan" | "change" | "answer" | "review" | "compact";

export type HarnessTurnRequest = {
  sessionId: string;
  cwd: string;
  prompt: string;
  mode: HarnessTurnMode;
  model: {
    provider: string;
    modelId: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  };
  limits: {
    maxSteps: number;
    timeoutMs: number;
  };
  abortSignal?: AbortSignal;
};

export type HarnessToolRequest = {
  callId: string;
  toolName: string;
  args: unknown;
  sessionId: string;
  turnId: string;
  subagentId?: string;
};

export type HarnessApprovalRequest =
  | {
      kind: "tool";
      toolName: string;
      args: unknown;
      reason: string;
    }
  | {
      kind: "patch";
      files: Array<{ filePath: string; diff: string }>;
      summary?: string;
    }
  | {
      kind: "sandbox-escalation";
      command?: string[];
      fileAccess?: { read?: string[]; write?: string[] };
      network?: { enabled: boolean; domains?: string[] };
      scope: "turn" | "session";
    };

export type HarnessEvent =
  | { type: "turn.started"; turnId: string; mode: HarnessTurnMode }
  | { type: "text.delta"; turnId: string; delta: string }
  | { type: "reasoning.delta"; turnId: string; delta: string }
  | { type: "tool.requested"; turnId: string; tool: HarnessToolRequest }
  | { type: "tool.started"; turnId: string; callId: string; toolName: string }
  | { type: "tool.completed"; turnId: string; callId: string; toolName: string; output: unknown }
  | { type: "tool.failed"; turnId: string; callId: string; toolName: string; error: string }
  | { type: "approval.requested"; turnId: string; approval: HarnessApprovalRequest }
  | { type: "approval.resolved"; turnId: string; approved: boolean }
  | { type: "subagent.started"; turnId: string; subagentId: string; role: string }
  | { type: "subagent.completed"; turnId: string; subagentId: string; result: string }
  | { type: "turn.completed"; turnId: string; outputText: string }
  | { type: "turn.failed"; turnId: string; error: string };
```

## Design Decisions To Copy From Existing Agents

### Copy From Codex

- separate sandbox and approvals
- treat permission escalation as structured runtime behavior
- keep approvals sticky within a turn or session when explicitly granted
- expose review, diff, status, and debug surfaces as harness features

### Copy From Claude Code

- scoped subagents with dedicated tools and permission modes
- hooks before and after tool usage
- project-level instructions and agent definitions
- deny rules that apply outside prompt logic

### Copy From Gemini CLI

- tool-level sandboxing
- explicit sandbox expansion requests
- plan mode as a real runtime concept
- extensible tool registry

### Copy From Aider

- repo map as a native context subsystem
- token-budget-aware context packing
- strong git-centric diff/review workflow
- optional architect/editor split

### Copy From OpenHands And SWE-ReX

- runtime backend as a separate sandbox execution service
- stable action/observation interface
- local or remote sandbox pluggability

### Copy From Open SWE

- async orchestration for future surfaces
- middleware and trigger friendliness
- curated toolset over tool sprawl

## Key Archer-Specific Decisions

### 1. Control Phases Become Native

These should stop being generic tools over time:

- `submitPlan`
- `submitVerificationReport`
- `submitTurnDecision`
- `submitCompactionReport`

They should become runtime outputs owned by the phase runner.

### 2. Patch Approval Stays Central

Archer already has the right instinct here.

Keep:

- patch previews
- grouped multi-file approval
- diff-first review

Strengthen it by making patch approval part of the native tool router rather than tool-specific glue.

### 3. Protected Paths Must Be Hard Policy

The harness should always protect paths like:

- `.git`
- `.agents`
- `.codex`
- `.claude`
- local secrets and env files based on config

These protections should not depend on prompt obedience.

### 4. Context Must Be Built, Not Dumped

Add a native `ContextBuilder` that can combine:

- explicit file mentions
- recent transcript facts
- repo map slices
- symbol-targeted code snippets
- plan artifacts
- verification findings

### 5. Review Must Be Native

The harness should support a first-party review flow that can inspect:

- working tree diff
- changed file set
- test status
- policy violations
- missing verification

## Proposed Package Layout

Recommended target:

- rename `@archer/agent-core` to `@archer/harness`

Possible source tree:

```txt
packages/harness/
  src/
    index.ts
    session/
    turns/
    events/
    policy/
    tools/
    backends/
    models/
    subagents/
    context/
    compaction/
    review/
```

Support packages if the code grows:

- `@archer/context-engine`
- `@archer/review-engine`
- `@archer/runtime-backends`

But do not start with extra packages unless necessary.

Start with one package:

- `@archer/harness`

## Migration Plan

### Phase 1: Define Native Types

Create Archer-native types for:

- session state
- turn request/result
- event stream
- tool request/result
- approval requests
- subagent lifecycle

Exit criteria:

- no new runtime logic is written against OpenHarness types

### Phase 2: Build Native Tool Router

Implement:

- tool registry
- dispatch lifecycle
- approval interception
- result normalization
- hook surfaces

Exit criteria:

- file tools, shell tools, web tools, and control flows all run through Archer routing

### Phase 3: Build Native Session And Turn Runner

Implement:

- session load/save
- turn execution
- streaming event emission
- cancellation
- retries
- step limits

Exit criteria:

- Archer can execute a full answer turn without OpenHarness

### Phase 4: Build Native Change Mode

Implement:

- patch flow
- shell execution flow
- approval flow
- verification flow

Exit criteria:

- Archer can complete a patch-based coding task end to end without OpenHarness

### Phase 5: Build Native Subagents

Implement:

- scoped child sessions
- per-subagent tools
- result aggregation
- cancel/wait/status lifecycle

Exit criteria:

- OpenHarness `AgentRegistry` is gone

### Phase 6: Remove OpenHarness

Remove:

- `@openharness/core`
- OpenHarness runtime types
- OpenHarness event mapping
- OpenHarness session construction

Exit criteria:

- no `@openharness/core` dependency remains anywhere in Archer packages

## Immediate First Refactors

Before writing the native loop, do these first:

1. Rename `OpenHarnessRuntimeDeps` to an Archer-owned runtime deps type.
2. Rename `OpenHarnessToolEvent` to `HarnessToolEvent`.
3. Rename `createOpenHarnessEngineAdapter()` to `createHarnessEngine()` only if it is immediately backed by native code.
4. Replace `openharness-config` naming in CLI and shared config with Archer-native config naming.
5. Move event mapping semantics out of OpenHarness-specific files.

Even if the full replacement happens fast, these renames reduce conceptual drag.

## Suggested Near-Term Package Renames

If you want to make the tree align with the target architecture early:

1. rename `@archer/agent-core` to `@archer/harness`
2. rename `openharness-runtime.ts` to `harness-runtime.ts` only once native execution exists
3. rename `openharness-types.ts` to `harness-types.ts` as soon as the exported types become Archer-owned
4. rename `openharness-config.ts` to `harness-config.ts`

Do not keep OpenHarness in package and module names longer than necessary.

## Risks

- rebuilding streaming semantics incorrectly
- losing stable cancellation behavior
- introducing session persistence regressions
- making provider integrations worse while trying to make them more native
- overbuilding abstractions before the first native end-to-end flow works

## Decision Rule

If the goal is truly to remove OpenHarness rather than coexist with it, then Archer should stop spending design effort on long-lived compatibility layers.

The only compatibility work worth doing is the minimum needed to keep the tree compiling while the Archer harness lands.

The target state is simple:

- `@archer/harness` is the runtime core
- all session, turn, tool, policy, and subagent semantics belong to Archer
- provider and sandbox backends plug into Archer, not the other way around

## Final Recommendation

Use this naming:

- package: `@archer/harness`
- runtime class: `ArcherHarness`
- migration label: `Archer Harness`

That gives you:

- a clean product-native identity
- no reference to OpenHarness
- no transitional smell in the package name
- room to grow if Archer later adds other clients or execution backends
