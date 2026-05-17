import { describe, expect, it } from "bun:test";
import { HarnessEventBus } from "./event-bus.js";

describe("HarnessEventBus", () => {
  it("delivers events to subscribers", () => {
    const bus = new HarnessEventBus();
    const seen: string[] = [];

    bus.subscribe((event) => {
      seen.push(event.type);
    });

    bus.emit({ type: "turn.started", turnId: "t1", mode: "change" });
    bus.emit({ type: "turn.completed", turnId: "t1", outputText: "ok", steps: 2 });

    expect(seen).toEqual(["turn.started", "turn.completed"]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new HarnessEventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(event.type);
    });

    bus.emit({ type: "turn.started", turnId: "t1", mode: "plan" });
    unsubscribe();
    bus.emit({ type: "turn.failed", turnId: "t1", error: "boom" });

    expect(seen).toEqual(["turn.started"]);
  });
});
