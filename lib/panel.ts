import { ApiError, CREDIT, createTransaction, deleteTransaction, refreshEntities } from './api';
import { FIELDS, REQUIRED, guessMapping, normalize, readCsv } from './csv';
import type { CsvFile, Field, Mapping, ParsedRow, RowError, SignMode } from './csv';
import { STYLE } from './panel-style';
import type { Category } from './session';
import { accounts, categories, hasSession, onSessionChange } from './session';

const UNDO_KEY = 'becu-csv-import:last';
const REQUEST_DELAY_MS = 250;
const MAX_CONSECUTIVE_FAILURES = 3;
const PREVIEW_LIMIT = 200;

const FIELD_LABELS: Record<Field, string> = {
  date: 'Date',
  payee: 'Payee',
  amount: 'Amount',
  category: 'Category',
  memo: 'Memo',
  type: 'Type',
};

const SIGN_MODES: [SignMode, string][] = [
  ['negative-is-debit', 'Negative amounts are expenses'],
  ['positive-is-debit', 'Positive amounts are expenses'],
  ['type-column', 'Use the Type column (debit/credit)'],
];

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type Phase = 'idle' | 'confirm-import' | 'importing' | 'confirm-undo' | 'undoing';

interface Job {
  kind: 'import' | 'undo';
  total: number;
  done: number;
  ok: number;
  failed: number;
  finished: boolean;
  target?: string;
  note?: string;
}

interface State {
  open: boolean;
  minimized: boolean;
  phase: Phase;
  refreshing: boolean;
  stopRequested: boolean;
  accountGuid: string;
  file?: CsvFile;
  fileName?: string;
  fileVersion: number;
  importedVersion?: number; // fileVersion of the last file imported, to warn about duplicates
  fileError?: string;
  mapping: Mapping;
  signMode: SignMode;
  mappingExpanded: boolean;
  job?: Job;
}

const state: State = {
  open: false,
  minimized: false,
  phase: 'idle',
  refreshing: false,
  stopRequested: false,
  accountGuid: '',
  fileVersion: 0,
  mapping: {},
  signMode: 'negative-is-debit',
  mappingExpanded: false,
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const child of children) if (child) el.append(child);
  return el;
}

