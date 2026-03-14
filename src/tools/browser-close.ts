/**
 * browser_close tool — closes browser tabs/targets via CDP.
 *
 * Supports:
 *  - Close all page targets (closeAll)
 *  - Close a specific target by targetId
 *  - Close the current active tab (default)
 *
 * Returns the count of closed targets.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloseParams {
  /** Specific target ID to close. */
  targetId?: string;
  /** Whether to force close (skip beforeunload). */
  force?: boolean;
  /** Close all page targets. */
  closeAll?: boolean;
}

export interface CloseResult {
  success: boolean;
  closedTargets: number;
}

// ---------------------------------------------------------------------------
// Types for CDP responses
// ---------------------------------------------------------------------------

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
}

// ---------------------------------------------------------------------------
// Main implementation
// ---------------------------------------------------------------------------

/**
 * Closes browser tabs/targets.
 *
 * - closeAll: closes all page-type targets
 * - targetId: closes that specific target
 * - default: closes the current active tab (attached page target, or first page)
 *
 * @param cdp    - CDP connection with send/on/off methods.
 * @param params - Close parameters.
 * @returns Result with success status and count of closed targets.
 */
export async function browserClose(
  cdp: CDPConnection,
  params: CloseParams,
): Promise<CloseResult> {
  let closedCount = 0;

  if (params.closeAll) {
    // Close all page targets
    const targetsResponse = (await cdp.send("Target.getTargets")) as {
      targetInfos: TargetInfo[];
    };

    const pageTargets = targetsResponse.targetInfos.filter(
      (t) => t.type === "page",
    );

    for (const target of pageTargets) {
      try {
        await cdp.send("Target.closeTarget", {
          targetId: target.targetId,
        } as unknown as Record<string, unknown>);
        closedCount++;
      } catch {
        // Target may already be closed — ignore
      }
    }
  } else if (params.targetId) {
    // Close a specific target
    await cdp.send("Target.closeTarget", {
      targetId: params.targetId,
    } as unknown as Record<string, unknown>);
    closedCount = 1;
  } else {
    // Close the current active tab
    const targetsResponse = (await cdp.send("Target.getTargets")) as {
      targetInfos: TargetInfo[];
    };

    const pageTargets = targetsResponse.targetInfos.filter(
      (t) => t.type === "page",
    );

    if (pageTargets.length === 0) {
      throw new Error("No page targets found to close");
    }

    // Find the attached (active) page target, or fall back to the first page
    const activeTarget =
      pageTargets.find((t) => t.attached) ?? pageTargets[0];

    await cdp.send("Target.closeTarget", {
      targetId: activeTarget.targetId,
    } as unknown as Record<string, unknown>);
    closedCount = 1;
  }

  return {
    success: true,
    closedTargets: closedCount,
  };
}
