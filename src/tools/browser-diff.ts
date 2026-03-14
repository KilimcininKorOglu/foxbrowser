/**
 * browser_diff tool — pixel-by-pixel comparison of two screenshots via CDP.
 *
 * Supports:
 *  - Comparing two base64 PNG screenshots
 *  - Capturing "current" page state as before/after
 *  - Element-scoped comparison via CSS selector
 *  - Configurable pixel difference threshold
 *  - Visual diff image with red-highlighted changes
 *
 * @module browser-diff
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffParams {
  /** First screenshot - base64 PNG or "current" to capture now */
  before: string;
  /** Second screenshot - base64 PNG or "current" to capture now */
  after?: string;
  /** CSS selector to scope comparison */
  selector?: string;
  /** Pixel difference threshold (0-255, default 30) */
  threshold?: number;
}

export interface DiffResult {
  /** Percentage of pixels that differ (0-100) */
  diffPercentage: number;
  /** Total pixels compared */
  totalPixels: number;
  /** Number of different pixels */
  diffPixels: number;
  /** Whether images are considered identical (diffPercentage < 0.1) */
  identical: boolean;
  /** Base64 diff image (red highlights on differences) */
  diffImage: string;
  /** Dimensions */
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot of the current page or a specific element.
 */
async function captureScreenshot(
  cdp: CDPConnection,
  selector?: string,
): Promise<string> {
  const captureParams: Record<string, unknown> = { format: "png" };

  if (selector) {
    const doc = (await cdp.send("DOM.getDocument", {})) as {
      root: { nodeId: number };
    };
    const queryResult = (await cdp.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector,
    })) as { nodeId: number };

    if (!queryResult.nodeId) {
      throw new Error(`Element not found: ${selector}`);
    }

    const boxModel = (await cdp.send("DOM.getBoxModel", {
      nodeId: queryResult.nodeId,
    })) as {
      model: { content: number[] };
    };

    const content = boxModel.model.content;
    captureParams.clip = {
      x: content[0],
      y: content[1],
      width: content[2] - content[0],
      height: content[5] - content[1],
      scale: 1,
    };
  }

  const screenshot = (await cdp.send(
    "Page.captureScreenshot",
    captureParams,
  )) as { data: string };

  return screenshot.data;
}

/**
 * Build the JavaScript expression for in-browser pixel comparison.
 * Uses string concatenation to avoid template literal escaping issues
 * with large base64 strings injected into CDP Runtime.evaluate.
 */
function buildComparisonExpression(threshold: number): string {
  return [
    "(async () => {",
    "  const beforeSrc = window._diffBefore;",
    "  const afterSrc = window._diffAfter;",
    "",
    "  const loadImg = (src) => new Promise((res, rej) => {",
    "    const img = new Image();",
    "    img.onload = () => res(img);",
    "    img.onerror = (e) => rej(new Error('Failed to load image'));",
    "    img.src = src;",
    "  });",
    "",
    "  const img1 = await loadImg('data:image/png;base64,' + beforeSrc);",
    "  const img2 = await loadImg('data:image/png;base64,' + afterSrc);",
    "",
    "  const w = Math.max(img1.width, img2.width);",
    "  const h = Math.max(img1.height, img2.height);",
    "",
    "  const c1 = document.createElement('canvas');",
    "  c1.width = w; c1.height = h;",
    "  const ctx1 = c1.getContext('2d');",
    "  ctx1.drawImage(img1, 0, 0);",
    "",
    "  const c2 = document.createElement('canvas');",
    "  c2.width = w; c2.height = h;",
    "  const ctx2 = c2.getContext('2d');",
    "  ctx2.drawImage(img2, 0, 0);",
    "",
    "  const d1 = ctx1.getImageData(0, 0, w, h).data;",
    "  const d2 = ctx2.getImageData(0, 0, w, h).data;",
    "",
    "  const diff = document.createElement('canvas');",
    "  diff.width = w; diff.height = h;",
    "  const dCtx = diff.getContext('2d');",
    "  dCtx.drawImage(img2, 0, 0);",
    "  const dData = dCtx.getImageData(0, 0, w, h);",
    "",
    "  let diffCount = 0;",
    "  const threshold = " + threshold + ";",
    "  for (let i = 0; i < d1.length; i += 4) {",
    "    const dr = Math.abs(d1[i] - d2[i]);",
    "    const dg = Math.abs(d1[i+1] - d2[i+1]);",
    "    const db = Math.abs(d1[i+2] - d2[i+2]);",
    "    if (dr > threshold || dg > threshold || db > threshold) {",
    "      diffCount++;",
    "      dData.data[i] = 255;",
    "      dData.data[i+1] = 0;",
    "      dData.data[i+2] = 0;",
    "      dData.data[i+3] = 200;",
    "    }",
    "  }",
    "",
    "  dCtx.putImageData(dData, 0, 0);",
    "  const diffBase64 = diff.toDataURL('image/png').split(',')[1];",
    "",
    "  const total = w * h;",
    "  return JSON.stringify({",
    "    diffPercentage: parseFloat((diffCount / total * 100).toFixed(4)),",
    "    totalPixels: total,",
    "    diffPixels: diffCount,",
    "    identical: (diffCount / total) < 0.001,",
    "    diffImage: diffBase64,",
    "    width: w,",
    "    height: h",
    "  });",
    "})()",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compare two screenshots pixel-by-pixel.
 *
 * If `before` is "current", captures the page now.
 * If `after` is not provided or is "current", captures the page now.
 *
 * @param cdp - CDP connection.
 * @param params - Diff parameters.
 * @returns Diff result with percentage, pixel count, and visual diff image.
 */
export async function browserDiff(
  cdp: CDPConnection,
  params: DiffParams,
): Promise<DiffResult> {
  const threshold = params.threshold ?? 30;

  // Resolve before image
  let beforeBase64: string;
  if (params.before === "current") {
    beforeBase64 = await captureScreenshot(cdp, params.selector);
  } else {
    beforeBase64 = params.before;
  }

  // Resolve after image
  let afterBase64: string;
  if (!params.after || params.after === "current") {
    afterBase64 = await captureScreenshot(cdp, params.selector);
  } else {
    afterBase64 = params.after;
  }

  // Store images in page context to avoid escaping issues with large base64 strings
  await cdp.send("Runtime.evaluate", {
    expression: "window._diffBefore = " + JSON.stringify(beforeBase64) + ";",
    returnByValue: true,
  });

  await cdp.send("Runtime.evaluate", {
    expression: "window._diffAfter = " + JSON.stringify(afterBase64) + ";",
    returnByValue: true,
  });

  // Run pixel comparison in the browser
  const result = (await cdp.send("Runtime.evaluate", {
    expression: buildComparisonExpression(threshold),
    awaitPromise: true,
    returnByValue: true,
  })) as {
    result: { type: string; value: string };
    exceptionDetails?: { text: string };
  };

  if (result.exceptionDetails) {
    throw new Error(
      "Diff comparison failed: " + result.exceptionDetails.text,
    );
  }

  // Clean up global variables
  await cdp.send("Runtime.evaluate", {
    expression: "delete window._diffBefore; delete window._diffAfter;",
    returnByValue: true,
  });

  return JSON.parse(result.result.value) as DiffResult;
}
