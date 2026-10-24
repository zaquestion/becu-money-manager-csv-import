# BECU Money Manager CSV Import

Chromium extension (TypeScript + [WXT](https://wxt.dev)) that bulk-adds
transactions to a manual account in BECU Money Manager, which is MX's
widget hosted at `widgets.moneydesktop.com`.

## Build & load

```sh
pnpm install
pnpm build           # or `pnpm dev` for live reload
```

Open `chrome://extensions`, enable Developer mode, then click **Load unpacked**
and pick `.output/chrome-mv3`.

## Release

Publish a GitHub release with a tag like `v0.2.0`. The `Release` workflow sets
the extension version from the tag, attaches the zip to the release and submits
it to the Chrome Web Store, where it goes live after review. The version must be
higher than the one currently in the store.

The workflow uses the Chrome Web Store API v2 with a service account. One-time
setup:

1. In Google Cloud, enable the Chrome Web Store API, create a service account
   (no roles needed) and create a JSON key for it.
2. In the Chrome Web Store Developer Dashboard, add the service account's email
   under **Account**.
3. Add these repository secrets (the extension and publisher IDs are set in
   the workflow):
   - `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` (`client_email` from the key)
   - `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` (`private_key` from the key, pasted as
     the multi-line PEM, not with literal `\n`)

## Use

1. Open Money Manager in BECU online banking and let it load.
2. Open the Transactions tab and click **Import CSV** next to **Export CSV**.
   (If it can't be placed there, a **CSV import** button appears at the
   bottom-right of the Money Manager frame instead.)
3. Pick the manual account and the CSV file.
4. Check the column mapping and the preview, then click **Import**.

CSV columns: `date`, `payee`, `amount` (required); `category`, `memo`, `type`
(optional). Dates can be `YYYY-MM-DD` or `M/D/YYYY`. Amounts can look like
`-4.50`, `$1,200.00` or `(12.00)`. Category names match MX categories
(parent or subcategory) case-insensitively. Rows with an unknown or blank
category are imported with no category, so Money Manager applies its own
categorization rules.

Credit-card exports with `Date,Amount,Currency,Type,Status,Merchant,…` columns
work with no setup: `Merchant` is the payee, `Type` decides direction
(`PURCHASE`/`FEE` are expenses, `PAYMENT`/`REFUND` are income), and a blank
merchant falls back to the type (e.g. "Payment"). `Status` is honored:
`VOIDED`/`DECLINED` rows are never imported, and `AUTHORIZED`/`PENDING` rows
are skipped unless you tick the box, since their amount can still change.

### Duplicates

Import overlapping exports as often as you like; only new transactions are
added. A row counts as already imported when the account already has a
transaction with the same date, amount and direction (identical rows in one
file are counted, so two $5 rides on the same day both import). "Already in"
comes from:

- a ledger of every transaction this extension created, kept in the browser's
  storage for `widgets.moneydesktop.com` (per browser profile), and
- transactions Money Manager itself has loaded on the page.

Deleting a transaction ("Delete last import", or in Money Manager while the
extension is loaded) removes it from the ledger so it can be imported again.
If you delete one some other way, tick "Import rows that match … anyway".

## How it works

The content script runs in the page's main world and wraps `fetch`/`XHR`:

- It copies `md-session-token` and the `x-inter-*` headers from the widget's
  own requests.
- It picks up accounts (`ACT-…`) and categories (`CAT-…`) from the JSON the
  widget already loads.

Each row becomes a `POST /transactions` with the same body the UI sends
(`transaction_type` 1 = credit, 2 = debit, `date` = unix seconds at midnight UTC).
"Delete last import" sends `DELETE /transactions/{guid}` for each created
transaction, the same request the widget sends.

## Unverified assumptions

- `GET /accounts` (fallback when the widget's own load happened before the
  hooks were installed). `GET /categories` is confirmed: it returns
  `{"categories": [{guid, name, parent_guid, …}]}`.
- whether `memo` is accepted when a transaction is created
