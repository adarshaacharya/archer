export type TurnState =
  | "idle"
  | "routing"
  | "researching"
  | "planning"
  | "implementing"
  | "verifying"
  | "repairing"
  | "compacting"
  | "done"
  | "failed"
  | "cancelled";

const ALLOWED_TRANSITIONS: Record<TurnState, TurnState[]> = {
  idle: ["routing"],
  routing: ["researching", "planning", "done", "failed", "cancelled"],
  researching: ["planning", "implementing", "done", "failed", "cancelled"],
  planning: ["implementing", "failed", "cancelled"],
  implementing: ["verifying", "compacting", "done", "failed", "cancelled"],
  verifying: ["repairing", "done", "failed", "cancelled"],
  repairing: ["implementing", "failed", "cancelled"],
  compacting: ["implementing", "failed", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

export interface TurnStateMachine {
  readonly state: TurnState;
  transition(next: TurnState): void;
  beginResearch(): void;
  beginPlanning(): void;
  beginImplementation(): void;
  beginVerification(): void;
  beginRepair(): void;
  beginCompaction(): void;
  finish(): void;
  fail(): void;
  cancel(): void;
}

export function createTurnStateMachine(): TurnStateMachine {
  let state: TurnState = "idle";

  const transition = (next: TurnState) => {
    const allowed = ALLOWED_TRANSITIONS[state];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid turn transition: ${state} -> ${next}`);
    }
    state = next;
  };

  return {
    get state() {
      return state;
    },
    transition,
    beginResearch() {
      transition("researching");
    },
    beginPlanning() {
      transition("planning");
    },
    beginImplementation() {
      transition("implementing");
    },
    beginVerification() {
      transition("verifying");
    },
    beginRepair() {
      transition("repairing");
    },
    beginCompaction() {
      transition("compacting");
    },
    finish() {
      transition("done");
    },
    fail() {
      transition("failed");
    },
    cancel() {
      transition("cancelled");
    },
  };
}
