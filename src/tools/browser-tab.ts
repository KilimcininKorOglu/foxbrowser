/**
 * browser_tab_new / browser_window_new — Create new browser tabs/windows via CDP.
 *
 * Uses Target.createTarget to open new tabs or windows, and
 * Target.activateTarget to bring them to focus.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TabNewParams {
  /** URL to open in the new tab. Defaults to "about:blank". */
  url?: string;
}

export interface TabNewResult {
  /** The target ID of the newly created tab. */
  targetId: string;
}

export interface WindowNewParams {
  /** URL to open in the new window. Defaults to "about:blank". */
  url?: string;
}

export interface WindowNewResult {
  /** The target ID of the newly created window target. */
  targetId: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Creates a new browser tab and activates it.
 *
 * @param cdp - CDP connection
 * @param params - URL to navigate to (defaults to about:blank)
 * @returns The target ID of the new tab
 */
export async function browserTabNew(
  cdp: CDPConnection,
  params: TabNewParams,
): Promise<TabNewResult> {
  const url = params.url ?? "about:blank";

  const createResult = (await cdp.send("Target.createTarget", {
    url,
  })) as { targetId: string };

  await cdp.send("Target.activateTarget", {
    targetId: createResult.targetId,
  });

  return { targetId: createResult.targetId };
}

/**
 * Creates a new browser window and activates it.
 *
 * @param cdp - CDP connection
 * @param params - URL to navigate to (defaults to about:blank)
 * @returns The target ID of the new window target
 */
export async function browserWindowNew(
  cdp: CDPConnection,
  params: WindowNewParams,
): Promise<WindowNewResult> {
  const url = params.url ?? "about:blank";

  const createResult = (await cdp.send("Target.createTarget", {
    url,
    newWindow: true,
  })) as { targetId: string };

  await cdp.send("Target.activateTarget", {
    targetId: createResult.targetId,
  });

  return { targetId: createResult.targetId };
}
