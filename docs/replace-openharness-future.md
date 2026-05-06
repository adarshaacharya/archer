# Replacing OpenHarness In The Future

This document explains:

- why `archer` still uses OpenHarness today
- where OpenHarness can become a bottleneck
- what signals should trigger a replacement effort
- how to migrate without rewriting the whole product at once

The short version:

- Do not remove OpenHarness just because it is not fully native.
- Keep pushing `archer` runtime ownership upward first.
- Make OpenHarness replaceable behind a thin internal engine boundary.
- Replace it only if it starts limiting product quality, control, or speed of iteration.

## Current Position

Today `archer` uses OpenHarness as the inner agent/session engine, while `archer` owns more of the higher-level orchestration:

- routing
- planning
- verification
- compaction policy
- repair flow
- approvals policy
- turn state

That means OpenHarness is no longer the whole architecture. It is now an execution backend.

This is a good intermediate state.

It gives us:

- working agent behavior now
- lower implementation cost
- faster iteration on product behavior
- a path to future replacement without losing the runtime work already done

## Why Keep OpenHarness For Now

OpenHarness is still useful if it continues to provide:

- session/message persistence we do not need to reimplement yet
- tool-call loop execution
- provider abstraction
- streaming event handling
- stable enough semantics for current `archer` use cases

Replacing it too early would create risk in:

- model streaming behavior
- tool execution semantics
- cancellation behavior
- provider integration
- session continuity bugs

If OpenHarness is not actively blocking quality or product direction, keep it and keep wrapping it.

## Where OpenHarness Can Become A Bottleneck

OpenHarness becomes a problem when `archer` wants deeper control than the adapter allows.

### 1. Turn And Message Semantics

Potential bottleneck:

- OpenHarness decides too much about what a turn is
- message history shape is not fully under `archer` control
- tool outputs and assistant outputs are normalized in ways we cannot tune

Symptoms:

- awkward workarounds in `task-runner` or runtime modules
- special-case logic to reconstruct intent or state from events
- difficulty making answer turns and change turns fully uniform

Why this matters:

Codex and Claude Code both own these semantics directly. That makes their runtime behavior more predictable and easier to evolve.

### 2. Tool Protocol Ownership

Potential bottleneck:

- control tools like `submitPlan`, `submitVerificationReport`, `submitTurnDecision`, and `submitCompactionReport` are layered on top of a generic tool protocol rather than being native runtime concepts

Symptoms:

- control-tool capture feels bolted on
- planning/verification/compaction need too much event interception
- approval or tool event handling becomes fragile

Why this matters:

If the runtime does not naturally treat control actions as first-class, `archer` will keep carrying adaptation complexity forever.

### 3. Provider Behavior And Model-Specific Features

Potential bottleneck:

- OpenHarness may flatten provider differences too aggressively
- model-specific structured output or tool-calling capabilities may be hard to expose directly

Symptoms:

- `archer` cannot use the best features of a specific provider cleanly
- new model capabilities are delayed until OpenHarness supports them
- provider abstraction becomes a lowest-common-denominator problem

Why this matters:

Codex/Claude-style quality often comes from taking strong advantage of the real underlying model/tool protocol, not just abstracting everything away.

### 4. Session Lifecycle And Continuation Control

Potential bottleneck:

- session continuation behavior is partly owned by OpenHarness
- compaction and rehydration behavior cannot be shaped precisely enough

Symptoms:

- difficult-to-debug continuation bugs
- inconsistent behavior after compaction or retries
- model context behavior that feels surprising from `archer`’s point of view

Why this matters:

As `archer` becomes more runtime-driven, session continuity becomes core product behavior, not just infrastructure.

### 5. Observability And Debuggability

Potential bottleneck:

- event stream is not rich enough for the debugging we want
- internal model/tool state is hidden behind OpenHarness abstractions

Symptoms:

- hard to answer "why did the agent do that?"
- hard to measure exact failure modes
- difficult evaluation work because state transitions are only partially visible

Why this matters:

Once agent quality becomes the main product problem, observability is critical.

### 6. Performance And Overhead

Potential bottleneck:

- extra abstraction layers add latency or complexity
- unnecessary data transformation around messages or tool events

Symptoms:

- slower turns than necessary
- duplicated work in adapter layers
- more memory churn than expected

This is usually not the first reason to replace OpenHarness, but it can become relevant later.

## Signals That Mean "Replace It"

Do not replace OpenHarness because it feels conceptually impure.

Replace it if several of these become true:

