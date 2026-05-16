# @archer/tui

Terminal UI package built on Ink with a state-driven render loop.

## Responsibility

- Render session UI (steps, approvals, summaries).
- Handle terminal input and present approval prompts.
- Keep presentation logic isolated from core runtime.

## Must Not Do

- No direct model calls.
- No direct tool side effects.

## Depends On

- `@archer/shared`
- `ink`
- `react`
