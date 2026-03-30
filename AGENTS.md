# AGENTS.md

## Project Overview

XEQ is a terminal-first AI coding agent built as a Bun monorepo.

Primary goal for V1:
- safe coding-agent harness
- approval modes (`suggest`, `auto-edit`)
- policy-driven tool execution
- patch-first edit workflow
- usage/cost logging

## Monorepo Layout

- `apps/*`: user-facing apps (CLI first; template web/docs may be removed)
- `packages/agent-core`: core agent loop and step orchestration
- `packages/model-providers`: model/provider adapters
- `packages/tools`: file/shell/git tools
- `packages/sandbox`: path/command policy engine
- `packages/shared`: shared types, zod schemas, error contracts

## Source of Truth

- Architecture and decisions: `PLAN.md`
- V1 execution order: `STEPS.md`
- Turborepo guidance: `.agents/skills/turborepo/SKILL.md`
- AI SDK guidance : `.agents/skills/ai-sdk/SKILL.md`

If there is a conflict:
1. Latest user instruction
2. `PLAN.md` and `STEPS.md`
3. This file

## Dev Commands

- Install dependencies: `bun install`
- Type check all workspaces: `bun run check-types`
- Lint all workspaces: `bun run lint`
- Build all workspaces: `bun run build`
- Dev mode (workspace-defined): `bun run dev`

## Agent Working Rules

1. Implement contracts in `packages/shared` before adding runtime behavior.
2. Keep side effects isolated:
   - `packages/tools` executes operations
   - `packages/sandbox` decides permissions
   - `packages/agent-core` orchestrates loop only
3. Use zod-validated input/output for tool and agent boundaries.
4. Prefer patch-based edits over full-file overwrite.
5. Never bypass policy checks for file writes or shell commands.
6. Add or update tests for logic changes when test harness is present.
7. For turborepo/workspace pipeline changes, read `.agents/skills/turborepo/SKILL.md` first.

## Safety and Security

1. Never write outside workspace root unless explicitly requested.
2. Treat dangerous commands as denied by default.
3. Never print API keys or secrets in logs.
4. Respect credential precedence:
   - runtime/session input
   - environment variables
   - local auth store (`~/.local/share/xeq/auth.json`)

## V1 Delivery Checklist

Before marking work complete:
1. `suggest` and `auto-edit` modes are functional.
2. Loop controls exist (`maxSteps`, `maxDurationMs`, retry guard).
3. Tool policy enforcement is active (path + command checks).
4. Type checks pass (`bun run check-types`).
5. Changes align with `PLAN.md` and `STEPS.md`.
