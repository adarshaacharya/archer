import {
  BoxRenderable,
  type CliRenderer,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
  fg,
  type TextChunk,
} from "@opentui/core";
import { batch, createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import { createPlainComposerSubmission, type AgentStep, type ComposerMentionBinding, type ComposerSubmission, type RunSummary } from "@xeq/shared";
import { buildComposerTextElements, findActiveMentionQuery, insertFileMention, MentionFileIndex, type ActiveMentionQuery, type MentionSuggestion, reconcileMentionBindings } from "./mention-state.js";
import { PromptHistory, type PromptHistoryEntry } from "./prompt-history.js";

export interface ApprovalPromptState {
  message: string;
  options?: string[];
  choices?: ApprovalDialogChoice[];
  selectedIndex?: number;
  details?: string;
  review?: PatchReviewState;
}

export interface SlashCommandItem {
  name: string;
  description: string;
}

export interface Tui {
  start(): Promise<void>;
  renderStartupBanner(): void;
  setActiveModel(modelId: string): void;
  loadPersistentPromptHistory(entries: string[]): void;
  renderUserMessage(message: string): void;
  renderAssistantMessage(message: string): void;
  renderInfoMessage(message: string): void;
  renderInfoLines(lines: Array<{ text: string; color?: string }>): void;
  renderStep(step: AgentStep): void;
  renderAssistantDelta(delta: string): void;
  finalizeAssistantStream(text?: string): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
  promptApproval(prompt: ApprovalPromptState): Promise<string>;
  renderSummary(summary: RunSummary): void;
  setSlashCommands(commands: SlashCommandItem[]): void;
  readInput(): Promise<ComposerSubmission>;
  readInputLine(): Promise<string>;
  onCancelRunning(handler: (() => void) | null): void;
  stop(): void;
}

export type ApprovalDialogChoice = {
  value: string;
  label: string;
  description?: string;
};

export type PatchReviewFile = {
  filePath: string;
  diff: string;
  status?: string;
};

export type PatchReviewState = {
  summary: string;
  changedFilesCount: number;
  files: PatchReviewFile[];
};

// Color palette ───────────────────────────────────────────────────────────────

const col = {
  bg:        "#0D1117",
  userBg:    "#161B22",
  text:      "#E6EDF3",
  muted:     "#6E7681",
  border:    "#30363D",
  accent:    "#58A6FF",
  user:      "#3FB950",
  step:      "#6E7681",
  summary:   "#F0883E",
};

// Footer sizing: status(2) + composer box(5) = 7 before slash menu or dialogs.
const BASE_FOOTER = 7;
const MAX_SLASH_ROWS = 6;
const MAX_MENTION_ROWS = 8;

// ─────────────────────────────────────────────────────────────────────────────

type PendingModal =
  | {
      type: "approval";
      resolve: (value: string) => void;
      select: SelectRenderable;
      box: BoxRenderable;
    }
  | {
      type: "review";
      resolve: (value: string) => void;
      fileSelect: SelectRenderable;
      actionSelect: SelectRenderable;
      preview: TextRenderable;
      box: BoxRenderable;
      focused: "files" | "actions";
    };

function normalizeText(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function wrappedLineCount(value: string, width: number): number {
  const safeWidth = Math.max(1, width);
  const lines = value.length === 0 ? [""] : value.split("\n");
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / safeWidth)), 0);
}

function compactDiff(diff: string, maxLines = 16): string {
  const lines: string[] = [];
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) { inHunk = true; lines.push(raw); continue; }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) { lines.push(raw); continue; }
    if (!inHunk) continue;
    if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ")) lines.push(raw);
  }
  if (lines.length <= maxLines) return lines.join("\n").trim() || "(no diff)";
  return `${lines.slice(0, maxLines).join("\n")}\n... truncated ...`;
}

function defaultApprovalChoices(): ApprovalDialogChoice[] {
  return [
    { value: "reject",  label: "Reject",        description: "Deny this action" },
    { value: "once",    label: "Approve once",   description: "Allow this action this time only" },
    { value: "always",  label: "Always approve", description: "Remember this rule for next time" },
  ];
}

function approvalTitle(prompt: ApprovalPromptState): string {
  const message = normalizeText(prompt.message).toLowerCase();
  if (message.includes("choose model")) return "model picker";
  if (message.includes("choose model provider")) return "provider picker";
  if (message.includes("review")) return "review changes";
  return "selection";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approvalDialogWidth(prompt: ApprovalPromptState, choices: ApprovalDialogChoice[]): number {
  const labelWidth = Math.max(...choices.map((choice) => choice.label.length), 0);
  const detailWidth = prompt.details ? normalizeText(prompt.details).length : 0;
  const messageWidth = normalizeText(prompt.message).length;
  return clamp(Math.max(labelWidth + 10, detailWidth + 4, messageWidth + 4), 42, 88);
}

function statusPromptStyle(prompt: ApprovalPromptState): {
  primary: string;
  primaryColor: string;
  secondary?: string;
  secondaryColor?: string;
} {
  const message = normalizeText(prompt.message);
  const hint = prompt.options ? `  ${prompt.options.join("  ")}` : "";
  if (message.startsWith("Enter API key for ")) {
    return {
      primary: message,
      primaryColor: col.accent,
      secondary: "Type /exit to cancel",
      secondaryColor: col.muted,
    };
  }
  return {
    primary: message + hint,
    primaryColor: col.text,
  };
}

function slashCommandMatches(commands: SlashCommandItem[], input: string): SlashCommandItem[] {
  const v = input.trim();
  if (!v.startsWith("/")) return [];
  const query = v.slice(1).toLowerCase();
  const matches = commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(query));
  return matches.length > 0 ? matches : commands;
}

