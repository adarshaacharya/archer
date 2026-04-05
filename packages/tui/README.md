# @xeq/tui

Terminal UI package (pi-tui).

## Responsibility

- Render session UI (steps, approvals, summaries).
- Handle terminal input and present approval prompts.
- Keep presentation logic isolated from core runtime.

## Must Not Do

- No direct model calls.
- No direct tool side effects.

## Depends On

- `@xeq/shared`
- `@mariozechner/pi-tui`
- `react`
