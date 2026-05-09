# @archer/evals

Evaluation runner and scoring package for Archer quality checks.

## Responsibility

- Define eval scenarios and scoring logic.
- Run eval CLI workflows using persisted run/session data.

## Allowed Dependencies

- `@archer/storage`
- `@archer/shared`

## Must Not Do

- No runtime side effects outside eval execution.
- No production orchestration logic.

## Import Rules

- Keep eval-only helpers inside this package.
- Do not let app/runtime packages depend on eval internals.
