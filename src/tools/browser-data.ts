/**
 * browser_data tools — Data extraction from DOM elements via CDP.
 *
 * Provides functions to extract text, values, attributes, counts,
 * bounding boxes, and computed styles from page elements.
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
  returnByValue = true,
): Promise<{ type: string; subtype?: string; value: unknown }> {
  const response = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue,
  })) as { result: { type: string; subtype?: string; value: unknown } };
  return response.result;
}

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

interface RefParams {
  ref: string;
  backendNodeId: number;
}

interface AttributeParams extends RefParams {
  attribute: string;
}

interface CountParams {
  selector: string;
}

interface StylesParams extends RefParams {
  property?: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Returns the text content of an element identified by its backend node ID.
 *
 * Uses `Runtime.callFunctionOn` with `function() { return this.textContent; }`
 * to extract the element's `textContent` property.
 */
export async function browserGetText(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ text: string }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    "function() { return this.textContent || ''; }",
  );
  return { text: (result.value as string) ?? "" };
}

/**
 * Returns the `value` property of a form element (input, textarea, select).
 *
 * For non-form elements, returns an empty string.
 */
export async function browserGetValue(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ value: string }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    "function() { return this.value !== undefined ? this.value : ''; }",
  );
  return { value: (result.value as string) ?? "" };
}

/**
 * Returns the value of a specific attribute on an element.
 *
 * Returns `null` if the attribute does not exist.
 */
export async function browserGetAttribute(
  cdp: CDPConnection,
  params: AttributeParams,
): Promise<{ value: string | null }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    `function() { return this.getAttribute(${JSON.stringify(params.attribute)}); }`,
  );

  if (result.subtype === "null" || result.value === null) {
    return { value: null };
  }
  return { value: result.value as string };
}

/**
 * Returns the number of elements matching a CSS selector.
 *
 * Uses `Runtime.evaluate` with `document.querySelectorAll(selector).length`.
 */
export async function browserGetCount(
  cdp: CDPConnection,
  params: CountParams,
): Promise<{ count: number }> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelectorAll(${JSON.stringify(params.selector)}).length`,
    returnByValue: true,
  })) as { result: { type: string; value: number } };
  return { count: response.result.value };
}

/**
 * Returns the bounding box of an element as `{ x, y, width, height }`.
 *
 * Returns `null` for hidden elements that have no bounding box
 * (e.g., `display: none`).
 */
export async function browserGetBox(
  cdp: CDPConnection,
  params: RefParams,
): Promise<{ box: { x: number; y: number; width: number; height: number } | null }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);
  const result = await callOnNode(
    cdp,
    objectId,
    `function() {
      var rect = this.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }`,
  );

  if (result.subtype === "null" || result.value === null) {
    return { box: null };
  }
  return { box: result.value as { x: number; y: number; width: number; height: number } };
}

/**
 * Returns computed styles of an element.
 *
 * When `property` is provided, returns only the value of that specific
 * CSS property. Otherwise, returns a full computed styles object.
 */
export async function browserGetStyles(
  cdp: CDPConnection,
  params: StylesParams,
): Promise<{ styles: Record<string, string> | string }> {
  const { objectId } = await resolveNode(cdp, params.backendNodeId);

  if (params.property) {
    const result = await callOnNode(
      cdp,
      objectId,
      `function() { return window.getComputedStyle(this).getPropertyValue(${JSON.stringify(params.property)}); }`,
    );
    return { styles: result.value as string };
  }

  const result = await callOnNode(
    cdp,
    objectId,
    `function() {
      var cs = window.getComputedStyle(this);
      var obj = {};
      for (var i = 0; i < cs.length; i++) {
        var prop = cs[i];
        obj[prop] = cs.getPropertyValue(prop);
      }
      return obj;
    }`,
  );
  return { styles: result.value as Record<string, string> };
}