function loadUndo(): string[] {
  try {
    return JSON.parse(localStorage.getItem(UNDO_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveUndo(guids: string[]) {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify(guids));
  } catch {
    // storage unavailable; undo just won't be possible
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const formatDate = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isRunning = () => state.phase === 'importing' || state.phase === 'undoing';

function categoryByName(): Map<string, Category> {
  const byName = new Map<string, Category>();
  for (const cat of categories.values()) {
    const key = cat.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, cat);
  }
  return byName;
}

function matchedCategory(row: ParsedRow, byName: Map<string, Category>): Category | undefined {
  return row.categoryName ? byName.get(row.categoryName.toLowerCase()) : undefined;
}

function resolveCategory(row: ParsedRow, byName: Map<string, Category>): Category | undefined {
  return matchedCategory(row, byName) ?? byName.get('uncategorized');
}

function manualAccounts() {
  const all = [...accounts.values()];
  const manual = all.filter((a) => a.isManual);
  return manual.length ? manual : all;
}

function mappingProblem(): string | undefined {
  const missing = REQUIRED.filter((f) => !state.mapping[f]);
  if (missing.length) return `Choose the ${missing.map((f) => FIELD_LABELS[f]).join(', ')} column${missing.length > 1 ? 's' : ''}.`;
  if (state.signMode === 'type-column' && !state.mapping.type) {
    return 'Choose the Type column, or pick a different income vs. expense rule.';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Preview (memoized: normalize + category matching only rerun when inputs change)

interface Preview {
  key: string;
  rows: ParsedRow[];
  errors: RowError[];
  byName: Map<string, Category>;
  unknown: string[];
  uncategorized: number;
  expenses: { count: number; total: number };
  income: { count: number; total: number };
}

let cachedPreview: Preview | undefined;

function getPreview(): Preview | undefined {
  if (!state.file || mappingProblem()) return undefined;
  const key = JSON.stringify([state.fileVersion, state.mapping, state.signMode, categories.size]);
  if (cachedPreview?.key === key) return cachedPreview;

  const { rows, errors } = normalize(state.file, state.mapping, state.signMode);
  const byName = categoryByName();
  const unknown = new Set<string>();
  const expenses = { count: 0, total: 0 };
  const income = { count: 0, total: 0 };
  let uncategorized = 0;
  for (const row of rows) {
    if (!matchedCategory(row, byName)) {
      uncategorized++;
      if (row.categoryName) unknown.add(row.categoryName);
    }
    const bucket = row.type === CREDIT ? income : expenses;
    bucket.count++;
    bucket.total += row.amount;
  }
  cachedPreview = { key, rows, errors, byName, unknown: [...unknown], uncategorized, expenses, income };
  return cachedPreview;
}

function importBlocker(preview: Preview | undefined): string | undefined {
  if (!hasSession()) return 'Waiting for the Money Manager session.';
  if (!accounts.get(state.accountGuid)) return 'Choose an account.';
  if (!state.file) return 'Choose a CSV file.';
  if (mappingProblem()) return 'Finish the column mapping.';
  if (!categories.size) return 'Categories not loaded yet. Click Refresh.';
  if (!preview?.rows.length) return 'No valid rows to import.';
  return undefined;
}

// ---------------------------------------------------------------------------
// DOM (built once; update() patches it in place so focus, scroll and open
// selects survive session updates and progress ticks)

function step(n: number, title: string, ...children: (Node | null)[]) {
  const badge = h('span', { className: 'badge', textContent: String(n), ariaHidden: 'true' });
  const section = h('section', { className: 'step' }, h('h3', {}, badge, title), ...children);
  return { section, badge, n };
}

function buildUi() {
  const toggle = h('button', { type: 'button', className: 'toggle', ariaHasPopup: 'dialog' });

  const pill = h('span', { className: 'pill' });
  const minimizeBtn = h('button', { type: 'button', className: 'icon' });
  const closeBtn = h('button', { type: 'button', className: 'icon', textContent: '×', title: 'Close (Esc)', ariaLabel: 'Close' });
  const header = h(
    'header',
    {},
    h('h2', { id: 'csv-title', textContent: 'CSV import' }),
    pill,
    h('span', { className: 'spacer' }),
    minimizeBtn,
    closeBtn,
  );

  // Readiness
  const checklist = h('ul', { className: 'checklist' });
  const refreshBtn = h('button', { type: 'button', className: 'link' });
  const status = h('div', { className: 'status', role: 'status' }, checklist, refreshBtn);

  // 1. Account
  const accountSelect = h('select', { id: 'account', ariaLabel: 'Manual account' });
  const accountHint = h('p', { className: 'hint' });
  const step1 = step(1, 'Account', accountSelect, accountHint);

  // 2. File
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', className: 'sr-only', tabIndex: -1, ariaHidden: 'true' });
  const fileLabel = h('span', { className: 'file-name' });
  const dropHint = h('span', {});
  const chooseBtn = h('button', { type: 'button', className: 'btn' });
  const dropZone = h('div', { className: 'drop' }, dropHint, fileLabel, chooseBtn, fileInput);
  const fileError = h('p', { className: 'callout danger', role: 'alert' });
  const step2 = step(2, 'CSV file', dropZone, fileError);

  // 3. Columns
  const chips = h('div', { className: 'chips' });
  const editMapBtn = h('button', { type: 'button', className: 'link' });
  const mapSummary = h('div', { className: 'map-summary' }, chips, editMapBtn);
  const mapGrid = h('div', { className: 'grid' });
  const fieldSelects = new Map<Field, HTMLSelectElement>();
  const fieldSamples = new Map<Field, HTMLElement>();
  for (const field of FIELDS) {
    const id = `map-${field}`;
    const select = h('select', { id, ariaRequired: REQUIRED.includes(field) ? 'true' : 'false' });
    const sample = h('span', { className: 'sample' });
    fieldSelects.set(field, select);
    fieldSamples.set(field, sample);
    mapGrid.append(
      h('label', { htmlFor: id, textContent: REQUIRED.includes(field) ? `${FIELD_LABELS[field]} *` : FIELD_LABELS[field] }),
      h('div', { className: 'field' }, select, sample),
    );
  }
  const signSelect = h('select', { id: 'map-sign' });
  mapGrid.append(h('label', { htmlFor: 'map-sign', textContent: 'Income vs. expense' }), h('div', { className: 'field' }, signSelect));
  const mapWarn = h('p', { className: 'callout warn' });
  const step3 = step(3, 'Columns', mapSummary, mapGrid, mapWarn);

  // 4. Review
  const stats = h('div', { className: 'stats' });
  const errorsSummary = h('summary', {});
  const errorsList = h('ul', {});
  const errorsBox = h('details', { className: 'callout danger' }, errorsSummary, errorsList);
  const unknownBox = h('p', { className: 'callout warn' });
  const tableWrap = h('div', { className: 'table-wrap', tabIndex: 0, ariaLabel: 'Rows to import' });
  const tableNote = h('p', { className: 'hint' });
  const step4 = step(4, 'Review', stats, errorsBox, unknownBox, tableWrap, tableNote);

  const content = h('div', { className: 'content' }, status, step1.section, step2.section, step3.section, step4.section);

  // Footer: progress + actions
  const progressLabel = h('div', { className: 'progress-label', ariaLive: 'polite' });
  const progressBar = h('progress', { max: 1, value: 0 });
  const resultText = h('p', { className: 'callout', role: 'status' });
  const reloadBtn = h('button', { type: 'button', className: 'btn', textContent: 'Reload page' });
  const result = h('div', { className: 'result' }, resultText, reloadBtn);
  const logPre = h('pre', {});
  const logBox = h('details', { className: 'log' }, h('summary', { textContent: 'Details' }), logPre);
  const progress = h('div', { className: 'progress' }, progressLabel, progressBar, result, logBox);

  const undoBtn = h('button', { type: 'button', className: 'btn quiet' });
  const message = h('span', { className: 'message' });
  const cancelBtn = h('button', { type: 'button', className: 'btn', textContent: 'Cancel' });
  const stopBtn = h('button', { type: 'button', className: 'btn', textContent: 'Stop' });
  const confirmBtn = h('button', { type: 'button', className: 'btn primary' });
  const importBtn = h('button', { type: 'button', className: 'btn primary' });
  const actions = h('div', { className: 'actions' }, undoBtn, message, cancelBtn, stopBtn, confirmBtn, importBtn);
  const footer = h('footer', {}, progress, actions);

  const panel = h('div', { className: 'panel', role: 'dialog' }, header, content, footer);
  panel.setAttribute('aria-labelledby', 'csv-title');

  return {
    toggle, panel, pill, minimizeBtn, closeBtn,
    checklist, refreshBtn, status,
    step1, accountSelect, accountHint,
    step2, fileInput, fileLabel, dropHint, chooseBtn, dropZone, fileError,
    step3, chips, editMapBtn, mapSummary, mapGrid, fieldSelects, fieldSamples, signSelect, mapWarn,
    step4, stats, errorsSummary, errorsList, errorsBox, unknownBox, tableWrap, tableNote,
    content, progress, progressLabel, progressBar, result, resultText, reloadBtn, logBox, logPre,
    undoBtn, message, cancelBtn, stopBtn, confirmBtn, importBtn,
    tableKey: '',
  };
}

let ui: ReturnType<typeof buildUi> | undefined;

// Only rebuild a select's options when the option set changes, so an open
// dropdown isn't closed by unrelated updates.
function syncSelect(select: HTMLSelectElement, options: [string, string][], selected: string) {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.replaceChildren(...options.map(([value, label]) => h('option', { value, textContent: label })));
    select.dataset.key = key;
  }
  if (select.value !== selected) select.value = selected;
}

function setStepDone(s: { section: HTMLElement; badge: HTMLElement; n: number }, done: boolean) {
  s.section.classList.toggle('done', done);
  s.badge.textContent = done ? '✓' : String(s.n);
}

function updateChrome(u: NonNullable<typeof ui>) {
  const job = state.job;
  const running = isRunning() && job;
  u.toggle.hidden = state.open;
  u.toggle.classList.toggle('running', !!running);
  u.toggle.textContent = running
    ? `${job.kind === 'import' ? 'Importing' : 'Deleting'} ${job.done}/${job.total}…`
    : 'CSV import';
  u.toggle.ariaLabel = running ? null : 'Open CSV import';

  u.panel.hidden = !state.open;
  u.panel.classList.toggle('minimized', state.minimized);
  u.minimizeBtn.textContent = state.minimized ? '▢' : '–';
  u.minimizeBtn.title = state.minimized ? 'Expand' : 'Minimize';
  u.minimizeBtn.ariaLabel = u.minimizeBtn.title;
  u.minimizeBtn.ariaExpanded = String(!state.minimized);

  const ready = hasSession() && manualAccounts().length > 0 && categories.size > 0;
  let pill: [string, string];
  if (running) pill = ['info', `${job.done}/${job.total}`];
  else if (ready) pill = ['ok', 'Ready'];
  else pill = ['warn', 'Setup needed'];
  u.pill.className = `pill ${pill[0]}`;
  u.pill.textContent = pill[1];
}

function updateStatus(u: NonNullable<typeof ui>) {
  const session = hasSession();
  const accountCount = manualAccounts().length;
  const checks: { ok: boolean; text: string; hint?: string }[] = [
    session
      ? { ok: true, text: 'Connected to Money Manager' }
      : {
          ok: false,
          text: 'Waiting for your Money Manager session',
          hint: 'Click around Money Manager (e.g. open Transactions) so the extension can pick it up.',
        },
    accountCount
      ? { ok: true, text: `${plural(accountCount, 'manual account')} found` }
      : {
          ok: false,
          text: 'No manual accounts found yet',
          hint: session ? 'Click Refresh, or open the Accounts view.' : undefined,
        },
    categories.size
      ? { ok: true, text: `${categories.size} ${categories.size === 1 ? 'category' : 'categories'} loaded` }
      : { ok: false, text: 'Categories not loaded yet', hint: session ? 'Click Refresh.' : undefined },
  ];
  const allOk = checks.every((c) => c.ok);
  const items = allOk
    ? [h('li', { className: 'ok' }, h('span', { className: 'mark', textContent: '✓' }), checks.map((c) => c.text).join(' · '))]
    : checks.map((c) =>
        h(
          'li',
          { className: c.ok ? 'ok' : 'pending' },
          h('span', { className: 'mark', textContent: c.ok ? '✓' : '○' }),
          h('span', { textContent: c.text }),
          c.hint && h('span', { className: 'hint', textContent: c.hint }),
        ),
      );
  u.checklist.replaceChildren(...items);
  u.refreshBtn.textContent = state.refreshing ? 'Refreshing…' : 'Refresh';
  u.refreshBtn.disabled = !session || state.refreshing || isRunning();
}

function updateAccount(u: NonNullable<typeof ui>) {
  const options = manualAccounts();
  if (state.accountGuid && !accounts.has(state.accountGuid)) state.accountGuid = '';
  if (!state.accountGuid && options.length === 1) state.accountGuid = options[0]!.guid;

  syncSelect(
    u.accountSelect,
    [['', options.length ? 'Choose a manual account…' : 'No accounts found yet'], ...options.map((a): [string, string] => [a.guid, a.name])],
    state.accountGuid,
  );
  u.accountSelect.disabled = isRunning() || !options.length;
  u.accountHint.textContent = 'Transactions are added to this account. Only manual accounts accept them.';
  u.accountHint.hidden = !!state.accountGuid;
  setStepDone(u.step1, !!accounts.get(state.accountGuid));
}

function updateFile(u: NonNullable<typeof ui>) {
  const file = state.file;
  u.dropZone.classList.toggle('has-file', !!file);
  u.dropHint.textContent = file ? '' : 'Drag a CSV file here, or';
  u.dropHint.hidden = !!file;
  u.fileLabel.textContent = file ? `${state.fileName} · ${plural(file.records.length, 'row')}` : '';
  u.fileLabel.hidden = !file;
  u.chooseBtn.textContent = file ? 'Change…' : 'Choose file…';
  u.chooseBtn.disabled = isRunning();
  u.fileError.textContent = state.fileError ?? '';
  u.fileError.hidden = !state.fileError;
  setStepDone(u.step2, !!file);
}

function updateMapping(u: NonNullable<typeof ui>) {
  const file = state.file;
  u.step3.section.hidden = !file;
  if (!file) return;

  const problem = mappingProblem();
  const expanded = state.mappingExpanded || !!problem;
  u.mapGrid.hidden = !expanded;
  u.mapSummary.hidden = !!problem;
  u.editMapBtn.textContent = expanded ? 'Done' : 'Edit';
  u.editMapBtn.ariaExpanded = String(expanded);
  u.editMapBtn.disabled = isRunning();

  const mapped = FIELDS.filter((f) => state.mapping[f]);
  const sign = SIGN_MODES.find(([m]) => m === state.signMode)?.[1] ?? '';
  u.chips.replaceChildren(
    ...mapped.map((f) => h('span', { className: 'chip' }, `${state.mapping[f]} → `, h('b', { textContent: FIELD_LABELS[f] }))),
    h('span', { className: 'chip', textContent: sign }),
  );

  const headerOptions: [string, string][] = [['', '— not used —'], ...file.headers.map((hd): [string, string] => [hd, hd])];
  const first = file.records[0];
  for (const field of FIELDS) {
    const select = u.fieldSelects.get(field)!;
    syncSelect(select, headerOptions, state.mapping[field] ?? '');
    select.disabled = isRunning();
    const header = state.mapping[field];
    const sample = header && first ? (first[header] ?? '').trim() : '';
    u.fieldSamples.get(field)!.textContent = sample ? `e.g. ${sample}` : '';
  }
  syncSelect(u.signSelect, SIGN_MODES, state.signMode);
  u.signSelect.disabled = isRunning();

  u.mapWarn.textContent = problem ?? '';
  u.mapWarn.hidden = !problem;
  setStepDone(u.step3, !problem);
}

function stat(label: string, value: string, sub?: string, tone?: string) {
  return h(
    'div',
    { className: `stat${tone ? ` ${tone}` : ''}` },
    h('div', { className: 'label', textContent: label }),
    h('div', { className: 'value', textContent: value }),
    sub && h('div', { className: 'sub', textContent: sub }),
  );
}

function buildTable(p: Preview) {
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      h('th', { className: 'line', textContent: '#', title: 'CSV line' }),
      h('th', { textContent: 'Date' }),
      h('th', { textContent: 'Payee' }),
      h('th', { textContent: 'Category' }),
      h('th', { className: 'num', textContent: 'Amount' }),
    ),
  );
  const body = h(
    'tbody',
    {},
    ...p.rows.slice(0, PREVIEW_LIMIT).map((row) => {
      const matched = matchedCategory(row, p.byName);
      const credit = row.type === CREDIT;
      return h(
        'tr',
        {},
        h('td', { className: 'line', textContent: String(row.line) }),
        h('td', { className: 'date', textContent: formatDate(row.date) }),
        h('td', { className: 'payee' }, row.payee, row.memo && h('span', { className: 'memo', textContent: row.memo })),
        h('td', {
          className: matched ? '' : 'uncat',
          textContent: matched?.name ?? 'Uncategorized',
          title: !matched && row.categoryName ? `"${row.categoryName}" isn't a Money Manager category` : '',
        }),
        h('td', { className: `num ${credit ? 'credit' : 'debit'}`, textContent: `${credit ? '+' : '−'}${money.format(row.amount)}` }),
      );
    }),
  );
  return h('table', {}, head, body);
}

function updateReview(u: NonNullable<typeof ui>, p: Preview | undefined) {
  u.step4.section.hidden = !p;
  if (!p) return;

  u.stats.replaceChildren(
    stat('Ready', String(p.rows.length), 'transactions'),
    stat('Expenses', `−${money.format(p.expenses.total)}`, plural(p.expenses.count, 'row'), 'debit'),
    stat('Income', `+${money.format(p.income.total)}`, plural(p.income.count, 'row'), 'credit'),
    stat('Skipped', String(p.errors.length), 'invalid rows', p.errors.length ? 'warn' : undefined),
    stat('No category', String(p.uncategorized), '→ Uncategorized'),
  );

  const fresh = u.tableKey !== p.key;
  u.errorsBox.hidden = !p.errors.length;
  if (fresh) {
    u.errorsSummary.textContent = `${plural(p.errors.length, 'row')} will be skipped`;
    u.errorsList.replaceChildren(...p.errors.map((e) => h('li', { textContent: `Line ${e.line}: ${e.message}` })));
    u.errorsBox.open = p.errors.length > 0 && p.errors.length <= 5;
  }

  u.unknownBox.hidden = !p.unknown.length;
  u.unknownBox.textContent = p.unknown.length
    ? `Not found in Money Manager, so imported as Uncategorized: ${p.unknown.join(', ')}`
    : '';

  if (fresh) {
    u.tableWrap.replaceChildren(buildTable(p));
    u.tableWrap.scrollTop = 0;
    u.tableKey = p.key;
  }
  u.tableWrap.hidden = !p.rows.length;
  u.tableNote.hidden = p.rows.length <= PREVIEW_LIMIT;
  u.tableNote.textContent = `Showing the first ${PREVIEW_LIMIT} of ${p.rows.length} rows.`;
}

function updateFooter(u: NonNullable<typeof ui>, p: Preview | undefined) {
  const job = state.job;
  const phase = state.phase;
  const running = isRunning();

  // Progress & result
  u.progress.hidden = !job;
  if (job) {
    const verb = job.kind === 'import' ? 'Importing' : 'Deleting';
    u.progressBar.max = Math.max(job.total, 1);
    u.progressBar.value = job.done;
    u.progressBar.hidden = job.finished;
    u.progressLabel.hidden = job.finished;
    u.progressLabel.textContent = `${verb}… ${job.done} of ${job.total}${job.failed ? ` · ${job.failed} failed` : ''}`;

    u.result.hidden = !job.finished;
    if (job.finished) {
      const noun = job.kind === 'import' ? 'Imported' : 'Deleted';
      const where = job.kind === 'import' && job.target ? ` into “${job.target}”` : '';
      const tone = job.ok === job.total ? 'ok' : job.ok > 0 ? 'warn' : 'danger';
      const counts = job.ok === job.total ? `${noun} ${plural(job.ok, 'transaction')}${where}.` : `${noun} ${job.ok} of ${plural(job.total, 'transaction')}${where}.`;
      u.resultText.className = `callout ${tone}`;
      u.resultText.textContent = [counts, job.failed ? `${job.failed} failed.` : '', job.note ?? '', job.ok ? 'Reload Money Manager to see the changes.' : '']
        .filter(Boolean)
        .join(' ');
      u.reloadBtn.hidden = job.ok === 0;
    }
  }

  // Actions
  const blocker = importBlocker(p);
  const reimport = state.importedVersion === state.fileVersion;
  const undoCount = loadUndo().length;
  const confirming = phase === 'confirm-import' || phase === 'confirm-undo';

  u.undoBtn.hidden = running || confirming || !undoCount;
  u.undoBtn.textContent = `Delete last import (${undoCount})`;

  u.importBtn.hidden = phase !== 'idle';
  u.importBtn.disabled = !!blocker;
  u.importBtn.textContent = reimport ? 'Import again' : p?.rows.length ? `Import ${plural(p.rows.length, 'transaction')}` : 'Import';
  u.importBtn.className = reimport ? 'btn' : 'btn primary';

  u.confirmBtn.hidden = !confirming;
  u.cancelBtn.hidden = !confirming;
  u.stopBtn.hidden = !running;
  u.stopBtn.disabled = state.stopRequested;
  u.stopBtn.textContent = state.stopRequested ? 'Stopping…' : 'Stop';

  const account = accounts.get(state.accountGuid);
  u.message.classList.toggle('confirm', confirming);
  if (phase === 'confirm-import') {
    u.message.textContent = reimport
      ? `This file was already imported. Add ${plural(p?.rows.length ?? 0, 'duplicate transaction')} to “${account?.name ?? ''}”?`
      : `Add ${plural(p?.rows.length ?? 0, 'transaction')} to “${account?.name ?? ''}”?`;
    u.confirmBtn.className = 'btn primary';
    u.confirmBtn.textContent = 'Confirm import';
  } else if (phase === 'confirm-undo') {
    u.message.textContent = `Delete ${plural(undoCount, 'transaction')} from the last import? This can't be undone.`;
    u.confirmBtn.className = 'btn danger';
    u.confirmBtn.textContent = 'Delete';
  } else if (running) {
    u.message.textContent = 'Keep this page open until it finishes.';
  } else {
    u.message.textContent = blocker ?? (reimport ? 'Already imported. Importing again creates duplicates.' : '');
  }
}

function update() {
  const u = ui;
  if (!u) return;
  updateChrome(u);
  if (!state.open) return;
  const preview = getPreview();
  updateStatus(u);
  updateAccount(u);
  updateFile(u);
  updateMapping(u);
  updateReview(u, preview);
  updateFooter(u, preview);
}

// ---------------------------------------------------------------------------
// Actions

function setPhase(phase: Phase, focus?: HTMLElement) {
  state.phase = phase;
  update();
  focus?.focus();
}

function appendLog(line: string) {
  if (!ui) return;
  const pre = ui.logPre;
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.append(`${line}\n`);
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function startJob(kind: Job['kind'], total: number, target?: string): Job {
  state.job = { kind, total, done: 0, ok: 0, failed: 0, finished: false, target };
  state.stopRequested = false;
  if (ui) {
    ui.logPre.textContent = '';
    ui.logBox.open = false;
  }
  return state.job;
}

function finishJob(job: Job) {
  job.finished = true;
  state.stopRequested = false;
  setPhase('idle');
  if (ui && state.open) (ui.reloadBtn.hidden ? ui.importBtn : ui.reloadBtn).focus();
}

async function runImport() {
  const preview = getPreview();
  const account = accounts.get(state.accountGuid);
  if (!preview || !account || importBlocker(preview)) return setPhase('idle');

  const rows = preview.rows;
  const job = startJob('import', rows.length, account.name);
  state.importedVersion = state.fileVersion;
  setPhase('importing', ui?.stopBtn);
  const created: string[] = [];
  let failures = 0;

  for (const row of rows) {
    if (state.stopRequested) {
      job.note = 'Stopped before finishing.';
      break;
    }
    const category = resolveCategory(row, preview.byName);
    try {
      const guid = await createTransaction({
        accountGuid: account.guid,
        amount: row.amount,
        type: row.type,
        date: row.date,
        payee: row.payee,
        memo: row.memo,
        category: category && { guid: category.guid, name: category.name },
      });
      created.push(guid);
      saveUndo(created);
      failures = 0;
      job.ok++;
      appendLog(`✓ line ${row.line}: ${row.payee}`);
    } catch (err) {
      failures++;
      job.failed++;
      appendLog(`✗ line ${row.line}: ${(err as Error).message}`);
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        job.note = 'Session rejected. Reload Money Manager and try again.';
        job.done++;
        break;
      }
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        job.note = `Stopped after ${failures} failures in a row.`;
        job.done++;
        break;
      }
    }
    job.done++;
    update();
    await sleep(REQUEST_DELAY_MS);
  }
  finishJob(job);
}

async function runUndo() {
  const guids = loadUndo();
  if (!guids.length) return setPhase('idle');
  const job = startJob('undo', guids.length);
  setPhase('undoing', ui?.stopBtn);
  const remaining = [...guids];

  for (const guid of guids) {
    if (state.stopRequested) {
      job.note = 'Stopped before finishing.';
      break;
    }
    try {
      await deleteTransaction(guid);
      remaining.splice(remaining.indexOf(guid), 1);
      saveUndo(remaining);
      job.ok++;
      appendLog(`✓ deleted ${guid}`);
    } catch (err) {
      job.failed++;
      appendLog(`✗ ${guid}: ${(err as Error).message}`);
    }
    job.done++;
    update();
    await sleep(REQUEST_DELAY_MS);
  }
  finishJob(job);
}

async function loadFile(file: File) {
  if (isRunning()) return;
  state.fileError = undefined;
  if (!/\.(csv|txt)$/i.test(file.name) && file.type && !file.type.startsWith('text/')) {
    state.fileError = `“${file.name}” doesn't look like a CSV file.`;
    return update();
  }
  let parsed: CsvFile;
  try {
    parsed = readCsv(await file.text());
  } catch (err) {
    state.fileError = `Couldn't read “${file.name}”: ${(err as Error).message}`;
    return update();
  }
  if (!parsed.headers.length || !parsed.records.length) {
    state.fileError = `“${file.name}” has no data rows. The first line must be column headers.`;
    return update();
  }
  state.file = parsed;
  state.fileName = file.name;
  state.fileVersion++;
  state.mapping = guessMapping(parsed.headers);
  state.signMode = state.mapping.type ? 'type-column' : 'negative-is-debit';
  state.mappingExpanded = false;
  if (state.job?.finished) state.job = undefined;
  state.phase = 'idle';
  update();
}

function refresh() {
  state.refreshing = true;
  update();
  refreshEntities().finally(() => {
    state.refreshing = false;
    update();
  });
}

function open() {
  state.open = true;
  state.minimized = false;
  if (hasSession() && (!accounts.size || !categories.size)) refresh();
  update();
  const u = ui!;
  const target = !state.accountGuid && !u.accountSelect.disabled ? u.accountSelect : !state.file ? u.chooseBtn : u.closeBtn;
  target.focus();
}

function close() {
  if (state.phase === 'confirm-import' || state.phase === 'confirm-undo') state.phase = 'idle';
  state.open = false;
  update();
  ui?.toggle.focus();
}

function wire(u: NonNullable<typeof ui>) {
  u.toggle.addEventListener('click', open);
  u.closeBtn.addEventListener('click', close);
  u.minimizeBtn.addEventListener('click', () => {
    state.minimized = !state.minimized;
    update();
  });
  u.refreshBtn.addEventListener('click', refresh);

  u.panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (state.phase === 'confirm-import') setPhase('idle', u.importBtn);
    else if (state.phase === 'confirm-undo') setPhase('idle', u.undoBtn);
    else close();
  });

  u.accountSelect.addEventListener('change', () => {
    state.accountGuid = u.accountSelect.value;
    if (state.phase === 'confirm-import') state.phase = 'idle';
    update();
  });

  u.chooseBtn.addEventListener('click', () => u.fileInput.click());
  u.fileInput.addEventListener('change', () => {
    const file = u.fileInput.files?.[0];
    u.fileInput.value = ''; // allow re-picking the same file
    if (file) loadFile(file);
  });

  // Drag-and-drop anywhere on the panel.
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  u.panel.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    u.dropZone.classList.add('dragging');
  });
  u.panel.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = isRunning() ? 'none' : 'copy';
  });
  u.panel.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      u.dropZone.classList.remove('dragging');
    }
  });
  u.panel.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    u.dropZone.classList.remove('dragging');
    const file = e.dataTransfer?.files[0];
    if (state.minimized) state.minimized = false;
    if (file) loadFile(file);
  });

  u.editMapBtn.addEventListener('click', () => {
    state.mappingExpanded = !state.mappingExpanded;
    update();
  });
  for (const [field, select] of u.fieldSelects) {
    select.addEventListener('change', () => {
      if (select.value) state.mapping[field] = select.value;
      else delete state.mapping[field];
      state.mappingExpanded = true;
      if (state.phase === 'confirm-import') state.phase = 'idle';
      update();
    });
  }
  u.signSelect.addEventListener('change', () => {
    state.signMode = u.signSelect.value as SignMode;
    if (state.phase === 'confirm-import') state.phase = 'idle';
    update();
  });

  u.importBtn.addEventListener('click', () => setPhase('confirm-import', u.confirmBtn));
  u.undoBtn.addEventListener('click', () => setPhase('confirm-undo', u.confirmBtn));
  u.cancelBtn.addEventListener('click', () => {
    const back = state.phase === 'confirm-undo' ? u.undoBtn : u.importBtn;
    setPhase('idle', back);
  });
  u.confirmBtn.addEventListener('click', () => {
    if (state.phase === 'confirm-import') runImport();
    else if (state.phase === 'confirm-undo') runUndo();
  });
  u.stopBtn.addEventListener('click', () => {
    state.stopRequested = true;
    update();
  });
  u.reloadBtn.addEventListener('click', () => location.reload());
}

export function mountPanel() {
  const host = h('div', { id: 'becu-csv-import' });
  const root = host.attachShadow({ mode: 'open' });
  ui = buildUi();
  wire(ui);
  root.append(h('style', { textContent: STYLE }), ui.panel, ui.toggle);
  document.body.append(host);
  update();

  // Session data trickles in as the widget loads; batch the updates.
  let pending = 0;
  onSessionChange(() => {
    clearTimeout(pending);
    pending = window.setTimeout(update, 200);
  });
}