export class PiTui implements Tui {
  private renderer: CliRenderer | null = null;
  private footerRoot: BoxRenderable | null = null;
  private composerBox: BoxRenderable | null = null;
  private inputRow: BoxRenderable | null = null;
  private statusPrimaryText: TextRenderable | null = null;
  private statusSecondaryText: TextRenderable | null = null;
  private input: TextareaRenderable | null = null;
  private slashMenuBox: BoxRenderable | null = null;
  private slashMenuSelect: SelectRenderable | null = null;
  private slashCommands: SlashCommandItem[] = [];
  private slashMenuItems: SlashCommandItem[] = [];
  private slashMenuIndex = 0;
  private slashMenuScrollOffset = 0;
  private slashLineCount = 0;
  private mentionMenuBox: BoxRenderable | null = null;
  private mentionMenuSelect: SelectRenderable | null = null;
  private mentionMenuItems: MentionSuggestion[] = [];
  private mentionMenuIndex = 0;
  private mentionMenuScrollOffset = 0;
  private mentionLineCount = 0;
  private activeMentionQuery: ActiveMentionQuery | null = null;
  private readonly mentionFileIndex = new MentionFileIndex(process.cwd());
  private mentionQueryRequestId = 0;
  private currentInput = "";
  private currentMentionBindings: ComposerMentionBinding[] = [];
  private readonly promptHistory = new PromptHistory();
  private applyingPromptHistoryValue = false;
  private applyingComposerUpdate = false;
  private nextMentionBindingsOverride: ComposerMentionBinding[] | null = null;
  private assistantStreamText = "";
  private pendingReadResolve: ((line: string) => void) | null = null;
  private pendingSubmissionResolve: ((submission: ComposerSubmission) => void) | null = null;
  private pendingApprovalResolve: ((choice: string) => void) | null = null;
  private pendingModal: PendingModal | null = null;
  private cancelRunningHandler: (() => void) | null = null;
  private activeModelLabel = "model=unconfigured";
  private dispose: VoidFunction | null = null;
  private setInputValue: ((value: string) => void) | null = null;
  private setSlashCommandsState: ((value: SlashCommandItem[]) => void) | null = null;
  private setApprovalRows: ((value: number) => void) | null = null;

  private setStatus(
    primary: string,
    primaryColor: string = col.muted,
    secondary = "",
    secondaryColor: string = col.muted,
  ): void {
    if (!this.statusPrimaryText || !this.statusSecondaryText) return;
    this.statusPrimaryText.content = primary;
    this.statusPrimaryText.fg = primaryColor;
    this.statusSecondaryText.content = secondary;
    this.statusSecondaryText.fg = secondaryColor;
    this.renderer?.requestRender();
  }

  private handleSlashMenuClick(screenY: number): void {
    if (!this.currentInput.trim().startsWith("/") || this.slashMenuItems.length === 0 || !this.slashMenuSelect) {
      return;
    }
    const row = screenY - this.slashMenuSelect.screenY;
    if (row < 0 || row >= this.slashLineCount) {
      return;
    }
    const absoluteIndex = this.slashMenuScrollOffset + row;
    if (absoluteIndex < 0 || absoluteIndex >= this.slashMenuItems.length) {
      return;
    }
    this.slashMenuIndex = absoluteIndex;
    this.syncSlashMenuViewport();
    this.syncSlashMenuSelect();
    this.submitSlashMenuSelection();
  }

  private handleMentionMenuClick(screenY: number): void {
    if (!this.activeMentionQuery || this.mentionMenuItems.length === 0 || !this.mentionMenuSelect) {
      return;
    }
    const row = screenY - this.mentionMenuSelect.screenY;
    if (row < 0 || row >= this.mentionLineCount) {
      return;
    }
    const absoluteIndex = this.mentionMenuScrollOffset + row;
    if (absoluteIndex < 0 || absoluteIndex >= this.mentionMenuItems.length) {
      return;
    }
    this.mentionMenuIndex = absoluteIndex;
    this.syncMentionMenuViewport();
    this.syncMentionMenuSelect();
    void this.submitMentionMenuSelection();
  }

  private syncScrollbackViewport(): void {
    const renderer = this.renderer as CliRenderer | null;
    if (!renderer) return;

    const sync = (renderer as unknown as { syncSplitScrollback?: () => void }).syncSplitScrollback;
    if (typeof sync === "function") {
      sync.call(renderer);
    }
  }

