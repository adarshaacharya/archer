# Architecture Refactor Requirements and Checklist

## Objective

Improve folder/file architecture and package boundaries for long-term scalability **without changing runtime behavior**.

## Core Requirements

1. Logic parity:
- Existing behavior must remain unchanged.
- Refactors are structural unless explicitly approved.

2. Clear boundaries:
- `apps/*` are composition/entrypoints.
- `packages/*` are reusable capabilities with single responsibility.

3. Navigability:
- Files should be easier to discover by intent (contracts/domain/application/infrastructure).
- Avoid large "god files" where possible.

4. Safe rollout:
- Implement in small phases with validation after each phase.
- Stop if behavior drift is detected.

## Non-Goals

- No feature expansion during refactor phases.
- No provider or policy behavior redesign in this track.
- No migration of persistence schema behavior unless separately planned.

## Invariants (Must Stay True)

1. Policy checks are never bypassed for shell or file operations.
2. Approval mode semantics remain unchanged.
3. Existing command and session workflows remain unchanged.
4. Existing public package APIs continue to work during migration.

## Phase Plan

## Phase 1: CLI Bootstrap Structure

Status: `DONE`

Checklist:
- [x] Extract CLI arg parsing/help text into `apps/cli/src/app/cli-args.ts`
- [x] Extract version logic into `apps/cli/src/app/version.ts`
- [x] Extract project root resolution into `apps/cli/src/app/project-root.ts`
- [x] Rewire `apps/cli/src/index.ts` to use new modules
- [x] Confirm typecheck and targeted tests

## Phase 2: Task Runner Decomposition (No Logic Changes)

Status: `IN PROGRESS`

Checklist:
- [x] Create `apps/cli/src/workflows/run-task/` module folder
- [x] Extract output parsing helpers
- [x] Extract turn status labeling helpers
- [x] Extract web provider connection/state helpers
- [x] Extract route resolution and route helpers
- [ ] Extract execution path blocks (answer/change/web context) into modules
- [ ] Keep `runTask` as composition orchestrator
- [ ] Re-run typecheck and targeted tests after each extraction

## Phase 3: Shared Contracts Split

Status: `PLANNED`

Checklist:
- [ ] Split `packages/shared/src/index.ts` into:
- [ ] `packages/shared/src/approval/*`
- [ ] `packages/shared/src/composer/*`
- [ ] `packages/shared/src/web/*`
- [ ] `packages/shared/src/subagents/*`
- [ ] Keep root `index.ts` as curated compatibility exports
- [ ] Confirm all package imports continue to compile

## Phase 4: Agent Core Internal Organization

Status: `PLANNED`

Checklist:
- [ ] Reorganize large runtime files into subfolders:
- [ ] `planning/`, `execution/`, `session/`, `validation/`
- [ ] Preserve `@archer/agent-core` package public API compatibility
- [ ] Validate runtime tests and CLI integration tests

## Phase 5: Boundary Hardening and Documentation

Status: `PLANNED`

Checklist:
- [ ] Add per-package README with:
- [ ] package purpose
- [ ] allowed dependencies
- [ ] public API surface
- [ ] narrow exports where safe (avoid `export *` overexposure)
- [ ] add/enforce boundary rules in monorepo tooling

## Validation Gates

Run these after each phase:

```bash
bun run --filter @adarshaacharya/archer check-types
bun test apps/cli/src/task-runner.test.ts apps/cli/src/turn-runner.test.ts apps/cli/src/turn-runner.integration.test.ts
```

For broader phases:

```bash
bun run check-types
bun run lint
```

## Decision Log

### 2026-05-09
- Chosen approach: incremental refactor with strict logic parity.
- First target: reduce `apps/cli/src/index.ts` and `apps/cli/src/task-runner.ts` complexity.
- Tracking doc established as implementation source of truth.
