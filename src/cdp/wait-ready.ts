/**
 * wait-ready.ts — Polls `document.readyState` via CDP `Runtime.evaluate`
 * until it equals `"complete"` or a timeout is reached.
 *
 * @module
 */

/** Minimal CDP session interface required by this module. */
export interface CDPSendable {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Options accepted as the second positional argument (object form). */
export interface WaitReadyOptions {
  sessionId?: string;
  timeout?: number;
}

/** Default polling interval in milliseconds. */
const POLL_INTERVAL_MS = 200;

/** Default timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Polls `document.readyState` via `Runtime.evaluate` until it equals
 * `"complete"`, or rejects with a timeout error.
 *
 * Supports two calling conventions:
 *
 * ```ts
 * // Positional (used by cdp.test.ts / connection.ts consumers)
 * waitForDocumentReady(cdp, sessionId, timeoutMs)
 *
 * // Options object (used by interaction.test.ts / wait-ready.ts consumers)
 * waitForDocumentReady(cdp, { timeout, sessionId })
 * ```
 */
export async function waitForDocumentReady(
  cdp: CDPSendable,
  sessionIdOrOpts?: string | WaitReadyOptions,
  timeoutMs?: number,
): Promise<void> {
  let sessionId: string | undefined;
  let timeout: number;

  if (typeof sessionIdOrOpts === "string") {
    sessionId = sessionIdOrOpts;
    timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  } else if (sessionIdOrOpts != null && typeof sessionIdOrOpts === "object") {
    sessionId = sessionIdOrOpts.sessionId;
    timeout = sessionIdOrOpts.timeout ?? DEFAULT_TIMEOUT_MS;
  } else {
    sessionId = undefined;
    timeout = DEFAULT_TIMEOUT_MS;
  }

  const deadline = Date.now() + timeout;
  let lastReadyState = "unknown";

  for (;;) {
    // Check deadline at the top of each iteration.
    if (Date.now() >= deadline) break;

    // Wait before polling. This ensures fake-timer tests can advance
    // time in lock-step with each poll cycle.
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const params: Record<string, unknown> = {
        expression: "document.readyState",
        returnByValue: true,
      };
      if (sessionId !== undefined) {
        params.sessionId = sessionId;
      }

      const response = await cdp.send("Runtime.evaluate", params);

      const result = (response as { result?: { value?: string } })?.result;
      if (result?.value) {
        lastReadyState = result.value;
      }

      if (lastReadyState === "complete") {
        return;
      }
    } catch {
      // Runtime.evaluate can fail transiently during navigation
      // (e.g., "Execution context was destroyed"). Retry on next poll.
    }
  }

  throw new Error(
    `waitForDocumentReady timeout after ${timeout}ms — last readyState: "${lastReadyState}"`,
  );
}
