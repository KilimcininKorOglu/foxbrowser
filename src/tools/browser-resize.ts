/**
 * browser_resize tool — Resizes the browser viewport.
 *
 * Supports:
 *  - Explicit width/height dimensions
 *  - Named presets: "mobile", "tablet", "desktop", "fullhd"
 *  - Custom device scale factor
 *  - Uses Emulation.setDeviceMetricsOverride
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  fullhd: { width: 1920, height: 1080 },
};

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface ResizeParams {
  /** Viewport width in CSS pixels */
  width?: number;
  /** Viewport height in CSS pixels */
  height?: number;
  /** Device scale factor (DPR). Defaults to 0 (use browser default). */
  deviceScaleFactor?: number;
  /** Named preset: "mobile", "tablet", "desktop", "fullhd". */
  preset?: string;
}

export interface ResizeResult {
  success: boolean;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resizes the browser viewport by overriding device metrics.
 *
 * If a preset is given, uses preset dimensions as defaults.
 * Explicit width/height params override preset values.
 * Sets mobile emulation when width < 768.
 */
export async function browserResize(
  cdp: CDPConnection,
  params: ResizeParams,
): Promise<ResizeResult> {
  let width: number;
  let height: number;

  // Handle "reset" preset — clears device metrics override
  if (params.preset?.toLowerCase() === "reset") {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    return { success: true, width: 0, height: 0 };
  }

  // Start with preset dimensions if provided
  if (params.preset) {
    const preset = PRESETS[params.preset.toLowerCase()];
    if (!preset) {
      throw new Error(
        `Unknown preset "${params.preset}". Available: ${Object.keys(PRESETS).join(", ")}, reset`,
      );
    }
    width = preset.width;
    height = preset.height;
  } else {
    // Default to desktop if no preset and no dimensions
    width = params.width ?? 1280;
    height = params.height ?? 720;
  }

  // Explicit width/height override preset values
  if (params.width !== undefined) width = params.width;
  if (params.height !== undefined) height = params.height;

  const deviceScaleFactor = params.deviceScaleFactor ?? 0;
  const mobile = width < 768;

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile,
  });

  return {
    success: true,
    width,
    height,
  };
}
