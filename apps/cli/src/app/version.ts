import packageJson from "../../package.json" with { type: "json" };

export function requireVersion(): string {
  return packageJson.version;
}

export function printVersion(): void {
  console.log(`archer ${requireVersion()}`);
}
