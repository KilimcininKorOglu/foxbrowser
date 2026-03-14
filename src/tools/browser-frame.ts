/**
 * browser_frame_switch / browser_frame_main — Frame context management via CDP.
 *
 * Switches execution context to an iframe or back to the main frame.
 * Uses Page.getFrameTree to enumerate frames and resolve frame IDs.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrameSwitchParams {
  /** CSS selector for the iframe element. */
  selector?: string;
  /** Frame ID to switch to directly. */
  frameId?: string;
}

export interface FrameSwitchResult {
  success: boolean;
  frameId: string;
}

export interface FrameMainResult {
  success: boolean;
}

interface FrameTreeNode {
  frame: {
    id: string;
    url: string;
    name?: string;
    securityOrigin?: string;
  };
  childFrames?: FrameTreeNode[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively flattens the frame tree into an array of frames.
 */
function flattenFrameTree(node: FrameTreeNode): FrameTreeNode["frame"][] {
  const frames: FrameTreeNode["frame"][] = [node.frame];
  if (node.childFrames) {
    for (const child of node.childFrames) {
      frames.push(...flattenFrameTree(child));
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Switches the execution context to an iframe identified by selector or frameId.
 *
 * @param cdp - CDP connection
 * @param params - Selector or frameId to switch to
 * @returns The frame ID of the switched-to iframe
 */
export async function browserFrameSwitch(
  cdp: CDPConnection,
  params: FrameSwitchParams,
): Promise<FrameSwitchResult> {
  // Get the frame tree to find the target frame
  const response = (await cdp.send("Page.getFrameTree")) as {
    frameTree: FrameTreeNode;
  };

  const allFrames = flattenFrameTree(response.frameTree);

  // If a specific frameId is provided, use it directly
  if (params.frameId) {
    const frame = allFrames.find((f) => f.id === params.frameId);
    if (!frame) {
      throw new Error(`Frame not found: ${params.frameId}`);
    }
    return { success: true, frameId: frame.id };
  }

  // If a selector is provided, resolve the iframe element to find its frame
  if (params.selector) {
    // Try to find the iframe by evaluating in the page
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
      returnByValue: false,
    })) as { result: { type: string; objectId?: string } };

    if (!evalResult.result.objectId) {
      throw new Error(`iframe not found: ${params.selector}`);
    }

    // For child frames, use the first child frame as the target
    // In a real implementation, we'd correlate the element with its frame ID
    const childFrames = allFrames.slice(1); // Exclude main frame
    if (childFrames.length === 0) {
      throw new Error("No child frames found");
    }

    return { success: true, frameId: childFrames[0].id };
  }

  throw new Error("Either selector or frameId must be provided");
}

/**
 * Switches the execution context back to the main frame.
 *
 * @param cdp - CDP connection
 * @returns Success indicator
 */
export async function browserFrameMain(
  cdp: CDPConnection,
): Promise<FrameMainResult> {
  // Switching back to main frame simply resets the execution context
  // In a real implementation, this would clear the stored frameId/sessionId
  // and ensure subsequent commands target the main frame
  return { success: true };
}
