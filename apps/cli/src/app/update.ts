import { mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };

const REPO_SLUG = "adarshaacharya/archer";
const NETWORK_TIMEOUT_MS = 10_000;

type ReleaseInfo = {
  tag_name: string;
};

type LatestReleaseInfo = {
  currentVersion: string;
  latestTag: string;
  latestVersion: string;
};

function platformArtifact(): string {
  switch (`${process.platform}-${process.arch}`) {
    case "darwin-arm64":
      return "darwin-arm64";
    case "darwin-x64":
      return "darwin-x64";
    case "linux-arm64":
      return "linux-arm64";
    case "linux-x64":
      return "linux-x64";
    default:
      throw new Error(`Unsupported platform for Archer update: ${process.platform}-${process.arch}`);
  }
}

function parseSemver(version: string): [number, number, number] {
  const normalized = version.trim().replace(/^v/, "");
  const parts = normalized.split(".");
  if (parts.length !== 3) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  const patch = Number.parseInt(parts[2] ?? "", 10);
  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return [major, minor, patch];
}

function compareVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseSemver(left);
  const [rightMajor, rightMinor, rightPatch] = parseSemver(right);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

function buildUpdateNotice(currentVersion: string, latestVersion: string): string | null {
  return compareVersions(currentVersion, latestVersion) < 0
    ? `New version available: ${currentVersion} -> ${latestVersion}. Run \`archer update\` to install it.`
    : null;
}

function currentInstallDir(): string {
  const envDir = process.env.ARCHER_INSTALL_DIR?.trim();
  if (envDir) return path.resolve(envDir);

  throw new Error(
    "Archer update is only available for release-installer builds. Reinstall with the installer script or update your package-manager install manually.",
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = NETWORK_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestReleaseTag(): Promise<string> {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "archer",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest Archer release: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ReleaseInfo;
  if (!data.tag_name) {
    throw new Error("Latest release response did not include a tag name");
  }

  return data.tag_name;
}

async function downloadArchive(url: string, destination: string): Promise<void> {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "archer",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Archer release asset: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, bytes);
}

async function getLatestReleaseInfo(): Promise<LatestReleaseInfo> {
  const currentVersion = packageJson.version;
  const latestTag = await fetchLatestReleaseTag();
  const latestVersion = latestTag.replace(/^v/, "");

  return {
    currentVersion,
    latestTag,
    latestVersion,
  };
}

async function extractArchive(archivePath: string, destinationDir: string): Promise<void> {
  const tar = Bun.spawn({
    cmd: ["tar", "-xzf", archivePath, "-C", destinationDir],
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await tar.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to extract Archer release archive (${exitCode})`);
  }
}

async function findTopLevelDirectory(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    throw new Error("Downloaded release archive did not contain exactly one top-level directory");
  }

  const [onlyDir] = directories;
  if (!onlyDir) {
    throw new Error("Downloaded release archive did not contain exactly one top-level directory");
  }

  return path.join(dir, onlyDir.name);
}

export async function updateArcher(options: { checkOnly?: boolean; force?: boolean } = {}): Promise<string> {
  const { currentVersion, latestTag, latestVersion } = await getLatestReleaseInfo();

  if (options.checkOnly) {
    return (
      buildUpdateNotice(currentVersion, latestVersion) ??
      `Archer is already up to date (${currentVersion}).`
    );
  }

  if (compareVersions(currentVersion, latestVersion) >= 0) {
    if (!options.force) {
      return `Archer is already up to date (${currentVersion}).`;
    }
  }

  const installDir = currentInstallDir();
  const parentDir = path.dirname(installDir);
  const workDir = await mkdtemp(path.join(parentDir, ".archer-update-"));
  const archiveName = `archer-${platformArtifact()}.tar.gz`;
  const archivePath = path.join(workDir, archiveName);
  const releaseUrl = `https://github.com/${REPO_SLUG}/releases/download/${latestTag}/${archiveName}`;

  let backupDir: string | null = null;
  let stagedInstallDir: string | null = null;

  try {
    await downloadArchive(releaseUrl, archivePath);
    await extractArchive(archivePath, workDir);
    const extractedRoot = await findTopLevelDirectory(workDir);
    stagedInstallDir = `${installDir}.next-${Date.now()}`;
    backupDir = `${installDir}.backup-${Date.now()}`;

    await rm(stagedInstallDir, { force: true, recursive: true });
    await rename(extractedRoot, stagedInstallDir);

    try {
      await rename(installDir, backupDir);
    } catch {
      backupDir = null;
    }

    try {
      await rename(stagedInstallDir, installDir);
      stagedInstallDir = null;
    } catch (error) {
      if (backupDir) {
        try {
          await rename(backupDir, installDir);
          backupDir = null;
        } catch (restoreError) {
          const restoreMessage =
            restoreError instanceof Error ? restoreError.message : String(restoreError);
          throw new Error(
            `Failed to activate Archer update and failed to restore the previous install: ${restoreMessage}`,
          );
        }
      }

      throw error;
    }

    if (backupDir) {
      await rm(backupDir, { force: true, recursive: true });
      backupDir = null;
    }

    return `Updated Archer from ${currentVersion} to ${latestVersion}. Restart Archer to use the new version.`;
  } finally {
    if (stagedInstallDir) {
      await rm(stagedInstallDir, { force: true, recursive: true });
    }
    if (backupDir) {
      await rm(backupDir, { force: true, recursive: true });
    }
    await rm(workDir, { force: true, recursive: true });
  }
}

export async function getArcherUpdateNotice(): Promise<string | null> {
  try {
    const { currentVersion, latestVersion } = await getLatestReleaseInfo();
    return buildUpdateNotice(currentVersion, latestVersion);
  } catch {
    return null;
  }
}
