# @archer/storage

Persistence layer for sessions, messages, turn results, and prompt history.

## Responsibility

- Own sqlite/drizzle access and migration bootstrap.
- Expose persistence functions used by app/runtime packages.
- Keep data mapping and storage concerns local to this package.

## Allowed Dependencies

- `@archer/shared`
- `drizzle-orm`
- `ai` (token/model message shape compatibility)

## Must Not Do

- No model/provider calls.
- No command/tool execution.
- No UI concerns.

## Import Rules

- Other packages should import from `@archer/storage` public exports only.
- Do not import internal files from `packages/storage/src/*` across package boundaries.
