# XEQ

Pronunciation: `eks-ee-kyoo` (`X-E-Q`).

`XEQ` is derived from “execute,” condensed through “exeqt” into its final form.

Terminal-first AI coding agent monorepo (Bun + Turborepo).

## Status

Early V1 scaffolding is in progress:
- core package boundaries created
- shared contracts and sandbox interfaces created
- pi-tui-based `packages/tui` started
- migration direction set: Mastra core runtime (`Agent + Workspace + Memory`) with XEQ-specific CLI/TUI behavior preserved

See:
- `PLAN.md` for architecture decisions
- `STEPS.md` for V1 implementation order
- `AGENTS.md` for repo agent instructions

## Workspace Packages

- `packages/agent-core`: XEQ orchestration adapter (target: Mastra-backed runtime)
- `packages/model-providers`: provider abstraction + OpenRouter stub
- `packages/sandbox`: policy decisions (`allow/ask/deny`)
- `packages/shared`: zod contracts and shared types/errors
- `packages/tools`: tool runtime (currently includes `readFileTool`)
- `packages/tui`: terminal UI layer (pi-tui)

## Commands

```bash
bun install
bun run check-types
```


## Checklist:


  1. Extend runAgent to iterative action loop

  - model response -> decide action
  - if tool action: execute tool
  - append observation
  - continue until done/maxSteps

  2. Define internal action contract in agent-core

  - type AgentAction = "respond" | "tool_call" | "done"
  - keep it simple for now

  3. Add tool executor interface to agent-core

  - inject function like executeTool(name, input)
  - don’t hardcode tools in core

  4. Wire first 3 tools from @xeq/tools

  - list_files
  - search_files
  - run_command (sandbox-gated)

  5. Emit step events to TUI

  - every model decision
  - every tool execution result
  - final summary

  6. Add guardrails

  - maxSteps
  - repeated tool-call detection
  - max runtime

  After that you’ll have first real “coding-agent loop” instead of model-only display.
