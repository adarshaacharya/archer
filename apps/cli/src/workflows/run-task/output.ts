export function shellOutputText(output: unknown): string {
  if (!output || typeof output !== "object") {
    return typeof output === "string" ? output : "";
  }

  const stdout =
    typeof (output as { stdout?: unknown }).stdout === "string"
      ? (output as { stdout: string }).stdout
      : "";
  const stderr =
    typeof (output as { stderr?: unknown }).stderr === "string"
      ? (output as { stderr: string }).stderr
      : "";

  return [stdout, stderr].filter(Boolean).join("\n");
}

export function isSuccessfulGitCommitOutput(output: unknown): boolean {
  const text = shellOutputText(output);
  return /^\[[^\]]+\s+[0-9a-f]{7,}\]/m.test(text);
}
