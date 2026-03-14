/**
 * browser_keyboard tool — low-level keyboard control.
 *
 * Actions:
 *   - "type"       → dispatch keyDown/char/keyUp events per character (no element lookup)
 *   - "inserttext" → call Input.insertText (no key events, no element lookup)
 *   - "keydown"    → dispatch only keyDown (hold without release)
 *   - "keyup"      → dispatch only keyUp (release held key)
 */
import type { CDPConnection } from "../cdp/connection";

export interface KeyboardParams {
  action: "type" | "inserttext" | "keydown" | "keyup";
  text?: string;
  key?: string;
}

export interface KeyboardResult {
  success: boolean;
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
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Meta: 91,
    Space: 32,
  };
  return codes[key] ?? 0;
}

/**
 * Resolves a key name to its DOM KeyboardEvent.code.
 */
function getCode(key: string): string {
  const codeMap: Record<string, string> = {
    Shift: "ShiftLeft",
    Control: "ControlLeft",
    Alt: "AltLeft",
    Meta: "MetaLeft",
  };
  if (codeMap[key]) return codeMap[key];

  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= "A" && upper <= "Z") return `Key${upper}`;
    if (upper >= "0" && upper <= "9") return `Digit${upper}`;
  }
  return key;
}

/**
 * Dispatches a single character via keyDown + char + keyUp events.
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
 * Low-level keyboard control — operates on the currently focused element
 * without performing any DOM element lookup.
 */
export async function browserKeyboard(
  cdp: CDPConnection,
  params: KeyboardParams,
): Promise<KeyboardResult> {
  switch (params.action) {
    case "type": {
      const text = params.text ?? "";
      for (const char of text) {
        await dispatchCharEvents(cdp, char);
      }
      break;
    }

    case "inserttext": {
      const text = params.text ?? "";
      await cdp.send("Input.insertText", {
        text,
      } as unknown as Record<string, unknown>);
      break;
    }

    case "keydown": {
      const key = params.key ?? "";
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: getCode(key),
        windowsVirtualKeyCode: getKeyCode(key),
      } as unknown as Record<string, unknown>);
      break;
    }

    case "keyup": {
      const key = params.key ?? "";
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: getCode(key),
        windowsVirtualKeyCode: getKeyCode(key),
      } as unknown as Record<string, unknown>);
      break;
    }

    default:
      throw new Error(`Unknown keyboard action: ${params.action as string}`);
  }

  return { success: true };
}
