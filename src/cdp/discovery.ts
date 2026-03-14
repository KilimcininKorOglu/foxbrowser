/**
 * Browser Discovery Module
 *
 * Discovers running Chromium-based browsers via:
 * - HTTP GET /json/version endpoint
 * - DevToolsActivePort file parsing
 * - Port scanning
 * - OS-specific browser path resolution
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Information about a discovered browser instance.
 */
export interface BrowserInfo {
  /** Browser name (e.g., "Chrome", "Edge", "Brave") */
  browser: string;
  /** Browser version string (e.g., "131.0.6778.86") */
  version: string;
  /** WebSocket URL for the browser-level debugger */
  webSocketDebuggerUrl: string;
  /** Chrome DevTools Protocol version */
  protocolVersion: string;
  /** Raw User-Agent string */
  userAgent?: string;
  /** V8 engine version */
  v8Version?: string;
}

/**
 * Error codes for discovery failures.
 */
export type DiscoveryErrorCode =
  | "BROWSER_NOT_FOUND"
  | "DEBUG_PORT_UNAVAILABLE";

/**
 * Structured error type for browser discovery failures.
 */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DiscoverBrowserOptions {
  /** Host to connect to (default: "127.0.0.1") */
  host?: string;
  /** Port to connect to (default: 9222) */
  port?: number;
  /** Timeout in ms for the HTTP request */
  timeout?: number;
}

export interface ScanPortsOptions {
  /** Host to scan (default: "127.0.0.1") */
  host?: string;
  /** Ports to scan */
  ports?: number[];
}

export interface ParseJsonListOptions {
  /** Return only targets with type === "page" */
  pagesOnly?: boolean;
  /** Exclude targets with chrome:// URLs */
  excludeInternal?: boolean;
}

/**
 * A single target from Chrome's /json/list response.
 */
export interface TargetInfo {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
  description?: string;
}

/**
 * Result of parsing a DevToolsActivePort file.
 */
export interface DevToolsActivePortInfo {
  port: number;
  wsPath: string;
  wsUrl: string;
}

// ---------------------------------------------------------------------------
// Browser type detection
// ---------------------------------------------------------------------------

