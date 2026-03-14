/**
 * browser_console_messages tool — captures console messages via CDP events.
 *
 * Uses Runtime.consoleAPICalled CDP event to capture messages server-side
 * into a bounded EventBuffer. Messages survive page navigations and never
 * require JS injection.
 *
 * Supports:
 *  - Filtering by log level
 *  - Result limiting
 *  - Secret redaction (JWT/Bearer tokens)
 *
 * @module browser-console-messages
 */
import { EventBuffer } from "../event-buffer.js";
import { redactInlineSecrets } from "../redactor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsoleMessagesParams {
  /** Maximum number of messages to return. */
  limit?: number;
  /** Filter by log level. */
  level?: "log" | "warn" | "error" | "info";
}

export interface ConsoleMessage {
  /** Log level: "log", "warn", "error", or "info". */
  level: string;
  /** Stringified message text. */
  text: string;
  /** Timestamp when the message was captured. */
  timestamp?: number;
}

export interface ConsoleMessagesResult {
  /** List of captured console messages. */
  messages: ConsoleMessage[];
}

// ---------------------------------------------------------------------------
// Supported console levels
// ---------------------------------------------------------------------------

const SUPPORTED_LEVELS = new Set(["log", "warn", "warning", "error", "info"]);

// ---------------------------------------------------------------------------
// Module-level EventBuffer
// ---------------------------------------------------------------------------

const consoleBuffer = new EventBuffer<ConsoleMessage>(500);

// ---------------------------------------------------------------------------
// Setup & Reset
// ---------------------------------------------------------------------------

interface CDPEventSource {
  on(event: string, handler: (params: unknown) => void): void;
}

/**
 * Register a CDP event listener for Runtime.consoleAPICalled.
 * Call once after Runtime.enable.
 */
export function setupConsoleCapture(cdp: CDPEventSource): void {
  cdp.on("Runtime.consoleAPICalled", (params: unknown) => {
    const p = params as {
      type: string;
      args?: Array<{ type: string; value?: unknown; description?: string }>;
      timestamp?: number;
    };

    if (!SUPPORTED_LEVELS.has(p.type)) return;

    const text = (p.args ?? [])
      .map((arg) => {
        if (arg.type === "string") return String(arg.value);
        if (arg.type === "undefined") return "undefined";
        if (arg.value !== undefined) return String(arg.value);
        if (arg.description) return arg.description;
        return "";
      })
      .join(" ");

    consoleBuffer.push({
      level: p.type === "warning" ? "warn" : p.type,
      text,
      timestamp: p.timestamp ? Math.floor(p.timestamp) : Date.now(),
    });
  });
}

/** Clear the console buffer (call on reconnection). */
export function resetConsoleBuffer(): void {
  consoleBuffer.clear();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Read console messages from the EventBuffer.
 *
 * @param _cdp - CDP connection (unused — buffer is populated by setupConsoleCapture).
 * @param params - Filter and limit parameters.
 * @returns List of console messages.
 */
export async function browserConsoleMessages(
  _cdp: unknown,
  params: ConsoleMessagesParams,
): Promise<ConsoleMessagesResult> {
  let messages = consoleBuffer.last();

  // Redact secrets from message text
  messages = messages.map((m) => ({ ...m, text: redactInlineSecrets(m.text) }));

  // Filter by level
  if (params.level) {
    messages = messages.filter((m) => m.level === params.level);
  }

  // Apply limit (return most recent messages)
  const limit = params.limit ?? 100;
  if (messages.length > limit) {
    messages = messages.slice(-limit);
  }

  return { messages };
}
