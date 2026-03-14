/**
 * Runtime platform detection for foxbrowser.
 *
 * Inspects environment variables to determine which AI coding platform
 * is invoking the MCP server, enabling platform-specific behavior.
 */

import type { PlatformId, ConfidenceLevel } from "./types.js";

/** Detection result returned by {@link detectPlatform}. */
export interface DetectionResult {
  /** Detected platform identifier. */
  platform: PlatformId;
  /** Confidence in the detection accuracy. */
  confidence: ConfidenceLevel;
  /** Human-readable explanation of why this platform was detected. */
  reason: string;
}

/** Install configuration for a specific platform. */
export interface InstallConfig {
  /** Path to the platform's config file. */
  configPath: string;
  /** JSON key used for MCP server entries. */
  configKey: string;
  /** The JSON entry for foxbrowser. */
  serverEntry: Record<string, unknown>;
}

/**
 * Detect the current AI coding platform by inspecting environment variables.
 *
 * Detection priority (first match wins):
 * 1. Claude Code     — `CLAUDE_PROJECT_DIR` is set
 * 2. Cursor          — `CURSOR_TRACE_ID` is set
 * 3. Gemini CLI      — `GEMINI_CLI` is set
 * 4. VS Code Copilot — `VSCODE_PID` is set or `TERM_PROGRAM` is "vscode"
 * 5. OpenCode        — `OPENCODE_CONFIG` is set
 * 6. Generic         — fallback when no platform-specific env vars are found
 */
export function detectPlatform(): DetectionResult {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return {
      platform: "claude-code",
      confidence: "high",
      reason: `CLAUDE_PROJECT_DIR is set (${process.env.CLAUDE_PROJECT_DIR})`,
    };
  }

  if (process.env.CURSOR_TRACE_ID) {
    return {
      platform: "cursor",
      confidence: "high",
      reason: `CURSOR_TRACE_ID is set (${process.env.CURSOR_TRACE_ID})`,
    };
  }

  if (process.env.GEMINI_CLI) {
    return {
      platform: "gemini-cli",
      confidence: "high",
      reason: `GEMINI_CLI is set (${process.env.GEMINI_CLI})`,
    };
  }

  if (process.env.VSCODE_PID) {
    return {
      platform: "vscode-copilot",
      confidence: "medium",
      reason: `VSCODE_PID is set (${process.env.VSCODE_PID})`,
    };
  }

  if (process.env.TERM_PROGRAM === "vscode") {
    return {
      platform: "vscode-copilot",
      confidence: "medium",
      reason: `TERM_PROGRAM is set to vscode`,
    };
  }

  if (process.env.OPENCODE_CONFIG) {
    return {
      platform: "opencode",
      confidence: "high",
      reason: `OPENCODE_CONFIG is set (${process.env.OPENCODE_CONFIG})`,
    };
  }

  return {
    platform: "generic",
    confidence: "low",
    reason: "No platform-specific environment variables detected",
  };
}

/** Platform-specific install configuration map. */
const installConfigs: Record<PlatformId, { configPath: string; configKey: string }> = {
  "claude-code": {
    configPath: ".mcp.json",
    configKey: "mcpServers",
  },
  cursor: {
    configPath: ".cursor/mcp.json",
    configKey: "mcpServers",
  },
  "gemini-cli": {
    configPath: "~/.gemini/settings.json",
    configKey: "mcpServers",
  },
  windsurf: {
    configPath: "~/.codeium/windsurf/mcp_config.json",
    configKey: "mcpServers",
  },
  cline: {
    configPath:
      "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    configKey: "mcpServers",
  },
  "vscode-copilot": {
    configPath: ".vscode/mcp.json",
    configKey: "servers",
  },
  opencode: {
    configPath: "opencode.json",
    configKey: "mcpServers",
  },
  zed: {
    configPath: "~/.config/zed/settings.json",
    configKey: "context_servers",
  },
  continue: {
    configPath: "~/.continue/config.yaml",
    configKey: "mcpServers",
  },
  generic: {
    configPath: "mcp.json",
    configKey: "mcpServers",
  },
};

/**
 * Get the install configuration for a given platform.
 *
 * Returns the config file path, the JSON key for MCP server entries,
 * and the standard server entry for foxbrowser.
 */
export function getInstallConfig(platformId: PlatformId): InstallConfig {
  const config = installConfigs[platformId];
  return {
    configPath: config.configPath,
    configKey: config.configKey,
    serverEntry: {
      command: "npx",
      args: ["-y", "foxbrowser"],
    },
  };
}
