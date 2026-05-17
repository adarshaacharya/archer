import { describe, expect, it } from "bun:test";
import { HarnessTurnMachine } from "./turn-machine.js";

describe("HarnessTurnMachine", () => {
  it("allows valid transitions and tracks history", () => {
    const machine = new HarnessTurnMachine();
    machine.transition("running", "turn started");
    machine.transition("awaiting_approval", "needs patch approval");
    machine.transition("running", "approval granted");
    machine.transition("completed", "final response emitted");

    expect(machine.status).toBe("completed");
    expect(machine.history).toEqual([
      { from: "idle", to: "running", reason: "turn started" },
      { from: "running", to: "awaiting_approval", reason: "needs patch approval" },
      { from: "awaiting_approval", to: "running", reason: "approval granted" },
      { from: "running", to: "completed", reason: "final response emitted" },
    ]);
  });

  it("rejects illegal transitions", () => {
    const machine = new HarnessTurnMachine();
    expect(() => machine.transition("completed", "cannot complete before running")).toThrow(
      "Illegal turn transition: idle -> completed",
    );
  });
});
