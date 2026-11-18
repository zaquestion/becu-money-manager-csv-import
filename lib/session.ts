// Runs in the page's MAIN world. Wraps fetch/XHR so we can reuse the auth
// headers the MX widget sends, and harvest accounts/categories from the
// JSON responses it already loads.

export interface Account {
  guid: string;
  name: string;
  isManual?: boolean;
}

// What dedup and category learning need from transactions the widget loads.
export interface KnownTransaction {
  guid: string;
  accountGuid: string;
  date: number; // unix seconds
  amount: number;
  type: number;
  payee?: string; // the name shown in Money Manager (may be renamed)
  originalDescription?: string;
  memo?: string;
  categoryGuid?: string;
}

export interface Category {
  guid: string;
  name: string;
  parentGuid: string | null;
}

// Headers worth replaying on our own requests. md-session-token is the auth;
// the x-inter-* headers are a client fingerprint the widget attaches.
const CAPTURE = (name: string) => name === 'md-session-token' || name.startsWith('x-inter-');

export const capturedHeaders: Record<string, string> = {};
export const accounts = new Map<string, Account>();
export const categories = new Map<string, Category>();
export const transactions = new Map<string, KnownTransaction>();
// Bumped whenever `transactions` changes, so callers can cheaply tell.
export let transactionsRevision = 0;

const listeners = new Set<() => void>();
export const onSessionChange = (fn: () => void) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());
const deleteListeners = new Set<(guid: string) => void>();
export const onTransactionDeleted = (fn: (guid: string) => void) => deleteListeners.add(fn);

export function forgetTransaction(guid: string) {
  if (transactions.delete(guid)) transactionsRevision++;
  deleteListeners.forEach((fn) => fn(guid));
  notify();
}

// Keep an unwrapped fetch for our own calls.
export const rawFetch = window.fetch.bind(window);

export function hasSession(): boolean {
  return 'md-session-token' in capturedHeaders;
}

function captureHeader(name: string, value: string) {
  const key = name.toLowerCase();
  if (CAPTURE(key) && capturedHeaders[key] !== value) {
    capturedHeaders[key] = value;
    notify();
  }
}

function captureHeaderBag(headers: HeadersInit | undefined) {
  if (!headers) return;
  new Headers(headers).forEach((value, name) => captureHeader(name, value));
}

// Response shapes aren't documented, so walk any JSON looking for objects
// with MX-style GUIDs.
export function scanEntities(value: unknown, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) scanEntities(item, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  const guid = obj.guid;
  if (typeof guid === 'string') {
    if (guid.startsWith('CAT-') && typeof obj.name === 'string') {
      categories.set(guid, {
        guid,
        name: obj.name,
        parentGuid: typeof obj.parent_guid === 'string' ? obj.parent_guid : null,
      });
      notify();
    } else if (guid.startsWith('TRN-')) {
      const amount = Number(obj.amount);
      const date = typeof obj.date === 'number' ? obj.date : Date.parse(String(obj.date)) / 1000;
      if (obj.is_deleted === true) {
        if (transactions.delete(guid)) transactionsRevision++;
      } else if (
        typeof obj.account_guid === 'string' &&
        Number.isFinite(amount) &&
        Number.isFinite(date) &&
        (obj.transaction_type === 1 || obj.transaction_type === 2)
      ) {
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
        transactions.set(guid, {
          guid,
          accountGuid: obj.account_guid,
          date,
          amount: Math.abs(amount),
          type: obj.transaction_type,
          payee: str(obj.description) ?? str(obj.payee),
          originalDescription: str(obj.original_description),
          memo: str(obj.memo),
          categoryGuid: typeof obj.category_guid === 'string' && obj.category_guid.startsWith('CAT-') ? obj.category_guid : undefined,
        });
        transactionsRevision++;
      }
      notify();
    } else if (guid.startsWith('ACT-')) {
      const name = obj.user_name ?? obj.name;
      if (obj.is_deleted === true || obj.is_closed === true) {
        if (accounts.delete(guid)) notify();
      } else if (typeof name === 'string') {
        accounts.set(guid, {
          guid,
          name,
          isManual: typeof obj.is_manual === 'boolean' ? obj.is_manual : undefined,
        });
        notify();
      }
    }
  }
  for (const child of Object.values(obj)) scanEntities(child, depth + 1);
}

function scanText(text: string) {
  try {
    scanEntities(JSON.parse(text));
  } catch {
    // not JSON
  }
}

// Notice when the widget itself deletes a transaction, so dedup doesn't keep
// treating it as present.
function watchDelete(method: string | undefined, url: string, ok: boolean) {
  if (!ok || method?.toUpperCase() !== 'DELETE') return;
  const guid = /\/transactions\/(TRN-[\w-]+)/.exec(url)?.[1];
  if (guid) forgetTransaction(guid);
}

export function installHooks() {
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    if (input instanceof Request) captureHeaderBag(input.headers);
    captureHeaderBag(init?.headers);
    const response = await rawFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    watchDelete(method, response.url || String(input instanceof Request ? input.url : input), response.ok);
    if (response.headers.get('content-type')?.includes('json')) {
      response.clone().text().then(scanText, () => {});
    }
    return response;
  };

  const { open, setRequestHeader, send } = XMLHttpRequest.prototype;
  const methods = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, ...rest: unknown[]) {
    methods.set(this, method);
    return (open as (...args: unknown[]) => void).call(this, method, ...rest);
  } as typeof open;
  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    captureHeader(name, value);
    return setRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', () => {
      watchDelete(methods.get(this), this.responseURL, this.status >= 200 && this.status < 300);
      if (this.responseType === '' || this.responseType === 'text') scanText(this.responseText);
      else if (this.responseType === 'json') scanEntities(this.response);
    });
    return send.call(this, body);
  };
}