/** Known Chromium-based browser identifiers mapped from the Browser field. */
const BROWSER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /^Brave\//i, name: "Brave" },
  { pattern: /^Arc\//i, name: "Arc" },
  { pattern: /^Vivaldi\//i, name: "Vivaldi" },
  { pattern: /^Edg\//i, name: "Edge" },
  { pattern: /^OPR\//i, name: "Opera" },
  { pattern: /^Chrome\//i, name: "Chrome" },
  { pattern: /^Chromium\//i, name: "Chromium" },
];

/**
 * Detects the browser type from the "Browser" field of /json/version.
 *
 * @param browserField - Value of the "Browser" field, e.g. "Chrome/131.0.6778.86"
 * @returns Identified browser name, or "Chromium" as fallback
 */
export function detectBrowserType(browserField: string): string {
  for (const { pattern, name } of BROWSER_PATTERNS) {
    if (pattern.test(browserField)) {
      return name;
    }
  }
  return "Chromium";
}

/**
 * Extracts the version string from the Browser field.
 * For compound fields like "Brave/1.73.97 Chrome/131.0.6778.86",
 * returns the version of the first component.
 */
function extractVersion(browserField: string): string {
  const match = browserField.match(/[\w]+\/([\d.]+)/);
  return match?.[1] ?? "unknown";
}

/**
 * Extracts the browser name from the Browser field (the part before "/version").
 */
function extractBrowserName(browserField: string): string {
  return detectBrowserType(browserField);
}

// ---------------------------------------------------------------------------
// HTTP-based discovery
// ---------------------------------------------------------------------------

/**
 * Discovers a running Chromium-based browser by querying its HTTP
 * debugging endpoint at /json/version.
 *
 * @param options - Discovery options (host, port, timeout)
 * @returns Browser information including WebSocket debugger URL
 * @throws {DiscoveryError} When no browser is found or debugging is not enabled
 */
export async function discoverBrowser(
  options: DiscoverBrowserOptions = {},
): Promise<BrowserInfo> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9222;
  const timeout = options.timeout ?? 5000;

  const url = `http://${host}:${port}/json/version`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    response = await globalThis.fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
  } catch {
    throw new DiscoveryError(
      "BROWSER_NOT_FOUND",
      `No Chrome or Chromium-based browser found on ${host}:${port}. ` +
        `Ensure a browser is running with remote debugging enabled: ` +
        `chrome --remote-debugging-port=${port}`,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(
      "DEBUG_PORT_UNAVAILABLE",
      `Port ${port} is responding but does not appear to be a Chrome debugging endpoint (HTTP ${response.status}). ` +
        `Please relaunch Chrome with --remote-debugging-port=${port}`,
    );
  }

  let data: Record<string, string>;
  try {
    data = (await response.json()) as Record<string, string>;
  } catch {
    throw new DiscoveryError(
      "DEBUG_PORT_UNAVAILABLE",
      `Port ${port} returned invalid JSON. Please relaunch Chrome with --remote-debugging-port=${port}`,
    );
  }

  const browserField = data["Browser"] ?? "";
  const browser = extractBrowserName(browserField);
  const version = extractVersion(browserField);

  // Normalize the WebSocket URL to use the same host:port we connected to,
  // since Chrome may report a different port in its response.
  let wsUrl = data["webSocketDebuggerUrl"] ?? "";
  if (wsUrl) {
    try {
      const parsed = new URL(wsUrl);
      parsed.hostname = host;
      parsed.port = String(port);
      wsUrl = parsed.toString();
      // URL.toString() adds a trailing slash for ws: protocol; remove it
      // if the original didn't have one and the path doesn't end with /
      if (!data["webSocketDebuggerUrl"]?.endsWith("/") && wsUrl.endsWith("/")) {
        wsUrl = wsUrl.slice(0, -1);
      }
    } catch {
      // If URL parsing fails, use as-is
    }
  }

  return {
    browser,
    version,
    webSocketDebuggerUrl: wsUrl,
    protocolVersion: data["Protocol-Version"] ?? "",
    userAgent: data["User-Agent"],
    v8Version: data["V8-Version"],
  };
}

// ---------------------------------------------------------------------------
// DevToolsActivePort file parsing
// ---------------------------------------------------------------------------

/**
 * Parses the content of Chrome's DevToolsActivePort file.
 *
 * The file has two lines:
 *   Line 1: The port number
 *   Line 2: The WebSocket path (e.g., /devtools/browser/guid)
 *
 * @param content - Raw file content
 * @returns Parsed port, path, and full WebSocket URL
 */
export function readDevToolsActivePort(content: string): DevToolsActivePortInfo {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("DevToolsActivePort file is empty");
  }

  const lines = trimmed.split("\n");
  if (lines.length < 2) {
    throw new Error(
      "DevToolsActivePort file is malformed: expected at least two lines (port and WS path)",
    );
  }

  const portStr = lines[0]!.trim();
  const wsPath = lines[1]!.trim();
  const port = parseInt(portStr, 10);

  if (isNaN(port) || port <= 0) {
    throw new Error(
      `DevToolsActivePort file contains invalid port number: "${portStr}"`,
    );
  }

  return {
    port,
    wsPath,
    wsUrl: `ws://127.0.0.1:${port}${wsPath}`,
  };
}

// ---------------------------------------------------------------------------
// Parse /json/list response
// ---------------------------------------------------------------------------

/**
 * Parses Chrome's /json/list response into typed target info objects.
 *
 * @param data - Raw array from /json/list
 * @param options - Filtering options
 * @returns Filtered array of target info
 */
export function parseJsonListResponse(
  data: unknown[],
  options: ParseJsonListOptions = {},
): TargetInfo[] {
  let targets: TargetInfo[] = data.map((item) => {
    const raw = item as Record<string, unknown>;
    return {
      id: String(raw["id"] ?? ""),
      type: String(raw["type"] ?? ""),
      title: String(raw["title"] ?? ""),
      url: String(raw["url"] ?? ""),
      webSocketDebuggerUrl: raw["webSocketDebuggerUrl"]
        ? String(raw["webSocketDebuggerUrl"])
        : undefined,
      devtoolsFrontendUrl: raw["devtoolsFrontendUrl"]
        ? String(raw["devtoolsFrontendUrl"])
        : undefined,
      description: raw["description"] != null
        ? String(raw["description"])
        : undefined,
    };
  });

  if (options.pagesOnly) {
    targets = targets.filter((t) => t.type === "page");
  }

  if (options.excludeInternal) {
    targets = targets.filter((t) => !t.url.startsWith("chrome://"));
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Port scanning
// ---------------------------------------------------------------------------

/** Default ports to scan for Chrome debugging endpoints. */
const DEFAULT_SCAN_PORTS = [9222, 9229];

/**
 * Scans multiple ports for running Chromium browsers.
 *
 * @param options - Scan options (host, ports)
 * @returns Array of discovered browser instances (may be empty)
 */
export async function scanPorts(
  options: ScanPortsOptions = {},
): Promise<BrowserInfo[]> {
  const host = options.host ?? "127.0.0.1";
  const ports = options.ports ?? DEFAULT_SCAN_PORTS;

  const results: BrowserInfo[] = [];

  for (const port of ports) {
    try {
      const info = await discoverBrowser({ host, port, timeout: 2000 });
      results.push(info);
    } catch {
      // Port not responding or not a Chrome debugger — skip
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// OS-specific browser paths (DevToolsActivePort file locations)
// ---------------------------------------------------------------------------

type BrowserType = "chrome" | "edge" | "brave" | "arc";

interface BrowserPathConfig {
  darwin: string;
  linux: string;
  win32: string;
}

const BROWSER_PATHS: Record<BrowserType, Partial<BrowserPathConfig>> = {
  chrome: {
    darwin: "Library/Application Support/Google/Chrome/Default/DevToolsActivePort",
    linux: ".config/google-chrome/Default/DevToolsActivePort",
    win32: "Google\\Chrome\\User Data\\Default\\DevToolsActivePort",
  },
  edge: {
    darwin: "Library/Application Support/Microsoft Edge/Default/DevToolsActivePort",
    linux: ".config/microsoft-edge/Default/DevToolsActivePort",
    win32: "Microsoft\\Edge\\User Data\\Default\\DevToolsActivePort",
  },
  brave: {
    darwin: "Library/Application Support/BraveSoftware/Brave-Browser/Default/DevToolsActivePort",
    linux: ".config/BraveSoftware/Brave-Browser/Default/DevToolsActivePort",
    win32: "BraveSoftware\\Brave-Browser\\User Data\\Default\\DevToolsActivePort",
  },
  arc: {
    darwin: "Library/Application Support/Arc/User Data/Default/DevToolsActivePort",
  },
};

/**
 * Returns the OS-specific path to a browser's DevToolsActivePort file.
 *
 * @param platform - Node.js platform string (e.g., "darwin", "linux", "win32")
 * @param browser - Browser type (e.g., "chrome", "edge", "brave", "arc")
 * @returns Absolute path to the DevToolsActivePort file
 * @throws When the platform is not supported
 */
export function getChromePath(
  platform: NodeJS.Platform,
  browser: string = "chrome",
): string {
  const browserKey = browser.toLowerCase() as BrowserType;
  const paths = BROWSER_PATHS[browserKey];

  if (!paths) {
    throw new Error(`Unsupported browser: ${browser}`);
  }

  const osPlatform = platform as keyof BrowserPathConfig;

  if (osPlatform !== "darwin" && osPlatform !== "linux" && osPlatform !== "win32") {
    throw new Error(
      `Unsupported platform "${platform}". Supported platforms: darwin, linux, win32`,
    );
  }

  const relativePath = paths[osPlatform];
  if (!relativePath) {
    throw new Error(
      `Unsupported platform "${platform}" for browser "${browser}"`,
    );
  }

  if (osPlatform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
    return join(localAppData, relativePath);
  }

  return join(homedir(), relativePath);
}
