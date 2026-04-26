import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import { batch, createEffect, createRoot, createSignal, onCleanup } from "solid-js";
import type { AgentStep, RunSummary } from "@xeq/shared";

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
  setActiveModel(modelId: string): void;
  renderUserMessage(message: string): void;
  renderStep(step: AgentStep): void;
  renderAssistantDelta(delta: string): void;
  finalizeAssistantStream(text?: string): void;
  renderApprovalPrompt(prompt: ApprovalPromptState | null): void;
  promptApproval(prompt: ApprovalPromptState): Promise<string>;
  renderSummary(summary: RunSummary): void;
  setSlashCommands(commands: SlashCommandItem[]): void;
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

// Footer sizing: status(1) + border-top(1) + input(1) + border-bottom(1) = 4
const BASE_FOOTER = 4;
const MAX_SLASH_ROWS = 6;

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
  private statusText: TextRenderable | null = null;
  private input: InputRenderable | null = null;
  private slashMenuBox: BoxRenderable | null = null;
  private slashMenuSelect: SelectRenderable | null = null;
  private slashCommands: SlashCommandItem[] = [];
  private slashMenuItems: SlashCommandItem[] = [];
  private slashMenuIndex = 0;
  private slashMenuScrollOffset = 0;
  private slashLineCount = 0;
  private currentInput = "";
  private assistantStreamText = "";
  private pendingReadResolve: ((line: string) => void) | null = null;
  private pendingApprovalResolve: ((choice: string) => void) | null = null;
  private pendingModal: PendingModal | null = null;
  private cancelRunningHandler: (() => void) | null = null;
  private activeModelLabel = "model=unconfigured";
  private dispose: VoidFunction | null = null;
  private setInputValue: ((value: string) => void) | null = null;
  private setSlashCommandsState: ((value: SlashCommandItem[]) => void) | null = null;
  private setApprovalRows: ((value: number) => void) | null = null;

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

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      screenMode: "split-footer",
      footerHeight: BASE_FOOTER,
      externalOutputMode: "capture-stdout",
      exitOnCtrlC: false,
      clearOnShutdown: false,
      autoFocus: true,
      useMouse: true,
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
        const nextHeight = BASE_FOOTER + this.slashLineCount + approvalRows()
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

    // Status line (1 row, above composer border)
    const statusRow = new BoxRenderable(this.renderer, {
      id: "status-row",
      width: "100%",
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
    });
    this.statusText = new TextRenderable(this.renderer, {
      id: "status-text",
      content: "",
      width: "100%",
      height: 1,
      fg: col.muted,
    });
    statusRow.add(this.statusText);

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

    // Composer box: just the border + input row (no slash inside)
    const composerBox = new BoxRenderable(this.renderer, {
      id: "composer",
      width: "100%",
      height: 3,
      flexShrink: 0,
      flexDirection: "column",
      alignItems: "stretch",
      border: true,
      borderStyle: "single",
      borderColor: col.border,
      paddingLeft: 1,
      paddingRight: 1,
    });

    const inputRow = new BoxRenderable(this.renderer, {
      id: "input-row",
      width: "100%",
      height: 1,
      flexDirection: "row",
      alignItems: "center",
    });

    const promptGlyph = new TextRenderable(this.renderer, {
      id: "prompt",
      content: ">",
      width: 2,
      flexShrink: 0,
      fg: col.accent,
    });

    this.input = new InputRenderable(this.renderer, {
      id: "input",
      value: "",
      placeholder: "message xeq…",
      flexGrow: 1,
      flexShrink: 1,
      textColor: col.text,
    });

    inputRow.add(promptGlyph);
    inputRow.add(this.input);
    composerBox.add(inputRow);

    this.footerRoot.add(statusRow);
    this.footerRoot.add(composerBox);
    this.footerRoot.add(this.slashMenuBox);
    this.renderer.root.add(this.footerRoot);
    this.renderer.start();

    // Welcome banner
    this.print("xeq  type a task to get started  /help for commands  ctrl+c to quit", col.muted);
    this.print("");

    // ── Input events ──────────────────────────────────────────────────────────
    this.input.on(InputRenderableEvents.INPUT, (value: string) => {
      this.currentInput = value;
      this.setInputValue?.(value);
      this.updateSlashMenu(value);
    });

    this.input.on(InputRenderableEvents.ENTER, (value: string) => {
      const submit = normalizeText(value);
      this.currentInput = "";
      if (this.input) this.input.value = "";
      this.setInputValue?.("");
      this.updateSlashMenu("");

      if (this.pendingReadResolve) {
        const resolve = this.pendingReadResolve;
        this.pendingReadResolve = null;
        resolve(submit);
      } else if (submit.startsWith("/")) {
        const command = submit.slice(1).split(/\s+/)[0];
        const match = this.slashCommands.find((item) => item.name === `/${command}`);
        if (match) this.renderUserMessage(submit);
      }
    });

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
      if (seq === "\x1b" && this.pendingModal) {
        this.rejectPendingModal();
        return true;
      }
      return false;
    });

    this.input.focus();
  }

  setActiveModel(modelId: string): void {
    const value = modelId.trim();
    this.activeModelLabel = value ? `model=${value}` : "model=unconfigured";
    if (this.statusText) {
      this.statusText.content = this.activeModelLabel;
      this.renderer?.requestRender();
    }
  }

  renderUserMessage(message: string): void {
    const text = normalizeText(message);
    if (!text) return;
    if (!this.renderer) return;
    this.renderer.writeToScrollback((ctx) => {
      const box = new BoxRenderable(ctx.renderContext, {
        id: "user-msg-box",
        width: ctx.width,
        backgroundColor: col.userBg,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 0,
        paddingBottom: 0,
      });
      box.add(new TextRenderable(ctx.renderContext, {
        id: "user-msg-text",
        content: `› ${text}`,
        width: ctx.width - 4,
        wrapMode: "word",
        truncate: false,
        fg: col.text,
      }));
      return { root: box, width: ctx.width, startOnNewLine: true, trailingNewline: true };
    });
    this.print("");
  }

  renderStep(step: AgentStep): void {
    const detail = step.observation
      ? `\n  ${normalizeText(step.observation).split("\n").slice(0, 3).join("\n  ")}`
      : "";
    this.print(`● ${step.action}  step ${step.step}${detail}`, col.step);
  }

  renderAssistantDelta(delta: string): void {
    if (!delta) return;
    this.assistantStreamText += delta;
    if (this.statusText) {
      const lines = this.assistantStreamText.trimEnd().split("\n");
      const last = (lines[lines.length - 1] ?? "").slice(0, 100);
      this.statusText.content = `${this.activeModelLabel}  |  ${last}`;
      this.renderer?.requestRender();
    }
  }

  finalizeAssistantStream(text?: string): void {
    const final = normalizeText(text ?? this.assistantStreamText);
    this.assistantStreamText = "";
    if (this.statusText) {
      this.statusText.content = this.activeModelLabel;
      this.renderer?.requestRender();
    }
    if (final) {
      this.print(final, col.text);
      this.print("");
    }
  }

  renderApprovalPrompt(prompt: ApprovalPromptState | null): void {
    if (!prompt) {
      this.closePendingModal();
      if (this.statusText) this.statusText.content = this.activeModelLabel;
      this.input?.focus();
      this.renderer?.requestRender();
      return;
    }
    if (this.pendingModal) return;
    if (this.statusText) {
      const hint = prompt.options ? `  ${prompt.options.join("  ")}` : "";
      this.statusText.content = `${this.activeModelLabel}  |  ${normalizeText(prompt.message)}${hint}`;
      this.renderer?.requestRender();
    }
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
    ].join("  ");
    this.print(`◆ ${line}`, col.summary);
    this.print("");
    this.printSeparator();
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

  private printSeparator(): void {
    if (!this.renderer) return;
    this.renderer.writeToScrollback((ctx) => {
      const text = new TextRenderable(ctx.renderContext, {
        id: "sb-sep",
        content: "─".repeat(ctx.width),
        width: ctx.width,
        wrapMode: "none",
        truncate: true,
        fg: col.border,
      });
      return { root: text, width: ctx.width, startOnNewLine: true, trailingNewline: true };
    });
  }

  /** Write a styled line to the scrollback area above the footer. */
  private print(content: string, fg: string = col.text): void {
    if (!this.renderer) return;
    this.renderer.writeToScrollback((ctx) => {
      const text = new TextRenderable(ctx.renderContext, {
        id: "sb-line",
        content,
        width: ctx.width,
        wrapMode: "word",
        truncate: false,
        fg,
      });
      return { root: text, width: ctx.width, startOnNewLine: true, trailingNewline: true };
    });
  }

  private updateSlashMenu(value: string): void {
    const menuSelect = this.slashMenuSelect;
    const menuBox = this.slashMenuBox;
    const renderer = this.renderer;
    if (!menuSelect || !menuBox || !renderer) return;

    const items = slashCommandMatches(this.slashCommands, value);
    const previous = this.slashMenuItems[this.slashMenuIndex];
    const nextIndex = previous
      ? Math.max(0, items.findIndex((item) => item.name === previous.name))
      : 0;
    const lineCount = items.length;

    this.slashMenuItems = items;
    this.slashMenuIndex = items.length > 0 ? (nextIndex >= 0 ? nextIndex : 0) : 0;
    this.syncSlashMenuViewport();

    batch(() => {
      this.syncSlashMenuSelect();
      menuSelect.height = this.slashLineCount;
      menuBox.height = this.slashLineCount;
    });
    renderer.footerHeight = BASE_FOOTER + this.slashLineCount + (this.pendingModal ? (this.pendingModal.type === "review" ? 19 : this.pendingModal.box.height) : 0);
    renderer.requestRender();
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
      input.value = selected.name;
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

  private submitSlashMenuSelection(): void {
    const selected = this.slashMenuItems[this.slashMenuIndex];
    const renderer = this.renderer;
    const input = this.input;
    if (!selected || !renderer || !input) return;

    input.value = "";
    this.currentInput = "";
    this.setInputValue?.("");
    this.updateSlashMenu("");

    if (this.pendingReadResolve) {
      const resolve = this.pendingReadResolve;
      this.pendingReadResolve = null;
      renderer.requestRender();
      resolve(selected.name);
      return;
    }

    this.renderUserMessage(selected.name);
    renderer.requestRender();
  }

  private closePendingModal(): void {
    if (this.pendingModal) {
      this.pendingModal.box.destroyRecursively();
      this.pendingModal = null;
      this.setApprovalRows?.(0);
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
  private approvalBox(id: string, innerRows: number, title: string): BoxRenderable {
    if (!this.renderer) throw new Error("renderer not ready");
    return new BoxRenderable(this.renderer, {
      id,
      width: "100%",
      height: innerRows + 2,  // +2 for border-top and border-bottom
      flexShrink: 0,
      flexDirection: "column",
      alignItems: "stretch",
      border: true,
      borderStyle: "single",
      borderColor: col.accent,
      paddingLeft: 1,
      paddingRight: 1,
      title: ` ${title} `,
    });
  }

  private showApprovalModal(prompt: ApprovalPromptState, resolve: (value: string) => void): void {
    if (!this.renderer || !this.footerRoot) return;

    const choices = prompt.choices ?? defaultApprovalChoices();
    const visibleChoices = Math.min(choices.length, 8);
    // innerRows = message(1) + choices viewport + help(1)
    const innerRows = 1 + visibleChoices + 1;
    const box = this.approvalBox("approval-modal", innerRows, "approval");

    box.add(new TextRenderable(this.renderer, {
      id: "approval-msg",
      content: normalizeText(prompt.message),
      width: "100%",
      height: 1,
      fg: col.muted,
    }));

    const select = new SelectRenderable(this.renderer, {
      id: "approval-select",
      options: choices.map((ch) => ({
        name: ch.label,
        description: ch.description ?? "",
        value: ch.value,
      })),
      selectedIndex: Math.max(0, Math.min(choices.length - 1, prompt.selectedIndex ?? 1)),
      width: "100%",
      height: visibleChoices,
      showScrollIndicator: choices.length > visibleChoices,
      showDescription: false,
      selectedBackgroundColor: col.accent,
      selectedTextColor: "#000000",
    });

    box.add(select);
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

    select.focus();
    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, item: { value: string }) => {
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
    actionSelect.focus();

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
