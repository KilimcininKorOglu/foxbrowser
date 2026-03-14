/**
 * browser_click tool — clicks an element by ref, CSS selector, or coordinates.
 *
 * Element resolution:
 *   1. If `ref` provided (@eN) -> extract backendNodeId -> DOM.resolveNode
 *   2. If `selector` provided -> DOM.getDocument -> DOM.querySelector -> nodeId
 *   3. DOM.scrollIntoViewIfNeeded -> DOM.getBoxModel -> center of content quad
 *   4. If `x`, `y` provided -> use directly
 *
 * Click sequence (CDP Input.dispatchMouseEvent):
 *   1. mouseMoved (x, y)
 *   2. mousePressed (x, y, button, clickCount)
 *   3. 50ms delay
 *   4. mouseReleased (x, y, button, clickCount)
 *
 * Supports: left/right/middle button, double-click, modifier keys, new-tab click.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Modifier bitfield values (CDP Input.dispatchMouseEvent modifiers)
// ---------------------------------------------------------------------------
const MODIFIER_BITS: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClickParams {
  /** @eN ref from accessibility snapshot */
  ref?: string;
  /** CSS selector */
  selector?: string;
  /** Human-readable element description */
  element?: string;
  /** Direct x coordinate */
  x?: number;
  /** Direct y coordinate */
  y?: number;
  /** Mouse button: "left" | "right" | "middle" */
  button?: "left" | "right" | "middle";
  /** Whether to double-click */
  doubleClick?: boolean;
  /** Modifier keys to hold during click */
  modifiers?: string[];
  /** Whether to open in new tab (Meta on macOS, Ctrl otherwise) */
  newTab?: boolean;
}

export interface ClickResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Ref pattern
// ---------------------------------------------------------------------------
const REF_PATTERN = /^@e(\d+)$/;

// ---------------------------------------------------------------------------
// Element resolution helpers
// ---------------------------------------------------------------------------

/**
 * Calculates the center point of a content quad from DOM.getBoxModel.
 * Content quad is 8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4].
 */
