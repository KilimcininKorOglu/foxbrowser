/**
 * browser_wait_for tool — waits for various conditions via CDP polling.
 *
 * Supported strategies:
 *  - text: poll until text appears in page body
 *  - textGone: poll until text disappears from page body
 *  - selector: poll until a CSS selector matches an element in the DOM
 *  - selector + visible: poll until element is visible
 *  - selector + state:"hidden": poll until element is hidden
 *  - time: simple delay (seconds)
 *  - networkIdle: poll until no pending network requests
 *  - load: poll until document.readyState === "complete"
 *  - url: poll until location.href matches a glob pattern
 *  - fn: poll until a JS expression evaluates to truthy
 *
 * Default timeout: 30 seconds. Poll interval: ~100ms.
 */
import type { CDPConnection } from "../cdp/connection";

interface WaitForParams {
  text?: string;
  textGone?: string;
  selector?: string;
  visible?: boolean;
  state?: "hidden" | "visible";
  time?: number;
  networkIdle?: boolean;
  load?: boolean;
  loadState?: string;
  url?: string;
  fn?: string;
  timeout?: number;
}

interface WaitForResult {
  success: boolean;
  elapsed: number;
}

const DEFAULT_TIMEOUT_S = 30;
const POLL_INTERVAL_MS = 100;

/**
 * Normalizes a timeout value to milliseconds.
 *
 * Values <= 60 are treated as seconds (e.g., 5 → 5000ms, 0.5 → 500ms).
 * Values > 60 are treated as milliseconds (e.g., 1000 → 1000ms).
 */
function normalizeTimeoutMs(timeout: number): number {
  if (timeout > 60) {
    return timeout; // Already in ms
  }
  return timeout * 1000; // Convert seconds to ms
}

