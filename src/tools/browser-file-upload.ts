/**
 * browser_file_upload tool — sets files on a file input element via BiDi.
 *
 * Uses input.setFiles BiDi command, with fallback to dispatching change event.
 */
import type { BiDiConnection } from "../bidi/connection.js";

export interface FileUploadParams {
  ref: string;
  paths: string[];
}

export interface FileUploadResult {
  success: boolean;
  filesCount: number;
  error?: string;
}

const REF_PATTERN = /^@?e(\d+)$/;

export async function browserFileUpload(
  bidi: BiDiConnection,
  params: FileUploadParams,
): Promise<FileUploadResult> {
  const match = REF_PATTERN.exec(params.ref);
  if (!match) {
    return {
      success: false,
      filesCount: 0,
      error: `Invalid ref format: ${params.ref}. Expected @eN pattern (e.g. @e5).`,
    };
  }

  const nodeId = match[1];

  // Resolve element to get sharedId
  const resolveResponse = (await bidi.send("script.callFunction", {
    functionDeclaration: `(id) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0; let node = walker.currentNode;
      while (node) { count++; if (count === parseInt(id)) return node; node = walker.nextNode(); if(!node) break; }
      return null;
    }`,
    arguments: [{ type: "string", value: nodeId }],
    awaitPromise: false,
    resultOwnership: "root",
  })) as { result?: { type: string; sharedId?: string } };

  if (!resolveResponse.result || resolveResponse.result.type === "null") {
    return {
      success: false,
      filesCount: 0,
      error: `Element not found for ref: ${params.ref}`,
    };
  }

  const sharedId = resolveResponse.result.sharedId;

  // Try input.setFiles (BiDi spec)
  try {
    await bidi.send("input.setFiles", {
      element: { sharedId },
      files: params.paths,
    });
  } catch {
    // Fallback: dispatch change event
    await bidi.send("script.callFunction", {
      functionDeclaration: `(el) => el.dispatchEvent(new Event('change', { bubbles: true }))`,
      arguments: [{ type: "node", sharedId }],
      awaitPromise: false,
      resultOwnership: "none",
    });
  }

  return {
    success: true,
    filesCount: params.paths.length,
  };
}
