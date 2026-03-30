# @xeq/sandbox

Policy and permission engine.

## Responsibility

- Decide `allow / ask / deny` for:
  - file path access
  - command execution
- Enforce workspace boundaries and safety rules.

## Must Not Do

- No command execution.
- No file editing.

## Depends On

- `@xeq/shared`
