/**
 * browser_handle_dialog tool — accepts or dismisses a JavaScript dialog via CDP.
 *
 * Uses Page.handleJavaScriptDialog to handle alert, confirm, prompt, and
 * beforeunload dialogs. If no dialog is currently pending, returns a helpful
 * error message.
 *
 * @module browser-handle-dialog
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandleDialogParams {
  /** Whether to accept (true) or dismiss (false) the dialog. */
  accept: boolean;
  /** Text to enter in a prompt dialog. Only used when accept is true. */
  promptText?: string;
}

export interface HandleDialogResult {
  /** Whether the dialog was handled successfully. */
  success: boolean;
  /** Error message if the operation failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Handle a pending JavaScript dialog (alert, confirm, prompt, beforeunload).
 *
 * @param cdp - CDP connection.
 * @param params - Dialog handling parameters.
 * @returns Result with success status.
 */
export async function browserHandleDialog(
  cdp: CDPConnection,
  params: HandleDialogParams,
): Promise<HandleDialogResult> {
  const dialogParams: Record<string, unknown> = {
    accept: params.accept,
  };

  if (params.promptText !== undefined) {
    dialogParams.promptText = params.promptText;
  }

  try {
    await cdp.send("Page.handleJavaScriptDialog", dialogParams);
    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);

    // CDP returns an error when no dialog is pending
    if (message.includes("No dialog is showing") || message.includes("no dialog")) {
      return {
        success: false,
        error: "No JavaScript dialog is currently pending. A dialog must be open before it can be handled.",
      };
    }

    return {
      success: false,
      error: `Failed to handle dialog: ${message}`,
    };
  }
}
