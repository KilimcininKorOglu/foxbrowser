/**
 * browser_scroll_into_view tool — Scrolls a specific element into the visible viewport via BiDi.
 */
import type { BiDiConnection } from "../bidi/connection.js";

interface ScrollIntoViewParams {
  selector?: string;
  ref?: string;
}

interface ScrollIntoViewResult {
  success: boolean;
}

export async function browserScrollIntoView(
  bidi: BiDiConnection,
  params: ScrollIntoViewParams,
): Promise<ScrollIntoViewResult> {
  let jsExpression: string;

  if (params.ref) {
    const match = /^@?e(\d+)$/.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    jsExpression = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) { node.scrollIntoView({ behavior: "instant", block: "center" }); return true; } node = walker.nextNode(); if(!node) break; }
      throw new Error('Element not found for ref: ${params.ref}');
    })()`;
  } else if (params.selector) {
    jsExpression = `(() => {
      const el = document.querySelector(${JSON.stringify(params.selector)});
      if (!el) throw new Error('Element not found: ${params.selector}');
      el.scrollIntoView({ behavior: "instant", block: "center" });
      return true;
    })()`;
  } else {
    throw new Error("Either selector or ref must be provided");
  }

  await bidi.send("script.evaluate", {
    expression: jsExpression,
    awaitPromise: false,
    resultOwnership: "none",
  });

  return { success: true };
}
