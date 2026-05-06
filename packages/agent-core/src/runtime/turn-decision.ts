import { TurnDecisionSchema } from "@archer/shared";

export type TurnObservedFacts = {
  changeFlowEntered: boolean;
  implementationAttempted: boolean;
  verificationAttempted: boolean;
};

export type RuntimeObservedIntent = "question" | "change";

export function validateTurnDecision(value: unknown) {
  try {
    return TurnDecisionSchema.parse(value);
  } catch {
    return null;
  }
}

export function parseTurnDecision(outputText: string) {
  try {
    return validateTurnDecision(JSON.parse(outputText));
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
