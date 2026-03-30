# XEQ

Terminal-first AI coding agent monorepo (Bun + Turborepo).

## Status

Early V1 scaffolding is in progress:
- core package boundaries created
- shared contracts and sandbox interfaces created
- OpenTUI-based `packages/tui` started

See:
- `PLAN.md` for architecture decisions
- `STEPS.md` for V1 implementation order
- `AGENTS.md` for repo agent instructions

## Workspace Packages

- `packages/agent-core`: agent loop skeleton
- `packages/model-providers`: provider abstraction + OpenRouter stub
- `packages/sandbox`: policy decisions (`allow/ask/deny`)
- `packages/shared`: zod contracts and shared types/errors
- `packages/tools`: tool runtime (currently includes `readFileTool`)
- `packages/tui`: terminal UI layer (OpenTUI + console fallback)

## Commands

```bash
bun install
bun run check-types
```

## Notes

- This repo is being rebuilt from scratch.
