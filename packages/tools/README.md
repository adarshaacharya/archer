# @archer/tools

Tool runtime implementations.

## Responsibility

- Implement file/shell/git/search tools.
- Validate input/output against shared contracts.
- Route every side-effect through sandbox policy checks.

## Must Not Do

- No model API calls.
- No UI rendering.

## Depends On

- `@archer/shared`
- `@archer/sandbox`
