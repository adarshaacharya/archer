# Archer

Archer is a terminal-first AI coding agent for macOS, Linux, and WSL.

It is built for local development workflows where the agent should stay close to the code, respect boundaries, and make changes in a way you can inspect before they land.

## What It Does

Archer helps you work inside a repository with:

- explicit approval modes for risky actions
- patch-first file edits
- sandboxed command and filesystem policy checks
- provider switching without forcing you into a single model vendor
- usage and cost tracking
- TUI-driven interactive sessions

## What Makes It Different

Archer is not trying to hide the mechanics of agentic coding.

It is designed around a few practical rules:

- you keep your own API key
- you choose the provider and model
- you can inspect patches before applying them
- dangerous commands should be gated by policy, not assumed safe
- the CLI should feel like a developer tool, not a chatbot shell

## Features

- Terminal-first workflow
- Interactive TUI
- Approval-aware tool execution
- Patch-based editing
- Local policy enforcement for paths and commands
- Provider support for OpenAI, Anthropic, Gemini, and OpenRouter
- Web search and page navigation tools
- Session and turn persistence
- CLI commands for new sessions, resumes, compaction, and provider changes

## Local Setup

### Prerequisites

- Node.js 18 or newer
- Bun 1.2.x

### Install Dependencies

```bash
bun install
```

### Start the CLI

Run the CLI directly from the workspace:

```bash
bun run cli
```

You can also pass a prompt or task inline:

```bash
bun run cli -- "review this repository and suggest improvements"
```

### Common Commands

```bash
bun run dev
bun run check-types
bun run lint
bun run build
```

## Configuration

Archer reads configuration from environment variables.

### Model Providers

Choose a provider with `ARCHER_PROVIDER` and set the matching API key:

```bash
# OpenAI
ARCHER_PROVIDER=openai
OPENAI_API_KEY=...
AGENT_MODEL=gpt-4o-mini

# Anthropic
ARCHER_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
AGENT_MODEL=claude-3-5-sonnet-latest

# Gemini
ARCHER_PROVIDER=gemini
GEMINI_API_KEY=...
AGENT_MODEL=gemini-2.0-flash

# OpenRouter
ARCHER_PROVIDER=openrouter
OPENROUTER_API_KEY=...
AGENT_MODEL=openai/gpt-4o-mini
```

Supported aliases:

- `openrouter`
- `openai` or `codex`
- `anthropic` or `claude`
- `gemini` or `google`

### Web Search

Web search support can be configured with:

```bash
ARCHER_WEB_PROVIDER=tavily
TAVILY_API_KEY=...

ARCHER_WEB_PROVIDER=exa
EXA_API_KEY=...
```

### TUI Config

The TUI reads `tui.json` by default.

Set `ARCHER_TUI_CONFIG` to point to a different config file if needed.

## Project Layout

- `apps/cli`: terminal app and command handling
- `apps/web`: marketing site
- `packages/agent-core`: agent loop and orchestration
- `packages/model-providers`: provider adapters
- `packages/tools`: file, shell, git, and search tools
- `packages/sandbox`: policy engine for commands and paths
- `packages/shared`: shared types, schemas, and error contracts
- `packages/storage`: persistence layer
- `packages/tui`: terminal UI primitives

## CLI Commands

The CLI includes commands for:

- `/help`
- `/new`
- `/resume`
- `/init`
- `/commit`
- `/compact`
- `/providers`
- `/connect`
- `/change-key`
- `/disconnect`
- `/provider`
- `/model`
- `/web`
- `/web-provider`
- `/web-logout`
- `/permissions`
- `/logout`
- `/bye`
- `/exit`

## Development

```bash
bun run dev
bun run check-types
bun run lint
bun run build
```

## Repository Notes

- The CLI package publishes the `archer` binary.
- The workspace uses Turborepo and Bun.
- The codebase is split by responsibility so policy, tools, and orchestration stay separate.

## Contributing

If you change behavior, update tests where they exist.

If you touch workspace commands or package boundaries, keep the changes consistent across the monorepo.

## License

No license file is included yet.
Add one before treating the project as open source software.
