# Archer

Terminal-first AI coding agent for macOS, Linux, and WSL.

Archer is built for local, policy-aware agent workflows with:

- approval modes for safe execution
- patch-first editing
- sandboxed tool execution
- usage and cost logging
- Bun + Turborepo workspace support

## Install

Planned release paths:

- `npm install -g archer`
- `npx archer`
- `curl -fsSL https://example.com/install.sh | bash`

## What It Is

Archer is a terminal coding agent designed to work like a real developer tool, not a chat demo.

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

Archer is still in early V1 scaffolding, with the main runtime direction set around an OpenHarness-backed core and Archer-specific CLI/TUI behavior.

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
ARCHER_PROVIDER=openrouter
OPENROUTER_API_KEY=...
AGENT_MODEL=openai/gpt-4o-mini

# direct OpenAI
ARCHER_PROVIDER=openai
OPENAI_API_KEY=...
AGENT_MODEL=gpt-4o-mini

# direct Anthropic
ARCHER_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
AGENT_MODEL=claude-3-5-sonnet-latest

# direct Gemini
ARCHER_PROVIDER=gemini
GEMINI_API_KEY=...
AGENT_MODEL=gemini-2.0-flash
```

Accepted provider aliases:

- `openrouter`
- `openai` or `codex`
- `anthropic` or `claude`
- `gemini` or `google`

## Web Search

Archer exposes `webSearch`, `webOpenPage`, and `webFindInPage` tools to the agent.

Supported web providers:

- `tavily`
- `exa`

```bash
ARCHER_WEB_PROVIDER=tavily
TAVILY_API_KEY=...

ARCHER_WEB_PROVIDER=exa
EXA_API_KEY=...
```

## Docs

- [Agent instructions](./AGENTS.md)
- [OpenHarness migration notes](./docs/replace-openharness-future.md)



   1. The Human Persona: (e.g., Devin, Claude, Cody, Junie) – These aim to feel like a "teammate" or a pair programmer.
   2. The Action Tool: (e.g., Cursor, Windsurf, Sweep, Amp, Aider) – These emphasize what the tool does (navigation, cleaning,
      accelerating).
   3. The Abstract/Modern: (e.g., Zed, Pika, PearAI, Phind) – Short, punchy, and brandable names that don't necessarily describe the
      function but feel modern.