import type { ExecutionPlan, VerificationReport } from "./planning-artifacts.js";
import type { RuntimePhaseResult } from "./phase-runner.js";
import {
  type AnswerTurnPhase,
  type AnswerTurnState,
  type ChangeTurnCompactionReport,
  type ChangeTurnPhase,
  type ChangeTurnState,
  mergeChangeTurnTotals,
  runtimePhaseTotals,
} from "./turn-state.js";

export type ChangeTurnEvent =
  | { type: "phase.set"; phase: ChangeTurnPhase }
  | { type: "planning.recovery-attempted" }
  | { type: "planning.completed"; result: RuntimePhaseResult; plan: ExecutionPlan | null }
  | { type: "implementation.completed"; result: RuntimePhaseResult }
  | {
      type: "verification.completed";
      result: RuntimePhaseResult;
      report: VerificationReport | null;
    }
  | { type: "repair.completed"; result: RuntimePhaseResult; plan: ExecutionPlan | null }
  | {
      type: "compaction.completed";
      result: RuntimePhaseResult;
      report: ChangeTurnCompactionReport | null;
    }
  | { type: "implementation.addendum.set"; addendum: string | null }
  | { type: "failure.set"; message: string | null };

export type AnswerTurnEvent =
  | { type: "phase.set"; phase: AnswerTurnPhase }
  | { type: "final-message.set"; message: string | null }
  | { type: "synthesis.completed"; result: RuntimePhaseResult; message: string | null }
  | { type: "failure.set"; message: string | null };

export function reduceChangeTurnState(
  state: ChangeTurnState,
  event: ChangeTurnEvent,
): ChangeTurnState {
  switch (event.type) {
    case "phase.set":
      return {
        ...state,
        phase: event.phase,
      };
    case "planning.recovery-attempted":
      return {
        ...state,
        planningRecoveryAttempted: true,
      };
    case "planning.completed":
      return {
        ...state,
        plan: event.plan,
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "implementation.completed":
      return {
        ...state,
        implementationResult: event.result,
        verificationResult: null,
        verificationReport: null,
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "verification.completed":
      return {
        ...state,
        verificationResult: event.result,
        verificationReport: event.report,
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "repair.completed":
      return {
        ...state,
        plan: event.plan ?? state.plan,
        repairCount: state.repairCount + (event.plan ? 1 : 0),
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "compaction.completed":
      return {
        ...state,
        compactionReport: event.report,
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "implementation.addendum.set":
      return {
        ...state,
        implementationPromptAddendum: event.addendum,
      };
    case "failure.set":
      return {
        ...state,
        failureMessage: event.message,
      };
    default:
      return state;
  }
}

export function reduceAnswerTurnState(
  state: AnswerTurnState,
  event: AnswerTurnEvent,
): AnswerTurnState {
  switch (event.type) {
    case "phase.set":
      return {
        ...state,
        phase: event.phase,
      };
    case "final-message.set":
      return {
        ...state,
        finalMessage: event.message,
      };
    case "synthesis.completed":
      return {
        ...state,
        finalAnswerResult: event.result,
        finalMessage: event.message,
        totals: mergeChangeTurnTotals(state.totals, runtimePhaseTotals(event.result)),
      };
    case "failure.set":
      return {
        ...state,
        failureMessage: event.message,
      };
    default:
      return state;
  }
}
