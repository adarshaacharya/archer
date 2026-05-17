import type { HarnessTurnStatus } from "./contracts.js";

type Transition = {
  from: HarnessTurnStatus;
  to: HarnessTurnStatus;
  reason: string;
};

function isAllowedTransition(from: HarnessTurnStatus, to: HarnessTurnStatus): boolean {
  if (from === to) {
    return false;
  }

  switch (from) {
    case "idle":
      return to === "running";
    case "running":
      return to === "awaiting_approval" || to === "cancelled" || to === "failed" || to === "completed";
    case "awaiting_approval":
      return to === "running" || to === "cancelled" || to === "failed";
    case "cancelled":
    case "failed":
    case "completed":
      return false;
    default:
      return false;
  }
}

export class HarnessTurnMachine {
  #status: HarnessTurnStatus = "idle";
  #history: Transition[] = [];

  get status(): HarnessTurnStatus {
    return this.#status;
  }

  get history(): Transition[] {
    return [...this.#history];
  }

  transition(to: HarnessTurnStatus, reason: string): void {
    const from = this.#status;
    if (!isAllowedTransition(from, to)) {
      throw new Error(`Illegal turn transition: ${from} -> ${to}`);
    }

    this.#status = to;
    this.#history.push({ from, to, reason });
  }
}
