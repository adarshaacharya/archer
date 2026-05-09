import type { PreRouteResult } from "../../features/routing/intent-router.js";
import type { TurnResult } from "../../features/runtime/turn-types.js";

export type TaskExecutionRoute = "direct-answer" | "web-context" | "research" | "change";

export function resolveTaskExecutionRoute(
  resolvedPreRoute: PreRouteResult | null,
  declaredIntent: TurnResult["intent"],
): TaskExecutionRoute {
  if (declaredIntent === "change") {
    return "change";
  }
  if (!resolvedPreRoute) {
    return "research";
  }
  if (resolvedPreRoute.mode === "change") {
    return "change";
  }
  if (resolvedPreRoute.mode === "direct-answer") {
    return "direct-answer";
  }
  if (resolvedPreRoute.mode === "web-context") {
    return "web-context";
  }
  return "research";
}
