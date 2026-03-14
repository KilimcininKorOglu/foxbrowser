/**
 * browser_state tools — Element state inspection via CDP.
 *
 * Provides functions to check visibility, enabled state, and
 * checked state of DOM elements.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ResolvedNode {
  objectId: string;
}

/**
 * Resolves a backend node ID to a Runtime object ID for use with
 * `Runtime.callFunctionOn`.
 */
async function resolveNode(cdp: CDPConnection, backendNodeId: number): Promise<ResolvedNode> {
  const result = (await cdp.send("DOM.resolveNode", { backendNodeId })) as {
    object: { objectId: string };
  };
  return { objectId: result.object.objectId };
}

/**
 * Calls a function on a resolved node and returns the raw CDP result.
 */
async function callOnNode(
  cdp: CDPConnection,
  objectId: string,
  functionDeclaration: string,
): Promise<{ type: string; value: unknown }> {
  const response = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue: true,
  })) as { result: { type: string; value: unknown } };
  return response.result;
}

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

interface RefParams {
  ref: string;
  backendNodeId: number;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Checks whether an element is visible in the viewport.
 *
 * An element is considered NOT visible if any of the following is true:
 * - `display` is `none`
 * - `visibility` is `hidden`
 * - `opacity` is `0`
 * - `offsetParent` is null (and element is not the body/html)
 * - Element has zero width and height
 */
export async function browserIsVisible(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ visible: boolean }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    `function() {
      var style = window.getComputedStyle(this);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (this.offsetParent === null &&
          this.tagName !== 'BODY' &&
          this.tagName !== 'HTML' &&
          style.position !== 'fixed') return false;
      var rect = this.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    }`,
  );
  return { visible: result.value as boolean };
}

/**
 * Checks whether an element is enabled (not disabled).
 *
 * For form elements (input, textarea, select, button), checks the
 * `disabled` property. Non-form elements are always considered enabled.
 */
export async function browserIsEnabled(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ enabled: boolean }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    `function() {
      if ('disabled' in this) return !this.disabled;
      return true;
    }`,
  );
  return { enabled: result.value as boolean };
}

/**
 * Checks whether a checkbox or radio button is checked.
 *
 * Returns the value of the `checked` property on the element.
 */
export async function browserIsChecked(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ checked: boolean }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    "function() { return !!this.checked; }",
  );
  return { checked: result.value as boolean };
}
