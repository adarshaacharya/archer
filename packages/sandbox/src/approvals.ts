export type ApprovalChoice = "once" | "always" | "reject";

export type ApprovalRequest =
  | {
      kind: "file-write";
      target: string;
      details?: string;
    }
  | {
      kind: "command";
      target: string;
      details?: string;
    };

export type ApprovalHandler = (
  request: ApprovalRequest,
) => Promise<ApprovalChoice> | ApprovalChoice;
