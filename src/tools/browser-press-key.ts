/**
 * browser_press_key tool — dispatches a single key press (keyDown + keyUp)
 * via CDP Input.dispatchKeyEvent. Supports key combinations like "Control+c".
 *
 * For modifier combos: sends keyDown for each modifier, then keyDown+keyUp
 * for the main key, then keyUp for modifiers in reverse order.
 * For regular characters without modifiers, also sends a "char" event.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Key → virtual key code mapping
// ---------------------------------------------------------------------------
const KEY_CODE_MAP: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Insert: 45,
  Space: 32,
  " ": 32,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
  Control: 17,
  Shift: 16,
  Alt: 18,
  Meta: 91,
};

// Key → code mapping (DOM KeyboardEvent.code)
const KEY_TO_CODE: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowLeft: "ArrowLeft",
  ArrowUp: "ArrowUp",
  ArrowRight: "ArrowRight",
  ArrowDown: "ArrowDown",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Space: "Space",
  " ": "Space",
  Control: "ControlLeft",
  Shift: "ShiftLeft",
  Alt: "AltLeft",
  Meta: "MetaLeft",
};

// Special key → text mapping for CDP key events
const KEY_TEXT_MAP: Record<string, string> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "",
  Space: " ",
  Backspace: "\b",
};

// Modifier keys → bitfield values
const MODIFIER_BITS: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
};

export interface PressKeyParams {
  key: string;
}

export interface PressKeyResult {
  success: boolean;
}

/**
 * Resolves a key name to its virtual key code.
 */
function getKeyCode(key: string): number {
  if (KEY_CODE_MAP[key] !== undefined) {
    return KEY_CODE_MAP[key];
  }
  // Single character: use its char code (uppercase)
  if (key.length === 1) {
    return key.toUpperCase().charCodeAt(0);
  }
  return 0;
}

/**
 * Resolves a key name to its DOM code property.
 */
function getCode(key: string): string {
  if (KEY_TO_CODE[key] !== undefined) {
    return KEY_TO_CODE[key];
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= "A" && upper <= "Z") {
      return `Key${upper}`;
    }
    if (upper >= "0" && upper <= "9") {
      return `Digit${upper}`;
    }
  }
  return key;
}

/**
 * Resolves the text value for a key press.
 * Returns the text to send with "char" and "keyDown" events.
 */
function getKeyText(key: string): string | undefined {
  // Check special key text mappings first
  if (KEY_TEXT_MAP[key] !== undefined) {
    return KEY_TEXT_MAP[key] || undefined;
  }
  // Single printable character
  if (key.length === 1) {
    return key;
  }
  return undefined;
}

/**
 * Dispatches a single key press or key combination via CDP.
 *
 * Key combinations are specified as "Modifier+key" (e.g. "Control+c", "Shift+Tab").
 * Multiple modifiers can be combined: "Control+Shift+a".
 *
 * For modifier combos: sends keyDown for each modifier, then keyDown+keyUp
 * for the main key, then keyUp for modifiers in reverse order.
 * For regular characters without modifiers, also sends a "char" event with the text.
 */
export async function browserPressKey(
  cdp: CDPConnection,
  params: PressKeyParams,
): Promise<PressKeyResult> {
  const parts = params.key.split("+");
  const mainKey = parts[parts.length - 1];
  const modifierKeys = parts.slice(0, -1);

  // Calculate combined modifier bitfield for the main key event
  let modifiers = 0;
  for (const mod of modifierKeys) {
    if (MODIFIER_BITS[mod] !== undefined) {
      modifiers |= MODIFIER_BITS[mod];
    }
  }

  // Press modifier keys down first
  for (const mod of modifierKeys) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: mod,
      code: getCode(mod),
      windowsVirtualKeyCode: getKeyCode(mod),
      modifiers,
    } as unknown as Record<string, unknown>);
  }

  // Resolve text for the main key
  const text = getKeyText(mainKey);

  // Dispatch main key down
  const keyDownParams: Record<string, unknown> = {
    type: "keyDown",
    key: mainKey,
    code: getCode(mainKey),
    windowsVirtualKeyCode: getKeyCode(mainKey),
    modifiers,
  };

  if (text !== undefined) {
    keyDownParams.text = text;
  }

  await cdp.send("Input.dispatchKeyEvent", keyDownParams);

  // For characters that produce text (without modifiers), send a "char" event
  if (text && modifierKeys.length === 0) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "char",
      key: mainKey,
      code: getCode(mainKey),
      windowsVirtualKeyCode: getKeyCode(mainKey),
      modifiers,
      text,
    } as unknown as Record<string, unknown>);
  }

  // Dispatch main key up
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mainKey,
    code: getCode(mainKey),
    windowsVirtualKeyCode: getKeyCode(mainKey),
    modifiers,
  } as unknown as Record<string, unknown>);

  // Release modifier keys in reverse order
  for (let i = modifierKeys.length - 1; i >= 0; i--) {
    const mod = modifierKeys[i];
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: mod,
      code: getCode(mod),
      windowsVirtualKeyCode: getKeyCode(mod),
      modifiers: 0,
    } as unknown as Record<string, unknown>);
  }

  return { success: true };
}
