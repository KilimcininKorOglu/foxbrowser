/**
 * browser_clipboard — Read/write system clipboard via CDP Runtime.evaluate.
 *
 * Uses navigator.clipboard.readText() and navigator.clipboard.writeText()
 * to interact with the clipboard.
 */
import type { BiDiConnection } from "../bidi/connection.js";

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
  bidi: BiDiConnection,
): Promise<ClipboardReadResult> {
  const response = (await bidi.send("script.evaluate", {
    expression: "navigator.clipboard.readText()",
    awaitPromise: true,
    resultOwnership: "none",
  })) as { result: { type: string; value: unknown } };

  return { text: (response.result?.value as string) ?? "" };
}

/**
 * Writes text content to the system clipboard.
 *
 * Uses `navigator.clipboard.writeText()` via script.evaluate.
 */
export async function browserClipboardWrite(
  bidi: BiDiConnection,
  params: ClipboardWriteParams,
): Promise<void> {
  await bidi.send("script.evaluate", {
    expression: `navigator.clipboard.writeText(${JSON.stringify(params.text)})`,
    awaitPromise: true,
    resultOwnership: "none",
  });
}
