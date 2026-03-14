/**
 * browser_check / browser_uncheck — Idempotent checkbox state management via CDP.
 *
 * Checks the current state of a checkbox before clicking. If the checkbox is
 * already in the desired state, the operation is a no-op.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckParams {
  /** CSS selector for the checkbox element. */
  selector?: string;
  /** @eN reference for the checkbox element. */
  ref?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the element to a Runtime object and reads its `checked` property.
 */
async function getCheckedState(
  cdp: CDPConnection,
  params: CheckParams,
): Promise<boolean> {
  if (params.selector) {
    const response = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})?.checked ?? false`,
      returnByValue: true,
    })) as { result: { type: string; value: unknown } };
    return response.result.value === true;
  }

  if (params.ref) {
    const backendNodeId = parseRef(params.ref);
    const resolved = (await cdp.send("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };
    const response = (await cdp.send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: "function() { return this.checked; }",
      returnByValue: true,
    })) as { result: { type: string; value: unknown } };
    return response.result.value === true;
  }

  return false;
}

/**
 * Clicks a checkbox element using the standard 3-event mouse sequence.
 *
 * Resolves element coordinates via DOM.getBoxModel and dispatches
 * mouseMoved, mousePressed, and mouseReleased events.
 */
async function clickElement(
  cdp: CDPConnection,
  params: CheckParams,
): Promise<void> {
  // Build the identifier for DOM commands
  const domParams: Record<string, unknown> = {};

  if (params.ref) {
    domParams.backendNodeId = parseRef(params.ref);
  } else if (params.selector) {
    domParams.selector = params.selector;
  }

  await cdp.send("DOM.scrollIntoViewIfNeeded", domParams);

  const boxResponse = (await cdp.send("DOM.getBoxModel", domParams)) as {
    model: { content: number[] };
  };
  const content = boxResponse.model.content;
  const x = (content[0] + content[2] + content[4] + content[6]) / 4;
  const y = (content[1] + content[3] + content[5] + content[7]) / 4;

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

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
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Ensures a checkbox is checked. No-op if already checked.
 */
export async function browserCheck(
  cdp: CDPConnection,
  params: CheckParams,
): Promise<void> {
  const isChecked = await getCheckedState(cdp, params);
  if (!isChecked) {
    await clickElement(cdp, params);
  }
}

/**
 * Ensures a checkbox is unchecked. No-op if already unchecked.
 */
export async function browserUncheck(
  cdp: CDPConnection,
  params: CheckParams,
): Promise<void> {
  const isChecked = await getCheckedState(cdp, params);
  if (isChecked) {
    await clickElement(cdp, params);
  }
}
