/**
 * LLM Output Formatter
 *
 * Formats browser events (console logs, network requests/responses) into
 * clean markdown suitable for LLM consumption. Strips ANSI escape codes
 * and escapes markdown special characters.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserEvent {
  type: "console" | "network";
  timestamp?: string | number;
  // Console events
  level?: string;
  message?: string;
  // Network events
  direction?: "request" | "response";
  method?: string;
  url?: string;
  status?: number;
  body?: string;
}

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------

/**
 * Remove all ANSI escape codes (colors, bold, underline, reset, etc.)
 * from a string.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /\x1B(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1B\\)|[#()*+,\-.\/0-9:;<=>A-Z[\\\]^_`a-z{|}~])/g,
    "",
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape markdown special characters in content so the output renders
 * as literal text rather than formatted markdown.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([*_`|~\\[\]#>])/g, "\\$1");
}

/**
 * Format a timestamp value as an ISO string.
 */
function formatTimestamp(ts: string | number | undefined): string {
  if (ts === undefined) return "";
  if (typeof ts === "number") {
    return new Date(ts).toISOString();
  }
  return ts;
}

// ---------------------------------------------------------------------------
// formatForLLM
// ---------------------------------------------------------------------------

/**
 * Format a single BrowserEvent as clean markdown.
 */
export function formatForLLM(event: BrowserEvent): string {
  const ts = formatTimestamp(event.timestamp);
  const lines: string[] = [];

  if (event.type === "console") {
    const label = (event.level ?? "log").toUpperCase();
    const rawMessage = stripAnsi(event.message ?? "");

    lines.push(`**[${label}]** ${ts}`);

    if (rawMessage.includes("\n")) {
      lines.push("");
      lines.push("```");
      lines.push(rawMessage);
      lines.push("```");
    } else {
      lines.push("");
      lines.push(escapeMarkdown(rawMessage));
    }
  } else if (event.type === "network") {
    if (event.direction === "response") {
      lines.push(
        `**[RESPONSE]** ${event.status ?? ""} ${event.url ?? ""} ${ts}`.trim(),
      );
    } else {
      lines.push(
        `**[REQUEST]** ${event.method ?? ""} ${event.url ?? ""} ${ts}`.trim(),
      );
    }

    if (event.body) {
      lines.push("");
      lines.push("```");
      lines.push(stripAnsi(event.body));
      lines.push("```");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatBatchForLLM
// ---------------------------------------------------------------------------

/**
 * Format an array of BrowserEvents as markdown sections separated by
 * horizontal rules.
 */
export function formatBatchForLLM(events: BrowserEvent[]): string {
  if (events.length === 0) return "";

  const parts: string[] = [];

  parts.push(`## Browser Events (${events.length})`);
  parts.push("");

  for (let i = 0; i < events.length; i++) {
    if (i > 0) {
      parts.push("");
      parts.push("---");
      parts.push("");
    }
    parts.push(formatForLLM(events[i]));
  }

  return parts.join("\n");
}
