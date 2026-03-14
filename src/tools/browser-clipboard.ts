/**
 * browser_clipboard — Read/write system clipboard via CDP Runtime.evaluate.
 *
 * Uses navigator.clipboard.readText() and navigator.clipboard.writeText()
 * to interact with the clipboard.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipboardReadResult {
  /** The text content read from the clipboard. */
  text: string;
}

export interface ClipboardWriteParams {
  /** The text to write to the clipboard. */
  text: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Reads text content from the system clipboard.
 *
 * Uses `navigator.clipboard.readText()` via Runtime.evaluate.
 *
 * @param cdp - CDP connection
 * @returns The clipboard text content
 */
export async function browserClipboardRead(
  cdp: CDPConnection,
): Promise<ClipboardReadResult> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression: "navigator.clipboard.readText()",
    awaitPromise: true,
    returnByValue: true,
  })) as { result: { type: string; value: unknown } };

  return { text: (response.result.value as string) ?? "" };
}

/**
 * Writes text content to the system clipboard.
 *
 * Uses `navigator.clipboard.writeText()` via Runtime.evaluate.
 *
 * @param cdp - CDP connection
 * @param params - The text to write
 */
export async function browserClipboardWrite(
  cdp: CDPConnection,
  params: ClipboardWriteParams,
): Promise<void> {
  const escaped = params.text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");

  await cdp.send("Runtime.evaluate", {
    expression: `navigator.clipboard.writeText('${escaped}')`,
    awaitPromise: true,
    returnByValue: true,
  });
}
