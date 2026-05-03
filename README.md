# XEQ

Terminal-first AI coding agent for macOS, Linux, and WSL.

XEQ is built for local, policy-aware agent workflows with:

- approval modes for safe execution
- patch-first editing
- sandboxed tool execution
- usage and cost logging
- Bun + Turborepo workspace support

## Install

Planned release paths:

- `npm install -g xeq`
- `npx xeq`
- `curl -fsSL https://example.com/install.sh | bash`

## What It Is

XEQ is a terminal coding agent designed to work like a real developer tool, not a chat demo.

It aims to provide:

- fast CLI-first interaction
- explicit tool approvals
- safe file and command policy enforcement
- model/provider switching
- TUI support for interactive sessions

## Repository Layout

- `apps/*`: user-facing apps, currently CLI first
- `packages/agent-core`: agent loop and orchestration
- `packages/model-providers`: model and provider adapters
- `packages/tools`: file, shell, and git tools
- `packages/sandbox`: path and command policy engine
- `packages/shared`: shared types, schemas, and error contracts

## Current Status

XEQ is still in early V1 scaffolding, with the main runtime direction set around an OpenHarness-backed core and XEQ-specific CLI/TUI behavior.

## Development

```bash
bun install
bun run check-types
bun run lint
bun run build
```

## Provider Configuration

Runtime selection is env-driven:

```bash
# default behavior
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

Accepted provider aliases:

- `openrouter`
- `openai` or `codex`
- `anthropic` or `claude`
- `gemini` or `google`

## Web Search

XEQ exposes `webSearch`, `webOpenPage`, and `webFindInPage` tools to the agent.

Supported web providers:

- `tavily`
- `exa`

```bash
XEQ_WEB_PROVIDER=tavily
TAVILY_API_KEY=...

XEQ_WEB_PROVIDER=exa
EXA_API_KEY=...
```

## Docs

- [Agent instructions](./AGENTS.md)
- [OpenHarness migration notes](./docs/replace-openharness-future.md)

