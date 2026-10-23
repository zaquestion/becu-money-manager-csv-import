import { onTransactionDeleted, transactions } from './session';

// Every transaction this extension creates is recorded here (per account), so
// re-importing an overlapping export only adds what's new. Transactions the
// widget has loaded count too, which covers ones added some other way.
const LEDGER_KEY = 'becu-csv-import:ledger';

interface LedgerEntry {
  account: string;
  key: string;
  guid: string;
}

let ledger: LedgerEntry[] = load();
export let ledgerRevision = 0;

function load(): LedgerEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  ledgerRevision++;
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // storage unavailable; dedup falls back to what the widget has loaded
  }
}

// Same day (UTC), same cents, same direction. Payee is left out because Money
// Manager may rename it; identical rows in one file are handled by counting.
export function dedupKey(date: number, amount: number, type: number): string {
  return `${Math.floor(date / 86400)}|${Math.round(amount * 100)}|${type}`;
}

export function recordImport(account: string, key: string, guid: string) {
  ledger.push({ account, key, guid });
  save();
}

export function forgetImports(guids: Iterable<string>) {
  const gone = new Set(guids);
  const before = ledger.length;
  ledger = ledger.filter((e) => !gone.has(e.guid));
  if (ledger.length !== before) save();
}

// How many transactions already exist in the account for each key.
export function existingCounts(account: string): Map<string, number> {
  const guidsByKey = new Map<string, Set<string>>();
  const add = (key: string, guid: string) => {
    let set = guidsByKey.get(key);
    if (!set) guidsByKey.set(key, (set = new Set()));
    set.add(guid);
  };
  for (const e of ledger) if (e.account === account) add(e.key, e.guid);
  for (const tx of transactions.values()) {
    if (tx.accountGuid === account) add(dedupKey(tx.date, tx.amount, tx.type), tx.guid);
  }
  return new Map([...guidsByKey].map(([key, set]) => [key, set.size]));
}

onTransactionDeleted((guid) => forgetImports([guid]));
