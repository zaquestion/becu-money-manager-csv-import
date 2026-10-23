import Papa from 'papaparse';
import { CREDIT, DEBIT } from './api';

export const FIELDS = ['date', 'payee', 'amount', 'category', 'memo', 'type', 'status'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, string>>;
export const REQUIRED: Field[] = ['date', 'payee', 'amount'];

export type SignMode = 'negative-is-debit' | 'positive-is-debit' | 'type-column';

// settled: import. pending: authorized but not posted yet; the amount can
// still change (tips) or be voided. void: never import.
export type RowStatus = 'settled' | 'pending' | 'void';

export interface ParsedRow {
  line: number;
  status: RowStatus;
  date: number;
  payee: string;
  amount: number;
  type: typeof CREDIT | typeof DEBIT;
  categoryName?: string;
  memo?: string;
}

export interface RowError {
  line: number;
  message: string;
}

export interface CsvFile {
  headers: string[];
  records: Record<string, string>[];
}

export function readCsv(text: string): CsvFile {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], records: result.data };
}

const GUESSES: Record<Field, RegExp> = {
  date: /^(date|posted|transaction date|posting date)$/i,
  payee: /^(payee|description|merchant|name)$/i,
  amount: /^(amount|value)$/i,
  category: /^category$/i,
  memo: /^(memo|notes?)$/i,
  type: /^(type|transaction type|debit\/credit)$/i,
  status: /^(status|state)$/i,
};

export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  for (const field of FIELDS) {
    const header = headers.find((h) => GUESSES[field].test(h));
    if (header) mapping[field] = header;
  }
  return mapping;
}

// Returns unix seconds at midnight UTC, which is what the widget sends.
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return ms / 1000;
}

// Handles "$1,234.56", "-12.00", and accounting-style "(12.00)".
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[$,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

// Includes credit-card export types: PURCHASE/FEE add to the balance owed,
// PAYMENT/REFUND reduce it.
function parseType(raw: string): typeof CREDIT | typeof DEBIT | null {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (/^(debit|withdrawal|expense|dr|d|purchase|sale|charge|fee|interest|cash advance)$/.test(s)) return DEBIT;
  if (/^(credit|deposit|income|cr|c|payment|refund|return|reward|cashback|cash back)$/.test(s)) return CREDIT;
  return null;
}

// Unknown or blank statuses count as settled.
function parseStatus(raw: string): RowStatus {
  const s = raw.trim().toLowerCase();
  if (/^(void|voided|declined|cancell?ed|failed|reversed|rejected)$/.test(s)) return 'void';
  if (/^(authori[sz]ed|pending|processing|hold)$/.test(s)) return 'pending';
  return 'settled';
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s_-])\w/g, (c) => c.toUpperCase()).replace(/_/g, ' ');

export function normalize(
  file: CsvFile,
  mapping: Mapping,
  signMode: SignMode,
): { rows: ParsedRow[]; errors: RowError[] } {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const get = (record: Record<string, string>, field: Field) => {
    const header = mapping[field];
    return header ? (record[header] ?? '').trim() : '';
  };

  file.records.forEach((record, i) => {
    const line = i + 2; // header is line 1
    const date = parseDate(get(record, 'date'));
    const amount = parseAmount(get(record, 'amount'));
    // Card payments often have no merchant; name them after their type.
    const payee = get(record, 'payee') || titleCase(get(record, 'type'));
    if (date === null) return errors.push({ line, message: `bad date "${get(record, 'date')}"` });
    if (amount === null) return errors.push({ line, message: `bad amount "${get(record, 'amount')}"` });
    if (!payee) return errors.push({ line, message: 'missing payee' });
    if (amount === 0) return errors.push({ line, message: 'zero amount' });

    let type: typeof CREDIT | typeof DEBIT;
    if (signMode === 'type-column') {
      const parsed = parseType(get(record, 'type'));
      if (parsed === null) return errors.push({ line, message: `bad type "${get(record, 'type')}"` });
      type = parsed;
    } else {
      const negative = amount < 0;
      type = negative === (signMode === 'negative-is-debit') ? DEBIT : CREDIT;
    }

    rows.push({
      line,
      status: parseStatus(get(record, 'status')),
      date,
      payee,
      amount: Math.abs(amount),
      type,
      categoryName: get(record, 'category') || undefined,
      memo: get(record, 'memo') || undefined,
    });
  });
  return { rows, errors };
}
