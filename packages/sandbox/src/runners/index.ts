import { detectSandboxPlatform } from "../platform/detect.js";
import { runWithLinuxBwrap } from "./linux-bwrap.js";
import { runWithMacosSeatbelt } from "./macos-seatbelt.js";
import type { SandboxRunner } from "./types.js";

export function getSandboxRunner(): SandboxRunner {
    const platform = detectSandboxPlatform();

    if (platform === "linux") return runWithLinuxBwrap;
    if (platform === "macos") return runWithMacosSeatbelt;

    throw new Error("Windows sandbox runner is not implemented yet");
}

export type { SandboxExecOptions, SandboxExecResult, SandboxRunner } from "./types.js";