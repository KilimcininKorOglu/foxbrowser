/**
 * browser_frames — List all frames in the current page via CDP.
 *
 * Uses Page.getFrameTree to enumerate all frames (main + iframes),
 * including cross-origin detection based on security origins.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrameInfo {
  /** CDP frame ID. */
  id: string;
  /** URL of the frame. */
  url: string;
  /** Optional name of the frame. */
  name?: string;
  /** Security origin of the frame. */
  securityOrigin?: string;
  /** Whether this frame is cross-origin relative to the main frame. */
  crossOrigin: boolean;
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
 * Recursively flattens the frame tree into an array of frame descriptors.
 */
function flattenFrameTree(
  node: FrameTreeNode,
  mainOrigin: string,
): FrameInfo[] {
  const origin = node.frame.securityOrigin ?? extractOrigin(node.frame.url);
  const frames: FrameInfo[] = [
    {
      id: node.frame.id,
      url: node.frame.url,
      name: node.frame.name,
      securityOrigin: node.frame.securityOrigin,
      crossOrigin: origin !== mainOrigin,
    },
  ];

  if (node.childFrames) {
    for (const child of node.childFrames) {
      frames.push(...flattenFrameTree(child, mainOrigin));
    }
  }

  return frames;
}

/**
 * Extracts the origin from a URL string.
 */
function extractOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Exported function
// ---------------------------------------------------------------------------

/**
 * Lists all frames (main frame and iframes) in the current page.
 *
 * Marks cross-origin frames based on security origin comparison with the main frame.
 * For cross-origin frames, Target.attachToTarget should be used to access content.
 *
 * @param cdp - CDP connection
 * @returns Array of frame info objects
 */
export async function listFrames(
  cdp: CDPConnection,
): Promise<FrameInfo[]> {
  const response = (await cdp.send("Page.getFrameTree")) as {
    frameTree: FrameTreeNode;
  };

  const mainOrigin =
    response.frameTree.frame.securityOrigin ??
    extractOrigin(response.frameTree.frame.url);

  return flattenFrameTree(response.frameTree, mainOrigin);
}
