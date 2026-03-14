/**
 * browser_click tool — clicks an element by ref, CSS selector, or coordinates.
 *
 * Element resolution:
 *   1. If `ref` provided (@eN) -> script.callFunction to find element
 *   2. If `selector` provided -> script.callFunction with querySelector
 *   3. Get bounding rect via script.callFunction -> center of element
 *   4. If `x`, `y` provided -> use directly
 *
 * Click sequence (BiDi input.performActions):
 *   pointer: pointerMove -> pointerDown -> pointerUp
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClickParams {
  ref?: string;
  selector?: string;
  element?: string;
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
  modifiers?: string[];
  newTab?: boolean;
}

export interface ClickResult {
  success: boolean;
}

const REF_PATTERN = /^@?e(\d+)$/;

// ---------------------------------------------------------------------------
// Element resolution
// ---------------------------------------------------------------------------

async function resolveElementCoordinates(
  bidi: BiDiConnection,
  params: ClickParams,
): Promise<{ x: number; y: number }> {
  let jsExpression: string;

  if (params.ref) {
    const match = REF_PATTERN.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    jsExpression = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) { node.scrollIntoView({block:'center',inline:'center'}); const r = node.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:r.width,h:r.height}; } node = walker.nextNode(); if(!node) break; }
      return null;
    })()`;
  } else if (params.selector) {
    const sel = JSON.stringify(params.selector);
    jsExpression = `(() => {
      const el = document.querySelector(${sel});
      if (!el) return null;
      el.scrollIntoView({block:'center',inline:'center'});
      const r = el.getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:r.width,h:r.height};
    })()`;
  } else {
    throw new Error("Either ref, selector, or coordinates (x, y) must be provided");
  }

  const response = (await bidi.send("script.evaluate", {
    expression: jsExpression,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { type: string; value?: { x: number; y: number; w: number; h: number } } };

  const val = response.result?.value;
  if (!val) throw new Error(params.ref ? `Element not found for ref: ${params.ref}` : `Element not found: no element matches selector "${params.selector}"`);
  if (val.w === 0 && val.h === 0) throw new Error("Element is not visible: zero-size box model.");

  return { x: val.x, y: val.y };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main click
// ---------------------------------------------------------------------------

export async function browserClick(
  bidi: BiDiConnection,
  params: ClickParams,
): Promise<ClickResult> {
  let x: number;
  let y: number;

  if (params.x !== undefined && params.y !== undefined) {
    x = params.x;
    y = params.y;
  } else {
    const coords = await resolveElementCoordinates(bidi, params);
    x = coords.x;
    y = coords.y;
  }

  const buttonMap: Record<string, number> = { left: 0, middle: 1, right: 2 };
  const button = buttonMap[params.button ?? "left"] ?? 0;

  if (params.doubleClick) {
    await performClick(bidi, x, y, button);
    await delay(50);
    await performClick(bidi, x, y, button);
  } else {
    await performClick(bidi, x, y, button);
  }

  return { success: true };
}

async function performClick(
  bidi: BiDiConnection,
  x: number,
  y: number,
  button: number,
): Promise<void> {
  await bidi.send("input.performActions", {
    actions: [{
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", x, y, duration: 0 },
        { type: "pointerDown", button },
        { type: "pause", duration: 50 },
        { type: "pointerUp", button },
      ],
    }],
  });
}
