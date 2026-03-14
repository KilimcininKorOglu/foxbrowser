/**
 * browser_fill_form tool — fills form fields by ref or CSS selector.
 *
 * Supports field types:
 *   - textbox: focus → clear value → insert text → dispatch input/change events
 *   - checkbox: click to toggle checked state
 *   - radio: click to select
 *   - combobox: set value via Runtime.callFunctionOn (select dropdown)
 *   - slider: set value via Runtime.callFunctionOn and dispatch events
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FillFormField {
  name: string;
  type: string;
  ref?: string;
  selector?: string;
  value: string;
}

export interface FillFormParams {
  fields: FillFormField[];
}

export interface FillFormError {
  field: string;
  error: string;
}

export interface FillFormResult {
  success: boolean;
  filledCount: number;
  errors?: FillFormError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the numeric backendNodeId from an "@eN" ref string.
 */
function parseRef(ref: string): number {
  const match = ref.match(/@?e(\d+)/);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  return parseInt(match[1], 10);
}

/**
 * Resolves a field to its objectId for use with Runtime.callFunctionOn.
 * Supports both @eN refs and CSS selectors.
 */
async function resolveObjectId(
  cdp: CDPConnection,
  field: FillFormField,
): Promise<string> {
  if (field.ref) {
    const backendNodeId = parseRef(field.ref);
    const result = (await cdp.send("DOM.resolveNode", {
      backendNodeId,
    } as unknown as Record<string, unknown>)) as {
      object: { objectId: string };
    };
    return result.object.objectId;
  }

  if (field.selector) {
    // Use Runtime.evaluate to query the selector
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(field.selector)})`,
      returnByValue: false,
    } as unknown as Record<string, unknown>)) as {
      result: { objectId?: string };
    };

    if (evalResult.result.objectId) {
      return evalResult.result.objectId;
    }

    // Fallback: DOM.querySelector approach
    const docResult = (await cdp.send(
      "DOM.getDocument",
      {} as Record<string, unknown>,
    )) as { root: { nodeId: number } };
    const queryResult = (await cdp.send("DOM.querySelector", {
      nodeId: docResult.root.nodeId,
      selector: field.selector,
    } as unknown as Record<string, unknown>)) as { nodeId: number };

    const resolveResult = (await cdp.send("DOM.resolveNode", {
      nodeId: queryResult.nodeId,
    } as unknown as Record<string, unknown>)) as {
      object: { objectId: string };
    };
    return resolveResult.object.objectId;
  }

  throw new Error(`Field "${field.name}" has neither ref nor selector`);
}

/**
 * Checks if an element is readonly or disabled.
 * Returns true if the element cannot be modified.
 */
async function isReadonlyOrDisabled(
  cdp: CDPConnection,
  objectId: string,
): Promise<boolean> {
  const result = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() { return this.readOnly || this.disabled; }`,
    returnByValue: true,
  } as unknown as Record<string, unknown>)) as {
    result: { value?: boolean };
  };

  return result.result.value === true;
}

/**
 * Clicks an element by computing its center from the box model.
 */
async function clickElement(
  cdp: CDPConnection,
  field: FillFormField,
): Promise<void> {
  let backendNodeId: number | undefined;

  if (field.ref) {
    backendNodeId = parseRef(field.ref);
  }

  // Scroll into view
  if (backendNodeId !== undefined) {
    await cdp.send("DOM.scrollIntoViewIfNeeded", {
      backendNodeId,
    } as unknown as Record<string, unknown>);
  }

  // Get box model
  const boxResult = (await cdp.send("DOM.getBoxModel", {
    backendNodeId,
  } as unknown as Record<string, unknown>)) as {
    model: { content: number[]; width: number; height: number };
  };

  const quad = boxResult.model.content;
  // Compute center of the content quad (4 corner points: x1,y1,x2,y2,x3,y3,x4,y4)
  const centerX = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const centerY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: centerX,
    y: centerY,
    button: "left",
    clickCount: 1,
  } as unknown as Record<string, unknown>);

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: centerX,
    y: centerY,
    button: "left",
    clickCount: 1,
  } as unknown as Record<string, unknown>);
}

/**
 * Fills a single textbox field: focus → clear → insert text → dispatch events.
 */
async function fillTextbox(
  cdp: CDPConnection,
  field: FillFormField,
  objectId: string,
): Promise<void> {
  // Focus the element
  if (field.ref) {
    const backendNodeId = parseRef(field.ref);
    await cdp.send("DOM.focus", {
      backendNodeId,
    } as unknown as Record<string, unknown>);
  } else {
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() { this.focus(); }`,
      returnByValue: true,
    } as unknown as Record<string, unknown>);
  }

  // Clear existing value and dispatch input event
  await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() { this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); }`,
    returnByValue: true,
  } as unknown as Record<string, unknown>);

  // Insert the new text
  await cdp.send("Input.insertText", {
    text: field.value,
  } as unknown as Record<string, unknown>);

  // Dispatch input and change events
  await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() {
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    returnByValue: true,
  } as unknown as Record<string, unknown>);
}

/**
 * Fills a combobox (select dropdown) field.
 */
async function fillCombobox(
  cdp: CDPConnection,
  _field: FillFormField,
  objectId: string,
  value: string,
): Promise<void> {
  await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function(val) {
      this.value = val;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return [val];
    }`,
    arguments: [{ value }],
    returnByValue: true,
  } as unknown as Record<string, unknown>);
}

/**
 * Fills a slider (range input) field.
 */
async function fillSlider(
  cdp: CDPConnection,
  _field: FillFormField,
  objectId: string,
  value: string,
): Promise<void> {
  await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function(val) {
      this.value = val;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    arguments: [{ value }],
    returnByValue: true,
  } as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fills one or more form fields via CDP.
 */
export async function browserFillForm(
  cdp: CDPConnection,
  params: FillFormParams,
): Promise<FillFormResult> {
  let filledCount = 0;
  const errors: FillFormError[] = [];

  for (const field of params.fields) {
    try {
      const objectId = await resolveObjectId(cdp, field);

      switch (field.type) {
        case "textbox": {
          // Check readonly/disabled before filling
          const isBlocked = await isReadonlyOrDisabled(cdp, objectId);
          if (isBlocked) {
            errors.push({
              field: field.name,
              error: `Cannot fill readonly or disabled field "${field.name}"`,
            });
            continue;
          }

          await fillTextbox(cdp, field, objectId);
          filledCount++;
          break;
        }

        case "checkbox": {
          // Toggle checkbox by clicking
          await clickElement(cdp, field);
          filledCount++;
          break;
        }

        case "radio": {
          // Select radio button by clicking
          await clickElement(cdp, field);
          filledCount++;
          break;
        }

        case "combobox": {
          await fillCombobox(cdp, field, objectId, field.value);
          filledCount++;
          break;
        }

        case "slider": {
          await fillSlider(cdp, field, objectId, field.value);
          filledCount++;
          break;
        }

        default: {
          // Default to textbox behavior
          await fillTextbox(cdp, field, objectId);
          filledCount++;
          break;
        }
      }
    } catch (err) {
      errors.push({
        field: field.name,
        error:
          err instanceof Error ? err.message : `Unknown error filling ${field.name}`,
      });
    }
  }

  return {
    success: errors.length === 0,
    filledCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
