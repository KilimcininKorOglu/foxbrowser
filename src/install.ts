/**
 * Runs the platform installer — configures browsirai for the current OS and IDE.
 */

import { intro, select, confirm, spinner, outro, note, isCancel, cancel, log } from "@clack/prompts";
import { detectPlatform, getInstallConfig } from "./adapters/detect.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { connectFirefox } from "./firefox-launcher.js";

import type { PlatformId } from "./adapters/types.js";

/** All supported platforms for the select prompt. */
const platformOptions: Array<{ value: PlatformId; label: string }> = [
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "vscode-copilot", label: "VS Code Copilot" },
  { value: "opencode", label: "OpenCode" },
  { value: "zed", label: "Zed" },
  { value: "windsurf", label: "Windsurf" },
  { value: "cline", label: "Cline" },
  { value: "continue", label: "Continue" },
];

/**
 * Resolve a config path, expanding ~ to the home directory.
 * For project scope, paths are relative to cwd.
 * For global scope, paths starting with ~ are resolved to the home directory.
 */
function resolveConfigPath(configPath: string, scope: string): string {
  if (configPath.startsWith("~")) {
    return resolve(homedir(), configPath.slice(2));
  }
  if (scope === "global") {
    // Global scope: resolve relative to home directory
    return resolve(homedir(), configPath);
  }
  // Project scope: resolve relative to cwd
  return resolve(process.cwd(), configPath);
}

export async function runInstall(): Promise<void> {
  intro("browsirai installer");

  // Auto-detect platform
  const detected = detectPlatform();

  // Check which platforms already have browsirai installed
  const installedPlatforms = new Set<PlatformId>();
  for (const opt of platformOptions) {
    const config = getInstallConfig(opt.value);
    const paths = [
      resolve(process.cwd(), config.configPath),
      config.configPath.startsWith("~")
        ? resolve(homedir(), config.configPath.slice(2))
        : resolve(homedir(), config.configPath),
    ];
    for (const filePath of paths) {
      if (existsSync(filePath)) {
        try {
          const existing = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
          const section = existing[config.configKey] as Record<string, unknown> | undefined;
          if (section?.browsirai) installedPlatforms.add(opt.value);
        } catch { /* skip malformed */ }
      }
    }
  }

  // Platform selection — mark installed ones
  const platform = await select({
    message: "Select your AI coding platform:",
    options: platformOptions.map(opt => ({
      value: opt.value,
      label: installedPlatforms.has(opt.value) ? `${opt.label} (installed)` : opt.label,
    })),
    initialValue: detected.platform,
  });

  if (isCancel(platform)) {
    cancel("Installation cancelled.");
    return;
  }

  // Scope selection
  const scope = await select({
    message: "Install scope:",
    options: [
      { value: "project", label: "Project (current directory)" },
      { value: "global", label: "Global (user home)" },
    ],
  });

  if (isCancel(scope)) {
    cancel("Installation cancelled.");
    return;
  }

  const selectedPlatform = platform as PlatformId;
  const selectedScope = scope as string;

  // Get install config for chosen platform
  const config = getInstallConfig(selectedPlatform);

  // Build config object
  const serverConfig: Record<string, unknown> = {
    [config.configKey]: {
      browsirai: config.serverEntry,
    },
  };

  // Resolve file path
  const filePath = resolveConfigPath(config.configPath, selectedScope);

  // Check for existing file
  if (existsSync(filePath)) {
    const existingRaw = readFileSync(filePath, "utf-8");
    const existingConfig = JSON.parse(existingRaw as string) as Record<string, unknown>;

    const shouldMerge = await confirm({
      message: `Config file already exists at ${filePath}. Merge browsirai into it?`,
    });

    if (isCancel(shouldMerge) || !shouldMerge) {
      cancel("Installation cancelled.");
      return;
    }

    // Merge: preserve existing entries under the config key
    const existingSection = (existingConfig[config.configKey] ?? {}) as Record<string, unknown>;
    existingConfig[config.configKey] = {
      ...existingSection,
      browsirai: config.serverEntry,
    };

    // Ensure parent directory exists
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(existingConfig, null, 2));
  } else {
    // Ensure parent directory exists
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(serverConfig, null, 2));
  }

  log.success(`Config written to ${filePath}`);

  // --- Check/establish BiDi connection (auto-launches Firefox if needed) ---
  const s = spinner();
  s.start("Connecting to Firefox via WebDriver BiDi...");

  const connection = await connectFirefox({ autoLaunch: true });
  if (connection.success) {
    s.stop(connection.wsEndpoint
      ? `Connected to Firefox (port ${connection.port})`
      : `BiDi reachable on port ${connection.port}`);
  } else {
    s.stop(connection.error ?? "Could not connect to Firefox");
    log.warn("Run `browsirai doctor` to diagnose.");
  }

  outro("browsirai is ready! Your AI agent can now control your browser.");
}
