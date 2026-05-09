export type CliArgs = {
  help: boolean;
  version: boolean;
  initialTask: string | null;
};

export const HELP_TEXT = `Archer CLI

Usage:
  archer
  archer "review this repository"
  archer --help
  archer --version

Options:
  --help, -h     Show this help text and exit
  --version, -v  Show the Archer version and exit

Slash commands:
  /help          Show available slash commands
  /new           Start a fresh session
  /resume        Restore a saved session
  /providers     Show provider connection status
  /connect       Connect a model provider
  /model         Choose the active model
  /web           Connect a web search provider
  /bye           Exit Archer
`;

export function parseCliArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const help = args.some((arg) => arg === "--help" || arg === "-h");
  const version = args.some((arg) => arg === "--version" || arg === "-v");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const initialTask = positional.join(" ").trim();

  return {
    help,
    version,
    initialTask: initialTask.length > 0 ? initialTask : null,
  };
}

export function printHelp(): void {
  console.log(HELP_TEXT);
}