- `archer` repeatedly needs awkward workarounds to express core runtime behavior
- control tools keep multiplying because the underlying runtime does not fit the product
- session/turn semantics are a recurring source of bugs
- provider-specific capabilities are blocked by OpenHarness abstractions
- evaluation shows persistent quality gaps tied to runtime limitations rather than prompt quality
- observability is too weak to debug agent failures efficiently
- adapter code around OpenHarness starts growing faster than actual product logic

If 3-4 of those are true at once, replacement becomes a serious candidate.

## Signals That Mean "Keep It"

Keep OpenHarness if:

- most quality gains are still coming from `archer` runtime policy changes
- tool interception is still manageable
- provider abstraction is helping more than hurting
- evaluation gaps are mainly prompt/policy/verification issues, not engine issues
- the adapter remains thin and understandable

## Recommended Strategy

The right strategy is not "rewrite everything later."

The right strategy is:

1. Define a small internal engine interface.
2. Keep OpenHarness behind that interface.
3. Move all `archer` orchestration to depend only on the interface.
4. Add a second backend only when justified.
5. Swap gradually, not all at once.

## Target Internal Interface

`archer` should depend on an internal engine adapter instead of directly depending on OpenHarness behavior everywhere.

Example shape:

```ts
export type EngineToolEvent =
  | { phase: "start"; step: number; toolName: string }
  | { phase: "done"; step: number; toolName: string; output: unknown }
  | { phase: "error"; step: number; toolName: string; error: string };

export type EngineRunOptions = {
  prompt: string;
  cwd: string;
  sessionId: string;
  maxSteps: number;
  timeoutMs: number;
  allowTools: boolean;
  instructions?: string;
  onToolEvent?: (event: EngineToolEvent) => void;
  onTextDelta?: (delta: string) => void;
  onStep?: (step: {
    step: number;
    action: string;
    observation?: string;
  }) => void;
};

export type EngineRunResult = {
  status: "completed" | "failed" | "cancelled";
  outputText: string;
  steps: number;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd?: number;
};

export interface EngineAdapter {
  run(options: EngineRunOptions): Promise<EngineRunResult>;
  resetSession(sessionId: string): void;
}
```

Then:

- today: `OpenHarnessEngineAdapter`
- later: `NativeArcherEngineAdapter`

This keeps `turn-execution.ts` and `task-runner.ts` stable.

## Migration Plan

### Phase 1: Keep Wrapping OpenHarness

Goal:

- make OpenHarness replaceable before replacing it

Work:

- introduce `EngineAdapter`
- move `runOpenHarnessRuntime()` behind it
- ensure higher-level runtime depends only on the adapter

Exit criteria:

- no higher-level runtime logic depends directly on OpenHarness-specific types

### Phase 2: Expand Native Ownership

Goal:

- reduce OpenHarness-specific semantics leaking upward

Work:

- move more session state ownership into `archer`
- normalize tool/control events into `archer`-native event types
- reduce raw fallback parsing over time

Exit criteria:

- `archer` can describe runtime behavior entirely in its own types

### Phase 3: Build A Native Prototype Engine

Goal:

- prove whether OpenHarness is actually the bottleneck

Work:

- implement a minimal native backend for a subset of flows
- start with one mode, likely change turns
- compare quality, observability, and maintainability

Exit criteria:

- measurable evidence that the native backend is better, or evidence that replacement is unnecessary

### Phase 4: Gradual Cutover

Goal:

- move production traffic or local dev default to the native engine

Work:

- feature-flag backend selection
- compare eval results
- keep OpenHarness as fallback during transition

Exit criteria:

- native engine is stable enough to become default

## Risks Of Replacing Too Early

- large engineering cost with unclear product gain
- regressions in streaming, cancellation, or tool handling
- time spent rebuilding infrastructure instead of improving agent quality
- hidden provider/protocol edge cases surfacing all at once

This is why the adapter-first strategy matters.

## Recommended Decision Rule

For now:

- keep OpenHarness
- continue owning more runtime behavior in `archer`
- isolate OpenHarness further

In the future:

- replace OpenHarness only when the adapter starts becoming the bigger problem than the underlying work it saves

## Honest Conclusion

OpenHarness is not the immediate problem anymore.

The main job now is:

- keep consolidating `archer` runtime control
- keep the OpenHarness dependency behind a clean boundary
- collect evidence about where quality is still being lost

If future work shows the biggest remaining gaps are caused by inner-loop constraints, then replacing OpenHarness will be justified.

Until then, treat it as a backend to contain, not a dependency to panic-remove.
