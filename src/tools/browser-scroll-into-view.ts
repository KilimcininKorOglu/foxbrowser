/**
 * browser_scroll_into_view tool — Scrolls a specific element into the visible viewport.
 *
 * Uses DOM.scrollIntoViewIfNeeded (preferred) or falls back to
 * Runtime.callFunctionOn with element.scrollIntoView().
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

interface ScrollIntoViewParams {
  /** CSS selector to find the element */
  selector?: string;
  /** @eN ref string, e.g. "@e5" */
  ref?: string;
}

interface ScrollIntoViewResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the backendNodeId from an @eN ref string.
 */
function refToBackendNodeId(ref: string): number {
  const match = /^@e(\d+)$/.exec(ref);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  return parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scrolls an element into the visible viewport.
 *
 * Supports targeting via CSS selector or @eN ref.
 * Uses DOM.scrollIntoViewIfNeeded when possible, with a fallback
 * to Runtime.callFunctionOn + scrollIntoView.
 */
export async function browserScrollIntoView(
  cdp: CDPConnection,
  params: ScrollIntoViewParams,
): Promise<ScrollIntoViewResult> {
  let backendNodeId: number | undefined;
  let objectId: string | undefined;

  if (params.ref) {
    // Resolve @eN ref to backendNodeId
    backendNodeId = refToBackendNodeId(params.ref);

    const resolveResponse = (await cdp.send("DOM.resolveNode", {
      backendNodeId,
    })) as { object: { objectId: string } };
    objectId = resolveResponse.object.objectId;
  } else if (params.selector) {
    // Resolve CSS selector to a node
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
      returnByValue: false,
    })) as { result: { type: string; subtype?: string; objectId?: string } };

    if (!evalResult.result.objectId || evalResult.result.subtype === "null") {
      throw new Error(`Element not found: ${params.selector}`);
    }

    objectId = evalResult.result.objectId;

    // Get the backendNodeId from DOM.describeNode for DOM.scrollIntoViewIfNeeded
    try {
      const describeResult = (await cdp.send("DOM.describeNode", {
        objectId,
      })) as { node: { backendNodeId: number } };
      backendNodeId = describeResult.node.backendNodeId;
    } catch {
      // describeNode may not be available — fall through
    }
  } else {
    throw new Error("Either selector or ref must be provided");
  }

  // Try DOM.scrollIntoViewIfNeeded first (preferred)
  if (backendNodeId !== undefined) {
    try {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
      return { success: true };
    } catch {
      // Fall through to Runtime approach
    }
  }

  // Fallback: use Runtime.callFunctionOn with scrollIntoView
  if (objectId) {
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() { this.scrollIntoView({ behavior: "instant", block: "center" }); }`,
      returnByValue: true,
    });
    return { success: true };
  }

  throw new Error("Could not scroll element into view");
}
