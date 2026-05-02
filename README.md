# XEQ

Pronunciation: `eks-ee-kyoo` (`X-E-Q`).

`XEQ` is derived from “execute,” condensed through “exeqt” into its final form.

Terminal-first AI coding agent monorepo (Bun + Turborepo).

## Status

Early V1 scaffolding is in progress:
- core package boundaries created
- shared contracts and sandbox interfaces created
- pi-tui-based `packages/tui` started
- migration direction set: OpenHarness-first runtime with XEQ-specific CLI/TUI behavior preserved

See:
- `AGENTS.md` for repo agent instructions

## Workspace Packages

- `packages/agent-core`: XEQ orchestration adapter (target: OpenHarness-backed runtime)
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

## Provider Configuration

Current runtime selection is env-driven:

```bash
# default behavior (current-compatible): OpenRouter
XEQ_PROVIDER=openrouter
OPENROUTER_API_KEY=...
AGENT_MODEL=openai/gpt-4o-mini

# direct OpenAI
XEQ_PROVIDER=openai
OPENAI_API_KEY=...
AGENT_MODEL=gpt-4o-mini

# direct Anthropic
XEQ_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
AGENT_MODEL=claude-3-5-sonnet-latest

# direct Gemini
XEQ_PROVIDER=gemini
GEMINI_API_KEY=...
AGENT_MODEL=gemini-2.0-flash
```

Provider aliases accepted by `XEQ_PROVIDER`:
- `openrouter`
- `openai` or `codex`
- `anthropic` or `claude`
- `gemini` or `google`

## Web Search

`xeq` now exposes `webSearch` and `webFetch` tools to the agent. Web search is configured lazily on first use, so startup does not require a web-search key.

Supported web providers:
- `tavily`
- `exa`

You can still configure them with env vars:

```bash
XEQ_WEB_PROVIDER=tavily
TAVILY_API_KEY=...

XEQ_WEB_PROVIDER=exa
EXA_API_KEY=...
```

In the CLI:
- `/web` connects a web-search provider
- `/web-provider` shows the current web-search provider
- `/web-logout` removes the saved web-search key for the active provider

Remembered network permissions:
- `webFetch` asks before fetching a new domain
- choosing `always` stores a `domain:host` allow rule in `~/.local/share/xeq/settings.json`


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
