import { CREDIT, DEBIT } from './api';
import { onTransactionDeleted, transactions } from './session';

// Duplicate detection, strongest evidence first:
//
// 1. Import tag. Every imported transaction gets "[import <date> <amount>
//    <payee>]" in its memo, recording the CSV row as it was. It survives
//    renaming, recategorizing or editing the amount in Money Manager, so a row
//    with the same tag is certainly already in.
// 2. This browser's ledger of what the extension created. Covers transactions
//    whose memo didn't stick, and imports made before tags existed.
// 3. Anything else in the account on the same day with the same amount and
//    direction. Could be the same purchase entered by hand, or imported from
//    an export that named the merchant differently. It could also be a
//    genuinely separate charge, so these are flagged for review, not skipped
//    silently, and not imported unless ticked.
const LEDGER_KEY = 'becu-csv-import:ledger';
const TAG_PAYEE_MAX = 60;

interface LedgerEntry {
  account: string;
  key: string; // loose key (day|cents|type) as imported
  guid: string;
  tag?: string; // exact key; missing for imports made before tags existed
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

const day = (date: number) => Math.floor(date / 86400);
const isoDay = (date: number) => new Date(day(date) * 86400 * 1000).toISOString().slice(0, 10);
const cleanPayee = (payee: string) => payee.replace(/\s+/g, ' ').trim().slice(0, TAG_PAYEE_MAX).trim();

// Same day (UTC), same cents, same direction.
export function dedupKey(date: number, amount: number, type: number): string {
  return `${day(date)}|${Math.round(amount * 100)}|${type}`;
}

// Same as dedupKey plus the payee as it appeared in the CSV.
export function exactKey(date: number, amount: number, type: number, payee: string): string {
  return `${dedupKey(date, amount, type)}|${cleanPayee(payee).toLowerCase()}`;
}

// The text written into the memo, e.g. "[import 2026-10-21 -4.50 STARBUCKS #123]".
export function importTag(date: number, amount: number, type: number, payee: string): string {
  const signed = `${type === DEBIT ? '-' : '+'}${amount.toFixed(2)}`;
  return `[import ${isoDay(date)} ${signed} ${cleanPayee(payee)}]`;
}

const TAG_RE = /\[import (\d{4})-(\d{2})-(\d{2}) ([+-])(\d+\.\d{2}) (.+)\]/;

export interface ParsedTag {
  key: string;
  payee: string;
}

export function parseTag(memo: string | undefined): ParsedTag | undefined {
  const m = memo && TAG_RE.exec(memo);
  if (!m) return undefined;
  const date = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  const type = m[4] === '-' ? DEBIT : CREDIT;
  const payee = m[6]!;
  return { key: exactKey(date, Number(m[5]), type, payee), payee };
}

export function withTag(memo: string | undefined, tag: string): string {
  return memo ? `${memo} ${tag}` : tag;
}

export function recordImport(account: string, key: string, guid: string, tag: string) {
  ledger.push({ account, key, guid, tag });
  save();
}

export function forgetImports(guids: Iterable<string>) {
  const gone = new Set(guids);
  const before = ledger.length;
  ledger = ledger.filter((e) => !gone.has(e.guid));
  if (ledger.length !== before) save();
}

// The original CSV payee of each transaction the extension created, from the
// memo tag or the ledger. Category learning uses it to see past renames.
export function importedPayees(): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of ledger) if (e.tag) out.set(e.guid, e.tag.split('|').slice(3).join('|'));
  for (const tx of transactions.values()) {
    const tag = parseTag(tx.memo);
    if (tag) out.set(tx.guid, tag.payee);
  }
  return out;
}

export interface Existing {
  guid: string;
  loose: string; // current day|cents|type
  exact?: string; // from the memo tag or ledger
  importedAs?: string; // ledger loose key: created by this extension (pre-tag)
  payee?: string; // current name, if Money Manager has loaded it
  date?: number;
}

function existingIn(account: string): Existing[] {
  const byGuid = new Map<string, Existing>();
  const fromLedger = new Map(ledger.filter((e) => e.account === account).map((e) => [e.guid, e]));
  for (const tx of transactions.values()) {
    if (tx.accountGuid !== account) continue;
    const entry = fromLedger.get(tx.guid);
    byGuid.set(tx.guid, {
      guid: tx.guid,
      loose: dedupKey(tx.date, tx.amount, tx.type),
      exact: parseTag(tx.memo)?.key ?? entry?.tag,
      importedAs: entry?.key,
      payee: tx.payee,
      date: tx.date,
    });
  }
  // Imports Money Manager hasn't loaded (e.g. outside the date range shown).
  for (const e of fromLedger.values()) {
    if (!byGuid.has(e.guid)) byGuid.set(e.guid, { guid: e.guid, loose: e.key, exact: e.tag, importedAs: e.key });
  }
  return [...byGuid.values()];
}

export type Match =
  | { kind: 'new' }
  | { kind: 'duplicate'; existing: Existing }
  | { kind: 'possible'; existing: Existing };

export interface MatchInput {
  loose: string;
  exact: string;
}

// Pairs each row with at most one existing transaction and vice versa, so
// identical rows in a file (two $5 rides on one day) only match as many
// transactions as the account really has.
export function matchRows<T extends MatchInput>(account: string, rows: T[]): Map<T, Match> {
  const existing = existingIn(account);
  const used = new Set<Existing>();
  const result = new Map<T, Match>(rows.map((r) => [r, { kind: 'new' }]));

  const pass = (kind: 'duplicate' | 'possible', rowKey: (r: T) => string, txKey: (e: Existing) => string | undefined) => {
    const pool = new Map<string, Existing[]>();
    for (const e of existing) {
      const k = txKey(e);
      if (k === undefined || used.has(e)) continue;
      const list = pool.get(k);
      if (list) list.push(e);
      else pool.set(k, [e]);
    }
    for (const row of rows) {
      if (result.get(row)!.kind !== 'new') continue;
      const e = pool.get(rowKey(row))?.find((c) => !used.has(c));
      if (!e) continue;
      used.add(e);
      result.set(row, { kind, existing: e });
    }
  };

  pass('duplicate', (r) => r.exact, (e) => e.exact);
  pass('duplicate', (r) => r.loose, (e) => (e.exact ? undefined : e.importedAs));
  pass('possible', (r) => r.loose, (e) => e.loose);
  return result;
}

// Earliest transaction date Money Manager has loaded, in any account. Rows
// older than this can only be checked against the ledger.
export function loadedSince(): number | undefined {
  let min: number | undefined;
  for (const tx of transactions.values()) if (min === undefined || tx.date < min) min = tx.date;
  return min;
}

onTransactionDeleted((guid) => forgetImports([guid]));
