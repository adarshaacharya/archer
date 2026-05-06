# @archer/tui

Terminal UI package built on OpenTUI with Solid-driven state.

## Responsibility

- Render session UI (steps, approvals, summaries).
- Handle terminal input and present approval prompts.
- Keep presentation logic isolated from core runtime.

## Must Not Do

- No direct model calls.
- No direct tool side effects.

## Depends On

- `@archer/shared`
- `@opentui/core`
- `solid-js`
