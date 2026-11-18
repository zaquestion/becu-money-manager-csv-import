import { importedPayees } from './dedup';
import type { Category } from './session';
import { categories, transactions } from './session';

// Money Manager's categorization rules don't run on manually created
// transactions, so learn payee → category from transactions it has already
// loaded (every account, including ones you renamed or recategorized) and
// apply the same category to new rows from the same merchant.

// Payment-processor prefixes like "SQ *BLUE BOTTLE" or "TST* PIZZA PLACE".
const PROCESSOR = /^(sq|tst|sp|pp|paypal|py|pos|dd|ic|bt|cke|fs|wpy|zls|ppd|ckc|lsp|par)\s*\*\s*/;

// Lowercased, without processor prefixes, store numbers or reference codes:
// "SQ *BLUE BOTTLE #12" and "Blue Bottle 4471" both become "blue bottle".
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(PROCESSOR, '')
    .replace(/[*#]/g, ' ')
    .replace(/\S*\d\S*/g, ' ')
    .replace(/[^a-z&']+/g, ' ')
    .replace(/'/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Progressively looser ways to match a merchant, each needing a clearer
// majority: the whole name, its first two words ("blue bottle coffee" finds
// "Blue Bottle"), then a distinctive first word ("uber trip" finds "Uber").
const LEVELS: { key: (merchant: string) => string | undefined; share: number }[] = [
  { key: (m) => m, share: 0 },
  { key: (m) => m.split(' ').slice(0, 2).join(' '), share: 2 / 3 },
  { key: (m) => { const w = m.split(' ')[0]!; return w.length >= 4 ? w : undefined; }, share: 0.8 },
];

const usable = (cat: Category | undefined): cat is Category => !!cat && !/uncategori[sz]ed/i.test(cat.name);

interface Vote {
  votes: number;
  last: number; // most recent date, breaks ties
  example: string; // a transaction name it was seen on
}

interface Tally {
  votes: Map<string, Vote>; // by category guid
  total: number;
}

export interface Suggestion {
  category: Category;
  from: string; // the earlier transaction's name, for the tooltip
}

export class CategoryLearner {
  private levels = LEVELS.map(() => new Map<string, Tally>());

  constructor() {
    const original = importedPayees();
    for (const tx of transactions.values()) {
      const cat = tx.categoryGuid ? categories.get(tx.categoryGuid) : undefined;
      if (!usable(cat)) continue;
      // The original CSV payee counts most: it's exactly what the next export
      // will say, and the category on it is your own choice.
      const names: [string | undefined, number][] = [
        [original.get(tx.guid), 3],
        [tx.payee, 2],
        [tx.originalDescription, 1],
      ];
      const weights = new Map<string, number>();
      for (const [name, weight] of names) {
        if (!name) continue;
        const key = merchantKey(name);
        if (!key) continue;
        weights.set(key, Math.max(weights.get(key) ?? 0, weight));
      }
      const shown = tx.payee ?? tx.originalDescription ?? '';
      LEVELS.forEach((level, i) => {
        // One vote per transaction per key, at its strongest weight.
        const keys = new Map<string, number>();
        for (const [merchant, weight] of weights) {
          const k = level.key(merchant);
          if (k) keys.set(k, Math.max(keys.get(k) ?? 0, weight));
        }
        for (const [k, weight] of keys) add(this.levels[i]!, k, cat.guid, weight, tx.date, shown);
      });
    }
  }

  suggest(payee: string): Suggestion | undefined {
    const key = merchantKey(payee);
    if (!key) return undefined;
    let hit: [string, Vote] | undefined;
    for (let i = 0; i < LEVELS.length && !hit; i++) {
      const k = LEVELS[i]!.key(key);
      if (k) hit = best(this.levels[i]!.get(k), LEVELS[i]!.share);
    }
    const category = hit && categories.get(hit[0]);
    return hit && usable(category) ? { category, from: hit[1].example } : undefined;
  }
}

function add(map: Map<string, Tally>, key: string, guid: string, weight: number, date: number, name: string) {
  let tally = map.get(key);
  if (!tally) map.set(key, (tally = { votes: new Map(), total: 0 }));
  const v = tally.votes.get(guid) ?? { votes: 0, last: -Infinity, example: name };
  v.votes += weight;
  if (date >= v.last) [v.last, v.example] = [date, name];
  tally.votes.set(guid, v);
  tally.total += weight;
}

// Most votes wins, most recent breaks ties. `share` is the minimum fraction of
// all votes the winner needs (looser matches must be clear-cut).
function best(tally: Tally | undefined, share: number): [string, Vote] | undefined {
  if (!tally) return undefined;
  let top: [string, Vote] | undefined;
  for (const entry of tally.votes) {
    if (!top || entry[1].votes > top[1].votes || (entry[1].votes === top[1].votes && entry[1].last > top[1].last)) top = entry;
  }
  return top && top[1].votes >= share * tally.total ? top : undefined;
}
