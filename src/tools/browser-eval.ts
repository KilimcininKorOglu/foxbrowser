/**
 * browser_eval tool — evaluates JavaScript expressions in the browser via BiDi.
 *
 * Supports:
 *  - Simple expression evaluation (script.evaluate)
 *  - Element-scoped evaluation via @eN refs (script.callFunction)
 *  - Async expressions with awaitPromise
 *  - Error handling (ReferenceError, TypeError, etc.)
 *  - DOM node serialization to string description
 *  - Primitive type handling (null, undefined, boolean)
 *  - Multi-line expressions (stdin mode)
 *  - Base64-encoded expressions
 *
 * @module browser-eval
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalParams {
  /** JavaScript expression to evaluate. */
  expression: string;
  /** @eN ref for element-scoped evaluation via callFunctionOn. */
  ref?: string;
  /** Whether the expression is multi-line (stdin mode). */
  stdin?: boolean;
  /** Whether the expression is base64-encoded. */
  base64?: boolean;
}

interface EvalResult {
  /** The evaluation result value. */
  result?: unknown;
  /** Error message if evaluation failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// BiDi result parsing
// ---------------------------------------------------------------------------

interface BiDiRemoteValue {
  type: string;
  value?: unknown;
  sharedId?: string;
  handle?: string;
}

interface BiDiExceptionDetails {
  text: string;
  columnNumber?: number;
  lineNumber?: number;
  stackTrace?: { callFrames: unknown[] };
}

/**
 * Parse a BiDi RemoteValue into a JavaScript value.
 */
function parseRemoteValue(obj: BiDiRemoteValue): unknown {
  if (obj.type === "undefined") {
    return undefined;
  }

  if (obj.type === "null") {
    return null;
  }

  if (obj.type === "node") {
    return `[Node sharedId=${obj.sharedId}]`;
  }

  if (obj.value !== undefined) {
    return obj.value;
  }

  return undefined;
}

/**
 * Extract error message from BiDi exception details.
 */
function formatException(details: BiDiExceptionDetails): string {
  return details.text;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate a JavaScript expression in the browser context.
 *
 * Without a ref, uses `script.evaluate` for global scope evaluation.
 * With a ref (@eN), uses `script.callFunction` for element-scoped evaluation.
 */
export async function browserEval(
  bidi: BiDiConnection,
  params: EvalParams,
): Promise<EvalResult> {
  let expression = params.expression;

  if (params.base64) {
    expression = atob(expression);
  }

  if (params.ref) {
    return evalWithRef(bidi, expression, params.ref);
  }

  return evalGlobal(bidi, expression);
}

async function evalGlobal(
  bidi: BiDiConnection,
  expression: string,
): Promise<EvalResult> {
  try {
    const response = (await bidi.send("script.evaluate", {
      expression,
      awaitPromise: true,
      resultOwnership: "root",
      serializationOptions: { maxDomDepth: 0 },
    })) as {
      type?: string;
      result?: BiDiRemoteValue;
      exceptionDetails?: BiDiExceptionDetails;
    };

    if (response.type === "exception" || response.exceptionDetails) {
      return {
        error: formatException(response.exceptionDetails ?? { text: "Unknown error" }),
      };
    }

    const value = response.result ? parseRemoteValue(response.result) : undefined;
    return { result: value };
  } catch (e: unknown) {
    return { error: (e as Error).message };
  }
}

async function evalWithRef(
  bidi: BiDiConnection,
  functionDeclaration: string,
  ref: string,
): Promise<EvalResult> {
  const match = /^@?e(\d+)$/.exec(ref);
  if (!match) {
    return { error: `Invalid ref format: ${ref}` };
  }

  const backendNodeId = match[1];

  try {
    // Resolve element by walking the DOM tree
    const resolveResponse = (await bidi.send("script.callFunction", {
      functionDeclaration: `(id) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let count = 0;
        let node = walker.currentNode;
        const targetId = parseInt(id, 10);
        while (node) {
          count++;
          if (count === targetId) return node;
          node = walker.nextNode();
          if (!node) break;
        }
        return null;
      }`,
      arguments: [{ type: "string", value: backendNodeId }],
      awaitPromise: false,
      resultOwnership: "root",
    })) as { result?: BiDiRemoteValue };

    if (!resolveResponse.result || resolveResponse.result.type === "null") {
      return { error: `Element not found for ref: ${ref}` };
    }

    const elementArg = {
      type: "node" as const,
      sharedId: resolveResponse.result.sharedId,
    };

    const response = (await bidi.send("script.callFunction", {
      functionDeclaration,
      arguments: [elementArg],
      awaitPromise: true,
      resultOwnership: "root",
      serializationOptions: { maxDomDepth: 0 },
    })) as {
      type?: string;
      result?: BiDiRemoteValue;
      exceptionDetails?: BiDiExceptionDetails;
    };

    if (response.type === "exception" || response.exceptionDetails) {
      return {
        error: formatException(response.exceptionDetails ?? { text: "Unknown error" }),
      };
    }

    const value = response.result ? parseRemoteValue(response.result) : undefined;
    return { result: value };
  } catch (e: unknown) {
    return { error: (e as Error).message };
  }
}
