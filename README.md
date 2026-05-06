<p align="center">
  <img
    src="./apps/web/public/logos/banner.png"
    alt="Archer wordmark"
    width="280"
  />
</p>

# Archer

Archer is a terminal based AI coding agent for macOS, Linux, and WSL. Bring your own API key, choose your model provider, no hidden costs, completely free to use.

## Features

- BYOK
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


## Contributing

If you change behavior, update tests where they exist.

If you touch workspace commands or package boundaries, keep the changes consistent across the monorepo.

## License

[MIT](LICENSE)