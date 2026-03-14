/**
 * browser_state tools — Element state inspection via CDP.
 *
 * Provides functions to check visibility, enabled state, and
 * checked state of DOM elements.
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function callOnNodeById(
  bidi: BiDiConnection,
  backendNodeId: number,
  functionDeclaration: string,
): Promise<{ type: string; value: unknown }> {
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
  })) as { result: { type: string; value: unknown } };
  return response.result ?? { type: "null", value: null };
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
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ visible: boolean }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
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
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ enabled: boolean }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
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
  bidi: BiDiConnection,
  params: RefParams,
): Promise<{ checked: boolean }> {
  const result = await callOnNodeById(
    bidi,
    params.backendNodeId,
    "function() { return !!this.checked; }",
  );
  return { checked: result.value as boolean };
}