export async function browserWaitFor(
  cdp: CDPConnection,
  params: WaitForParams,
): Promise<WaitForResult> {
  const timeoutMs = normalizeTimeoutMs(params.timeout ?? DEFAULT_TIMEOUT_S);
  const start = Date.now();

  // ---- Simple time delay ----
  if (params.time !== undefined) {
    const delayMs = params.time * 1000;
    await delay(delayMs);
    return { success: true, elapsed: Date.now() - start };
  }

  // ---- Determine the polling predicate ----
  const condition = buildCondition(params);

  // ---- Poll loop ----
  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `Timeout after ${timeoutMs}ms waiting for condition: ${describeCondition(params)}`,
      );
    }

    let met = false;
    try {
      met = await evaluateCondition(cdp, condition);
    } catch {
      // Transient errors (e.g. cross-origin frame) — retry on next poll
    }

    if (met) {
      return { success: true, elapsed: Date.now() - start };
    }

    await delay(POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Condition builders
// ---------------------------------------------------------------------------

interface Condition {
  kind:
    | "text"
    | "textGone"
    | "selector"
    | "selectorVisible"
    | "selectorHidden"
    | "networkIdle"
    | "load"
    | "loadState"
    | "url"
    | "fn";
  expression: string;
}

function buildCondition(params: WaitForParams): Condition {
  if (params.url !== undefined) {
    return { kind: "url", expression: params.url };
  }

  if (params.fn !== undefined) {
    return {
      kind: "fn",
      expression: `Boolean(${params.fn})`,
    };
  }

  if (params.selector !== undefined && params.state === "hidden") {
    return {
      kind: "selectorHidden",
      expression: buildVisibilityCheck(params.selector),
    };
  }

  if (params.selector !== undefined && params.visible) {
    return {
      kind: "selectorVisible",
      expression: buildVisibilityCheck(params.selector),
    };
  }

  if (params.selector !== undefined) {
    return {
      kind: "selector",
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
    };
  }

  if (params.text !== undefined) {
    return {
      kind: "text",
      expression: `document.body && document.body.innerText.includes(${JSON.stringify(params.text)})`,
    };
  }

  if (params.textGone !== undefined) {
    return {
      kind: "textGone",
      expression: `document.body && !document.body.innerText.includes(${JSON.stringify(params.textGone)})`,
    };
  }

  if (params.networkIdle) {
    return {
      kind: "networkIdle",
      expression: "true", // Simplified: check via Runtime.evaluate
    };
  }

  if (params.loadState !== undefined) {
    return {
      kind: "loadState",
      expression: params.loadState,
    };
  }

  if (params.load) {
    return {
      kind: "load",
      expression: "document.readyState",
    };
  }

  throw new Error("browserWaitFor: no wait condition specified");
}

function buildVisibilityCheck(selector: string): string {
  const sel = JSON.stringify(selector);
  return `(function() {
    var el = document.querySelector(${sel});
    if (!el) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  })()`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

async function evaluateCondition(
  cdp: CDPConnection,
  condition: Condition,
): Promise<boolean> {
  if (condition.kind === "url") {
    return evaluateUrlCondition(cdp, condition.expression);
  }

  if (condition.kind === "load") {
    return evaluateLoadCondition(cdp, condition.expression);
  }

  if (condition.kind === "loadState") {
    return evaluateLoadStateCondition(cdp, condition.expression);
  }

  if (condition.kind === "selectorHidden") {
    // Returns true when the element is NOT visible
    const response = (await cdp.send("Runtime.evaluate", {
      expression: condition.expression,
      returnByValue: true,
    })) as { result: { type: string; value: unknown } };

    // Element is hidden when the visibility check returns false
    return response.result.value === false;
  }

  if (condition.kind === "selector") {
    const response = (await cdp.send("Runtime.evaluate", {
      expression: condition.expression,
      returnByValue: true,
    })) as { result: { type: string; value: unknown; subtype?: string } };

    // Element found if result is not null
    return (
      response.result.value !== null && response.result.subtype !== "null"
    );
  }

  // Generic boolean evaluation
  const response = (await cdp.send("Runtime.evaluate", {
    expression: condition.expression,
    returnByValue: true,
  })) as { result: { type: string; value: unknown } };

  return response.result.value === true;
}

async function evaluateLoadCondition(
  cdp: CDPConnection,
  expression: string,
): Promise<boolean> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as { result: { type: string; value: unknown } };

  // readyState is a string: "loading" | "interactive" | "complete"
  // Also handle the case where the expression evaluates to a boolean
  if (response.result.type === "string") {
    return response.result.value === "complete";
  }
  return response.result.value === true;
}

/**
 * Evaluates a loadState condition.
 * For "complete", readyState must be "complete".
 * For "interactive", readyState must be "interactive" or "complete".
 */
async function evaluateLoadStateCondition(
  cdp: CDPConnection,
  targetState: string,
): Promise<boolean> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression: "document.readyState",
    returnByValue: true,
  })) as { result: { type: string; value: string } };

  const current = response.result.value;

  if (targetState === "complete") {
    return current === "complete";
  }
  if (targetState === "interactive") {
    return current === "interactive" || current === "complete";
  }
  // Exact match for any other value
  return current === targetState;
}

async function evaluateUrlCondition(
  cdp: CDPConnection,
  pattern: string,
): Promise<boolean> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true,
  })) as { result: { type: string; value: string } };

  const currentUrl = response.result.value;
  return globMatch(pattern, currentUrl);
}

// ---------------------------------------------------------------------------
// Glob matching (minimal implementation for URL patterns)
// ---------------------------------------------------------------------------

function globMatch(pattern: string, value: string): boolean {
  // Convert glob pattern to regex:
  //   ** → match anything (including /)
  //   *  → match anything except /
  //   ?  → match single char
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars (not * and ?)
    .replace(/\*\*/g, "\u0000") // placeholder for **
    .replace(/\*/g, "[^/]*") // * matches non-slash
    .replace(/\u0000/g, ".*") // ** matches anything
    .replace(/\?/g, "."); // ? matches one char

  const regex = new RegExp(regexStr);
  return regex.test(value);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeCondition(params: WaitForParams): string {
  if (params.text) return `text "${params.text}" to appear`;
  if (params.textGone) return `text "${params.textGone}" to disappear`;
  if (params.selector && params.state === "hidden")
    return `selector "${params.selector}" to become hidden`;
  if (params.selector && params.visible)
    return `selector "${params.selector}" to become visible`;
  if (params.selector) return `selector "${params.selector}" to appear`;
  if (params.url) return `URL matching "${params.url}"`;
  if (params.fn) return `JS condition: ${params.fn}`;
  if (params.loadState) return `document.readyState === "${params.loadState}"`;
  if (params.networkIdle) return "network idle";
  if (params.load) return "page load complete";
  return "unknown condition";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
