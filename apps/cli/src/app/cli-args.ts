export type CliArgs = {
  help: boolean;
  version: boolean;
  update: boolean;
  updateCheck: boolean;
  updateForce: boolean;
  initialTask: string | null;
};

export const HELP_TEXT = `Archer CLI

Usage:
  archer
  archer "review this repository"
  archer update
  archer --help
  archer --version
  archer --update

Options:
  --help, -h     Show this help text and exit
  --version, -v  Show the Archer version and exit
  --update       Update Archer to the latest release and exit

Update command:
  archer update --check   Show whether a newer release exists
  archer update --force   Reinstall the latest release even if already current

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
  const updateCheck = args.some((arg) => arg === "--check");
  const updateForce = args.some((arg) => arg === "--force");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const updateCommand = positional[0] === "update";
  const update = args.some((arg) => arg === "--update") || updateCommand;
  const initialTask = updateCommand ? null : positional.join(" ").trim();

  return {
    help,
    version,
    update,
    updateCheck,
    updateForce,
    initialTask: initialTask && initialTask.length > 0 ? initialTask : null,
  };
}

export function printHelp(): void {
  console.log(HELP_TEXT);
}
