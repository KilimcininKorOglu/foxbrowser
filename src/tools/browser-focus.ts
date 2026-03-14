/**
 * browser_focus — Focus an element via script.callFunction without dispatching click events.
 */
import type { BiDiConnection } from "../bidi/connection.js";

export interface FocusParams {
  selector?: string;
  ref?: string;
}

export async function browserFocus(
  bidi: BiDiConnection,
  params: FocusParams,
): Promise<void> {
  if (params.selector) {
    await bidi.send("script.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) throw new Error('Element not found: ${params.selector}');
        el.focus();
      })()`,
      awaitPromise: false,
      resultOwnership: "none",
    });
  } else if (params.ref) {
    const match = params.ref.match(/^@?e(\d+)$/);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    await bidi.send("script.evaluate", {
      expression: `(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let count = 0; let node = walker.currentNode;
        while (node) { count++; if (count === ${nodeId}) { node.focus(); return; } node = walker.nextNode(); if(!node) break; }
        throw new Error('Element not found for ref: @e${nodeId}');
      })()`,
      awaitPromise: false,
      resultOwnership: "none",
    });
  } else {
    throw new Error("Either selector or ref must be provided");
  }
}
