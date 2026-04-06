
export type SandboxPlatform = "macos" | "linux" | "windows";

export function detectSandboxPlatform(): SandboxPlatform {
    switch (process.platform) {
        case "darwin":
            return "macos";
        case "linux":
            return "linux";
        case "win32":
            return "windows";
        default:
            throw new Error(`Unsupported platform for sandbox: ${process.platform}`);
    }
}