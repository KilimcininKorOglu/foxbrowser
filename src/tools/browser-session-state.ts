/**
 * browser_save_state / browser_load_state — persist and restore browser session state.
 *
 * Saves cookies, localStorage, and sessionStorage to a named JSON file
 * under ~/.browsirai/states/. Loading restores all three and navigates
 * to the saved (or custom) URL.
 */
import type { CDPConnection } from "../cdp/connection";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SaveStateParams {
  name: string;
}

export interface SaveStateResult {
  name: string;
  path: string;
  cookies: number;
  localStorage: number;
  sessionStorage: number;
}

export interface LoadStateParams {
  name: string;
  url?: string;
}

export interface LoadStateResult {
  name: string;
  cookies: number;
  localStorage: number;
  sessionStorage: number;
}

interface StateFile {
  version: 1;
  savedAt: string;
  url: string;
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatesDir(): string {
  return join(homedir(), ".browsirai", "states");
}

function ensureStatesDir(): string {
  const dir = getStatesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getStatePath(name: string): string {
  return join(getStatesDir(), `${name}.json`);
}

// ---------------------------------------------------------------------------
// browser_save_state
// ---------------------------------------------------------------------------

export async function browserSaveState(
  cdp: CDPConnection,
  params: SaveStateParams,
): Promise<SaveStateResult> {
  const { name } = params;

  // 1. Get cookies
  const cookieResponse = (await cdp.send("Network.getAllCookies")) as {
    cookies: unknown[];
  };
  const cookies = cookieResponse.cookies ?? [];

  // 2. Get current URL
  const urlResponse = (await cdp.send("Runtime.evaluate", {
    expression: "window.location.href",
    returnByValue: true,
  })) as { result: { value?: string } };
  const url = urlResponse.result.value ?? "";

  // 3. Get localStorage
  const localStorageResponse = (await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify(Object.entries(localStorage))",
    returnByValue: true,
  })) as { result: { value?: string } };
  const localStorageEntries: Array<[string, string]> = JSON.parse(
    localStorageResponse.result.value ?? "[]",
  );
  const localStorage: Record<string, string> = Object.fromEntries(localStorageEntries);

  // 4. Get sessionStorage
  const sessionStorageResponse = (await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify(Object.entries(sessionStorage))",
    returnByValue: true,
  })) as { result: { value?: string } };
  const sessionStorageEntries: Array<[string, string]> = JSON.parse(
    sessionStorageResponse.result.value ?? "[]",
  );
  const sessionStorage: Record<string, string> = Object.fromEntries(sessionStorageEntries);

  // 5. Write state file
  const dir = ensureStatesDir();
  const filePath = join(dir, `${name}.json`);

  const stateFile: StateFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    url,
    cookies,
    localStorage,
    sessionStorage,
  };

  writeFileSync(filePath, JSON.stringify(stateFile, null, 2), "utf-8");

  return {
    name,
    path: filePath,
    cookies: cookies.length,
    localStorage: localStorageEntries.length,
    sessionStorage: sessionStorageEntries.length,
  };
}

// ---------------------------------------------------------------------------
// browser_load_state
// ---------------------------------------------------------------------------

export async function browserLoadState(
  cdp: CDPConnection,
  params: LoadStateParams,
): Promise<LoadStateResult> {
  const { name, url: customUrl } = params;

  // 1. Read state file
  const filePath = getStatePath(name);
  if (!existsSync(filePath)) {
    throw new Error(`State file not found: ${filePath}`);
  }

  const stateFile: StateFile = JSON.parse(readFileSync(filePath, "utf-8"));

  // 2. Navigate to URL (custom or saved)
  const targetUrl = customUrl ?? stateFile.url;
  if (targetUrl) {
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: targetUrl });
  }

  // 3. Set cookies
  if (stateFile.cookies.length > 0) {
    await cdp.send("Network.setCookies", { cookies: stateFile.cookies });
  }

  // 4. Set localStorage
  const localEntries = Object.entries(stateFile.localStorage);
  if (localEntries.length > 0) {
    const localScript = localEntries
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join(";");
    await cdp.send("Runtime.evaluate", {
      expression: localScript,
      returnByValue: true,
    });
  }

  // 5. Set sessionStorage
  const sessionEntries = Object.entries(stateFile.sessionStorage);
  if (sessionEntries.length > 0) {
    const sessionScript = sessionEntries
      .map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join(";");
    await cdp.send("Runtime.evaluate", {
      expression: sessionScript,
      returnByValue: true,
    });
  }

  // 6. Reload page to apply state
  await cdp.send("Page.reload");

  return {
    name,
    cookies: stateFile.cookies.length,
    localStorage: localEntries.length,
    sessionStorage: sessionEntries.length,
  };
}
