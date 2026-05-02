import type { OpenHarnessToolEvent } from "@xeq/agent-core";

export interface EvalMetricsSummary {
  approvalCount: number;
  fileReadCount: number;
  changedPaths: string[];
  toolNames: string[];
  finalMessage: string;
}

type BundleFile = {
  filePath?: unknown;
};

type PatchLikeResult = {
  filePath?: unknown;
  files?: unknown;
  dirPath?: unknown;
  status?: unknown;
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function pushChangedPath(changedPaths: Set<string>, value: unknown) {
  if (isString(value)) {
    changedPaths.add(value);
  }
}

function collectChangedPaths(changedPaths: Set<string>, output: unknown) {
  if (typeof output !== "object" || output == null) {
    return;
  }

  const value = output as PatchLikeResult;
  pushChangedPath(changedPaths, value.filePath);
  pushChangedPath(changedPaths, value.dirPath);

  if (!Array.isArray(value.files)) {
    return;
  }

  for (const item of value.files) {
    if (typeof item !== "object" || item == null) {
      continue;
    }
    pushChangedPath(changedPaths, (item as BundleFile).filePath);
  }
}

export function createEvalMetricsCollector() {
  let approvalCount = 0;
  let fileReadCount = 0;
  const changedPaths = new Set<string>();
  const toolNames = new Set<string>();
  let finalMessage = "";

  return {
    recordApproval() {
      approvalCount += 1;
    },
    recordFinalMessage(message: string) {
      if (message.trim()) {
        finalMessage = message;
      }
    },
    onToolEvent(event: OpenHarnessToolEvent) {
      if (event.phase === "start") {
        toolNames.add(event.toolName);
        if (event.toolName === "readFile") {
          fileReadCount += 1;
        }
        return;
      }

      if (event.phase !== "done") {
        return;
      }

      toolNames.add(event.toolName);
      if (
        event.toolName === "preparePatch" ||
        event.toolName === "preparePatchBundle" ||
        event.toolName === "createDirectory"
      ) {
        collectChangedPaths(changedPaths, event.output);
      }
    },
    summarize(): EvalMetricsSummary {
      return {
        approvalCount,
        fileReadCount,
        changedPaths: [...changedPaths].sort(),
        toolNames: [...toolNames].sort(),
        finalMessage,
      };
    },
  };
}