function calculateCenter(content: number[]): { x: number; y: number } {
  const x = (content[0] + content[2] + content[4] + content[6]) / 4;
  const y = (content[1] + content[3] + content[5] + content[7]) / 4;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Resolves an element to coordinates by ref or selector.
 * Returns the center (x, y) of the element's content box.
 */
async function resolveElementCoordinates(
  cdp: CDPConnection,
  params: ClickParams,
): Promise<{ x: number; y: number }> {
  let backendNodeId: number | undefined;
  let nodeId: number | undefined;

  if (params.ref) {
    // Parse @eN ref to extract backendNodeId
    const match = REF_PATTERN.exec(params.ref);
    if (!match) {
      throw new Error(`Invalid ref format: ${params.ref}`);
    }
    backendNodeId = parseInt(match[1], 10);

    // Resolve to get objectId (validates the node exists)
    await cdp.send("DOM.resolveNode", {
      backendNodeId,
    } as unknown as Record<string, unknown>);
  } else if (params.selector) {
    // Resolve via DOM.querySelector
    const docResponse = (await cdp.send("DOM.getDocument")) as {
      root: { nodeId: number };
    };

    const queryResponse = (await cdp.send("DOM.querySelector", {
      nodeId: docResponse.root.nodeId,
      selector: params.selector,
    } as unknown as Record<string, unknown>)) as { nodeId: number };

    if (!queryResponse.nodeId || queryResponse.nodeId === 0) {
      throw new Error(
        `Element not found: no element matches selector "${params.selector}"`,
      );
    }

    nodeId = queryResponse.nodeId;
  } else {
    throw new Error("Either ref, selector, or coordinates (x, y) must be provided");
  }

  // Scroll element into view
  const scrollParams: Record<string, unknown> = {};
  if (backendNodeId !== undefined) {
    scrollParams.backendNodeId = backendNodeId;
  } else if (nodeId !== undefined) {
    scrollParams.nodeId = nodeId;
  }
  await cdp.send(
    "DOM.scrollIntoViewIfNeeded",
    scrollParams,
  );

  // Get box model for center coordinates
  const boxParams: Record<string, unknown> = {};
  if (backendNodeId !== undefined) {
    boxParams.backendNodeId = backendNodeId;
  } else if (nodeId !== undefined) {
    boxParams.nodeId = nodeId;
  }

  const boxResponse = (await cdp.send("DOM.getBoxModel", boxParams)) as {
    model: {
      content: number[];
      width: number;
      height: number;
    };
  };

  const { content, width, height } = boxResponse.model;

  // Validate element is visible (non-zero size)
  if (width === 0 && height === 0) {
    throw new Error(
      "Element is not visible: zero-size box model. The element may be hidden or not rendered.",
    );
  }

  return calculateCenter(content);
}

/**
 * Calculates the combined modifier bitfield from modifier key names.
 */
function computeModifiers(modifiers?: string[]): number {
  if (!modifiers || modifiers.length === 0) return 0;

  let bits = 0;
  for (const mod of modifiers) {
    const bit = MODIFIER_BITS[mod];
    if (bit !== undefined) {
      bits |= bit;
    }
  }
  return bits;
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main click implementation
// ---------------------------------------------------------------------------

/**
 * Clicks an element identified by ref, CSS selector, or coordinates.
 *
 * @param cdp  - CDP connection with send/on/off methods.
 * @param params - Click parameters.
 * @returns Result with success status.
 */
export async function browserClick(
  cdp: CDPConnection,
  params: ClickParams,
): Promise<ClickResult> {
  // Resolve target coordinates
  let x: number;
  let y: number;

  if (params.x !== undefined && params.y !== undefined) {
    // Direct coordinates
    x = params.x;
    y = params.y;
  } else {
    // Resolve from ref or selector
    const coords = await resolveElementCoordinates(cdp, params);
    x = coords.x;
    y = coords.y;
  }

  const button = params.button ?? "left";

  // When newTab is requested, add Meta (macOS) or Ctrl (other platforms) modifier
  let effectiveModifiers = params.modifiers ? [...params.modifiers] : [];
  if (params.newTab) {
    const isMac = typeof process !== "undefined" && process.platform === "darwin";
    const newTabModifier = isMac ? "Meta" : "Control";
    if (!effectiveModifiers.includes(newTabModifier)) {
      effectiveModifiers.push(newTabModifier);
    }
  }
  const modifiers = computeModifiers(effectiveModifiers);

  // Perform click sequence
  if (params.doubleClick) {
    await performDoubleClick(cdp, x, y, button, modifiers);
  } else {
    await performClick(cdp, x, y, button, modifiers);
  }

  return { success: true };
}

/**
 * Dispatches a single click: mouseMoved -> mousePressed -> delay -> mouseReleased.
 */
async function performClick(
  cdp: CDPConnection,
  x: number,
  y: number,
  button: string,
  modifiers: number,
  clickCount: number = 1,
): Promise<void> {
  // 1. mouseMoved
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    modifiers,
  } as unknown as Record<string, unknown>);

  // 2. mousePressed
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount,
    modifiers,
  } as unknown as Record<string, unknown>);

  // 3. 50ms delay
  await delay(50);

  // 4. mouseReleased
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount,
    modifiers,
  } as unknown as Record<string, unknown>);
}

/**
 * Dispatches a double click: single click (clickCount 1) + second click (clickCount 2).
 */
async function performDoubleClick(
  cdp: CDPConnection,
  x: number,
  y: number,
  button: string,
  modifiers: number,
): Promise<void> {
  // First click
  await performClick(cdp, x, y, button, modifiers, 1);

  // Second click (double-click)
  await performClick(cdp, x, y, button, modifiers, 2);
}
