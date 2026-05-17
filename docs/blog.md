  The best engineering-heavy topics in archer are:

  1. Context compaction for long-running coding agents
     This is probably your strongest pure engineering post. You have explicit compaction policy, continuation artifacts, thresholds, and recovery behavior rather than vague
     “memory” language. The core files are archer/packages/agent-core/src/runtime/compaction-policy.ts, archer/apps/cli/src/commands/compact.ts, and archer/packages/model-
     providers/src/compaction-artifact.ts.
  2. Designing a multi-phase agent runtime
     Planning, execution, verification, repair, and compaction as explicit phases is real systems content. That is much stronger than “I built an AI agent.” Use archer/packages/
     agent-core/src/runtime/turn-execution.ts, archer/packages/agent-core/src/runtime/task-flow.ts, archer/packages/agent-core/src/runtime/turn-state.ts, and archer/packages/
     agent-core/src/runtime/turn-reducer.ts.
  3. Approval-aware patch application in terminal agents
     This is strong if you focus on mechanics instead of trust/UX rhetoric. The interesting part is how patch previews interact with later file-write approvals and session-scoped
     decisions. Use archer/apps/cli/src/workflows/task/run-task.ts and archer/apps/cli/src/features/approvals/approvals.ts.
  4. A sandbox policy model for coding agents: allow, ask, deny
     Very good engineering topic if you stay concrete about command analysis and filesystem enforcement. Use archer/packages/sandbox/src/policy.ts, archer/packages/sandbox/src/
     command-analysis.ts, archer/packages/sandbox/src/providers/shell-provider.ts, and archer/packages/sandbox/src/providers/fs-provider.ts.
  5. When an agent framework stops fitting: wrapping OpenHarness behind an engine boundary
     This is architecture-heavy and probably your most mature draft-in-waiting because archer/docs/replace-openharness-future.md already contains the core argument.
  6. Subagents without losing runtime control
     Good topic if you want something advanced. Focus on delegation contracts, expected output modes, background execution, and event reconciliation. Use archer/packages/agent-
     core/src/runtime/subagent-execution.ts and archer/packages/shared/src/subagents/index.ts.
  7. Verification scope as a runtime policy problem
     This is niche but strong. The angle is that validation should scale with change risk, not default to repo-wide checks. Use archer/packages/agent-core/src/runtime/validation-
     policy.ts and the verification paths in archer/packages/agent-core/src/runtime/turn-execution.ts.

  If you want maximum engineering and minimum marketing, I would prioritize these in order:

  1. Context compaction for long-running coding agents
  2. Designing a multi-phase agent runtime
  3. A sandbox policy model for coding agents
  4. Approval-aware patch application in terminal agents
  5. Wrapping OpenHarness behind an engine boundary

  The reason is simple: those topics expose runtime design, control flow, and failure handling. They read like systems engineering, not startup copy.


  One caution: don’t write “Archer supports X.” Write “here is the runtime problem, here is the design, here is the tradeoff, here is the failure mode, here is the code shape.”
  That is the difference between an engineering post and a product post.