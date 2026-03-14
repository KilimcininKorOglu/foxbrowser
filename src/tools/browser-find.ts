/**
 * browser_find — Semantic element locators via BiDi script.evaluate.
 *
 * Since BiDi has no Accessibility domain, we use JS-based DOM traversal
 * with ARIA attributes and element roles to simulate accessibility tree queries.
 */
import type { BiDiConnection } from "../bidi/connection.js";

export interface FindResult {
  found: boolean;
  backendNodeId?: number;
  index?: number;
}

export interface FindByRoleParams { role: string; name?: string; }
export interface FindByTextParams { text: string; exact?: boolean; }
export interface FindByLabelParams { label: string; }
export interface FindByPlaceholderParams { placeholder: string; }
export interface FindByAltParams { alt: string; }
export interface FindByTitleParams { title: string; }
export interface FindByTestIdParams { testId: string; }
export interface FindPositionalParams { selector: string; }
export interface FindNthParams extends FindPositionalParams { n: number; }

async function evalFind(bidi: BiDiConnection, expression: string): Promise<FindResult> {
  const response = (await bidi.send("script.evaluate", {
    expression,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { type: string; value?: unknown } };

  if (response.result?.type === "null" || !response.result?.value) {
    return { found: false };
  }
  return { found: true };
}

export async function findByRole(bidi: BiDiConnection, params: FindByRoleParams): Promise<FindResult> {
  const nameCheck = params.name ? ` && (el.getAttribute('aria-label') === ${JSON.stringify(params.name)} || el.textContent?.trim() === ${JSON.stringify(params.name)})` : "";
  return evalFind(bidi, `(() => {
    const role = ${JSON.stringify(params.role)};
    const implicit = { a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', img: 'img', nav: 'navigation', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem' };
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const elRole = el.getAttribute('role') || implicit[el.tagName.toLowerCase()] || '';
      if (elRole === role${nameCheck}) return el;
    }
    return null;
  })()`);
}

export async function findByText(bidi: BiDiConnection, params: FindByTextParams): Promise<FindResult> {
  const text = JSON.stringify(params.text);
  const check = params.exact ? `el.textContent?.trim() === ${text}` : `el.textContent?.includes(${text})`;
  return evalFind(bidi, `(() => { for (const el of document.querySelectorAll('*')) { if (${check}) return el; } return null; })()`);
}

export async function findByLabel(bidi: BiDiConnection, params: FindByLabelParams): Promise<FindResult> {
  return evalFind(bidi, `(() => {
    for (const label of document.querySelectorAll('label')) {
      if (label.textContent?.trim() === ${JSON.stringify(params.label)}) {
        if (label.htmlFor) return document.getElementById(label.htmlFor);
        return label.querySelector('input, select, textarea');
      }
    }
    return null;
  })()`);
}

export async function findByPlaceholder(bidi: BiDiConnection, params: FindByPlaceholderParams): Promise<FindResult> {
  return evalFind(bidi, `document.querySelector('[placeholder=${JSON.stringify(params.placeholder)}]')`);
}

export async function findByAlt(bidi: BiDiConnection, params: FindByAltParams): Promise<FindResult> {
  return evalFind(bidi, `document.querySelector('[alt=${JSON.stringify(params.alt)}]')`);
}

export async function findByTitle(bidi: BiDiConnection, params: FindByTitleParams): Promise<FindResult> {
  return evalFind(bidi, `document.querySelector('[title=${JSON.stringify(params.title)}]')`);
}

export async function findByTestId(bidi: BiDiConnection, params: FindByTestIdParams): Promise<FindResult> {
  return evalFind(bidi, `document.querySelector('[data-testid=${JSON.stringify(params.testId)}]')`);
}

export async function findFirst(bidi: BiDiConnection, params: FindPositionalParams): Promise<FindResult> {
  const r = await evalFind(bidi, `document.querySelectorAll(${JSON.stringify(params.selector)})[0]`);
  return r.found ? { ...r, index: 0 } : r;
}

export async function findLast(bidi: BiDiConnection, params: FindPositionalParams): Promise<FindResult> {
  return evalFind(bidi, `(() => { const els = document.querySelectorAll(${JSON.stringify(params.selector)}); return els.length > 0 ? els[els.length - 1] : null; })()`);
}

export async function findNth(bidi: BiDiConnection, params: FindNthParams): Promise<FindResult> {
  const r = await evalFind(bidi, `document.querySelectorAll(${JSON.stringify(params.selector)})[${params.n}]`);
  return r.found ? { ...r, index: params.n } : r;
}

// ---------------------------------------------------------------------------
// Unified browserFind — MCP tool entry point
// ---------------------------------------------------------------------------

export interface BrowserFindParams {
  role?: string;
  name?: string;
  text?: string;
  nth?: number;
}

export interface BrowserFindResult {
  found: boolean;
  ref: string | null;
  role: string | null;
  name: string | null;
  count: number;
}

export async function browserFind(
  bidi: BiDiConnection,
  params: BrowserFindParams,
): Promise<BrowserFindResult> {
  const nth = params.nth ?? 0;

  // JS-based accessibility tree traversal
  const response = (await bidi.send("script.evaluate", {
    expression: `(() => {
      const implicit = { a:'link', button:'button', input:'textbox', select:'combobox', textarea:'textbox', h1:'heading', h2:'heading', h3:'heading', h4:'heading', h5:'heading', h6:'heading', img:'img', nav:'navigation', form:'form', table:'table', ul:'list', ol:'list', li:'listitem' };
      const role = ${JSON.stringify(params.role ?? "")};
      const nameFilter = ${JSON.stringify(params.name ?? "")};
      const textFilter = ${JSON.stringify(params.text ?? "")};
      const matches = [];
      let counter = 0;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        counter++;
        const elRole = node.getAttribute && (node.getAttribute('role') || implicit[node.tagName?.toLowerCase()] || '');
        const elName = node.getAttribute && (node.getAttribute('aria-label') || node.textContent?.trim()?.slice(0, 100) || '');

        let match = true;
        if (role && elRole?.toLowerCase() !== role.toLowerCase()) match = false;
        if (nameFilter && !elName?.includes(nameFilter)) match = false;
        if (textFilter && !elName?.includes(textFilter)) match = false;

        if (match) {
          matches.push({ ref: '@e' + counter, role: elRole, name: elName?.slice(0, 50) });
        }
        node = walker.nextNode();
        if (!node) break;
      }
      return { matches, count: matches.length };
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: { matches: Array<{ ref: string; role: string; name: string }>; count: number } } };

  const data = response.result?.value;
  if (!data || data.count === 0 || nth >= data.count) {
    return { found: false, ref: null, role: null, name: null, count: data?.count ?? 0 };
  }

  const match = data.matches[nth]!;
  return {
    found: true,
    ref: match.ref,
    role: match.role,
    name: match.name,
    count: data.count,
  };
}