  private writeScrollback(write: Parameters<CliRenderer["writeToScrollback"]>[0]): void {
    if (!this.renderer) return;
    this.renderer.writeToScrollback(write);
    this.syncScrollbackViewport();
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      screenMode: "split-footer",
      footerHeight: BASE_FOOTER,
      externalOutputMode: "capture-stdout",
      exitOnCtrlC: false,
      clearOnShutdown: false,
      autoFocus: true,
      useMouse: false,
      targetFps: 30,
    });

    this.dispose = createRoot((dispose) => {
      const [, setInputValue] = createSignal("")
      const [, setSlashCommandsState] = createSignal<SlashCommandItem[]>([])
      const [approvalRows, setApprovalRows] = createSignal(0)

      this.setInputValue = setInputValue
      this.setSlashCommandsState = setSlashCommandsState
      this.setApprovalRows = setApprovalRows

      createEffect(() => {
        const renderer = this.renderer
        if (!renderer) return
        const nextHeight = BASE_FOOTER + this.slashLineCount + this.mentionLineCount + approvalRows()
        if (renderer.footerHeight === nextHeight) return
        renderer.footerHeight = nextHeight
        renderer.requestRender()
      })

      onCleanup(() => {
        this.setInputValue = null
        this.setSlashCommandsState = null
        this.setApprovalRows = null
      })

      return dispose
    });

    // ── Footer layout ─────────────────────────────────────────────────────────
    this.footerRoot = new BoxRenderable(this.renderer, {
      id: "footer",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "stretch",
    });

    // Status line (2 rows, above composer border)
    const statusRow = new BoxRenderable(this.renderer, {
      id: "status-row",
      width: "100%",
      height: 2,
      flexShrink: 0,
      flexDirection: "column",
      alignItems: "stretch",
      paddingLeft: 1,
    });
    this.statusPrimaryText = new TextRenderable(this.renderer, {
      id: "status-primary-text",
      content: "",
      width: "100%",
      height: 1,
      fg: col.muted,
    });
    this.statusSecondaryText = new TextRenderable(this.renderer, {
      id: "status-secondary-text",
      content: "",
      width: "100%",
      height: 1,
      fg: col.muted,
    });
    statusRow.add(this.statusPrimaryText);
    statusRow.add(this.statusSecondaryText);

    // Slash menu — sits below the composer, hidden until typing "/"
    this.slashMenuBox = new BoxRenderable(this.renderer, {
      id: "slash-menu-box",
      width: "100%",
      height: 0,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      onMouseDown: (event) => {
        this.handleSlashMenuClick(event.y);
        event.stopPropagation();
      },
    });
    this.slashMenuSelect = new SelectRenderable(this.renderer, {
      id: "slash-menu-select",
      width: "100%",
      height: 0,
      options: [],
      showDescription: false,
      showScrollIndicator: this.slashMenuItems.length > MAX_SLASH_ROWS,
      wrapSelection: true,
      textColor: col.muted,
      descriptionColor: col.muted,
      selectedBackgroundColor: col.userBg,
      selectedTextColor: col.text,
      selectedDescriptionColor: col.muted,
      onMouseDown: (event) => {
        this.handleSlashMenuClick(event.y);
        event.stopPropagation();
      },
    });
    this.slashMenuSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: number }) => {
      if (typeof item.value !== "number") return;
      this.slashMenuIndex = item.value;
      this.syncSlashMenuViewport();
      this.syncSlashMenuSelect();
      this.submitSlashMenuSelection();
    });
    this.slashMenuBox.add(this.slashMenuSelect);

    this.mentionMenuBox = new BoxRenderable(this.renderer, {
      id: "mention-menu-box",
      width: "100%",
      height: 0,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      onMouseDown: (event) => {
        this.handleMentionMenuClick(event.y);
        event.stopPropagation();
      },
    });
    this.mentionMenuSelect = new SelectRenderable(this.renderer, {
      id: "mention-menu-select",
      width: "100%",
      height: 0,
      options: [],
      showDescription: false,
      showScrollIndicator: this.mentionMenuItems.length > MAX_MENTION_ROWS,
      wrapSelection: true,
      textColor: col.muted,
      descriptionColor: col.muted,
      selectedBackgroundColor: col.userBg,
      selectedTextColor: col.text,
      selectedDescriptionColor: col.muted,
      onMouseDown: (event) => {
        this.handleMentionMenuClick(event.y);
        event.stopPropagation();
      },
    });
    this.mentionMenuSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: number }) => {
      if (typeof item.value !== "number") return;
      this.mentionMenuIndex = item.value;
      this.syncMentionMenuViewport();
      this.syncMentionMenuSelect();
      void this.submitMentionMenuSelection();
    });
    this.mentionMenuBox.add(this.mentionMenuSelect);

    // Composer box: just the border + input row (no slash inside)
    const composerBox = new BoxRenderable(this.renderer, {
      id: "composer",
      width: "100%",
      height: 5,
      flexShrink: 0,
      flexDirection: "column",
      alignItems: "stretch",
      border: true,
      borderStyle: "single",
      borderColor: col.border,
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.composerBox = composerBox;

    const inputRow = new BoxRenderable(this.renderer, {
      id: "input-row",
      width: "100%",
      height: 3,
      flexDirection: "row",
      alignItems: "stretch",
    });
    this.inputRow = inputRow;

    const promptGlyph = new TextRenderable(this.renderer, {
      id: "prompt",
      content: ">",
      width: 2,
      flexShrink: 0,
      fg: col.accent,
    });

    this.input = new TextareaRenderable(this.renderer, {
      id: "input",
      initialValue: "",
      placeholder: "message xeq…",
      wrapMode: "word",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 3,
      maxHeight: 3,
      textColor: col.text,
      keyBindings: [
        { name: "return", action: "submit" },
        { name: "linefeed", action: "submit" },
        { name: "return", shift: true, action: "newline" },
        { name: "linefeed", shift: true, action: "newline" },
      ],
      onContentChange: () => {
        const value = this.input?.plainText ?? "";
        if (this.applyingComposerUpdate) {
          this.applyingComposerUpdate = false;
          this.applyingPromptHistoryValue = false;
          this.currentMentionBindings = this.nextMentionBindingsOverride ?? this.currentMentionBindings;
          this.nextMentionBindingsOverride = null;
        } else if (this.applyingPromptHistoryValue) {
          this.applyingPromptHistoryValue = false;
          this.currentMentionBindings = [];
        } else {
          this.currentMentionBindings = reconcileMentionBindings(this.currentInput, value, this.currentMentionBindings);
          if (this.promptHistory.isNavigating()) {
            this.promptHistory.clearNavigation();
          }
          this.promptHistory.syncDraft(value, this.currentMentionBindings);
        }
        this.currentInput = value;
        this.setInputValue?.(value);
        this.updateSlashMenu(value);
        void this.updateMentionMenu(value);
        this.syncComposerLayout();
      },
      onSubmit: () => {
        this.submitComposerValue(normalizeText(this.input?.plainText ?? ""));
      },
      onSizeChange: () => {
        this.syncComposerLayout();
      },
    });

    inputRow.add(promptGlyph);
    inputRow.add(this.input);
    composerBox.add(inputRow);

    this.footerRoot.add(statusRow);
    this.footerRoot.add(composerBox);
    this.footerRoot.add(this.slashMenuBox);
    this.footerRoot.add(this.mentionMenuBox);
    this.renderer.root.add(this.footerRoot);
    this.renderer.start();
    this.syncComposerLayout();

    this.renderer.addInputHandler((seq) => {
      if (seq === "\x03") {
        this.cancelRunningHandler?.();
        this.renderer?.destroy();
        process.exit(130);
        return true;
      }
      if (this.handleSlashMenuInput(seq)) {
        return true;
      }
      if (this.handleMentionMenuInput(seq)) {
        return true;
      }
      if (this.handlePromptHistoryInput(seq)) {
        return true;
      }
      if (seq === "\x1b" && this.pendingModal) {
        this.rejectPendingModal();
        return true;
      }
      if (seq === "\x1b" && this.cancelRunningHandler) {
        this.cancelRunningHandler();
        return true;
      }
      return false;
    });

    this.input.focus();
  }

  renderStartupBanner(): void {
    this.renderStartupCard();
    this.print("");
  }

  setActiveModel(modelId: string): void {
    const value = modelId.trim();
    this.activeModelLabel = value ? `model=${value}` : "model=unconfigured";
    this.setStatus("", col.muted, "", col.muted);
  }

  loadPersistentPromptHistory(entries: string[]): void {
    this.promptHistory.loadPersistentTexts(entries);
  }

  renderUserMessage(message: string): void {
    const text = normalizeText(message);
    if (!text) return;
    this.renderMessageBlock(text, {
      textColor: col.text,
      prefix: "› ",
      backgroundColor: "#1b1f24",
      fullWidthBackground: true,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 0,
      paddingBottom: 0,
    });
    this.print("");
  }

  renderAssistantMessage(message: string): void {
    const text = normalizeText(message);
    if (!text) return;
    this.renderMessageBlock(text, {
      textColor: col.text,
      prefix: "‹ ",
    });
    this.renderMessageSeparator();
  }

  renderInfoMessage(message: string): void {
    const text = normalizeText(message);
    if (!text) return;
    for (const line of text.split("\n")) {
      this.print(line, col.muted);
    }
  }

  renderInfoLines(lines: Array<{ text: string; color?: string }>): void {
    for (const line of lines) {
      this.print(line.text, line.color ?? col.muted);
    }
  }

  renderStep(step: AgentStep): void {
    const observation = step.observation ? normalizeText(step.observation).split("\n").slice(0, 3).join("\n") : "";
    this.print(`● ${step.action}  step ${step.step}`, col.step);
    if (!observation) return;
    for (const line of observation.split("\n")) {
      this.print(`  ${line}`, col.step);
    }
  }

  renderAssistantDelta(delta: string): void {
    if (!delta) return;
    this.assistantStreamText += delta;
    const lines = this.assistantStreamText.trimEnd().split("\n");
    const last = (lines[lines.length - 1] ?? "").slice(0, 100);
    this.setStatus(`${this.activeModelLabel}  |  ${last}`);
  }

  finalizeAssistantStream(text?: string): void {
    const final = normalizeText(text ?? this.assistantStreamText);
    this.assistantStreamText = "";
    this.setStatus("", col.muted, "", col.muted);
    if (final) {
      this.renderTranscriptCard(final, {
        boxId: "assistant-msg-box",
        textId: "assistant-msg-text",
        borderColor: col.accent,
        backgroundColor: "#11161d",
      });
      this.print("");
    }
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.closePendingModal();
      this.setStatus("", col.muted, "", col.muted);
      this.input?.focus();
      return;
    }
    if (this.pendingModal) return;
    const style = statusPromptStyle(prompt);
    const showModel = !normalizeText(prompt.message).startsWith("Enter API key for ");
    if (showModel) {
      this.setStatus(
        `${this.activeModelLabel}  |  ${style.primary}`,
        style.primaryColor,
        style.secondary ?? "",
        style.secondaryColor ?? col.muted,
      );
      return;
    }
    this.setStatus(
      style.primary,
      style.primaryColor,
      style.secondary ?? "",
      style.secondaryColor ?? col.muted,
    );
  }

  promptApproval(prompt: ApprovalPromptState): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingApprovalResolve = resolve;
      if (prompt.review) {
        this.showReviewModal(prompt, resolve);
      } else {
        this.showApprovalModal(prompt, resolve);
      }
    });
  }

  renderSummary(summary: RunSummary): void {
    const line = [
      summary.success ? "done" : "failed",
      `steps=${summary.steps}`,
      `${Math.round(summary.durationMs / 1000)}s`,
      summary.promptTokens || summary.completionTokens
        ? `tokens=${summary.promptTokens + summary.completionTokens}`
        : "",
      summary.estimatedCostUsd > 0 ? `cost=$${summary.estimatedCostUsd.toFixed(4)}` : "",
    ].filter(Boolean).join("  ");
    this.renderTranscriptCard(`◆ ${line}`, {
      boxId: "run-summary-box",
      textId: "run-summary-text",
      borderColor: col.summary,
      backgroundColor: "#1a120c",
      textColor: col.summary,
    });
    this.print("");
  }

  setSlashCommands(commands: SlashCommandItem[]): void {
    this.slashCommands = commands;
    this.setSlashCommandsState?.([...commands]);
    this.updateSlashMenu(this.currentInput);
  }

  readInputLine(): Promise<string> {
    this.input?.focus();
    return new Promise<string>((resolve) => {
      this.pendingReadResolve = resolve;
    });
  }

  readInput(): Promise<ComposerSubmission> {
    this.input?.focus();
    return new Promise<ComposerSubmission>((resolve) => {
      this.pendingSubmissionResolve = resolve;
    });
  }

  onCancelRunning(handler: (() => void) | null): void {
    this.cancelRunningHandler = handler;
  }

  stop(): void {
    this.dispose?.();
    this.dispose = null;
    this.renderer?.destroy();
    this.renderer = null;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Write a styled line to the scrollback area above the footer. */
  private print(content: string, fg: string = col.text): void {
    this.writeScrollback((ctx) => {
      const height = wrappedLineCount(content, ctx.width);
      const text = new TextRenderable(ctx.renderContext, {
        id: "sb-line",
        content,
        width: ctx.width,
        height,
        wrapMode: "word",
        truncate: false,
        fg,
      });
      return { root: text, width: ctx.width, height, startOnNewLine: true, trailingNewline: true };
    });
  }

  private renderMessageBlock(
    content: string,
    opts: {
      textColor: string;
      prefix: string;
      backgroundColor?: string;
      fullWidthBackground?: boolean;
      paddingLeft?: number;
      paddingRight?: number;
      paddingTop?: number;
      paddingBottom?: number;
    },
  ): void {
    this.writeScrollback((ctx) => {
      const messageContent = `${opts.prefix}${content}`;
      const paddingLeft = opts.paddingLeft ?? 0;
      const paddingRight = opts.paddingRight ?? 0;
      const paddingTop = opts.paddingTop ?? 0;
      const paddingBottom = opts.paddingBottom ?? 0;
      const contentWidth = Math.max(1, ctx.width - paddingLeft - paddingRight);
      const contentHeight = wrappedLineCount(messageContent, contentWidth);
      const height = contentHeight + paddingTop + paddingBottom;

      if (opts.backgroundColor && opts.fullWidthBackground) {
        const box = new BoxRenderable(ctx.renderContext, {
          id: "sb-message-block-bg",
          width: ctx.width,
          height,
          backgroundColor: opts.backgroundColor,
          paddingLeft,
          paddingRight,
          paddingTop,
          paddingBottom,
        });
        box.add(new TextRenderable(ctx.renderContext, {
          id: "sb-message-block",
          content: messageContent,
          width: contentWidth,
          height: contentHeight,
          wrapMode: "word",
          truncate: false,
          fg: opts.textColor,
        }));
        return { root: box, width: ctx.width, height, startOnNewLine: true, trailingNewline: true };
      }

      const text = new TextRenderable(ctx.renderContext, {
        id: "sb-message-block",
        content: messageContent,
        width: ctx.width,
        height,
        wrapMode: "word",
        truncate: false,
        fg: opts.textColor,
        bg: opts.backgroundColor,
        paddingLeft,
        paddingRight,
        paddingTop,
        paddingBottom,
      });
      return { root: text, width: ctx.width, height, startOnNewLine: true, trailingNewline: true };
    });
  }

  private renderMessageSeparator(): void {
    this.writeScrollback((ctx) => {
      const line = "─".repeat(Math.max(1, ctx.width));
      const text = new TextRenderable(ctx.renderContext, {
        id: "sb-message-separator",
        content: line,
        width: ctx.width,
        height: 1,
        wrapMode: "none",
        truncate: true,
        fg: col.border,
      });
      return { root: text, width: ctx.width, height: 1, startOnNewLine: true, trailingNewline: true };
    });
  }

  private renderTranscriptCard(
    content: string,
    opts: {
      boxId: string;
      textId: string;
      borderColor: string;
      backgroundColor: string;
      textColor?: string;
    },
  ): void {
    this.writeScrollback((ctx) => {
      const contentWidth = Math.max(1, ctx.width - 5);
      const contentHeight = wrappedLineCount(content, contentWidth);
      const height = contentHeight + 2;
      const box = new BoxRenderable(ctx.renderContext, {
        id: opts.boxId,
        width: ctx.width,
        height,
        border: ["left"],
        borderColor: opts.borderColor,
        backgroundColor: opts.backgroundColor,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      });
      box.add(
        new TextRenderable(ctx.renderContext, {
          id: opts.textId,
          content,
          width: contentWidth,
          height: contentHeight,
          wrapMode: "word",
          truncate: false,
          fg: opts.textColor ?? col.text,
        }),
      );
      return { root: box, width: ctx.width, height, startOnNewLine: true, trailingNewline: true };
    });
  }

  private renderInfoCard(content: string, textColor: string = col.muted): void {
    this.writeScrollback((ctx) => {
      const contentWidth = Math.max(1, ctx.width - 5);
      const contentHeight = wrappedLineCount(content, contentWidth);
      const height = contentHeight + 2;
      const box = new BoxRenderable(ctx.renderContext, {
        id: "info-msg-box",
        width: ctx.width,
        height,
        border: ["left"],
        borderColor: col.border,
        backgroundColor: "#0b1016",
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      });
      box.add(
        new TextRenderable(ctx.renderContext, {
          id: "info-msg-text",
          content,
          width: contentWidth,
          height: contentHeight,
          wrapMode: "word",
          truncate: false,
          fg: textColor,
        }),
      );
      return { root: box, width: ctx.width, height, startOnNewLine: true, trailingNewline: true };
    });
  }

  private renderStartupCard(): void {
    this.writeScrollback((ctx) => {
      const width = clamp(ctx.width - 8, 68, 86);
      const innerWidth = width - 2;
      const labelWidth = 10;
      const commandWidth = 18;
      const directory = truncateMiddle(
        process.cwd().replace(/^\/Users\/[^/]+/, "~"),
        innerWidth - labelWidth - 3,
      );
      const modelLine = truncateMiddle(
        this.activeModelLabel.replace(/^model=/, ""),
        innerWidth - labelWidth - 3,
      );
      const chunks: TextChunk[] = [];
      const push = (color: string, content: string): void => {
        chunks.push(fg(color)(content));
      };
      const pushLine = (): void => push(col.border, "\n");
      const borderLine = (left: string, fill: string, right: string): void => {
        push(col.border, `${left}${fill.repeat(innerWidth)}${right}`);
        pushLine();
      };
      const row = (segments: Array<{ text: string; color?: string }>): void => {
        const contentLength = segments.reduce((sum, segment) => sum + segment.text.length, 0);
        push(col.border, "│ ");
        for (const segment of segments) {
          push(segment.color ?? col.text, segment.text);
        }
        push(col.text, " ".repeat(Math.max(0, innerWidth - contentLength - 1)));
        push(col.border, "│");
        pushLine();
      };
      const keyValue = (label: string, value: string): void =>
        row([
          { text: padRight(label, labelWidth), color: col.muted },
          { text: value },
        ]);
      const actionRow = (command: string, hint: string): void => {
        const content = `${padRight(command, commandWidth)}${hint}`;
        row([
          { text: padRight(command, commandWidth), color: col.accent },
          { text: hint },
        ]);
      };

      borderLine("┌", "─", "┐");
      row([
        { text: ">_ ", color: col.accent },
        { text: "xeq", color: col.accent },
        { text: `  v${Bun.version}`, color: col.muted },
      ]);
      row([{ text: "ready for a task", color: col.muted }]);
      borderLine("├", "─", "┤");
      keyValue("workspace", directory);
      keyValue("model", modelLine);
      borderLine("├", "─", "┤");
      actionRow("type anything", "start a new turn");
      actionRow("/", "browse commands");
      actionRow("/resume", "restore a saved session");
      actionRow("ctrl+c", "quit");
      borderLine("└", "─", "┘");
      if (chunks[chunks.length - 1]?.text === "\n") {
        chunks.pop();
      }
      const text = new TextRenderable(ctx.renderContext, {
        id: "startup-card-text",
        content: new StyledText(chunks),
        width,
        height: 12,
        wrapMode: "none",
        truncate: false,
      });
      return { root: text, width: ctx.width, startOnNewLine: true, trailingNewline: true };
    });
  }

  private syncFooterHeight(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const modalHeight = this.pendingModal?.box.height ?? 0;
    const nextHeight = BASE_FOOTER + this.slashLineCount + this.mentionLineCount + modalHeight;
    if (renderer.footerHeight !== nextHeight) {
      renderer.footerHeight = nextHeight;
    }
    renderer.requestRender();
  }

  private syncComposerLayout(): void {
    const composerBox = this.composerBox;
    const inputRow = this.inputRow;
    const input = this.input;
    if (!composerBox || !inputRow || !input) return;

    const visibleLines = clamp(Math.max(1, input.virtualLineCount), 1, 5);
    const nextInputHeight = Math.max(3, visibleLines);
    const nextComposerHeight = nextInputHeight + 2;

    if (inputRow.height !== nextInputHeight) {
      inputRow.height = nextInputHeight;
    }
    if (input.height !== nextInputHeight) {
      input.height = nextInputHeight;
    }
    if (composerBox.height !== nextComposerHeight) {
      composerBox.height = nextComposerHeight;
    }

    this.syncFooterHeight();
  }

  private submitComposerValue(submit: string): void {
    this.promptHistory.record({
      text: submit,
      mentions: this.currentMentionBindings,
    });
    const submission = submit
      ? {
          text: submit,
          textElements: buildComposerTextElements(this.currentMentionBindings),
          mentions: this.currentMentionBindings.slice(),
          attachments: [],
        }
      : createPlainComposerSubmission(submit);
    this.currentInput = "";
    this.currentMentionBindings = [];
    this.activeMentionQuery = null;
    if (this.input) {
      this.input.setText("");
    }
    this.setInputValue?.("");
    this.updateSlashMenu("");
    this.clearMentionMenu();

    if (this.pendingSubmissionResolve) {
      const resolve = this.pendingSubmissionResolve;
      this.pendingSubmissionResolve = null;
      resolve(submission);
      return;
    }

    if (this.pendingReadResolve) {
      const resolve = this.pendingReadResolve;
      this.pendingReadResolve = null;
      resolve(submit);
      return;
    }

    if (submit.startsWith("/")) {
      const command = submit.slice(1).split(/\s+/)[0];
      const match = this.slashCommands.find((item) => item.name === `/${command}`);
      if (match) this.renderUserMessage(submit);
    }
  }

  private handlePromptHistoryInput(seq: string): boolean {
    if (this.pendingModal) return false;
    if (this.currentInput.trim().startsWith("/") && this.slashMenuItems.length > 0) return false;
    if (this.activeMentionQuery && this.mentionMenuItems.length > 0) return false;

    if (seq === "\x1b[A") {
      return this.applyPromptHistoryValue(this.promptHistory.previous({
        text: this.currentInput,
        mentions: this.currentMentionBindings,
      }));
    }

    if (seq === "\x1b[B") {
      return this.applyPromptHistoryValue(this.promptHistory.next());
    }

    return false;
  }

  private applyPromptHistoryValue(entry: PromptHistoryEntry | null): boolean {
    if (!this.input || !this.renderer || entry == null) {
      return false;
    }

    this.applyingPromptHistoryValue = true;
    this.setComposerValue(entry.text, {
      cursorOffset: entry.text.length,
      mentions: entry.mentions,
      focusInput: true,
    });
    return true;
  }

  private updateSlashMenu(value: string): void {
    const menuSelect = this.slashMenuSelect;
    const menuBox = this.slashMenuBox;
    const renderer = this.renderer;
    if (!menuSelect || !menuBox || !renderer) return;

    if (!value.trim().startsWith("/")) {
      this.slashMenuItems = [];
      this.slashMenuIndex = 0;
      this.slashMenuScrollOffset = 0;
      this.slashLineCount = 0;
      batch(() => {
        menuSelect.options = [];
        menuSelect.selectedIndex = 0;
        menuSelect.height = 0;
        menuBox.height = 0;
      });
      this.syncFooterHeight();
      return;
    }

    const items = slashCommandMatches(this.slashCommands, value);
    const previous = this.slashMenuItems[this.slashMenuIndex];
    const nextIndex = previous
      ? Math.max(0, items.findIndex((item) => item.name === previous.name))
      : 0;

    this.slashMenuItems = items;
    this.slashMenuIndex = items.length > 0 ? (nextIndex >= 0 ? nextIndex : 0) : 0;
    this.syncSlashMenuViewport();

    batch(() => {
      this.syncSlashMenuSelect();
      menuSelect.height = this.slashLineCount;
      menuBox.height = this.slashLineCount;
    });
    this.syncFooterHeight();
  }

  private async updateMentionMenu(value: string): Promise<void> {
    const menuSelect = this.mentionMenuSelect;
    const menuBox = this.mentionMenuBox;
    const renderer = this.renderer;
    const input = this.input;
    if (!menuSelect || !menuBox || !renderer || !input) return;

    if (value.trim().startsWith("/")) {
      this.clearMentionMenu();
      return;
    }

    const mentionQuery = findActiveMentionQuery(value, input.cursorOffset);
    if (!mentionQuery) {
      this.clearMentionMenu();
      return;
    }

    const requestId = ++this.mentionQueryRequestId;
    const items = await this.mentionFileIndex.search(mentionQuery.query, MAX_MENTION_ROWS);
    if (requestId !== this.mentionQueryRequestId || this.currentInput !== value) {
      return;
    }

    this.activeMentionQuery = mentionQuery;
    const previous = this.mentionMenuItems[this.mentionMenuIndex];
    const nextIndex = previous
      ? Math.max(0, items.findIndex((item) => item.path === previous.path))
      : 0;

    this.mentionMenuItems = items;
    this.mentionMenuIndex = items.length > 0 ? (nextIndex >= 0 ? nextIndex : 0) : 0;
    this.syncMentionMenuViewport();

    batch(() => {
      this.syncMentionMenuSelect();
      menuSelect.height = this.mentionLineCount;
      menuBox.height = this.mentionLineCount;
    });
    this.syncFooterHeight();
  }

  private handleSlashMenuInput(seq: string): boolean {
    if (this.pendingModal) return false;
    if (!this.currentInput.trim().startsWith("/") || this.slashMenuItems.length === 0) return false;

    const menuSelect = this.slashMenuSelect;
    const renderer = this.renderer;
    const input = this.input;
    if (!menuSelect || !renderer || !input) return false;

    if (seq === "\x1b[A") {
      this.slashMenuIndex =
        this.slashMenuIndex <= 0 ? this.slashMenuItems.length - 1 : this.slashMenuIndex - 1;
      this.syncSlashMenuViewport();
      this.syncSlashMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (seq === "\x1b[B") {
      this.slashMenuIndex =
        this.slashMenuIndex >= this.slashMenuItems.length - 1 ? 0 : this.slashMenuIndex + 1;
      this.syncSlashMenuViewport();
      this.syncSlashMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (seq === "\t") {
      const selected = this.slashMenuItems[this.slashMenuIndex];
      if (!selected) return false;
      input.setText(selected.name);
      this.currentInput = selected.name;
      this.setInputValue?.(selected.name);
      this.updateSlashMenu(selected.name);
      input.focus();
      renderer.requestRender();
      return true;
    }

    if (seq === "\r") {
      const selected = this.slashMenuItems[this.slashMenuIndex];
      if (!selected) return false;
      this.submitSlashMenuSelection();
      return true;
    }

    return false;
  }

  private handleMentionMenuInput(seq: string): boolean {
    if (this.pendingModal) return false;
    if (!this.activeMentionQuery || this.mentionMenuItems.length === 0) return false;
    if (this.currentInput.trim().startsWith("/")) return false;

    const renderer = this.renderer;
    if (!renderer) return false;

    if (seq === "\x1b[A") {
      this.mentionMenuIndex =
        this.mentionMenuIndex <= 0 ? this.mentionMenuItems.length - 1 : this.mentionMenuIndex - 1;
      this.syncMentionMenuViewport();
      this.syncMentionMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (seq === "\x1b[B") {
      this.mentionMenuIndex =
        this.mentionMenuIndex >= this.mentionMenuItems.length - 1 ? 0 : this.mentionMenuIndex + 1;
      this.syncMentionMenuViewport();
      this.syncMentionMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (seq === "\t" || seq === "\r") {
      void this.submitMentionMenuSelection();
      return true;
    }

    if (seq === "\x1b") {
      this.clearMentionMenu();
      renderer.requestRender();
      return true;
    }

    return false;
  }

  private syncSlashMenuViewport(): void {
    const total = this.slashMenuItems.length;
    const visibleRows = Math.min(total, MAX_SLASH_ROWS);
    this.slashLineCount = visibleRows;

    if (visibleRows === 0) {
      this.slashMenuScrollOffset = 0;
      return;
    }

    if (this.slashMenuIndex < this.slashMenuScrollOffset) {
      this.slashMenuScrollOffset = this.slashMenuIndex;
    } else if (this.slashMenuIndex >= this.slashMenuScrollOffset + visibleRows) {
      this.slashMenuScrollOffset = this.slashMenuIndex - visibleRows + 1;
    }

    const maxOffset = Math.max(0, total - visibleRows);
    if (this.slashMenuScrollOffset > maxOffset) {
      this.slashMenuScrollOffset = maxOffset;
    }
  }

  private syncMentionMenuViewport(): void {
    const total = this.mentionMenuItems.length;
    const visibleRows = Math.min(total, MAX_MENTION_ROWS);
    this.mentionLineCount = visibleRows;

    if (visibleRows === 0) {
      this.mentionMenuScrollOffset = 0;
      return;
    }

    if (this.mentionMenuIndex < this.mentionMenuScrollOffset) {
      this.mentionMenuScrollOffset = this.mentionMenuIndex;
    } else if (this.mentionMenuIndex >= this.mentionMenuScrollOffset + visibleRows) {
      this.mentionMenuScrollOffset = this.mentionMenuIndex - visibleRows + 1;
    }

    const maxOffset = Math.max(0, total - visibleRows);
    if (this.mentionMenuScrollOffset > maxOffset) {
      this.mentionMenuScrollOffset = maxOffset;
    }
  }

  private syncSlashMenuSelect(): void {
    if (!this.slashMenuSelect) return;
    const visibleItems = this.slashMenuItems
      .slice(this.slashMenuScrollOffset, this.slashMenuScrollOffset + MAX_SLASH_ROWS)
      .map((item, index) => ({
        name: `${item.name.padEnd(16)} ${item.description}`,
        description: "",
        value: this.slashMenuScrollOffset + index,
      }));
    this.slashMenuSelect.options = visibleItems;
    this.slashMenuSelect.selectedIndex = Math.max(0, this.slashMenuIndex - this.slashMenuScrollOffset);
    this.slashMenuSelect.showScrollIndicator = this.slashMenuItems.length > MAX_SLASH_ROWS;
  }

  private syncMentionMenuSelect(): void {
    if (!this.mentionMenuSelect) return;
    const visibleItems = this.mentionMenuItems
      .slice(this.mentionMenuScrollOffset, this.mentionMenuScrollOffset + MAX_MENTION_ROWS)
      .map((item, index) => ({
        name: item.label,
        description: "",
        value: this.mentionMenuScrollOffset + index,
      }));
    this.mentionMenuSelect.options = visibleItems;
    this.mentionMenuSelect.selectedIndex = Math.max(0, this.mentionMenuIndex - this.mentionMenuScrollOffset);
    this.mentionMenuSelect.showScrollIndicator = this.mentionMenuItems.length > MAX_MENTION_ROWS;
  }

  private submitSlashMenuSelection(): void {
    const selected = this.slashMenuItems[this.slashMenuIndex];
    const renderer = this.renderer;
    const input = this.input;
    if (!selected || !renderer || !input) return;

    this.submitComposerValue(selected.name);
    renderer.requestRender();
  }

  private async submitMentionMenuSelection(): Promise<void> {
    const selected = this.mentionMenuItems[this.mentionMenuIndex];
    const mentionQuery = this.activeMentionQuery;
    if (!selected || !mentionQuery) return;

    if (this.promptHistory.isNavigating()) {
      this.promptHistory.clearNavigation();
    }

    const result = insertFileMention(this.currentInput, mentionQuery, this.currentMentionBindings, selected.path);
    this.setComposerValue(result.text, {
      cursorOffset: result.cursorOffset,
      mentions: result.mentions,
      focusInput: true,
    });
  }

  private clearMentionMenu(): void {
    this.mentionQueryRequestId += 1;
    this.activeMentionQuery = null;
    this.mentionMenuItems = [];
    this.mentionMenuIndex = 0;
    this.mentionMenuScrollOffset = 0;
    this.mentionLineCount = 0;

    if (!this.mentionMenuSelect || !this.mentionMenuBox) {
      return;
    }

    const mentionMenuSelect = this.mentionMenuSelect;
    const mentionMenuBox = this.mentionMenuBox;

    batch(() => {
      mentionMenuSelect.options = [];
      mentionMenuSelect.selectedIndex = 0;
      mentionMenuSelect.height = 0;
      mentionMenuBox.height = 0;
    });
    this.syncFooterHeight();
  }

  private setComposerValue(
    value: string,
    options: {
      cursorOffset?: number;
      mentions?: ComposerMentionBinding[];
      clearMentions?: boolean;
      focusInput?: boolean;
    } = {},
  ): void {
    const input = this.input;
    const renderer = this.renderer;
    if (!input || !renderer) {
      return;
    }

    this.applyingComposerUpdate = true;
    if (options.clearMentions) {
      this.nextMentionBindingsOverride = [];
    } else if (options.mentions) {
      this.nextMentionBindingsOverride = options.mentions;
    } else {
      this.nextMentionBindingsOverride = this.currentMentionBindings;
    }

    input.setText(value);
    input.cursorOffset = options.cursorOffset ?? input.plainText.length;
    this.currentInput = value;
    this.setInputValue?.(value);
    this.updateSlashMenu(value);
    void this.updateMentionMenu(value);
    this.syncComposerLayout();
    if (options.focusInput) {
      input.focus();
    }
    renderer.requestRender();
  }

  private closePendingModal(): void {
    if (this.pendingModal) {
      this.pendingModal.box.destroyRecursively();
      this.pendingModal = null;
      this.setApprovalRows?.(0);
      this.syncFooterHeight();
    }
  }

  private rejectPendingModal(): void {
    const modal = this.pendingModal;
    if (!modal) return;
    this.closePendingModal();
    this.pendingApprovalResolve?.("reject");
    this.pendingApprovalResolve = null;
    this.input?.focus();
    this.renderer?.requestRender();
  }

  /**
   * Create a box appended below the composer in the footer column.
   * Footer height is driven by the Solid signal in start().
   */
  private approvalBox(id: string, innerRows: number, title: string, width: number | "100%" = "100%"): BoxRenderable {
    if (!this.renderer) throw new Error("renderer not ready");
    return new BoxRenderable(this.renderer, {
      id,
      width,
      maxWidth: "100%",
      height: innerRows + 2,  // +2 for border-top and border-bottom
      flexShrink: 0,
      flexDirection: "column",
      alignItems: "stretch",
      border: ["left"],
      borderColor: col.accent,
      backgroundColor: "#0b1016",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      title: ` ${title} `,
    });
  }

  private armSelectAfterMount(callback: () => void): () => boolean {
    let armed = false;
    queueMicrotask(() => {
      armed = true;
      callback();
    });
    return () => armed;
  }

  private showApprovalModal(prompt: ApprovalPromptState, resolve: (value: string) => void): void {
    if (!this.renderer || !this.footerRoot) return;

    const choices = prompt.choices ?? defaultApprovalChoices();
    const selectedIndex = Math.max(0, Math.min(choices.length - 1, prompt.selectedIndex ?? 1));
    const visibleChoices = Math.min(choices.length, 12);
    const hasDetails = Boolean(prompt.details?.trim());
    const showPreview = choices.some((choice) => choice.description?.trim());
    // innerRows = message(1) + details?(1) + choices viewport + preview?(1) + help(1)
    const innerRows = 1 + (hasDetails ? 1 : 0) + visibleChoices + (showPreview ? 1 : 0) + 1;
    const box = this.approvalBox("approval-modal", innerRows, approvalTitle(prompt), "100%");

    box.add(new TextRenderable(this.renderer, {
      id: "approval-msg",
      content: normalizeText(prompt.message),
      width: "100%",
      height: 1,
      fg: col.muted,
    }));

    if (hasDetails) {
      box.add(new TextRenderable(this.renderer, {
        id: "approval-details",
        content: normalizeText(prompt.details ?? ""),
        width: "100%",
        height: 1,
        fg: col.step,
      }));
    }

    const selectOptions = choices.map((ch, index) => ({
      name: index === selectedIndex ? `${ch.label}  (current)` : ch.label,
      description: ch.description ?? "",
      value: ch.value,
    }));

    const select = new SelectRenderable(this.renderer, {
      id: "approval-select",
      options: selectOptions,
      selectedIndex,
      width: "100%",
      height: visibleChoices,
      backgroundColor: col.userBg,
      focusedBackgroundColor: col.userBg,
      showScrollIndicator: choices.length > visibleChoices,
      showDescription: false,
      selectedBackgroundColor: col.border,
      selectedTextColor: col.text,
      textColor: col.text,
      descriptionColor: col.muted,
      selectedDescriptionColor: col.muted,
    });

    box.add(select);
    const preview = showPreview
      ? new TextRenderable(this.renderer, {
          id: "approval-preview",
          content: selectOptions[selectedIndex]?.description || "",
          width: "100%",
          height: 1,
          truncate: true,
          fg: col.step,
        })
      : null;
    if (preview) {
      box.add(preview);
    }
    box.add(new TextRenderable(this.renderer, {
      id: "approval-help",
      content: "↑↓ move   enter select   esc reject",
      width: "100%",
      height: 1,
      fg: col.muted,
    }));

    this.footerRoot.add(box);
    this.setApprovalRows?.(innerRows + 2);
    this.pendingModal = { type: "approval", resolve, select, box };
    this.syncFooterHeight();

    const isArmed = this.armSelectAfterMount(() => {
      select.focus();
      this.syncFooterHeight();
    });

    if (preview) {
      select.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
        preview.content = selectOptions[index]?.description || "";
        this.renderer?.requestRender();
      });
    }

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: string }) => {
      if (!isArmed()) return;
      this.closePendingModal();
      this.pendingApprovalResolve?.(item.value);
      this.pendingApprovalResolve = null;
      this.input?.focus();
      this.renderer?.requestRender();
    });
  }

  private showReviewModal(prompt: ApprovalPromptState, resolve: (value: string) => void): void {
    if (!this.renderer || !this.footerRoot || !prompt.review) return;

    // innerRows = header(1) + subtitle(1) + files-label(1) + fileSelect(4) + diff-label(1) + preview(5) + actions(3) + help(1) = 17
    const box = this.approvalBox("review-modal", 17, "review changes");

    box.add(new TextRenderable(this.renderer, {
      id: "review-header",
      content: normalizeText(prompt.message),
      width: "100%",
      height: 1,
      fg: col.text,
    }));
    box.add(new TextRenderable(this.renderer, {
      id: "review-subtitle",
      content: normalizeText(prompt.details ?? prompt.review.summary),
      width: "100%",
      height: 1,
      fg: col.muted,
    }));
    box.add(new TextRenderable(this.renderer, {
      id: "review-files-label",
      content: "Files",
      width: "100%",
      height: 1,
      fg: col.accent,
    }));

    const fileSelect = new SelectRenderable(this.renderer, {
      id: "review-files",
      options: prompt.review.files.map((f) => ({
        name: f.filePath,
        description: f.status ?? "modified",
        value: f.filePath,
      })),
      selectedIndex: 0,
      width: "100%",
      height: 4,
      showDescription: true,
    });

    box.add(fileSelect);
    box.add(new TextRenderable(this.renderer, {
      id: "review-diff-label",
      content: "Diff",
      width: "100%",
      height: 1,
      fg: col.accent,
    }));

    const preview = new TextRenderable(this.renderer, {
      id: "review-preview",
      content: compactDiff(prompt.review.files[0]?.diff ?? "", 10),
      width: "100%",
      height: 5,
      wrapMode: "word",
      fg: col.muted,
    });

    const actionSelect = new SelectRenderable(this.renderer, {
      id: "review-actions",
      options: (prompt.choices ?? defaultApprovalChoices()).map((ch) => ({
        name: ch.label,
        description: ch.description ?? "",
        value: ch.value,
      })),
      selectedIndex: 1,
      width: "100%",
      height: 4,
      showDescription: true,
    });

    box.add(preview);
    box.add(actionSelect);
    box.add(new TextRenderable(this.renderer, {
      id: "review-help",
      content: "tab switch focus   enter choose   esc reject",
      width: "100%",
      height: 1,
      fg: col.muted,
    }));

    this.footerRoot.add(box);
    this.setApprovalRows?.(17 + 2);

    const modal: PendingModal = {
      type: "review",
      resolve,
      fileSelect,
      actionSelect,
      preview,
      box,
      focused: "actions",
    };
    this.pendingModal = modal;
    this.syncFooterHeight();
    const isArmed = this.armSelectAfterMount(() => {
      actionSelect.focus();
      this.syncFooterHeight();
    });

    fileSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
      const sel = fileSelect.getSelectedOption();
      const file = prompt.review?.files.find((f) => f.filePath === sel?.value);
      preview.content = file ? compactDiff(file.diff, 10) : "(no file selected)";
      this.renderer?.requestRender();
    });
    fileSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      modal.focused = "actions";
      actionSelect.focus();
      this.renderer?.requestRender();
    });
    actionSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: string }) => {
      if (!isArmed()) return;
      this.closePendingModal();
      this.pendingApprovalResolve?.(item.value);
      this.pendingApprovalResolve = null;
      this.input?.focus();
      this.renderer?.requestRender();
    });

    this.renderer.addInputHandler((seq) => {
      if (seq !== "\t" || this.pendingModal?.type !== "review") return false;
      const m = this.pendingModal;
      if (m.focused === "files") {
        m.focused = "actions";
        m.actionSelect.focus();
      } else {
        m.focused = "files";
        m.fileSelect.focus();
      }
      this.renderer?.requestRender();
      return true;
    });

    fileSelect.focus();
  }
}
