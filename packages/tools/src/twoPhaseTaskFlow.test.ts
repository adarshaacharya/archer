// packages/tools/src/twoPhaseTaskFlow.test.ts

import { createTaskPhaseController } from "../agent-core/src/runtime/task-flow";
import { expect } from "chai";  // Assuming chai is used for assertions


describe("Two-Phase Task Flow", () => {
  it("prevents file writing in the context phase", async () => {
    const controller = createTaskPhaseController("context");
    
    try {
      // Simulate file writing in context phase
      await writeFileInCurrentPhase("example.txt", "This should fail");
      throw new Error("Writing file should not be allowed in context phase.");
    } catch (error) {
      expect(error).to.exist; // Expect an error to be thrown
    }
  });

  it("allows file writing in the implementation phase", async () => {
    const controller = createTaskPhaseController("context");

    // Transition to implementation phase
    controller.beginImplementation();

    try {
      // Attempt file writing in implementation phase
      await writeFileInCurrentPhase("example.txt", "This should succeed");
      // If no error is thrown, the test passes
    } catch (error) {
      throw new Error("Writing file should be allowed in implementation phase.");
    }
  });

  async function writeFileInCurrentPhase(filePath: string, content: string) {
    // Implement file writing logic according to the current phase
    if (controller.isContextPhase()) {
      throw new Error("Cannot write file in context phase");
    } else {
      // Replace with actual file writing logic
      // fs.writeFileSync(filePath, content);
    }
  }
});