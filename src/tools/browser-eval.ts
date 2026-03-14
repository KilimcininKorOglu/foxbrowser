/**
 * browser_eval tool — evaluates JavaScript expressions in the browser via CDP.
 *
 * Supports:
 *  - Simple expression evaluation (Runtime.evaluate)
 *  - Element-scoped evaluation via @eN refs (Runtime.callFunctionOn)
 *  - Async expressions with awaitPromise
 *  - Error handling (ReferenceError, TypeError, etc.)
 *  - DOM node serialization to string description
 *  - Primitive type handling (null, undefined, boolean)
 *  - Multi-line expressions (stdin mode)
 *  - Base64-encoded expressions
 *
 * @module browser-eval
 */
import type { CDPConnection } from "../cdp/connection";

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
// CDP result parsing
// ---------------------------------------------------------------------------

interface CDPRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  description?: string;
  value?: unknown;
  objectId?: string;
}

interface CDPExceptionDetails {
  exceptionId: number;
  text: string;
  lineNumber: number;
  columnNumber: number;
  exception?: {
    type: string;
    subtype?: string;
    className?: string;
    description?: string;
  };
}

/**
 * Parse a CDP RemoteObject into a JavaScript value.
 *
 * Handles:
 *  - Primitives (string, number, boolean)
 *  - null (subtype "null")
 *  - undefined (type "undefined")
 *  - DOM nodes (subtype "node") → serialized to string description
 *  - Objects → return the value directly
 */
function parseRemoteObject(obj: CDPRemoteObject): unknown {
  // undefined
  if (obj.type === "undefined") {
    return undefined;
  }

  // null
  if (obj.type === "object" && obj.subtype === "null") {
    return null;
  }

  // DOM node
  if (obj.type === "object" && obj.subtype === "node") {
    return obj.description ?? `[${obj.className ?? "Node"}]`;
  }

  // Primitives and objects with value
  if (obj.value !== undefined) {
    return obj.value;
  }

  // Object without value (shouldn't happen with returnByValue: true)
  if (obj.description) {
    return obj.description;
  }

  return undefined;
}

/**
 * Extract error message from CDP exception details.
 */
function formatException(details: CDPExceptionDetails): string {
  if (details.exception?.description) {
    return details.exception.description;
  }

  if (details.exception?.className) {
    return `${details.exception.className}: ${details.text}`;
  }

  return details.text;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate a JavaScript expression in the browser context.
 *
 * Without a ref, uses `Runtime.evaluate` for global scope evaluation.
 * With a ref (@eN), uses `DOM.resolveNode` + `Runtime.callFunctionOn`
 * for element-scoped evaluation.
 *
 * @param cdp - CDP connection.
 * @param params - Expression and optional ref/flags.
 * @returns Evaluation result or error.
 */
export async function browserEval(
  cdp: CDPConnection,
  params: EvalParams,
): Promise<EvalResult> {
  let expression = params.expression;

  // Decode base64-encoded expression
  if (params.base64) {
    expression = atob(expression);
  }

  // Element-scoped evaluation via @eN ref
  if (params.ref) {
    return evalWithRef(cdp, expression, params.ref);
  }

  // Global scope evaluation
  return evalGlobal(cdp, expression);
}

/**
 * Evaluate an expression in the global scope via Runtime.evaluate.
 */
async function evalGlobal(
  cdp: CDPConnection,
  expression: string,
): Promise<EvalResult> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result: CDPRemoteObject;
    exceptionDetails?: CDPExceptionDetails;
  };

  // Check for exceptions
  if (response.exceptionDetails) {
    return {
      error: formatException(response.exceptionDetails),
    };
  }

  const value = parseRemoteObject(response.result);

  return { result: value };
}

/**
 * Evaluate a function on a specific element via Runtime.callFunctionOn.
 *
 * Resolves the @eN ref to a backendNodeId, then resolves to a remote object,
 * and calls the function on it.
 */
async function evalWithRef(
  cdp: CDPConnection,
  functionDeclaration: string,
  ref: string,
): Promise<EvalResult> {
  // Parse the @eN ref
  const match = /^@e(\d+)$/.exec(ref);
  if (!match) {
    return { error: `Invalid ref format: ${ref}` };
  }

  const backendNodeId = parseInt(match[1], 10);

  // Resolve backendNodeId to a remote object
  const resolved = (await cdp.send("DOM.resolveNode", {
    backendNodeId,
  })) as { object: { objectId: string } };

  const objectId = resolved.object.objectId;

  // Call the function on the element
  const response = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result: CDPRemoteObject;
    exceptionDetails?: CDPExceptionDetails;
  };

  // Check for exceptions
  if (response.exceptionDetails) {
    return {
      error: formatException(response.exceptionDetails),
    };
  }

  const value = parseRemoteObject(response.result);

  return { result: value };
}
