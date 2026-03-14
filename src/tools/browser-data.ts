/**
 * browser_data tools — Data extraction from DOM elements via CDP.
 *
 * Provides functions to extract text, values, attributes, counts,
 * bounding boxes, and computed styles from page elements.
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Calls a function on a resolved element by walking the DOM tree
 * to find the element by its index (backendNodeId equivalent).
 */
async function callOnNodeById(
  bidi: BiDiConnection,
  backendNodeId: number,
  functionDeclaration: string,
): Promise<{ type: string; subtype?: string; value: unknown }> {
  const response = (await bidi.send("script.callFunction", {
    functionDeclaration: `(id, fn) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0;
      let node = walker.currentNode;
      while (node) {
        count++;
        if (count === id) {
          const f = new Function('return (' + fn + ').call(this)');
          return f.call(node);
        }
        node = walker.nextNode();
        if (!node) break;
      }
      return null;
    }`,
    arguments: [
      { type: "number", value: backendNodeId },
      { type: "string", value: functionDeclaration },
    ],
    awaitPromise: false,
    resultOwnership: "none",
    serializationOptions: { maxDomDepth: 0 },
  })) as { result: { type: string; subtype?: string; value: unknown } };
  return response.result ?? { type: "null", value: null };
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
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ text: string }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
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
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ value: string }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
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
  bidi: BiDiConnection,
  params: AttributeParams,
): Promise<{ value: string | null }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
    `function() { return this.getAttribute(${JSON.stringify(params.attribute)}); }`,
  );

  if (result.type === "null" || result.value === null) {
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
  bidi: BiDiConnection,
  params: CountParams,
): Promise<{ count: number }> {
  const response = (await bidi.send("script.evaluate", {
    expression: `document.querySelectorAll(${JSON.stringify(params.selector)}).length`,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { type: string; value: number } };
  return { count: response.result?.value ?? 0 };
}

/**
 * Returns the bounding box of an element as `{ x, y, width, height }`.
 *
 * Returns `null` for hidden elements that have no bounding box
 * (e.g., `display: none`).
 */
export async function browserGetBox(
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ box: { x: number; y: number; width: number; height: number } | null }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
    `function() {
      var rect = this.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }`,
  );

  if (result.type === "null" || result.value === null) {
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
  bidi: BiDiConnection,
  params: StylesParams,
): Promise<{ styles: Record<string, string> | string }> {
  if (params.property) {
    const result = await callOnNodeById(
      bidi,
      params.backendNodeId,
      `function() { return window.getComputedStyle(this).getPropertyValue(${JSON.stringify(params.property)}); }`,
    );
    return { styles: result.value as string };
  }

  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
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
