/**
 * browser_diff tool — pixel-by-pixel comparison of two screenshots via BiDi.
 */
import type { BiDiConnection } from "../bidi/connection.js";

export interface DiffParams {
  before: string;
  after?: string;
  selector?: string;
  threshold?: number;
}

export interface DiffResult {
  diffPercentage: number;
  totalPixels: number;
  diffPixels: number;
  identical: boolean;
  diffImage: string;
  width: number;
  height: number;
}

async function captureScreenshot(
  bidi: BiDiConnection,
  selector?: string,
): Promise<string> {
  const captureParams: Record<string, unknown> = { origin: "viewport" };

  if (selector) {
    const response = (await bidi.send("script.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height};
      })()`,
      awaitPromise: false,
      resultOwnership: "none",
    })) as { result: { value?: { x: number; y: number; width: number; height: number } } };

    if (!response.result?.value) throw new Error(`Element not found: ${selector}`);
    const box = response.result.value;
    captureParams.clip = { type: "box", x: box.x, y: box.y, width: box.width, height: box.height };
  }

  const screenshot = (await bidi.send("browsingContext.captureScreenshot", captureParams)) as { data: string };
  return screenshot.data;
}

function buildComparisonExpression(threshold: number): string {
  return [
    "(async () => {",
    "  const beforeSrc = window._diffBefore;",
    "  const afterSrc = window._diffAfter;",
    "  const loadImg = (src) => new Promise((res, rej) => {",
    "    const img = new Image(); img.onload = () => res(img); img.onerror = (e) => rej(new Error('Failed to load image')); img.src = src;",
    "  });",
    "  const img1 = await loadImg('data:image/png;base64,' + beforeSrc);",
    "  const img2 = await loadImg('data:image/png;base64,' + afterSrc);",
    "  const w = Math.max(img1.width, img2.width);",
    "  const h = Math.max(img1.height, img2.height);",
    "  const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;",
    "  const ctx1 = c1.getContext('2d'); ctx1.drawImage(img1, 0, 0);",
    "  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;",
    "  const ctx2 = c2.getContext('2d'); ctx2.drawImage(img2, 0, 0);",
    "  const d1 = ctx1.getImageData(0, 0, w, h).data;",
    "  const d2 = ctx2.getImageData(0, 0, w, h).data;",
    "  const diff = document.createElement('canvas'); diff.width = w; diff.height = h;",
    "  const dCtx = diff.getContext('2d'); dCtx.drawImage(img2, 0, 0);",
    "  const dData = dCtx.getImageData(0, 0, w, h);",
    "  let diffCount = 0;",
    "  const threshold = " + threshold + ";",
    "  for (let i = 0; i < d1.length; i += 4) {",
    "    const dr = Math.abs(d1[i] - d2[i]);",
    "    const dg = Math.abs(d1[i+1] - d2[i+1]);",
    "    const db = Math.abs(d1[i+2] - d2[i+2]);",
    "    if (dr > threshold || dg > threshold || db > threshold) { diffCount++; dData.data[i] = 255; dData.data[i+1] = 0; dData.data[i+2] = 0; dData.data[i+3] = 200; }",
    "  }",
    "  dCtx.putImageData(dData, 0, 0);",
    "  const diffBase64 = diff.toDataURL('image/png').split(',')[1];",
    "  const total = w * h;",
    "  return JSON.stringify({ diffPercentage: parseFloat((diffCount / total * 100).toFixed(4)), totalPixels: total, diffPixels: diffCount, identical: (diffCount / total) < 0.001, diffImage: diffBase64, width: w, height: h });",
    "})()",
  ].join("\n");
}

export async function browserDiff(
  bidi: BiDiConnection,
  params: DiffParams,
): Promise<DiffResult> {
  const threshold = params.threshold ?? 30;

  let beforeBase64: string;
  if (params.before === "current") {
    beforeBase64 = await captureScreenshot(bidi, params.selector);
  } else {
    beforeBase64 = params.before;
  }

  let afterBase64: string;
  if (!params.after || params.after === "current") {
    afterBase64 = await captureScreenshot(bidi, params.selector);
  } else {
    afterBase64 = params.after;
  }

  // Store images in page context
  await bidi.send("script.evaluate", {
    expression: "window._diffBefore = " + JSON.stringify(beforeBase64) + ";",
    awaitPromise: false,
    resultOwnership: "none",
  });

  await bidi.send("script.evaluate", {
    expression: "window._diffAfter = " + JSON.stringify(afterBase64) + ";",
    awaitPromise: false,
    resultOwnership: "none",
  });

  const result = (await bidi.send("script.evaluate", {
    expression: buildComparisonExpression(threshold),
    awaitPromise: true,
    resultOwnership: "none",
  })) as { result: { type: string; value: string } };

  // Clean up
  await bidi.send("script.evaluate", {
    expression: "delete window._diffBefore; delete window._diffAfter;",
    awaitPromise: false,
    resultOwnership: "none",
  });

  return JSON.parse(result.result?.value ?? "{}") as DiffResult;
}
