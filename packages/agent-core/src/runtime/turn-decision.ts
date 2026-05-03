import { TurnDecisionSchema } from "@xeq/shared";

export type TurnObservedFacts = {
  changeFlowEntered: boolean;
  implementationAttempted: boolean;
  verificationAttempted: boolean;
};

export type RuntimeObservedIntent = "question" | "change";

export function parseTurnDecision(outputText: string) {
  try {
    return TurnDecisionSchema.parse(JSON.parse(outputText));
  } catch {
    return null;
  }
}

export function resolveObservedTurnIntent(
  facts: TurnObservedFacts,
  changedPaths: string[],
): RuntimeObservedIntent {
  if (
    facts.changeFlowEntered ||
    facts.implementationAttempted ||
    facts.verificationAttempted ||
    changedPaths.length > 0
  ) {
    return "change";
  }

  return "question";
}
