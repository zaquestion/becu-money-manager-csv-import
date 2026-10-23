import { capturedHeaders, rawFetch, scanEntities } from './session';

// MX transaction_type values, as observed from the widget's own requests.
export const CREDIT = 1;
export const DEBIT = 2;

export interface NewTransaction {
  accountGuid: string;
  amount: number; // always positive; direction comes from type
  type: typeof CREDIT | typeof DEBIT;
  date: number; // unix seconds, midnight UTC
  payee: string;
  memo?: string;
  category?: { guid: string; name: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await rawFetch(new URL(path, location.origin), {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...capturedHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, text);
  return text ? JSON.parse(text) : null;
}

export async function createTransaction(tx: NewTransaction): Promise<string> {
  const payload: Record<string, unknown> = {
    account_guid: tx.accountGuid,
    amount: tx.amount.toFixed(2),
    date: tx.date,
    is_manual: true,
    transaction_type: tx.type,
    description: tx.payee,
    payee: tx.payee,
  };
  if (tx.category) {
    payload.category_guid = tx.category.guid;
    payload.category = tx.category.name;
  }
  if (tx.memo) payload.memo = tx.memo;

  const result = (await request('POST', '/transactions', payload)) as {
    transaction?: { guid?: string };
  };
  const guid = result?.transaction?.guid;
  if (!guid) throw new Error('Response did not include a transaction guid');
  return guid;
}

// Matches the widget's own delete; the response body is `null`.
export async function deleteTransaction(guid: string): Promise<void> {
  await request('DELETE', `/transactions/${encodeURIComponent(guid)}`);
}

// Best-effort: the widget usually loads these itself, but ask directly in case
// they were fetched before our hooks were installed.
export async function refreshEntities(): Promise<void> {
  await Promise.all(
    ['/accounts', '/categories'].map((path) =>
      request('GET', path).then(scanEntities, () => {}),
    ),
  );
}
