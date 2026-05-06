# Archer

Terminal-first AI coding agent for macOS, Linux, and WSL.

Archer is built as a Bun monorepo for local, policy-aware agent workflows. The project is focused on:

- approval modes for safe execution
- patch-first editing
- sandboxed tool execution
- usage and cost logging
- provider switching without hiding your API key

## Why Archer

Archer is designed to feel like a real developer tool, not a chat demo.

It keeps the important controls visible:

- you choose the model provider
- you approve risky actions
- you can review and apply patches before they land
- you can keep cost and access under your own account

## Features

- Terminal-first CLI workflow
- Approval-aware tool execution
- Patch-based file edits
- Sandboxed filesystem and command policy checks
- Provider abstraction across OpenAI, Anthropic, Gemini, and OpenRouter
- Web search and page navigation tools
- TUI support for interactive sessions

## Repository Layout

- `apps/cli`: main CLI entry point
- `apps/web`: marketing site
- `packages/agent-core`: agent loop and orchestration
- `packages/model-providers`: model/provider adapters
- `packages/tools`: file, shell, git, and search tools
- `packages/sandbox`: path and command policy engine
- `packages/shared`: shared types, schemas, and error contracts
- `packages/storage`: persistence layer
- `packages/tui`: terminal UI components

## Getting Started

### Prerequisites

- Node.js 18 or newer
- Bun 1.2.x

### Install

```bash
bun install
```

### Development

Run the workspace dev tasks:

```bash
bun run dev
```

If you want to run the CLI directly:

```bash
bun run cli
```

### Quality Checks

```bash
bun run check-types
bun run lint
bun run build
```

## Configuration

Archer reads runtime configuration from environment variables.

### Model Provider

Set the provider with `ARCHER_PROVIDER` and provide the matching API key:

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

Supported provider aliases:

- `openrouter`
- `openai` or `codex`
- `anthropic` or `claude`
- `gemini` or `google`

### Web Search

Archer can use web search providers for search and page navigation tools:

```bash
ARCHER_WEB_PROVIDER=tavily
TAVILY_API_KEY=...

ARCHER_WEB_PROVIDER=exa
EXA_API_KEY=...
```

### TUI Config

The terminal UI can be customized with `tui.json` or by setting `ARCHER_TUI_CONFIG` to a config file path.

## Current Status

Archer is still in early V1 scaffolding.

The current direction is:

- OpenHarness-backed runtime for now
- Archer-owned orchestration, approvals, and policy
- gradual movement toward a thinner internal engine boundary

See [docs/replace-openharness-future.md](./docs/replace-openharness-future.md) for the migration notes.

## Documentation

- [AGENTS.md](./AGENTS.md) for working rules in this repo
- [OpenHarness migration notes](./docs/replace-openharness-future.md)

## Contributing

Before making changes, read [AGENTS.md](./AGENTS.md).

Suggested checks before opening a PR:

```bash
bun run check-types
bun run lint
bun run build
```

If you change runtime behavior, add or update tests where the harness already exists.

## License

This repository does not include a license file yet.
If you plan to publish it as open source, add a license before treating it as publicly reusable.
