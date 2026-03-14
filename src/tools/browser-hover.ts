/**
 * browser_hover tool — hovers over an element by ref or CSS selector.
 *
 * Element resolution follows the same pattern as browser_click:
 *   1. If `ref` provided (@eN) -> extract backendNodeId -> DOM.resolveNode
 *   2. If `selector` provided -> DOM.getDocument -> DOM.querySelector -> nodeId
 *   3. DOM.scrollIntoViewIfNeeded -> DOM.getBoxModel -> center of content quad
 *
 * Hover dispatches a single Input.dispatchMouseEvent of type "mouseMoved"
 * to the center of the element. This triggers mouseover/mouseenter events
 * in the browser.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoverParams {
  /** @eN ref from accessibility snapshot */
  ref?: string;
  /** CSS selector */
  selector?: string;
  /** Human-readable element description */
  element?: string;
}

export interface HoverResult {
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
 * Resolves an element to coordinates by ref or selector.
 * Returns the center (x, y) of the element's content box.
 */
async function resolveElementCoordinates(
  cdp: CDPConnection,
  params: HoverParams,
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

    // Resolve to validate the node exists
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
    throw new Error("Either ref or selector must be provided");
  }

  // Scroll element into view
  const scrollParams: Record<string, unknown> = {};
  if (backendNodeId !== undefined) {
    scrollParams.backendNodeId = backendNodeId;
  } else if (nodeId !== undefined) {
    scrollParams.nodeId = nodeId;
  }
  await cdp.send("DOM.scrollIntoViewIfNeeded", scrollParams);

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

  return calculateCenter(boxResponse.model.content);
}

// ---------------------------------------------------------------------------
// Main hover implementation
// ---------------------------------------------------------------------------

/**
 * Hovers over an element identified by ref or CSS selector.
 *
 * Dispatches a single mouseMoved event to the element's center,
 * which triggers mouseover/mouseenter browser events.
 *
 * @param cdp    - CDP connection with send/on/off methods.
 * @param params - Hover parameters.
 * @returns Result with success status.
 */
export async function browserHover(
  cdp: CDPConnection,
  params: HoverParams,
): Promise<HoverResult> {
  const { x, y } = await resolveElementCoordinates(cdp, params);

  // Dispatch mouseMoved to trigger hover
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  } as unknown as Record<string, unknown>);

  return { success: true };
}
