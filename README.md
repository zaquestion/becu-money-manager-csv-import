# BECU Money Manager CSV Import

Chrome and Firefox extension (TypeScript + [WXT](https://wxt.dev)) that bulk-adds
transactions to a manual account in BECU Money Manager, which is MX's
widget hosted at `widgets.moneydesktop.com`.

## Build & load

```sh
pnpm install
pnpm build           # or `pnpm dev` for live reload
```

Open `chrome://extensions`, enable Developer mode, then click **Load unpacked**
and pick `.output/chrome-mv3`.

For Firefox (140 or later), use `pnpm build:firefox` (or `pnpm dev:firefox`),
then open `about:debugging#/runtime/this-firefox`, click **Load Temporary
Add-on…** and pick `.output/firefox-mv3/manifest.json`.

## Release

Publish a GitHub release with a tag like `v0.2.0`. The `Release` workflow sets
the extension version from the tag, attaches the Chrome, Firefox and sources
zips to the release and submits them to the Chrome Web Store and Firefox Add-ons
(AMO), where they go live after review. The version must be higher than the one
currently in each store.

### Chrome Web Store

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

### Firefox Add-ons

AMO reviews the built code against the sources zip (`pnpm zip:firefox` writes
both; `store/` and the raw captures are left out). The add-on ID
`becu-money-manager-csv-import@zaquestion.github.io` is set in `wxt.config.ts`.
One-time setup:

1. Submit the first version by hand at
   <https://addons.mozilla.org/developers/addon/submit/> (the API can only add
   versions to an existing add-on): upload the Firefox zip, then the sources
   zip, and fill in the listing from `store/listing.md`.
2. Create API credentials at
   <https://addons.mozilla.org/developers/addon/api/key/> and add them as
   repository secrets `FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET`.

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
(parent or subcategory) case-insensitively.

### Categories

Money Manager's categorization rules don't run on transactions added to a
manual account, so the extension learns them itself. For each row without a
usable `category` column, it looks at the transactions Money Manager has
loaded (in every account) for the same payee and copies the category you, or
Money Manager, gave them most often. Payees are compared loosely: processor
prefixes (`SQ *`, `TST*`, …), store numbers and reference codes are ignored,
and "Blue Bottle Coffee 4471" or "UBER *TRIP" can fall back to an earlier
"Blue Bottle" or "Uber" when that payee's category is clear-cut. Transactions
this tool imported are also matched by their original CSV payee (from the
import tag below), so renaming one in Money Manager doesn't break learning.
Learned categories are marked ✦ in the preview; rows with nothing to learn
from are imported without a category.

Credit-card exports with `Date,Amount,Currency,Type,Status,Merchant,…` columns
work with no setup: `Merchant` is the payee, `Type` decides direction
(`PURCHASE`/`FEE` are expenses, `PAYMENT`/`REFUND` are income), and a blank
merchant falls back to the type (e.g. "Payment"). `Status` is honored:
`VOIDED`/`DECLINED` rows are never imported, and `AUTHORIZED`/`PENDING` rows
are skipped unless you tick the box, since their amount can still change.

### Duplicates

Import overlapping exports as often as you like; only new transactions are
added. Every imported transaction gets an import tag appended to its memo,
recording the CSV row it came from:

```
[import 2026-11-01 -4.50 SQ *BLUE BOTTLE #12]
```

Leave the tag in place: it's how the transaction is recognized after you
rename it, recategorize it or change its amount (e.g. adding a tip). Each row
is checked in this order:

1. **Already imported:** a transaction in the account has the same tag (same
   date, amount, direction and original payee). Skipped.
2. **Already imported:** this browser's ledger of what the extension created
   has a transaction with the same date, amount and direction, from before
   tags existed or whose memo didn't stick. Skipped.
3. **Possible duplicate:** some other transaction in the account has the same
   date, amount and direction (entered by hand, or imported from an export
   that named the merchant differently). Flagged in the preview and skipped
   unless you tick **Import anyway** for that row.

Each existing transaction matches at most one row, so identical rows in one
file are counted: two $5 rides on the same day against one $5 ride already in
the account gives one match and one new row.

Matching uses the transactions Money Manager has loaded on the page plus the
ledger, which is kept in the browser's storage for `widgets.moneydesktop.com`
(per browser profile). The preview warns about rows older than anything
Money Manager has loaded; widen the date range on the Transactions tab to
check those too. Deleting a transaction ("Delete last import", or in Money
Manager while the extension is loaded) removes it from the ledger so it can
be imported again. If you delete one some other way, tick "Ignore duplicate
checks".

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
- whether `memo` is accepted when a transaction is created (the ledger also
  keeps each import's tag, so dedup in the same browser works either way)
- that loaded transactions carry `description`, `memo`, `category_guid` and
  `original_description`, which category learning and tag matching read

## License

[AGPL-3.0-or-later](LICENSE). Copyright 2026 Zaq Question.
