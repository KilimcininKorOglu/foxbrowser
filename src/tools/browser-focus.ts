/**
 * browser_focus — Focus an element via DOM.focus without dispatching click events.
 *
 * Supports both CSS selectors and @eN references.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FocusParams {
  /** CSS selector for the element to focus. */
  selector?: string;
  /** @eN reference for the element to focus. */
  ref?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses an @eN reference string to extract the backend node ID.
 */
function parseRef(ref: string): number {
  const match = ref.match(/@e(\d+)/);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  return parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// Exported function
// ---------------------------------------------------------------------------

/**
 * Focuses an element identified by selector or @eN ref using DOM.focus.
 * Does NOT dispatch click events.
 */
export async function browserFocus(
  cdp: CDPConnection,
  params: FocusParams,
): Promise<void> {
  if (params.selector) {
    // Resolve via Runtime.evaluate to get objectId
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
      returnByValue: false,
    })) as { result: { type: string; objectId?: string } };

    if (!evalResult.result.objectId) {
      throw new Error(`Element not found: ${params.selector}`);
    }

    // Describe the node to get backendNodeId
    const describeResult = (await cdp.send("DOM.describeNode", {
      objectId: evalResult.result.objectId,
    })) as { node: { nodeId: number; backendNodeId: number } };

    await cdp.send("DOM.focus", {
      backendNodeId: describeResult.node.backendNodeId,
    });
  } else if (params.ref) {
    const backendNodeId = parseRef(params.ref);

    // Resolve the node to get objectId for potential callFunctionOn
    const resolved = (await cdp.send("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };

    // Use Runtime.callFunctionOn to call .focus() on the element
    await cdp.send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: "function() { this.focus(); }",
      returnByValue: true,
    });
  } else {
    throw new Error("Either selector or ref must be provided");
  }
}
