# @archer/model-providers

LLM provider adapters.

## Responsibility

- Normalize model API calls behind one internal interface.
- Map provider responses to shared internal types.
- Normalize provider/API failures into typed errors.

## Must Not Do

- No tool execution.
- No policy decisions.
- No UI rendering.

## Depends On

- `@archer/shared`
