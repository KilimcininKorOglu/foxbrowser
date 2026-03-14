/**
 * Configuration module for browsirai.
 *
 * Loads configuration from (in order of precedence):
 *   1. Environment variables (highest priority)
 *   2. User config file (JSON)
 *   3. Built-in defaults (lowest priority)
 *
 * Config file resolution:
 *   - BROWSIR_CONFIG env var (explicit path)
 *   - ~/.browsirai/config.json (default location)
 *
 * All configuration is validated with Zod schemas.
 */

import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const firefoxConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(9222),
  host: z.string().min(1).default("127.0.0.1"),
  autoLaunch: z.boolean().default(false),
});

const screenshotConfigSchema = z.object({
  quality: z.number().int().min(1).max(100).default(80),
  maxWidth: z.number().int().min(1).default(1280),
});

const networkConfigSchema = z.object({
  maxRequests: z.number().int().min(1).default(100),
});

const connectionConfigSchema = z.object({
  connectTimeout: z.number().int().min(0).default(5000),
  reconnectAttempts: z.number().int().min(0).default(3),
  commandTimeout: z.number().int().min(0).default(30000),
});

const browsiraiConfigSchema = z.object({
  firefox: firefoxConfigSchema.default({}),
  screenshot: screenshotConfigSchema.default({}),
  network: networkConfigSchema.default({}),
  connection: connectionConfigSchema.default({}),
});

// ---------------------------------------------------------------------------
// Partial schema for user-provided config (all fields optional)
// ---------------------------------------------------------------------------

const partialFirefoxSchema = z.object({
  port: z.number().int().min(1).max(65535).optional(),
  host: z.string().min(1).optional(),
  autoLaunch: z.boolean().optional(),
}).optional();

const partialScreenshotSchema = z.object({
  quality: z.number().int().min(1).max(100).optional(),
  maxWidth: z.number().int().min(1).optional(),
}).optional();

const partialNetworkSchema = z.object({
  maxRequests: z.number().int().min(1).optional(),
}).optional();

const partialConnectionSchema = z.object({
  connectTimeout: z.number().int().min(0).optional(),
  reconnectAttempts: z.number().int().min(0).optional(),
  commandTimeout: z.number().int().min(0).optional(),
}).optional();

const partialConfigSchema = z.object({
  firefox: partialFirefoxSchema,
  screenshot: partialScreenshotSchema,
  network: partialNetworkSchema,
  connection: partialConnectionSchema,
}).partial();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrowserdConfig = z.infer<typeof browsiraiConfigSchema>;

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: BrowserdConfig = browsiraiConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overrideVal = override[key];

    if (
      baseVal !== null &&
      overrideVal !== null &&
      typeof baseVal === "object" &&
      typeof overrideVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = overrideVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Config file loading
// ---------------------------------------------------------------------------

function resolveConfigPath(): string {
  const envPath = process.env.BROWSIR_CONFIG;
  if (envPath) {
    return envPath;
  }
  return join(homedir(), ".browsirai", "config.json");
}

function readConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(configPath)) {
      return null;
    }

    const raw = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("browsirai: config file is not a JSON object, using defaults");
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    console.warn(`browsirai: failed to parse config file at ${configPath}, using defaults`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Environment variable overrides
// ---------------------------------------------------------------------------

function applyEnvOverrides(config: BrowserdConfig): BrowserdConfig {
  const result = deepMerge(config, {});

  // FIREFOX_DEBUG_PORT -> firefox.port
  const portStr = process.env.FIREFOX_DEBUG_PORT ?? process.env.CHROME_DEBUG_PORT;
  if (portStr !== undefined && portStr !== "") {
    const port = parseInt(portStr, 10);
    if (!isNaN(port)) {
      result.firefox.port = port;
    }
  }

  // BROWSIR_HOST -> firefox.host
  const host = process.env.BROWSIR_HOST;
  if (host !== undefined && host !== "") {
    result.firefox.host = host;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the browsirai configuration.
 *
 * Resolution order (highest priority wins):
 *   1. Environment variables
 *   2. Config file (BROWSIR_CONFIG path or ~/.browsirai/config.json)
 *   3. Built-in defaults
 */
export function loadConfig(): BrowserdConfig {
  const configPath = resolveConfigPath();
  const fileConfig = readConfigFile(configPath);

  // Start from defaults
  let config: BrowserdConfig = { ...DEFAULT_CONFIG };

  if (fileConfig !== null) {
    // Validate the user config with the partial schema
    const validation = partialConfigSchema.safeParse(fileConfig);

    if (validation.success) {
      config = deepMerge(config, validation.data as Record<string, unknown>);
    } else {
      console.warn("browsirai: config file validation error, using defaults");
    }
  }

  // Apply environment variable overrides (highest priority)
  config = applyEnvOverrides(config);

  return config;
}
