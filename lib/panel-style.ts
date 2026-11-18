export const STYLE = `
  :host {
    all: initial;
    --bg: #ffffff;
    --fg: #1d2433;
    --muted: #667085;
    --border: #e4e7ec;
    --subtle: #f5f6f8;
    --accent: #0b5394;
    --accent-hover: #094377;
    --accent-fg: #ffffff;
    --ok: #137333;
    --ok-bg: #e7f4ea;
    --warn: #8a5300;
    --warn-bg: #fff4dd;
    --danger: #b42318;
    --danger-bg: #fdecea;
    --focus: #2f7de1;
    --shadow: 0 8px 32px rgba(16, 24, 40, .24), 0 2px 6px rgba(16, 24, 40, .12);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--fg);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --bg: #1c1f26;
      --fg: #e6e8ec;
      --muted: #9aa3b2;
      --border: #343a46;
      --subtle: #252a33;
      --accent: #4c8fd6;
      --accent-hover: #6aa5e3;
      --accent-fg: #0d1117;
      --ok: #6fcf8a;
      --ok-bg: #1d3325;
      --warn: #f0b95b;
      --warn-bg: #3a2e17;
      --danger: #f28b82;
      --danger-bg: #3b1f1d;
      --focus: #79b0ff;
      --shadow: 0 8px 32px rgba(0, 0, 0, .55);
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, select, input { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* Launcher */
  .toggle {
    position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
    display: flex; align-items: center; gap: 6px; padding: 6px 12px;
    border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-fg);
    font-size: 12px; font-weight: 600; cursor: pointer; opacity: .8; box-shadow: var(--shadow);
    transition: opacity .15s;
  }
  .toggle:hover, .toggle:focus-visible, .toggle.running { opacity: 1; }

  /* Panel shell */
  .panel {
    position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
    width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
    overflow: hidden;
  }
  .panel.minimized { width: min(320px, calc(100vw - 24px)); }
  .panel.minimized .content, .panel.minimized footer { display: none; }

  header {
    display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .panel.minimized header { border-bottom: 0; }
  h2 { margin: 0; font-size: 15px; font-weight: 650; }
  .spacer { flex: 1; }
  .icon {
    width: 28px; height: 28px; display: grid; place-items: center;
    border: 0; border-radius: 6px; background: transparent; color: var(--muted);
    font-size: 18px; line-height: 1; cursor: pointer;
  }
  .icon:hover { background: var(--subtle); color: var(--fg); }

  .pill {
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
    background: var(--subtle); color: var(--muted);
  }
  .pill.ok { background: var(--ok-bg); color: var(--ok); }
  .pill.warn { background: var(--warn-bg); color: var(--warn); }
  .pill.info { background: var(--subtle); color: var(--accent); }

  .content { overflow: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 16px; }

  /* Readiness */
  .status { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-radius: 8px; background: var(--subtle); }
  .checklist { list-style: none; margin: 0; padding: 0; flex: 1; display: grid; gap: 4px; }
  .checklist li { display: grid; grid-template-columns: 16px 1fr; column-gap: 6px; }
  .checklist .mark { font-weight: 700; }
  .checklist .ok .mark { color: var(--ok); }
  .checklist .pending .mark { color: var(--warn); }
  .checklist .hint { grid-column: 2; color: var(--muted); font-size: 12px; }

  /* Steps */
  .step { display: flex; flex-direction: column; gap: 8px; padding-left: 28px; min-width: 0; }
  h3 { margin: 0 0 0 -28px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; }
  .badge {
    width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%;
    background: var(--subtle); color: var(--muted); font-size: 11px; font-weight: 700;
    border: 1px solid var(--border);
  }
  .step.done .badge { background: var(--ok); border-color: var(--ok); color: var(--bg); }

  select {
    width: 100%; min-height: 30px; padding: 4px 8px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  }
  select:disabled { opacity: .6; }

  .hint { margin: 0; color: var(--muted); font-size: 12px; }

  .drop {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 14px;
    border: 1.5px dashed var(--border); border-radius: 8px; color: var(--muted);
    transition: border-color .15s, background .15s;
  }
  .drop.has-file { border-style: solid; color: var(--fg); }
  .drop.dragging { border-color: var(--accent); background: var(--subtle); }
  .file-name { font-weight: 600; color: var(--fg); overflow-wrap: anywhere; }

  .map-summary { display: flex; align-items: flex-start; gap: 8px; }
  .chips { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { padding: 1px 8px; border-radius: 999px; background: var(--subtle); border: 1px solid var(--border); font-size: 12px; }
  .chip b { font-weight: 600; }
  .grid { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; align-items: center; }
  .field { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .field select { flex: 0 1 200px; }
  .sample { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
    .field select { flex: 1; }
  }

  /* Review */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 6px; }
  .stat { padding: 8px 10px; border-radius: 8px; background: var(--subtle); }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
  .stat .value { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .stat .sub { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .stat.debit .value { color: var(--danger); }
  .stat.credit .value { color: var(--ok); }
  .stat.warn { background: var(--warn-bg); }
  .stat.warn .value { color: var(--warn); }

  .callout { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; }
  .callout.ok { background: var(--ok-bg); color: var(--ok); }
  .callout.warn { background: var(--warn-bg); color: var(--warn); }
  .callout.danger { background: var(--danger-bg); color: var(--danger); }
  .callout summary { cursor: pointer; font-weight: 600; }
  .callout ul { margin: 6px 0 0; padding-left: 18px; max-height: 120px; overflow: auto; }

  .table-wrap { max-height: 280px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  th { position: sticky; top: 0; background: var(--subtle); font-weight: 600; color: var(--muted); }
  td.line { color: var(--muted); font-variant-numeric: tabular-nums; }
  td.date { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.payee { max-width: 200px; overflow-wrap: anywhere; }
  .memo { display: block; color: var(--muted); font-size: 11px; }
  td.uncat { color: var(--muted); font-style: italic; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.debit { color: var(--danger); }
  td.credit { color: var(--ok); }
  tr.skip td { color: var(--muted); }
  tr.skip td.payee { text-decoration: line-through; text-decoration-color: var(--border); }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--subtle); color: var(--muted); font-size: 11px; text-decoration: none; }
  .tag.pending { background: var(--warn-bg); color: var(--warn); }
  .tag.possible { background: var(--warn-bg); color: var(--warn); }
  tr.possible td.payee { text-decoration: none; }
  .review { display: block; margin-top: 4px; }
  .review label { display: inline-flex; align-items: center; gap: 4px; color: var(--fg); font-weight: 600; cursor: pointer; }
  .review input { margin: 0; }
  td.learned { color: var(--fg); }

  .option { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .option[hidden] { display: none; }
  .option input { margin: 2px 0 0; }

  /* Footer */
  footer { border-top: 1px solid var(--border); padding: 10px 16px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
  .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .message { flex: 1; min-width: 140px; color: var(--muted); font-size: 12px; }
  .message.confirm { color: var(--fg); font-weight: 600; }

  .btn {
    min-height: 30px; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-weight: 600;
    border: 1px solid var(--border); background: var(--bg);
  }
  .btn:hover:not(:disabled) { background: var(--subtle); }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
  .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: var(--bg); }
  .btn.quiet { border-color: transparent; color: var(--muted); font-weight: 500; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 12px; font-weight: 600; }
  .link:disabled { color: var(--muted); cursor: default; }

  .progress { display: flex; flex-direction: column; gap: 6px; }
  .progress-label { font-size: 12px; font-variant-numeric: tabular-nums; }
  progress { width: 100%; height: 6px; appearance: none; border: 0; border-radius: 999px; background: var(--subtle); overflow: hidden; }
  progress::-webkit-progress-bar { background: var(--subtle); }
  progress::-webkit-progress-value { background: var(--accent); transition: width .2s; }
  .result { display: flex; align-items: center; gap: 8px; }
  .result .callout { flex: 1; }
  .log summary { cursor: pointer; font-size: 12px; color: var(--muted); }
  .log pre {
    margin: 6px 0 0; max-height: 120px; overflow: auto; padding: 8px; border-radius: 6px;
    background: var(--subtle); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
  }
`;
