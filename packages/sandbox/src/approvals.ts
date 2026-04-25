export type ApprovalChoice = "once" | "always" | "reject";

export type ApprovalRequest =
  | {
      kind: "file-write";
      target: string;
    }
  | {
      kind: "command";
      target: string;
    };

export type ApprovalHandler = (
  request: ApprovalRequest,
) => Promise<ApprovalChoice> | ApprovalChoice;
