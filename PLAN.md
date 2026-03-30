# XEQ Rebuild Plan (Monorepo AI Coding Agent)

Date: March 30, 2026

## 1. Goal

Build a high-quality, terminal-first AI coding agent with:
- strong tool safety
- provider-agnostic model support
- scalable monorepo architecture
- clear path from single-agent to planner/subagents

## 2. Current State

- Previous implementation moved to: `legacy/pre-monorepo/`
- Rebuild will be done from scratch in root monorepo structure

## 3. Product Scope

### V1 (must-have)
- Interactive CLI coding agent
- Safe file/shell/git tools
- Patch-based editing workflow
- Per-step logs + token/cost tracking
- Basic eval/regression tasks
- Approval modes: `suggest` and `auto-edit`
- Permission engine: path + command `allow/ask/deny`
- Loop budgets: max steps, max runtime, retry limits
- Basic context compaction/checkpoint for long sessions
- Speed tracking in evals (latency + cost + completion rate)
- Local user credential support (`auth login`, `auth logout`, `auth list`)

### V2 (next)
- Planner + Executor agent split
- Subagent delegation
- Better memory/session checkpoints
- LSP integration (diagnostics, go-to-definition, references)
- Optional async/background long-run execution

### V3 (later)
- Optional server mode / remote sessions
- Team workflows and richer observability

## 4. V1 Required vs V2 Optional

### Required for V1
- Approval modes: at least `suggest` and `auto-edit`.
- Permission rules engine for tools and filesystem boundaries.
- Deterministic edit flow (`read -> patch -> apply -> verify`).
- Hard loop controls (`maxSteps`, `maxDurationMs`, retry caps, loop-repeat guard).
- Session compaction/checkpoint to avoid context blowup.
- Eval metrics include:
  - task success rate
  - time to first useful edit
  - total completion time
  - token usage and cost

### Optional for V2+
- Planner/build mode split and full multi-agent delegation.
- LSP-powered code intelligence.
- Async/background execution queues.
- Rich TUI/desktop and team-level observability.

## 5. Tech Stack Decisions

### Core Agent Runtime
- Decision: **AI SDK-first architecture**
- Why: strong typed tools, model/provider abstraction, subagent support, low framework lock-in

### Reliability / Runtime Discipline
- Decision: **Effect-TS in boundaries where it adds real value**
- Use for:
  - tool execution policies
  - retries/timeouts/cancellation
  - typed error channels
- Avoid using Effect everywhere in app/UI layers initially

### Effect-TS Usage (Project-Specific)
- `packages/tools`: wrap shell/file/git operations in Effect programs with timeout + retry policy.
- `packages/sandbox`: express path and command permission checks as composable Effect checks.
- `packages/agent-core`: run each agent step through an Effect pipeline (`plan -> call model -> run tools -> observe`).
- `packages/model-providers`: normalize provider failures into typed Effect errors.
- `packages/shared`: define common tagged errors and Effect-based result helpers.
- Rule: domain logic stays plain TypeScript; Effect is used at I/O and orchestration boundaries.

### Orchestration Framework
- Decision: **Do not start with Mastra**
- Rationale:
  - We need custom coding-agent control first (tool policy + execution model)
  - Mastra can be added later if we want workflow/runtime conveniences

### CLI / UX
- Decision: **OpenTUI-first terminal UX from V1**
- `packages/tui` owns terminal rendering/input concerns.
- `apps/cli` only wires startup/session lifecycle to agent and tui packages.

### Validation / Quality
- Zod schemas for all tool contracts
- Vitest for unit/integration tests
- Eval package for repeatable benchmark tasks

### Terminal UI Stack
- Primary: `@opentui/core`
- Adapter: `@opentui/solid` (preferred) or `@opentui/react` (choose one, no mixing)
- Keep all UI vendor code inside `packages/tui` only

### Auth / Credentials
- V1 decision: **no backend DB for API keys**.
- Credential sources (highest precedence first):
  1. runtime flags / explicit CLI input for current session
  2. environment variables (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)
  3. local auth store file
- Local auth store path: `~/.local/share/xeq/auth.json` (user-only permissions).
- Never print secrets in logs; redact keys in telemetry and error output.
- Future (V3+): optional remote identity/token exchange if cloud multi-user features are added.

## 6. Monorepo Target Structure

