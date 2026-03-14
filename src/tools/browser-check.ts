/**
 * browser_check / browser_uncheck — Idempotent checkbox state management via BiDi.
 *
 * Uses script.evaluate to check state and input.performActions to click.
 */
import type { BiDiConnection } from "../bidi/connection.js";

const REF_PATTERN = /^@?e(\d+)$/;

export interface CheckParams {
  selector?: string;
  ref?: string;
}

async function getCheckedState(bidi: BiDiConnection, params: CheckParams): Promise<boolean> {
  let expression: string;

  if (params.selector) {
    expression = `document.querySelector(${JSON.stringify(params.selector)})?.checked ?? false`;
  } else if (params.ref) {
    const match = REF_PATTERN.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    expression = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) return node.checked ?? false; node = walker.nextNode(); if (!node) break; }
      return false;
    })()`;
  } else {
    return false;
  }

  const response = (await bidi.send("script.evaluate", {
    expression,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value: unknown } };

  return response.result.value === true;
}

async function clickElement(bidi: BiDiConnection, params: CheckParams): Promise<void> {
  let expression: string;

  if (params.selector) {
    const sel = JSON.stringify(params.selector);
    expression = `(() => {
      const el = document.querySelector(${sel});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`;
  } else if (params.ref) {
    const match = REF_PATTERN.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    expression = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) { node.scrollIntoView({ block: 'center', inline: 'center' }); const r = node.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; } node = walker.nextNode(); if (!node) break; }
      return null;
    })()`;
  } else {
    throw new Error("Either selector or ref must be provided");
  }

  const coordResult = (await bidi.send("script.evaluate", {
    expression,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value: { x: number; y: number } | null } };

  const coords = coordResult.result.value;
  if (!coords) throw new Error(`Element not found: ${params.ref ?? params.selector}`);

  await bidi.send("input.performActions", {
    actions: [{
      type: "pointer",
      id: "mouse",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", x: coords.x, y: coords.y },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    }],
  });
}

export async function browserCheck(bidi: BiDiConnection, params: CheckParams): Promise<void> {
  const isChecked = await getCheckedState(bidi, params);
  if (!isChecked) await clickElement(bidi, params);
}

export async function browserUncheck(bidi: BiDiConnection, params: CheckParams): Promise<void> {
  const isChecked = await getCheckedState(bidi, params);
  if (isChecked) await clickElement(bidi, params);
}
