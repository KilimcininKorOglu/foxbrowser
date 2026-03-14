/**
 * browser_screenshot tool — captures viewport or full-page screenshots via BiDi.
 *
 * Uses browsingContext.captureScreenshot for viewport/full-page capture.
 * Element screenshots use clip parameter with bounding rect from script.evaluate.
 */
import type { BiDiConnection } from "../bidi/connection.js";

interface ScreenshotParams {
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  selector?: string;
  ref?: string;
  annotate?: boolean;
}

interface Annotation {
  ref: string;
  label: string;
  role?: string;
  name?: string;
}

interface ScreenshotResult {
  base64: string;
  annotations?: Annotation[];
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getElementBox(
  bidi: BiDiConnection,
  selectorOrRef: string,
  isRef: boolean,
): Promise<BoundingBox> {
  let jsExpression: string;

  if (isRef) {
    const match = /^@e(\d+)$/.exec(selectorOrRef);
    if (!match) throw new Error(`Invalid ref format: ${selectorOrRef}`);
    const nodeId = match[1];
    jsExpression = `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; } node = walker.nextNode(); if(!node) break; }
      return null;
    })()`;
  } else {
    jsExpression = `(() => {
      const el = document.querySelector(${JSON.stringify(selectorOrRef)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`;
  }

  const response = (await bidi.send("script.evaluate", {
    expression: jsExpression,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: BoundingBox } };

  if (!response.result?.value) throw new Error(`Element not found: ${selectorOrRef}`);
  return response.result.value;
}

async function buildAnnotations(bidi: BiDiConnection): Promise<Annotation[]> {
  // Use JS-based accessibility tree traversal since BiDi has no Accessibility domain
  const response = (await bidi.send("script.evaluate", {
    expression: `(() => {
      const results = [];
      let counter = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        counter++;
        const role = node.getAttribute('role') || node.tagName.toLowerCase();
        const name = node.getAttribute('aria-label') || node.textContent?.trim()?.slice(0, 50) || '';
        results.push({ ref: '@e' + counter, label: '[' + counter + ']', role, name });
        node = walker.nextNode();
        if (!node) break;
      }
      return results;
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: Annotation[] } };

  return response.result?.value ?? [];
}

export async function browserScreenshot(
  bidi: BiDiConnection,
  params: ScreenshotParams,
): Promise<ScreenshotResult> {
  const captureParams: Record<string, unknown> = {
    origin: "viewport",
  };

  // Element screenshot by selector or ref
  if (params.selector) {
    const box = await getElementBox(bidi, params.selector, false);
    captureParams.clip = {
      type: "box",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  } else if (params.ref) {
    const box = await getElementBox(bidi, params.ref, true);
    captureParams.clip = {
      type: "box",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  }

  if (params.fullPage) {
    captureParams.origin = "document";
  }

  const screenshot = (await bidi.send(
    "browsingContext.captureScreenshot",
    captureParams,
  )) as { data: string };

  const result: ScreenshotResult = {
    base64: screenshot.data,
  };

  if (params.annotate) {
    result.annotations = await buildAnnotations(bidi);
  }

  return result;
}
