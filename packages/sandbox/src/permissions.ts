export type PermissionAction = "allow" | "ask" | "deny";

export type PermissionRule = {
  permission: "read" | "edit" | "bash" | "web_fetch" | "doom_loop";
  pattern: string;
  action: PermissionAction;
};

export type PermissionRequest = {
  permission: PermissionRule["permission"];
  pattern: string;
  metadata?: Record<string, unknown>;
};

export function evaluatePermission(
  request: PermissionRequest,
  rules: PermissionRule[],
): PermissionAction {
  const matching = rules.find(
    (rule) =>
      rule.permission === request.permission &&
      (rule.pattern === "*" || rule.pattern === request.pattern),
  );

  return matching?.action ?? "ask";
}
