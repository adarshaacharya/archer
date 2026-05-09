export function requireVersion(): string {
  return "0.1.3";
}

export function printVersion(): void {
  console.log(`archer ${requireVersion()}`);
}
