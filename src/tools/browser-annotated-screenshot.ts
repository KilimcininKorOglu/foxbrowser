/**
 * browser_annotated_screenshot tool — captures an annotated screenshot.
 *
 * Delegates to browserScreenshot with `annotate: true` to produce a
 * screenshot with interactive elements labeled with ref annotations.
 *
 * @module browser-annotated-screenshot
 */
import type { CDPConnection } from "../cdp/connection";
import { browserScreenshot } from "./browser-screenshot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnotatedScreenshotParams {
  /** CSS selector to screenshot a specific element. */
  selector?: string;
}

export interface AnnotatedScreenshotResult {
  /** Base64-encoded screenshot data. */
  base64: string;
  /** Annotations for interactive elements. */
  annotations: Array<{
    ref: string;
    label: string;
    role?: string;
    name?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Capture an annotated screenshot of the browser page.
 *
 * @param cdp - CDP connection.
 * @param params - Optional selector to scope the screenshot.
 * @returns Base64-encoded screenshot and annotation metadata.
 */
export async function browserAnnotatedScreenshot(
  cdp: CDPConnection,
  params: AnnotatedScreenshotParams,
): Promise<AnnotatedScreenshotResult> {
  const result = await browserScreenshot(cdp, {
    annotate: true,
    selector: params.selector,
  });

  return {
    base64: result.base64,
    annotations: result.annotations ?? [],
  };
}
