/**
 * TODO: when policy result is ask, show prompt with choices:
      - once, always, reject

  . packages/sandbox/src/approval-store.ts (new)

  - store persisted always rules (in-memory first, file later)

  . packages/sandbox/src/providers/shell-provider.ts

  - on ask:
      - check store for existing always-match
      - if none, call CLI approval callback
      - apply choice:
          - once -> run now
          - always -> save rule, run
          - reject -> throw deny error

  . packages/sandbox/src/providers/fs-provider.ts

  - same pattern for write operations if you want file-level asks too (optional initially)

  . packages/agent-core

  - pass approval callback from runtime deps down to sandbox providers (through environment creation/wiring)

 */
export type ApprovalChoice = "once" | "always" | "reject";
