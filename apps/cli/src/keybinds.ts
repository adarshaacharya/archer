import type { TuiKeybinds } from "@xeq/shared";

type ParsedCombo = {
  leader: boolean;
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};

type ParsedKey = {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};

export type KeybindAction = "leader" | "app_exit" | "input_submit" | "input_backspace" | "input_clear";

const DEFAULT_KEYBINDS: Required<TuiKeybinds> = {
  leader: "ctrl+x",
  app_exit: "ctrl+d,<leader>q",
  input_submit: "return",
  input_backspace: "backspace",
  input_clear: "ctrl+c",
};

export class KeybindManager {
  private readonly parsed: Record<KeybindAction, ParsedCombo[]>;
  private leaderActive = false;
  private leaderTimeout: NodeJS.Timeout | null = null;

  constructor(config?: TuiKeybinds) {
    const resolved = {
      leader: config?.leader ?? DEFAULT_KEYBINDS.leader,
      app_exit: config?.app_exit ?? DEFAULT_KEYBINDS.app_exit,
      input_submit: config?.input_submit ?? DEFAULT_KEYBINDS.input_submit,
      input_backspace: config?.input_backspace ?? DEFAULT_KEYBINDS.input_backspace,
      input_clear: config?.input_clear ?? DEFAULT_KEYBINDS.input_clear,
    };
    this.parsed = {
      leader: this.parseList(resolved.leader),
      app_exit: this.parseList(resolved.app_exit),
      input_submit: this.parseList(resolved.input_submit),
      input_backspace: this.parseList(resolved.input_backspace),
      input_clear: this.parseList(resolved.input_clear),
    };
  }

  match(action: KeybindAction, key: ParsedKey): boolean {
    const combos = this.parsed[action];
    const inLeaderMode = this.leaderActive;

    for (const combo of combos) {
      if (combo.leader !== inLeaderMode) continue;
      if (!key.name) continue;
      if (normalizeName(combo.name) !== normalizeName(key.name)) continue;
      if (!!combo.ctrl !== !!key.ctrl) continue;
      if (!!combo.shift !== !!key.shift) continue;
      if (!!combo.meta !== !!key.meta) continue;
      return true;
    }
    return false;
  }

  consumeLeaderIfMatched(key: ParsedKey): boolean {
    if (this.leaderActive) return false;
    if (!this.match("leader", key)) return false;
    this.leaderActive = true;
    if (this.leaderTimeout) clearTimeout(this.leaderTimeout);
    this.leaderTimeout = setTimeout(() => {
      this.leaderActive = false;
      this.leaderTimeout = null;
    }, 2000);
    return true;
  }

  resetLeader(): void {
    this.leaderActive = false;
    if (this.leaderTimeout) {
      clearTimeout(this.leaderTimeout);
      this.leaderTimeout = null;
    }
  }

  print(action: KeybindAction): string {
    const combo = this.parsed[action][0];
    if (!combo) return "";
    const text = stringify(combo);
    const leader = this.parsed.leader[0];
    if (!leader) return text;
    return text.replace("<leader>", stringify(leader));
  }

  private parseList(value: string): ParsedCombo[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseCombo(item));
  }
}

function parseCombo(input: string): ParsedCombo {
  const combo: ParsedCombo = {
    leader: false,
    name: "",
  };

  for (const part of input.split("+").map((x) => x.trim().toLowerCase())) {
    if (!part) continue;
    if (part === "<leader>" || part === "leader") {
      combo.leader = true;
      continue;
    }
    if (part === "ctrl" || part === "control") {
      combo.ctrl = true;
      continue;
    }
    if (part === "shift") {
      combo.shift = true;
      continue;
    }
    if (part === "alt" || part === "meta" || part === "option") {
      combo.meta = true;
      continue;
    }
    combo.name = part;
  }

  if (!combo.name) combo.name = "unknown";
  return combo;
}

function normalizeName(name: string): string {
  if (name === "return") return "enter";
  return name.toLowerCase();
}

function stringify(combo: ParsedCombo): string {
  const parts: string[] = [];
  if (combo.leader) parts.push("<leader>");
  if (combo.ctrl) parts.push("ctrl");
  if (combo.shift) parts.push("shift");
  if (combo.meta) parts.push("alt");
  parts.push(normalizeName(combo.name));
  return parts.join("+");
}
