# BECU Money Manager CSV Import

Chromium extension (TypeScript + [WXT](https://wxt.dev)) that bulk-adds
transactions to a manual account in BECU Money Manager, which is MX's
widget hosted at `widgets.moneydesktop.com`.

## Build & load

```sh
npm install
npm run build        # or `npm run dev` for live reload
```

Open `chrome://extensions`, enable Developer mode, then click **Load unpacked**
and pick `.output/chrome-mv3`.

## Use

1. Open Money Manager in BECU online banking and let it load.
2. Click **CSV import** (bottom-right of the Money Manager frame).
3. Pick the manual account and the CSV file.
4. Check the column mapping and the preview, then click **Import**.

CSV columns: `date`, `payee`, `amount` (required); `category`, `memo`, `type`
(optional). Dates can be `YYYY-MM-DD` or `M/D/YYYY`. Amounts can look like
`-4.50`, `$1,200.00` or `(12.00)`. Category names match MX categories
(parent or subcategory) case-insensitively. Rows with an unknown or blank
category are imported as "Uncategorized".

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
