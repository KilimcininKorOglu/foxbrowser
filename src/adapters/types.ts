/**
 * Adapter type definitions for foxbrowser platform integration.
 *
 * These types define the contract for platform-specific install adapters
 * and shared diagnostic/install result structures.
 */

/** Supported platform identifiers. */
export type PlatformId =
  | "claude-code"
  | "cursor"
  | "gemini-cli"
  | "windsurf"
  | "cline"
  | "vscode-copilot"
  | "opencode"
  | "zed"
  | "continue"
  | "generic";

/** Confidence level for platform detection. */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Result of a platform diagnostic check. */
export interface DiagnosticResult {
  /** Whether the diagnostic passed. */
  ok: boolean;
  /** Human-readable label for this check. */
  label: string;
  /** Optional detail message (e.g. version string or error). */
  message?: string;
}

/** Options passed to an install adapter. */
export interface InstallOptions {
  /** Target directory for installation artifacts. */
  targetDir?: string;
  /** Whether to overwrite existing configuration. */
  force?: boolean;
}

/** Result returned after an install operation. */
export interface InstallResult {
  /** Whether the installation succeeded. */
  success: boolean;
  /** Human-readable summary of what was done. */
  message: string;
  /** Files that were created or modified. */
  filesChanged?: string[];
}

/** Platform-specific install adapter interface. */
export interface InstallAdapter {
  /** The platform this adapter handles. */
  readonly platformId: PlatformId;

  /** Run pre-install diagnostics (e.g. check CLI availability). */
  diagnose(): Promise<DiagnosticResult[]>;

  /** Perform the installation for this platform. */
  install(options?: InstallOptions): Promise<InstallResult>;
}
