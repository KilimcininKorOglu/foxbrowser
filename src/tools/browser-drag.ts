/**
 * browser_drag tool — drags from a source to a target using synthesized mouse events.
 *
 * Element resolution follows the same pattern as browser_click:
 *   1. If `startRef`/`endRef` provided (@eN) -> extract backendNodeId -> DOM.resolveNode
 *   2. If `startX`/`startY` and `endX`/`endY` provided -> use directly
 *   3. DOM.scrollIntoViewIfNeeded -> DOM.getBoxModel -> center of content quad
 *
 * Drag sequence (CDP Input.dispatchMouseEvent):
 *   1. mouseMoved to start position
 *   2. mousePressed at start position (button: "left", clickCount: 1)
 *   3. One or more intermediate mouseMoved events toward the target
 *   4. mouseMoved to end position
 *   5. mouseReleased at end position (button: "left", clickCount: 1)
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DragParams {
  /** @eN ref for the source element */
  startRef?: string;
  /** Human-readable description of the source element */
  startElement?: string;
  /** @eN ref for the target element */
  endRef?: string;
  /** Human-readable description of the target element */
  endElement?: string;
  /** Direct start x coordinate */
  startX?: number;
  /** Direct start y coordinate */
  startY?: number;
  /** Direct end x coordinate */
  endX?: number;
  /** Direct end y coordinate */
  endY?: number;
}

export interface DragResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Ref pattern
// ---------------------------------------------------------------------------
const REF_PATTERN = /^@?e(\d+)$/;

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
 * Resolves an element ref to coordinates.
 */
async function resolveRefCoordinates(
  cdp: CDPConnection,
  ref: string,
): Promise<{ x: number; y: number }> {
  const match = REF_PATTERN.exec(ref);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  const backendNodeId = parseInt(match[1], 10);
  const opts = { timeout: 5000 };

  // Resolve to validate the node exists
  await cdp.send("DOM.resolveNode", {
    backendNodeId,
  } as unknown as Record<string, unknown>, opts);

  // Scroll element into view
  try {
    await cdp.send("DOM.scrollIntoViewIfNeeded", {
      backendNodeId,
    } as unknown as Record<string, unknown>, opts);
  } catch {
    // scrollIntoView can fail for some elements, not critical
  }

  // Get box model for center coordinates
  const boxResponse = (await cdp.send("DOM.getBoxModel", {
    backendNodeId,
  } as unknown as Record<string, unknown>, opts)) as {
    model: {
      content: number[];
      width: number;
      height: number;
    };
  };

  return calculateCenter(boxResponse.model.content);
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates intermediate points along a line from start to end.
 * Returns at least one intermediate point (midpoint).
 */
function interpolatePoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number = 8,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round(startX + (endX - startX) * t),
      y: Math.round(startY + (endY - startY) * t),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Main drag implementation
// ---------------------------------------------------------------------------

/**
 * Drags from a source element/coordinates to a target element/coordinates.
 *
 * The drag is performed using a sequence of mouse events:
 *   mouseMoved(start) -> mousePressed(start) -> mouseMoved(intermediate)... ->
 *   mouseMoved(end) -> mouseReleased(end)
 *
 * @param cdp    - CDP connection with send/on/off methods.
 * @param params - Drag parameters.
 * @returns Result with success status.
 */
export async function browserDrag(
  cdp: CDPConnection,
  params: DragParams,
): Promise<DragResult> {
  // Resolve start coordinates
  let startX: number;
  let startY: number;

  if (params.startX !== undefined && params.startY !== undefined) {
    startX = params.startX;
    startY = params.startY;
  } else if (params.startRef) {
    const coords = await resolveRefCoordinates(cdp, params.startRef);
    startX = coords.x;
    startY = coords.y;
  } else {
    throw new Error("Either startRef or startX/startY must be provided");
  }

  // Resolve end coordinates
  let endX: number;
  let endY: number;

  if (params.endX !== undefined && params.endY !== undefined) {
    endX = params.endX;
    endY = params.endY;
  } else if (params.endRef) {
    const coords = await resolveRefCoordinates(cdp, params.endRef);
    endX = coords.x;
    endY = coords.y;
  } else {
    throw new Error("Either endRef or endX/endY must be provided");
  }

  const mouseOpts = { timeout: 3000 };

  // 1. mouseMoved to start position
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: startX,
    y: startY,
  } as unknown as Record<string, unknown>, mouseOpts);

  // 2. mousePressed at start position
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y: startY,
    button: "left",
    clickCount: 1,
  } as unknown as Record<string, unknown>, mouseOpts);

  // 3. Intermediate mouseMoved events (4 steps)
  const intermediatePoints = interpolatePoints(startX, startY, endX, endY, 4);
  for (const point of intermediatePoints) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    } as unknown as Record<string, unknown>, mouseOpts);
    await delay(10);
  }

  // 4. mouseMoved to end position
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: endX,
    y: endY,
  } as unknown as Record<string, unknown>, mouseOpts);

  // 5. mouseReleased at end position
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: endX,
    y: endY,
    button: "left",
    clickCount: 1,
  } as unknown as Record<string, unknown>, mouseOpts);

  return { success: true };
}
