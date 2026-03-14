/**
 * browser_type tool — types text into a focused element or an element
 * identified by ref/selector.
 *
 * Fast mode (default): uses Input.insertText for a single CDP call.
 * Slow mode (slowly=true): dispatches individual keyDown/keyUp events per char.
 * submit=true: presses Enter after typing.
 */
import type { CDPConnection } from "../cdp/connection";

export interface TypeParams {
  text: string;
  ref?: string;
  selector?: string;
  slowly?: boolean;
  submit?: boolean;
}

export interface TypeResult {
  success: boolean;
}

/**
 * Extracts the numeric backendNodeId from an "@eN" ref string.
 */
function parseRef(ref: string): number {
  const match = ref.match(/@e(\d+)/);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  return parseInt(match[1], 10);
}

/**
 * Resolves a key name to its virtual key code.
 */
function getKeyCode(key: string): number {
  if (key.length === 1) {
    return key.toUpperCase().charCodeAt(0);
  }
  const codes: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Backspace: 8,
  };
  return codes[key] ?? 0;
}

/**
 * Resolves a key name to its DOM KeyboardEvent.code.
 */
function getCode(key: string): string {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= "A" && upper <= "Z") return `Key${upper}`;
    if (upper >= "0" && upper <= "9") return `Digit${upper}`;
  }
  return key;
}

/**
 * Promise-based delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatches a single character via keyDown, char, and keyUp events.
 */
async function dispatchCharEvents(
  cdp: CDPConnection,
  char: string,
): Promise<void> {
  const keyCode = getKeyCode(char);
  const code = getCode(char);

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: char,
    code,
    windowsVirtualKeyCode: keyCode,
    text: char,
  } as unknown as Record<string, unknown>);

  await cdp.send("Input.dispatchKeyEvent", {
    type: "char",
    key: char,
    code,
    windowsVirtualKeyCode: keyCode,
    text: char,
  } as unknown as Record<string, unknown>);

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: char,
    code,
    windowsVirtualKeyCode: keyCode,
  } as unknown as Record<string, unknown>);
}

/**
 * Types text into the currently focused element or an element by ref.
 */
export async function browserType(
  cdp: CDPConnection,
  params: TypeParams,
): Promise<TypeResult> {
  // Focus the target element if ref is provided
  if (params.ref) {
    const backendNodeId = parseRef(params.ref);
    await cdp.send("DOM.focus", {
      backendNodeId,
    } as unknown as Record<string, unknown>);
  }

  // Focus by selector if provided (no ref)
  if (!params.ref && params.selector) {
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
      returnByValue: false,
    } as unknown as Record<string, unknown>)) as {
      result: { objectId?: string };
    };

    if (evalResult.result.objectId) {
      await cdp.send("Runtime.callFunctionOn", {
        objectId: evalResult.result.objectId,
        functionDeclaration: `function() { this.focus(); }`,
        returnByValue: true,
      } as unknown as Record<string, unknown>);
    }
  }

  if (params.slowly) {
    // Slow mode: dispatch key events for each character with 50ms delay between
    for (let i = 0; i < params.text.length; i++) {
      await dispatchCharEvents(cdp, params.text[i]);
      if (i < params.text.length - 1) {
        await delay(50);
      }
    }
  } else {
    // Fast mode: single Input.insertText call
    await cdp.send("Input.insertText", {
      text: params.text,
    } as unknown as Record<string, unknown>);
  }

  // Submit: press Enter after typing
  if (params.submit) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    } as unknown as Record<string, unknown>);

    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    } as unknown as Record<string, unknown>);
  }

  return { success: true };
}