```txt
apps/
  cli/                 # terminal client
  server/              # optional later
packages/
  agent-core/          # loop, planning, policy
  tools/               # fs/shell/git/web/search tools
  model-providers/     # OpenAI/Anthropic/OpenRouter/Gemini adapters
  sandbox/             # path + command permission controls
  tui/                 # OpenTUI rendering/input package
  shared/              # types, schemas, config utils
  evals/               # regression/eval harness

```

## 7. Build Phases

### Phase 0: Foundation
- Initialize workspace tooling
- Add lint/test/typecheck pipelines
- Define shared contracts (`ToolRequest`, `ToolResult`, `AgentStep`, errors)

### Phase 1: Safe Single-Agent Loop
- Implement agent loop with hard step limits
- Add approval modes (`suggest`, `auto-edit`)
- Add permission engine (`allow/ask/deny`) for path and shell commands
- Implement safe tools:
  - read/list/search files
  - patch/apply edits
  - guarded shell commands
  - git diff/status
- Add structured logs and usage accounting
- Add basic context compaction/checkpointing

### Phase 2: Planner + Delegation
- Add planner mode
- Add subagent execution path
- Add task decomposition and progress model

### Phase 3: Evaluation + Hardening
- Build benchmark tasks (bug fix, refactor, test repair)
- Add pass/fail scoring and regression gates
- Add speed SLOs and reporting:
  - time to first edit
  - completion latency
  - average step count
  - token/cost per successful task
- Harden timeout/retry/sandbox boundaries

## 8. Acceptance Criteria (V1)

- Can complete coding tasks end-to-end in local repos
- Never writes outside allowed workspace roots
- Supports deterministic edit flow (patch > apply > verify)
- Runs tests/checks after edits and reports results
- Produces per-turn usage/cost logs
- Passes baseline eval tasks consistently
- Supports `suggest` and `auto-edit` approval modes
- Enforces command/path permission rules (`allow/ask/deny`)
- Meets initial speed baselines on benchmark tasks
- Compacts/checkpoints long sessions without losing task continuity
- Supports local provider login/logout and secure local credential storage without external DB

## 9. Reference Implementations Reviewed

- OpenCode (active): architecture and stack inspiration  
  https://github.com/anomalyco/opencode

- OpenAI Codex (Rust): modular safety-oriented system design  
  https://github.com/openai/codex

- Gemini CLI: terminal-first workflows and extensibility ideas  
  https://github.com/google-gemini/gemini-cli

- Aider: practical git-centered edit/repair loop patterns  
  https://github.com/Aider-AI/aider

- Kode-Agent and qbit: additional product/UX references  
  https://github.com/shareAI-lab/Kode-Agent  
  https://github.com/qbit-ai/qbit

- Pi Monorepo: custom `ai + agent-core + coding-agent` package layering  
  https://github.com/badlogic/pi-mono

## 10. Feature References (Docs)

- OpenCode modes (plan/build): https://open-code.ai/en/docs/modes
- OpenCode permissions and guards: https://opencode.ai/docs/permissions/
- OpenCode LSP support: https://opencode.ai/docs/lsp-servers/
- OpenCode providers and credential storage: https://opencode.ai/docs/providers/
- Codex CLI approval modes: https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started
- AI SDK loop control: https://ai-sdk.dev/docs/agents/loop-control
- AI SDK subagents: https://ai-sdk.dev/docs/agents/subagents
- Aider repo map concept: https://aider.chat/docs/repomap.html
- Gemini CLI session management/checkpointing: https://geminicli.com/docs/cli/session-management/

## 11. Explicit Non-Goals (for now)

- Full IDE plugin before core CLI stabilizes
- Over-optimizing UI while core agent quality is not proven
- Framework-heavy abstractions that hide tool/sandbox behavior

## 12. Next Step

Before coding:
1. Confirm this architecture and stack choices.
2. Freeze V1 scope and acceptance criteria.
3. Start Phase 0 with workspace scaffolding and package contracts.

## 13. User Interaction Flow (V1)

1. User runs `xeq` inside a project directory.
2. CLI starts interactive session and loads:
   - project context
   - provider credentials (runtime/env/local auth store)
   - selected approval mode (`suggest` or `auto-edit`)
3. User enters instruction (example: "add JWT auth and tests").
4. Agent runs loop:
   - inspect relevant files
   - propose/perform patch-based edits
   - run verification commands/tests
   - report result and next action
5. Approval behavior:
   - `suggest`: show planned edits/commands and request confirmation
   - `auto-edit`: apply allowed edits automatically, ask for guarded actions
6. Session keeps history with compaction/checkpoints for long tasks.
7. User exits; session artifacts remain available (logs, usage/cost, optional checkpoints).
