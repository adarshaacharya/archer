export interface TuiTheme {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentStrong: string;
  success: string;
  warning: string;
  error: string;
}

export const xeqTheme: TuiTheme = {
  bg: "#101418",
  surface: "#1A212A",
  text: "#D6E2F0",
  muted: "#8FA1B3",
  border: "#2B3948",
  accent: "#5CC8FF",
  accentStrong: "#76E3B1",
  success: "#76E3B1",
  warning: "#F6C177",
  error: "#FF7A90",
};

export const xeqBranding = {
  appTitle: "XEQ",
  frameTitle: "XEQ",
  sessionTitle: "Session",
  streamTitle: "Session Log",
  approvalTitle: "Approval",
  summaryTitle: "Summary",
  promptHint: "enter=run | ctrl+c=exit",
} as const;
