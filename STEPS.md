# XEQ V1 Build Steps

Date: March 30, 2026

## 0. Objective

Deliver V1 of a terminal-first coding agent (`xeq`) with:
- safe tool runtime
- approval modes (`suggest`, `auto-edit`)
- patch-based edit flow
- usage/cost logging
- baseline eval + speed metrics
- pi-tui-based terminal interface
- openharness-powered runtime core (session/agent/tools/policy)

## 1. Bootstrap Monorepo

1. Initialize workspace toolchain (`bun` workspaces + optional `turbo`).
2. Create root files:
   - `package.json`
   - `bunfig.toml` (optional)
   - `turbo.json`
   - `tsconfig.base.json`
   - `.gitignore`
3. Add shared scripts:
   - `build`
   - `test`
   - `lint`
   - `typecheck`
4. Add formatter/linter config and CI baseline.

### Bun-first bootstrap commands

```bash
bun init -y
bun add -d typescript vitest @types/node turbo
```

Then configure workspaces in root `package.json`:

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

## 2. Create Package Structure

1. `apps/cli`
2. `packages/shared`
3. `packages/sandbox`
4. `packages/model-providers`
5. `packages/tools`
6. `packages/agent-core`
7. `packages/tui`
8. `packages/evals`

## 3. Define Shared Contracts First

1. Create Zod schemas + TS types for:
   - `AgentRequest`
   - `AgentStep`
   - `ToolRequest`
   - `ToolResult`
   - `RunSummary`
2. Define typed error model:
   - `PolicyError`
   - `ToolExecutionError`
   - `ProviderError`
   - `ValidationError`
3. Define approval mode enum:
   - `suggest`
   - `auto-edit`

## 4. Implement Credentials and Config

1. Add credential precedence:
   - runtime/session input
   - environment variables
   - local auth file (`~/.local/share/xeq/auth.json`)
2. Add CLI commands:
   - `xeq auth login`
   - `xeq auth logout`
   - `xeq auth list`
3. Add secret redaction in logs.

## 5. Build Sandbox and Policy Engine

1. Path policy:
   - deny writes outside workspace root
   - allowlist/denylist patterns
2. Command policy:
   - allow safe commands
   - ask for guarded commands
   - deny dangerous commands by default
3. Add loop guard policy:
   - repeated same tool calls
   - max step count
   - max runtime

## 6. Build Tools Layer (Safe by Default)

1. File tools:
   - `list_files`
   - `read_file`
   - `search_files`
2. Edit tools:
   - `apply_patch`
   - optional controlled full write
3. Execution tools:
   - `run_command` (guarded by policy)
   - `git_status`
   - `git_diff`
4. Ensure all tool I/O matches shared schemas.

## 7. Build Model Provider Layer

1. Implement AI SDK-backed provider adapters.
2. Start with OpenRouter integration for broad model testing.
3. Add optional direct providers:
   - OpenAI
   - Anthropic
   - Gemini
4. Normalize all provider failures into typed errors.

## 8. Migrate Runtime Core (OpenHarness)

1. Replace custom harness loop with OpenHarness Session + Agent integration.
2. Wire repo-scoped tool execution with policy/approval controls.
3. Wire session continuity with thread/resource identifiers.
4. Keep XEQ adapter boundary in `packages/agent-core` so CLI/TUI remain framework-agnostic.
5. Enforce controls:
   - `maxSteps`
   - `maxDurationMs`
   - retry limits
6. Add context compaction/checkpoint for long sessions.
7. Add output trace per step (`thought/action/observation` style).

## 9. Build CLI App (No UX Regression)

1. `xeq` interactive command.
2. Session startup:
   - load repo context
   - load credentials
   - load approval mode
3. Interactive command loop:
   - accept user task
   - run openharness-backed agent core through XEQ adapter
   - stream updates
   - display diff/check results
4. Exit and save run artifacts.

## 9.1 Build TUI Package (pi-tui)

1. Add dependencies:
   - `@mariozechner/pi-tui`
2. Implement TUI boundaries:
   - session frame
   - step stream view
   - diff/output panel
   - approval prompt component
3. Keep TUI isolated in `packages/tui`; no business logic in UI layer.

## 10. Add Approval UX

1. `suggest` mode:
   - preview edits/commands
   - explicit user confirmation before apply/run
2. `auto-edit` mode:
   - apply low-risk edits automatically
   - ask for guarded actions
3. Provide clear audit trail for each approval decision.

## 11. Add Logging and Usage Accounting

1. Structured logs:
   - tool calls
   - policy decisions
   - model calls
2. Usage metrics:
   - input/output tokens
   - estimated cost
   - per-turn and session totals
3. Store run artifacts under local app data directory.

## 12. Add Evals (Quality + Speed)

1. Create baseline task suite:
   - bug fix
   - refactor
   - test repair
2. Track:
   - success/fail
   - time to first useful edit
   - total completion time
   - step count
   - token/cost per success
3. Add pass criteria and regression gate in CI.

## 13. V1 Exit Criteria

V1 is complete only if all are true:
1. `xeq` works as interactive terminal agent in a local repo.
2. Safe policy engine prevents out-of-scope writes/commands.
3. `suggest` and `auto-edit` modes are functional.
4. Patch-based edit flow is default.
5. Tests/checks run after edits and are reported clearly.
6. Logs + token/cost reports are available per run.
7. Eval suite passes defined baseline thresholds.

## 14. Suggested Build Order (Execution)

1. Steps 1-3
2. Steps 4-6
3. Steps 7-9
4. Steps 10-11
5. Steps 12-13

Do not jump to advanced planner/subagent/LSP work before V1 exit criteria are met.
