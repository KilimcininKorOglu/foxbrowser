/**
 * MCP-compatible error response builder.
 *
 * Each error type maps to a human-readable message suitable for AI agent
 * consumption. Responses follow the MCP content-block format with
 * `isError: true`.
 */

export type ErrorType =
  | "not_connected"
  | "invalid_selector"
  | "cdp_timeout"
  | "tab_not_found";

export interface ErrorOptions {
  selector?: string;
  timeout?: number;
  targetId?: string;
}

export interface ErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

const ERROR_MESSAGES: Record<ErrorType, (opts?: ErrorOptions) => string> = {
  not_connected: () =>
    "Not connected to browser. Run browser_connect first.",
  invalid_selector: (opts) =>
    `Invalid selector: ${opts?.selector ?? "<unknown>"}`,
  cdp_timeout: (opts) =>
    `CDP command timed out after ${opts?.timeout ?? 0}ms`,
  tab_not_found: (opts) =>
    `Tab not found: ${opts?.targetId ?? "<unknown>"}`,
};

export function createErrorResponse(
  type: ErrorType,
  opts?: ErrorOptions,
): ErrorResponse {
  const message = ERROR_MESSAGES[type](opts);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
