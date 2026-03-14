/**
 * Auto-upgrade system for browsirai.
 *
 * On MCP server start, checks npm registry for a newer version.
 * If found, performs a background upgrade (npm cache clean for npx,
 * npm install -g for global). Changes apply on next server restart.
 *
 * State is persisted to ~/.browsirai/upgrade.json with a 1-hour rate limit.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeStatus {
  current: string;
  latest: string;
  checkedAt: string;
  installMethod: InstallMethod;
}

export type InstallMethod = "npx" | "global" | "dev";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BROWSIR_DIR = join(homedir(), ".browsirai");
const UPGRADE_FILE = join(BROWSIR_DIR, "upgrade.json");
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Install method detection
// ---------------------------------------------------------------------------

/**
 * Detect how browsirai was installed by inspecting the running script path.
 */
export function getInstallMethod(): InstallMethod {
  try {
    const scriptPath = fileURLToPath(import.meta.url);

    // Local dev: has .git sibling or is inside a src/ directory with tsconfig
    const parentDir = dirname(dirname(scriptPath));
    if (
      existsSync(join(parentDir, ".git")) ||
      existsSync(join(parentDir, "tsconfig.json"))
    ) {
      return "dev";
    }

    // npx: path contains _npx or .npm/_cacache
    if (scriptPath.includes("_npx") || scriptPath.includes(".npm")) {
      return "npx";
    }

    // Global: check if script is under npm global prefix
    try {
      const globalPrefix = execSync("npm prefix -g", { stdio: "pipe" })
        .toString()
        .trim();
      if (scriptPath.startsWith(globalPrefix)) {
        return "global";
      }
    } catch {
      // Can't determine global prefix
    }

    // Default to npx (most common for MCP servers)
    return "npx";
  } catch {
    return "npx";
  }
}

/**
 * Get the resolved install path of browsirai.
 */
export function getInstallPath(): string {
  try {
    return dirname(dirname(fileURLToPath(import.meta.url)));
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/** Returns true if `latest` is newer than `current` (semver without deps). */
function isNewer(current: string, latest: string): boolean {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

/** Read cached upgrade status (sync, for use in tool handlers). */
export function getUpgradeStatus(): UpgradeStatus | null {
  try {
    if (!existsSync(UPGRADE_FILE)) return null;
    return JSON.parse(readFileSync(UPGRADE_FILE, "utf-8")) as UpgradeStatus;
  } catch {
    return null;
  }
}

function writeUpgradeStatus(status: UpgradeStatus): void {
  try {
    mkdirSync(BROWSIR_DIR, { recursive: true });
    writeFileSync(UPGRADE_FILE, JSON.stringify(status, null, 2));
  } catch {
    // Non-critical — status just won't be cached
  }
}

// ---------------------------------------------------------------------------
// Core: check + upgrade
// ---------------------------------------------------------------------------

/**
 * Check npm registry for a newer version and perform background upgrade.
 * Non-blocking, all errors silently caught. Safe to fire-and-forget.
 */
export async function checkForUpgrade(): Promise<UpgradeStatus | null> {
  try {
    const method = getInstallMethod();

    // Skip in dev mode
    if (method === "dev") return null;

    // Rate limit: skip if checked within the last hour
    const cached = getUpgradeStatus();
    if (cached) {
      const elapsed = Date.now() - new Date(cached.checkedAt).getTime();
      if (elapsed < CHECK_INTERVAL_MS) return cached;
    }

    // Fetch latest version from npm registry (5s timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://registry.npmjs.org/browsirai/latest", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;

    const status: UpgradeStatus = {
      current: VERSION,
      latest,
      checkedAt: new Date().toISOString(),
      installMethod: method,
    };

    writeUpgradeStatus(status);

    // Perform background upgrade if newer version available
    if (isNewer(VERSION, latest)) {
      process.stderr.write(
        `browsirai: v${latest} available (current: v${VERSION}). Upgrading in background...\n`,
      );

      if (method === "npx") {
        // Clear npx cache so next invocation fetches latest
        spawn("npm", ["cache", "clean", "--force"], {
          stdio: "ignore",
          detached: true,
        }).unref();
      } else if (method === "global") {
        spawn("npm", ["install", "-g", `browsirai@${latest}`], {
          stdio: "ignore",
          detached: true,
        }).unref();
      }
    }

    return status;
  } catch {
    // Never crash the server for an upgrade check
    return null;
  }
}
