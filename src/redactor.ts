/**
 * Secret redaction utilities for browsirai.
 *
 * Redacts sensitive values from headers, JSON bodies, inline text,
 * and network event objects to prevent secret leakage in logs/output.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactOptions {
  enabled?: boolean;
}

export interface NetworkEvent {
  url: string;
  method: string;
  status?: number;
  headers?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "proxy-authorization",
  "x-access-token",
  "x-refresh-token",
  "x-secret",
  "x-token",
]);

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "secret",
  "token",
  "api_key",
  "apiKey",
  "api-key",
  "access_token",
  "refresh_token",
  "client_secret",
  "private_key",
]);

const JWT_PATTERN =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g;

const BEARER_PATTERN = /Bearer\s+\S+/gi;

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

// ---------------------------------------------------------------------------
// redactHeaders
// ---------------------------------------------------------------------------

export function redactHeaders(
  headers: Record<string, string>,
  opts?: RedactOptions,
): Record<string, string> {
  if (opts?.enabled === false) {
    return { ...headers };
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// redactBody
// ---------------------------------------------------------------------------

function redactObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObjectKeys(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_BODY_KEYS.has(key)) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObjectKeys(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactBody(
  body: string,
  opts?: RedactOptions,
): string {
  if (opts?.enabled === false) {
    return body;
  }

  try {
    const parsed = JSON.parse(body);
    const redacted = redactObjectKeys(parsed);
    return JSON.stringify(redacted);
  } catch {
    // Not valid JSON — return as-is
    return body;
  }
}

// ---------------------------------------------------------------------------
// redactInlineSecrets
// ---------------------------------------------------------------------------

export function redactInlineSecrets(
  text: string,
  opts?: RedactOptions,
): string {
  if (opts?.enabled === false) {
    return text;
  }

  // Redact JWTs first (before Bearer, since Bearer may contain a JWT)
  let result = text.replace(JWT_PATTERN, REDACTED_JWT);

  // Redact Bearer tokens — preserve the original casing of "Bearer"
  result = result.replace(BEARER_PATTERN, (match) => {
    const bearerWord = match.split(/\s+/)[0];
    return `${bearerWord} ${REDACTED}`;
  });

  return result;
}

// ---------------------------------------------------------------------------
// redactNetworkEvent
// ---------------------------------------------------------------------------

export function redactNetworkEvent(
  event: NetworkEvent,
  opts?: RedactOptions,
): NetworkEvent {
  if (opts?.enabled === false) {
    return { ...event };
  }

  const result: NetworkEvent = { ...event };

  if (event.headers) {
    result.headers = redactHeaders(event.headers, opts);
  }

  if (event.responseHeaders) {
    result.responseHeaders = redactHeaders(event.responseHeaders, opts);
  }

  if (event.body !== undefined) {
    result.body = redactBody(event.body, opts);
  }

  return result;
}
