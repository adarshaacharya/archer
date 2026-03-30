import type { AgentState, ModelDecision, RunContext, ToolCall, ToolResult } from "./types.js";

export interface PreModelContext {
  run: RunContext;
  state: AgentState;
}

export interface PostModelContext {
  run: RunContext;
  state: AgentState;
  decision: ModelDecision;
}

export interface PreToolContext {
  run: RunContext;
  state: AgentState;
  call: ToolCall;
}

export interface PostToolContext {
  run: RunContext;
  state: AgentState;
  call: ToolCall;
  result: ToolResult;
}

export interface ErrorContext {
  run: RunContext;
  state: AgentState;
  error: unknown;
}

export interface FinishContext {
  run: RunContext;
  state: AgentState;
}

export interface AgentMiddleware {
  preModel?(ctx: PreModelContext): Promise<void> | void;
  postModel?(ctx: PostModelContext): Promise<void> | void;
  preTool?(ctx: PreToolContext): Promise<void> | void;
  postTool?(ctx: PostToolContext): Promise<void> | void;
  onError?(ctx: ErrorContext): Promise<void> | void;
  onFinish?(ctx: FinishContext): Promise<void> | void;
}

export interface MiddlewareRunner {
  runPreModel(ctx: PreModelContext): Promise<void>;
  runPostModel(ctx: PostModelContext): Promise<void>;
  runPreTool(ctx: PreToolContext): Promise<void>;
  runPostTool(ctx: PostToolContext): Promise<void>;
  runOnError(ctx: ErrorContext): Promise<void>;
  runOnFinish(ctx: FinishContext): Promise<void>;
}

export function composeMiddleware(middlewares: AgentMiddleware[]): MiddlewareRunner {
  return {
    async runPreModel(ctx) {
      for (const m of middlewares) await m.preModel?.(ctx);
    },
    async runPostModel(ctx) {
      for (const m of middlewares) await m.postModel?.(ctx);
    },
    async runPreTool(ctx) {
      for (const m of middlewares) await m.preTool?.(ctx);
    },
    async runPostTool(ctx) {
      for (const m of middlewares) await m.postTool?.(ctx);
    },
    async runOnError(ctx) {
      for (const m of middlewares) await m.onError?.(ctx);
    },
    async runOnFinish(ctx) {
      for (const m of middlewares) await m.onFinish?.(ctx);
    },
  };
}
