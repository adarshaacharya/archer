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
  bg: "#1A1B26",
  surface: "#24283B",
  text: "#C0CAF5",
  muted: "#A9B1D6",
  border: "#414868",
  accent: "#7AA2F7",
  accentStrong: "#BB9AF7",
  success: "#9ECE6A",
  warning: "#E0AF68",
  error: "#F7768E",
};

export const xeqBranding = {
  appTitle: "XEQ //",
  frameTitle: "XEQ // Terminal Agent",
  sessionTitle: "Session",
  streamTitle: "Step Stream",
  approvalTitle: "Approval",
  summaryTitle: "Summary",
  promptHint: "? for shortcuts",
} as const;
