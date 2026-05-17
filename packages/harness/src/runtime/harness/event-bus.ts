import type { HarnessEvent } from "./contracts.js";

export type HarnessEventHandler = (event: HarnessEvent) => void;

export class HarnessEventBus {
  #handlers = new Set<HarnessEventHandler>();

  subscribe(handler: HarnessEventHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  emit(event: HarnessEvent): void {
    for (const handler of this.#handlers) {
      handler(event);
    }
  }
}
