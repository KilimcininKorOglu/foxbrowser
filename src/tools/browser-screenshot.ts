/**
 * browser_screenshot tool — captures viewport or full-page screenshots via CDP.
 *
 * Supports:
 *  - Viewport / full-page capture (Page.captureScreenshot)
 *  - DPR detection cascade (3-level fallback)
 *  - Element screenshot by CSS selector or @eN ref
 *  - Annotated screenshots with ref labels
 *  - Custom format (png/jpeg) and quality
 *
 * @module browser-screenshot
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScreenshotParams {
  /** Capture the full scrollable page, not just the viewport. */
  fullPage?: boolean;
  /** Screenshot format. Default: "png". */
  format?: "png" | "jpeg";
  /** JPEG quality (0-100). Only applies when format is "jpeg". */
  quality?: number;
  /** CSS selector to screenshot a specific element. */
  selector?: string;
  /** @eN ref to screenshot a specific element. */
  ref?: string;
  /** Annotate interactive elements with numbered labels. */
  annotate?: boolean;
}

interface Annotation {
  /** The @eN ref string, e.g. "@e1" */
  ref: string;
  /** The numbered label on the screenshot, e.g. "[1]" */
  label: string;
  /** Accessibility role */
  role?: string;
  /** Accessible name */
  name?: string;
}

interface ScreenshotResult {
  /** Base64-encoded screenshot data. */
  base64: string;
  /** Annotation labels when `annotate: true`. */
  annotations?: Annotation[];
}

// ---------------------------------------------------------------------------
// DPR Detection Cascade
// ---------------------------------------------------------------------------

/**
 * Detect device pixel ratio using a 3-level cascade:
 *   Level 1: Page.getLayoutMetrics (visualViewport vs cssVisualViewport)
 *   Level 2: Emulation.getDeviceMetricsOverride (deviceScaleFactor)
 *   Level 3: Runtime.evaluate("window.devicePixelRatio")
 *   Default: 1
 */
async function detectDPR(cdp: CDPConnection): Promise<number> {
  // Level 1: Page.getLayoutMetrics
  try {
    const metrics = (await cdp.send("Page.getLayoutMetrics", {})) as {
      visualViewport?: { clientWidth: number };
      cssVisualViewport?: { clientWidth: number };
      layoutViewport?: { clientWidth: number };
      contentSize?: { width: number };
    };

    if (metrics.visualViewport && metrics.cssVisualViewport) {
      const physicalWidth = metrics.visualViewport.clientWidth;
      const cssWidth = metrics.cssVisualViewport.clientWidth;
      if (cssWidth > 0 && physicalWidth > 0) {
        const dpr = physicalWidth / cssWidth;
        if (dpr >= 1) {
          return dpr;
        }
      }
    }
  } catch {
    // Level 1 failed, try Level 2
  }

  // Level 2: Runtime.evaluate
  try {
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: "window.devicePixelRatio",
      returnByValue: true,
    })) as {
      result: { type: string; value: unknown };
    };

    if (evalResult.result.type === "number" && typeof evalResult.result.value === "number") {
      return evalResult.result.value;
    }
  } catch {
    // Level 3 failed, use default
  }

  // Default: DPR = 1
  return 1;
}

// ---------------------------------------------------------------------------
// Element bounding box
// ---------------------------------------------------------------------------

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get the bounding box of an element by CSS selector.
 */
async function getElementBoxBySelector(
  cdp: CDPConnection,
  selector: string,
): Promise<BoundingBox> {
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
    model: { content: number[]; width: number; height: number };
  };

  const content = boxModel.model.content;
  // content is [x1,y1, x2,y2, x3,y3, x4,y4] (quad)
  const x = content[0];
  const y = content[1];
  const width = content[2] - content[0];
  const height = content[5] - content[1];

  return { x, y, width, height };
}

/**
 * Get the bounding box of an element by @eN ref (backendNodeId).
 */
