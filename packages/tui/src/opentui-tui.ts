import {
  type ComposerMentionBinding,
  type ComposerSubmission,
  createPlainComposerSubmission,
} from "@archer/shared/composer";
import type { AgentStep, RunSummary } from "@archer/shared/runtime";
import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  fg,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextareaRenderable,
  type TextChunk,
  TextRenderable,
} from "@opentui/core";
import { batch, createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import {
  applyCollapsedMenuHeights,
  computeMentionQuery,
  computeNextMentionState,
  computeNextSlashState,
} from "./internal/menu-controller.js";
import {
  isArrowDown,
  isArrowUp,
  isEnter,
  isEscape,
  isTab,
  nextWrappedIndex,
} from "./internal/menu-input.js";
import { computeMenuViewport, mapMentionOptions, mapSlashOptions } from "./internal/menu-state.js";
import type { PendingModal } from "./internal/modal-types.js";
import { mountApprovalModal, mountReviewModal } from "./internal/modals.js";
import { BASE_FOOTER, col, MAX_MENTION_ROWS, MAX_SLASH_ROWS } from "./internal/theme.js";
import {
  clamp,
  normalizeText,
  padRight,
  truncateMiddle,
  wrappedLineCount,
} from "./internal/ui-helpers.js";
import {
  type ActiveMentionQuery,
  buildComposerTextElements,
  insertFileMention,
  MentionFileIndex,
  type MentionSuggestion,
  reconcileMentionBindings,
} from "./mention-state.js";
import { PromptHistory, type PromptHistoryEntry } from "./prompt-history.js";

type SummaryLike = RunSummary & {
  evalMetrics?: {
    webEventCount?: unknown;
  };
};

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
  renderEventMessage(message: string): void;
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

// ─────────────────────────────────────────────────────────────────────────────

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

export class ArcherTui implements Tui {
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
    if (
      !this.currentInput.trim().startsWith("/") ||
      this.slashMenuItems.length === 0 ||
      !this.slashMenuSelect
    ) {
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
      const [, setInputValue] = createSignal("");
      const [, setSlashCommandsState] = createSignal<SlashCommandItem[]>([]);
      const [approvalRows, setApprovalRows] = createSignal(0);

      this.setInputValue = setInputValue;
      this.setSlashCommandsState = setSlashCommandsState;
      this.setApprovalRows = setApprovalRows;

      createEffect(() => {
        const renderer = this.renderer;
        if (!renderer) return;
        const nextHeight =
          BASE_FOOTER + this.slashLineCount + this.mentionLineCount + approvalRows();
        if (renderer.footerHeight === nextHeight) return;
        renderer.footerHeight = nextHeight;
        renderer.requestRender();
      });

      onCleanup(() => {
        this.setInputValue = null;
        this.setSlashCommandsState = null;
        this.setApprovalRows = null;
      });

      return dispose;
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
    this.slashMenuSelect.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_i: number, item: { value: number }) => {
        if (typeof item.value !== "number") return;
        this.slashMenuIndex = item.value;
        this.syncSlashMenuViewport();
        this.syncSlashMenuSelect();
        this.submitSlashMenuSelection();
      },
    );
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
    this.mentionMenuSelect.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_i: number, item: { value: number }) => {
        if (typeof item.value !== "number") return;
        this.mentionMenuIndex = item.value;
        this.syncMentionMenuViewport();
        this.syncMentionMenuSelect();
        void this.submitMentionMenuSelection();
      },
    );
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
      placeholder: "message Archer…",
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
          this.currentMentionBindings =
            this.nextMentionBindingsOverride ?? this.currentMentionBindings;
          this.nextMentionBindingsOverride = null;
        } else if (this.applyingPromptHistoryValue) {
          this.applyingPromptHistoryValue = false;
          this.currentMentionBindings = [];
        } else {
          this.currentMentionBindings = reconcileMentionBindings(
            this.currentInput,
            value,
            this.currentMentionBindings,
          );
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

  renderEventMessage(message: string): void {
    const text = normalizeText(message);
    if (!text) return;
    this.renderInfoCard(`◇ ${text}`, col.accent);
    this.print("");
  }

  renderInfoLines(lines: Array<{ text: string; color?: string }>): void {
    for (const line of lines) {
      this.print(line.text, line.color ?? col.muted);
    }
  }

  renderStep(step: AgentStep): void {
    const observation = step.observation
      ? normalizeText(step.observation).split("\n").slice(0, 3).join("\n")
      : "";
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

  renderSummary(summary: SummaryLike): void {
    const webEventCount =
      typeof summary.evalMetrics?.webEventCount === "number"
        ? summary.evalMetrics.webEventCount
        : 0;
    const line = [
      summary.success ? "done" : "failed",
      `steps=${summary.steps}`,
      `${Math.round(summary.durationMs / 1000)}s`,
      summary.promptTokens || summary.completionTokens
        ? `tokens=${summary.promptTokens + summary.completionTokens}`
        : "",
      summary.estimatedCostUsd > 0 ? `cost=$${summary.estimatedCostUsd.toFixed(4)}` : "",
      webEventCount > 0 ? `web=${webEventCount}` : "",
    ]
      .filter(Boolean)
      .join("  ");
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
        box.add(
          new TextRenderable(ctx.renderContext, {
            id: "sb-message-block",
            content: messageContent,
            width: contentWidth,
            height: contentHeight,
            wrapMode: "word",
            truncate: false,
            fg: opts.textColor,
          }),
        );
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
      return {
        root: text,
        width: ctx.width,
        height: 1,
        startOnNewLine: true,
        trailingNewline: true,
      };
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
        row([{ text: padRight(label, labelWidth), color: col.muted }, { text: value }]);
      const actionRow = (command: string, hint: string): void => {
        row([{ text: padRight(command, commandWidth), color: col.accent }, { text: hint }]);
      };

      borderLine("┌", "─", "┐");
      row([
        { text: ">_ ", color: col.accent },
        { text: "Archer", color: col.accent },
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
      return this.applyPromptHistoryValue(
        this.promptHistory.previous({
          text: this.currentInput,
          mentions: this.currentMentionBindings,
        }),
      );
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

    const next = computeNextSlashState({
      value,
      slashCommands: this.slashCommands,
      currentItems: this.slashMenuItems,
      currentIndex: this.slashMenuIndex,
    });
    if (next.shouldClear) {
      this.slashMenuItems = [];
      this.slashMenuIndex = 0;
      this.slashMenuScrollOffset = 0;
      this.slashLineCount = 0;
      applyCollapsedMenuHeights(menuSelect, menuBox);
      this.syncFooterHeight();
      return;
    }

    this.slashMenuItems = next.items;
    this.slashMenuIndex = next.index;
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

    const mentionQuery = computeMentionQuery(value, input.cursorOffset);
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
    const previousItems = this.mentionMenuItems;
    this.mentionMenuItems = items;
    this.mentionMenuIndex = computeNextMentionState({
      items,
      currentItems: previousItems,
      currentIndex: this.mentionMenuIndex,
    }).index;
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

    if (isArrowUp(seq)) {
      this.slashMenuIndex = nextWrappedIndex(this.slashMenuIndex, this.slashMenuItems.length, "up");
      this.syncSlashMenuViewport();
      this.syncSlashMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (isArrowDown(seq)) {
      this.slashMenuIndex = nextWrappedIndex(
        this.slashMenuIndex,
        this.slashMenuItems.length,
        "down",
      );
      this.syncSlashMenuViewport();
      this.syncSlashMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (isTab(seq)) {
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

    if (isEnter(seq)) {
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

    if (isArrowUp(seq)) {
      this.mentionMenuIndex = nextWrappedIndex(
        this.mentionMenuIndex,
        this.mentionMenuItems.length,
        "up",
      );
      this.syncMentionMenuViewport();
      this.syncMentionMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (isArrowDown(seq)) {
      this.mentionMenuIndex = nextWrappedIndex(
        this.mentionMenuIndex,
        this.mentionMenuItems.length,
        "down",
      );
      this.syncMentionMenuViewport();
      this.syncMentionMenuSelect();
      renderer.requestRender();
      return true;
    }

    if (isTab(seq) || isEnter(seq)) {
      void this.submitMentionMenuSelection();
      return true;
    }

    if (isEscape(seq)) {
      this.clearMentionMenu();
      renderer.requestRender();
      return true;
    }

    return false;
  }

  private syncSlashMenuViewport(): void {
    const next = computeMenuViewport({
      total: this.slashMenuItems.length,
      index: this.slashMenuIndex,
      scrollOffset: this.slashMenuScrollOffset,
      maxRows: MAX_SLASH_ROWS,
    });
    this.slashLineCount = next.visibleRows;
    this.slashMenuScrollOffset = next.scrollOffset;
  }

  private syncMentionMenuViewport(): void {
    const next = computeMenuViewport({
      total: this.mentionMenuItems.length,
      index: this.mentionMenuIndex,
      scrollOffset: this.mentionMenuScrollOffset,
      maxRows: MAX_MENTION_ROWS,
    });
    this.mentionLineCount = next.visibleRows;
    this.mentionMenuScrollOffset = next.scrollOffset;
  }

  private syncSlashMenuSelect(): void {
    if (!this.slashMenuSelect) return;
    const visibleItems = mapSlashOptions(
      this.slashMenuItems,
      this.slashMenuScrollOffset,
      MAX_SLASH_ROWS,
    );
    this.slashMenuSelect.options = visibleItems;
    this.slashMenuSelect.selectedIndex = Math.max(
      0,
      this.slashMenuIndex - this.slashMenuScrollOffset,
    );
    this.slashMenuSelect.showScrollIndicator = this.slashMenuItems.length > MAX_SLASH_ROWS;
  }

  private syncMentionMenuSelect(): void {
    if (!this.mentionMenuSelect) return;
    const visibleItems = mapMentionOptions(
      this.mentionMenuItems,
      this.mentionMenuScrollOffset,
      MAX_MENTION_ROWS,
    );
    this.mentionMenuSelect.options = visibleItems;
    this.mentionMenuSelect.selectedIndex = Math.max(
      0,
      this.mentionMenuIndex - this.mentionMenuScrollOffset,
    );
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

    const result = insertFileMention(
      this.currentInput,
      mentionQuery,
      this.currentMentionBindings,
      selected.path,
    );
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

  private showApprovalModal(prompt: ApprovalPromptState, resolve: (value: string) => void): void {
    if (!this.renderer || !this.footerRoot) return;
    const modal = mountApprovalModal({
      renderer: this.renderer,
      footerRoot: this.footerRoot,
      prompt,
      resolve,
      closePendingModal: () => this.closePendingModal(),
      onResolved: (value) => {
        this.pendingApprovalResolve?.(value);
        this.pendingApprovalResolve = null;
      },
      focusInput: () => this.input?.focus(),
      requestRender: () => this.renderer?.requestRender(),
      setApprovalRows: (rows) => this.setApprovalRows?.(rows),
      syncFooterHeight: () => this.syncFooterHeight(),
    });
    if (modal) this.pendingModal = modal;
  }

  private showReviewModal(prompt: ApprovalPromptState, resolve: (value: string) => void): void {
    if (!this.renderer || !this.footerRoot || !prompt.review) return;
    const modal = mountReviewModal({
      renderer: this.renderer,
      footerRoot: this.footerRoot,
      prompt,
      resolve,
      closePendingModal: () => this.closePendingModal(),
      onResolved: (value) => {
        this.pendingApprovalResolve?.(value);
        this.pendingApprovalResolve = null;
      },
      focusInput: () => this.input?.focus(),
      requestRender: () => this.renderer?.requestRender(),
      setApprovalRows: (rows) => this.setApprovalRows?.(rows),
      syncFooterHeight: () => this.syncFooterHeight(),
      registerInputHandler: (handler) =>
        this.renderer?.addInputHandler((seq) =>
          this.pendingModal?.type === "review" ? handler(seq) : false,
        ),
    });
    if (modal) this.pendingModal = modal;
  }
}
