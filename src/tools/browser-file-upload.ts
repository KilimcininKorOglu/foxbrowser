/**
 * browser_file_upload tool — sets files on a file input element via CDP.
 *
 * Resolution:
 *   1. Parse @eN ref to extract backendNodeId
 *   2. DOM.resolveNode(backendNodeId) to get objectId
 *   3. DOM.setFileInputFiles({ files, objectId }) to set the files
 *
 * @module browser-file-upload
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileUploadParams {
  /** @eN ref pointing to a file input element. */
  ref: string;
  /** Array of absolute file paths to upload. */
  paths: string[];
}

export interface FileUploadResult {
  /** Whether the files were set successfully. */
  success: boolean;
  /** Number of files set on the input. */
  filesCount: number;
  /** Error message if the operation failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Ref pattern
// ---------------------------------------------------------------------------
const REF_PATTERN = /^@e(\d+)$/;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Set files on a file input element identified by @eN ref.
 *
 * @param cdp - CDP connection.
 * @param params - File upload parameters.
 * @returns Result with success status and file count.
 */
export async function browserFileUpload(
  cdp: CDPConnection,
  params: FileUploadParams,
): Promise<FileUploadResult> {
  // Parse @eN ref to extract backendNodeId
  const match = REF_PATTERN.exec(params.ref);
  if (!match) {
    return {
      success: false,
      filesCount: 0,
      error: `Invalid ref format: ${params.ref}. Expected @eN pattern (e.g. @e5).`,
    };
  }

  const backendNodeId = parseInt(match[1], 10);

  // Resolve backendNodeId to get objectId
  const resolved = (await cdp.send("DOM.resolveNode", {
    backendNodeId,
  } as unknown as Record<string, unknown>)) as {
    object: { objectId: string };
  };

  const objectId = resolved.object.objectId;

  // Set files on the file input element
  await cdp.send("DOM.setFileInputFiles", {
    files: params.paths,
    objectId,
  } as unknown as Record<string, unknown>);

  return {
    success: true,
    filesCount: params.paths.length,
  };
}
