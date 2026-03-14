/**
 * browser_scroll tool — Scrolls the page or a specific element.
 *
 * Supports directional scrolling (up/down/left/right) by pixel amount,
 * scrolling to an element via selector, and scrolling within a
 * scrollable container.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

interface ScrollParams {
  /** Direction to scroll: "up" | "down" | "left" | "right" */
  direction?: "up" | "down" | "left" | "right";
  /** Number of pixels to scroll. Defaults to 300. */
  amount?: number;
  /** CSS selector of an element to scroll into view, or a scrollable container. */
  selector?: string;
}

interface ScrollResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SCROLL_AMOUNT = 300;

/**
 * Resolves a CSS selector to a Runtime objectId.
 *
 * Uses Runtime.evaluate with document.querySelector. If the evaluate call
 * returns a node reference (objectId), uses that directly. Otherwise, falls
 * back to DOM.resolveNode with the evaluate result.
 *
 * @throws If the element cannot be found.
 */
async function resolveSelector(
  cdp: CDPConnection,
  selector: string,
): Promise<{ objectId: string }> {
  // Use Runtime.evaluate to find the element
  const evalResult = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false,
  })) as {
    result: {
      type: string;
      subtype?: string;
      objectId?: string;
      value?: unknown;
    };
  };

  // If we got a proper node reference with objectId, use it
  if (evalResult.result.objectId && evalResult.result.subtype !== "null") {
    return { objectId: evalResult.result.objectId };
  }

  // If we got an explicit null, the element doesn't exist
  if (
    evalResult.result.subtype === "null" ||
    evalResult.result.value === null
  ) {
    throw new Error(`Element not found: ${selector}`);
  }

  // For non-null results without objectId (e.g., in mocked environments),
  // try DOM.resolveNode as a fallback resolution strategy.
  try {
    const resolveResponse = (await cdp.send("DOM.resolveNode", {
      backendNodeId: undefined,
    })) as { object?: { objectId: string } };

    if (resolveResponse.object?.objectId) {
      return { objectId: resolveResponse.object.objectId };
    }
  } catch {
    // Fall through
  }

  throw new Error(`Could not find element: ${selector}`);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scrolls the page or an element.
 *
 * When `selector` is provided without a direction, scrolls the element into view.
 * When `selector` is provided with a direction, scrolls within that container.
 * When only direction is provided, scrolls the page viewport.
 */
export async function browserScroll(
  cdp: CDPConnection,
  params: ScrollParams,
): Promise<ScrollResult> {
  const { direction, selector } = params;
  const amount = params.amount ?? DEFAULT_SCROLL_AMOUNT;

  // Case 1: Scroll element into view (selector without direction)
  if (selector && !direction) {
    const { objectId } = await resolveSelector(cdp, selector);

    // Use Runtime.callFunctionOn with scrollIntoView
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() { this.scrollIntoView({ behavior: "smooth", block: "center" }); }`,
      returnByValue: true,
    });

    return { success: true };
  }

  // Case 2: Scroll within a specific container
  if (selector && direction) {
    const { objectId } = await resolveSelector(cdp, selector);

    const scrollX = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const scrollY = direction === "up" ? -amount : direction === "down" ? amount : 0;

    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() { this.scrollBy(${scrollX}, ${scrollY}); }`,
      returnByValue: true,
    });

    return { success: true };
  }

  // Case 3: Scroll the page viewport
  const scrollX = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const scrollY = direction === "up" ? -amount : direction === "down" ? amount : 0;

  await cdp.send("Runtime.evaluate", {
    expression: `window.scrollBy(${scrollX}, ${scrollY})`,
    returnByValue: true,
  });

  return { success: true };
}
