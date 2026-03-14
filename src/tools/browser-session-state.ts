/**
 * browser_save_state / browser_load_state — persist and restore browser session state via BiDi.
 *
 * Uses storage.getCookies / storage.setCookie for cookie management,
 * and script.evaluate for localStorage/sessionStorage.
 */
import type { BiDiConnection } from "../bidi/connection.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SaveStateParams { name: string; }
export interface SaveStateResult { name: string; path: string; cookies: number; localStorage: number; sessionStorage: number; }
export interface LoadStateParams { name: string; url?: string; }
export interface LoadStateResult { name: string; cookies: number; localStorage: number; sessionStorage: number; }

interface StateFile {
  version: 1;
  savedAt: string;
  url: string;
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

function getStatesDir(): string { return join(homedir(), ".foxbrowser", "states"); }
function ensureStatesDir(): string {
  const dir = getStatesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function getStatePath(name: string): string { return join(getStatesDir(), `${name}.json`); }

const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
function validateStateName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid state name: "${name}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
  }
}

export async function browserSaveState(
  bidi: BiDiConnection,
  params: SaveStateParams,
): Promise<SaveStateResult> {
  const { name } = params;
  validateStateName(name);

  // Get cookies via BiDi storage module
  let cookies: unknown[] = [];
  try {
    const cookieResponse = (await bidi.send("storage.getCookies", {})) as {
      cookies: unknown[];
    };
    cookies = cookieResponse.cookies ?? [];
  } catch {
    // storage module may not be available, fall back to JS
    const jsResponse = (await bidi.send("script.evaluate", {
      expression: "document.cookie",
      awaitPromise: false,
      resultOwnership: "none",
    })) as { result: { value?: string } };
    if (jsResponse.result?.value) {
      cookies = jsResponse.result.value.split(";").map(c => ({ name: c.split("=")[0]?.trim(), value: c.split("=").slice(1).join("=")?.trim() }));
    }
  }

  const urlResponse = (await bidi.send("script.evaluate", {
    expression: "window.location.href",
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: string } };
  const url = urlResponse.result?.value ?? "";

  const localStorageResponse = (await bidi.send("script.evaluate", {
    expression: "JSON.stringify(Object.entries(localStorage))",
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: string } };
  const localStorageEntries: Array<[string, string]> = JSON.parse(localStorageResponse.result?.value ?? "[]");
  const localStorage: Record<string, string> = Object.fromEntries(localStorageEntries);

  const sessionStorageResponse = (await bidi.send("script.evaluate", {
    expression: "JSON.stringify(Object.entries(sessionStorage))",
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: string } };
  const sessionStorageEntries: Array<[string, string]> = JSON.parse(sessionStorageResponse.result?.value ?? "[]");
  const sessionStorage: Record<string, string> = Object.fromEntries(sessionStorageEntries);

  const dir = ensureStatesDir();
  const filePath = join(dir, `${name}.json`);

  const stateFile: StateFile = { version: 1, savedAt: new Date().toISOString(), url, cookies, localStorage, sessionStorage };
  writeFileSync(filePath, JSON.stringify(stateFile, null, 2), "utf-8");

  return { name, path: filePath, cookies: cookies.length, localStorage: localStorageEntries.length, sessionStorage: sessionStorageEntries.length };
}

export async function browserLoadState(
  bidi: BiDiConnection,
  params: LoadStateParams,
): Promise<LoadStateResult> {
  const { name, url: customUrl } = params;
  validateStateName(name);

  const filePath = getStatePath(name);
  if (!existsSync(filePath)) throw new Error(`State file not found: ${filePath}`);

  const stateFile: StateFile = JSON.parse(readFileSync(filePath, "utf-8"));

  const targetUrl = customUrl ?? stateFile.url;
  if (targetUrl) {
    await bidi.send("browsingContext.navigate", { url: targetUrl, wait: "complete" });
  }

  // Set cookies via BiDi storage module
  if (stateFile.cookies.length > 0) {
    for (const cookie of stateFile.cookies) {
      try {
        await bidi.send("storage.setCookie", { cookie });
      } catch { /* ignore individual cookie failures */ }
    }
  }

  const localEntries = Object.entries(stateFile.localStorage);
  if (localEntries.length > 0) {
    const localScript = localEntries
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join(";");
    await bidi.send("script.evaluate", { expression: localScript, awaitPromise: false, resultOwnership: "none" });
  }

  const sessionEntries = Object.entries(stateFile.sessionStorage);
  if (sessionEntries.length > 0) {
    const sessionScript = sessionEntries
      .map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
      .join(";");
    await bidi.send("script.evaluate", { expression: sessionScript, awaitPromise: false, resultOwnership: "none" });
  }

  // Reload page
  await bidi.send("browsingContext.reload", {});

  return { name, cookies: stateFile.cookies.length, localStorage: localEntries.length, sessionStorage: sessionEntries.length };
}
