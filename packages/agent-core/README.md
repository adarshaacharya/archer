# @archer/agent-core

Agent orchestration runtime.

## Responsibility

- Run the core agent loop (`plan -> model -> tools -> observe`).
- Enforce run budgets (`maxSteps`, duration, retry limits).
- Emit step/summary events for CLI/TUI.

## Must Not Do

- No direct filesystem/shell side effects.
- No terminal rendering logic.

## Depends On

- `@archer/shared`
- `@archer/model-providers`
- `@archer/tools`
