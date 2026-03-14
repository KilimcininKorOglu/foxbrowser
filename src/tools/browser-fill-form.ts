/**
 * browser_fill_form tool — fills form fields by ref or CSS selector via BiDi.
 *
 * Supports field types:
 *   - textbox: focus -> clear -> insertText -> dispatch events
 *   - checkbox/radio: click to toggle
 *   - combobox/slider: set value via script.callFunction
 */
import type { BiDiConnection } from "../bidi/connection.js";

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

function resolveElementScript(field: FillFormField): string {
  if (field.ref) {
    const match = field.ref.match(/^@?e(\d+)$/);
    if (!match) throw new Error(`Invalid ref format: ${field.ref}`);
    const nodeId = match[1];
    return `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) return node; node = walker.nextNode(); if(!node) break; }
      return null;
    })()`;
  }
  if (field.selector) {
    return `document.querySelector(${JSON.stringify(field.selector)})`;
  }
  throw new Error(`Field "${field.name}" has neither ref nor selector`);
}

async function fillTextbox(bidi: BiDiConnection, field: FillFormField): Promise<void> {
  const elScript = resolveElementScript(field);
  const escaped = JSON.stringify(field.value);

  await bidi.send("script.evaluate", {
    expression: `(() => {
      const el = ${elScript};
      if (!el) throw new Error('Element not found');
      if (el.readOnly || el.disabled) throw new Error('Cannot fill readonly or disabled field');
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  });

  // Insert text via execCommand
  await bidi.send("script.callFunction", {
    functionDeclaration: `(t) => document.execCommand('insertText', false, t)`,
    arguments: [{ type: "string", value: field.value }],
    awaitPromise: false,
    resultOwnership: "none",
  });

  // Dispatch events
  await bidi.send("script.evaluate", {
    expression: `(() => {
      const el = document.activeElement;
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  });
}

async function clickField(bidi: BiDiConnection, field: FillFormField): Promise<void> {
  const elScript = resolveElementScript(field);

  const response = (await bidi.send("script.evaluate", {
    expression: `(() => {
      const el = ${elScript};
      if (!el) return null;
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: { x: number; y: number } } };

  const coords = response.result?.value;
  if (!coords) throw new Error(`Element not found for field: ${field.name}`);

  await bidi.send("input.performActions", {
    actions: [{
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", x: coords.x, y: coords.y, duration: 0 },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    }],
  });
}

async function fillComboboxOrSlider(bidi: BiDiConnection, field: FillFormField): Promise<void> {
  const elScript = resolveElementScript(field);
  const escaped = JSON.stringify(field.value);

  await bidi.send("script.evaluate", {
    expression: `(() => {
      const el = ${elScript};
      if (!el) throw new Error('Element not found');
      el.value = ${escaped};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  });
}

export async function browserFillForm(
  bidi: BiDiConnection,
  params: FillFormParams,
): Promise<FillFormResult> {
  let filledCount = 0;
  const errors: FillFormError[] = [];

  for (const field of params.fields) {
    try {
      switch (field.type) {
        case "textbox":
          await fillTextbox(bidi, field);
          filledCount++;
          break;
        case "checkbox":
        case "radio":
          await clickField(bidi, field);
          filledCount++;
          break;
        case "combobox":
        case "slider":
          await fillComboboxOrSlider(bidi, field);
          filledCount++;
          break;
        default:
          await fillTextbox(bidi, field);
          filledCount++;
          break;
      }
    } catch (err) {
      errors.push({
        field: field.name,
        error: err instanceof Error ? err.message : `Unknown error filling ${field.name}`,
      });
    }
  }

  return {
    success: errors.length === 0,
    filledCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
