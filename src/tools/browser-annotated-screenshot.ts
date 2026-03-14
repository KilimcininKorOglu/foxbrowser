/**
 * browser_annotated_screenshot tool — captures an annotated screenshot via BiDi.
 */
import type { BiDiConnection } from "../bidi/connection.js";
import { browserScreenshot } from "./browser-screenshot.js";

export interface AnnotatedScreenshotParams {
  selector?: string;
}

export interface AnnotatedScreenshotResult {
  base64: string;
  annotations: Array<{
    ref: string;
    label: string;
    role?: string;
    name?: string;
  }>;
}

export async function browserAnnotatedScreenshot(
  bidi: BiDiConnection,
  params: AnnotatedScreenshotParams,
): Promise<AnnotatedScreenshotResult> {
  const result = await browserScreenshot(bidi, {
    annotate: true,
    selector: params.selector,
  });

  return {
    base64: result.base64,
    annotations: result.annotations ?? [],
  };
}