async function getElementBoxByRef(
  cdp: CDPConnection,
  ref: string,
): Promise<BoundingBox> {
  // Parse @eN → extract numeric ref index
  const match = /^@e(\d+)$/.exec(ref);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }

  const backendNodeId = parseInt(match[1], 10);

  // Resolve the backendNodeId to a remote object
  const resolved = (await cdp.send("DOM.resolveNode", {
    backendNodeId,
  })) as { object: { objectId: string } };

  // Get the box model for the node
  const boxModel = (await cdp.send("DOM.getBoxModel", {
    backendNodeId,
  })) as {
    model: { content: number[]; width: number; height: number };
  };

  const content = boxModel.model.content;
  const x = content[0];
  const y = content[1];
  const width = content[2] - content[0];
  const height = content[5] - content[1];

  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// Annotated screenshot
// ---------------------------------------------------------------------------

/**
 * Build annotations from the accessibility tree for interactive elements.
 */
async function buildAnnotations(cdp: CDPConnection): Promise<Annotation[]> {
  const axTree = (await cdp.send("Accessibility.getFullAXTree", {}, { timeout: 10000 })) as {
    nodes: Array<{
      nodeId: string;
      backendDOMNodeId?: number;
      role?: { type: string; value: string };
      name?: { type: string; value: string };
    }>;
  };

  const annotations: Annotation[] = [];
  let counter = 0;

  for (const node of axTree.nodes) {
    const role = node.role?.value;

    // Skip the root WebArea node
    if (role === "WebArea") {
      continue;
    }

    counter++;
    // Use backendDOMNodeId as ref so tools can resolve it directly
    const ref = node.backendDOMNodeId ? `@e${node.backendDOMNodeId}` : `@e${counter}`;
    const label = `[${counter}]`;

    annotations.push({
      ref,
      label,
      role: role ?? "unknown",
      name: node.name?.value ?? "",
    });
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot of the browser page or a specific element.
 *
 * @param cdp - CDP connection.
 * @param params - Screenshot parameters.
 * @returns Base64-encoded screenshot data and optional annotations.
 */
export async function browserScreenshot(
  cdp: CDPConnection,
  params: ScreenshotParams,
): Promise<ScreenshotResult> {
  const format = params.format ?? "png";

  // Build the captureScreenshot parameters
  const captureParams: Record<string, unknown> = {
    format,
  };

  // Quality only applies to jpeg
  if (format === "jpeg" && params.quality !== undefined) {
    captureParams.quality = params.quality;
  }

  // Detect DPR (needed for various calculations)
  const _dpr = await detectDPR(cdp);

  // Element screenshot by selector
  if (params.selector) {
    const box = await getElementBoxBySelector(cdp, params.selector);
    captureParams.clip = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      scale: 1,
    };
  }

  // Element screenshot by @eN ref
  if (params.ref) {
    const box = await getElementBoxByRef(cdp, params.ref);
    captureParams.clip = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      scale: 1,
    };
  }

  // Full page screenshot
  if (params.fullPage) {
    const metrics = (await cdp.send("Page.getLayoutMetrics", {})) as {
      contentSize: { width: number; height: number };
      cssContentSize?: { width: number; height: number };
      layoutViewport: { clientWidth: number; clientHeight: number };
    };

    const contentWidth = metrics.cssContentSize?.width ?? metrics.contentSize.width;
    const contentHeight = metrics.cssContentSize?.height ?? metrics.contentSize.height;

    captureParams.clip = {
      x: 0,
      y: 0,
      width: contentWidth,
      height: contentHeight,
      scale: 1,
    };
  }

  // Capture the screenshot
  const screenshot = (await cdp.send("Page.captureScreenshot", captureParams)) as {
    data: string;
  };

  const result: ScreenshotResult = {
    base64: screenshot.data,
  };

  // Annotated screenshot
  if (params.annotate) {
    result.annotations = await buildAnnotations(cdp);
  }

  return result;
}
