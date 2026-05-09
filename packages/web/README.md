# @archer/web-capability

Web capability adapters (search/open/find) for runtime usage.

## Responsibility

- Provide normalized web actions and action results.
- Implement provider wiring (e.g. Tavily/Exa/direct fetch).
- Keep web-specific parsing/normalization in this package.

## Allowed Dependencies

- `@archer/shared`
- `@archer/tools`

## Must Not Do

- No terminal UI concerns.
- No direct agent orchestration policy.

## Import Rules

- Import via `@archer/web-capability` public exports.
- Keep provider-specific details internal to package implementation.
