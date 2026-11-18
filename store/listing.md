# Store listings

Copy-paste text for the Chrome Web Store Developer Dashboard and, where noted under
[Firefox Add-ons (AMO)](#firefox-add-ons-amo), the AMO Developer Hub. Chrome: Upload `.output/becu-import-<version>-chrome.zip`
(built with `pnpm zip`). Store icon: `store/icon-128.png`.

## Name

CSV Import for BECU Money Manager

## Summary (manifest description, max 132 chars)

Bulk-import CSV transactions into BECU Money Manager manual accounts. Unofficial; not affiliated with BECU or MX.

## Category

Tools (or Productivity › Tools)

## Detailed description

Add a whole CSV of transactions to a manual account in BECU Money Manager at once, instead of typing them in one by one.

Open Money Manager in BECU online banking, go to Transactions, and click "Import CSV" next to "Export CSV". Pick a manual account and a CSV file, check the column mapping and preview, and import.

Features
• Works with simple Date / Payee / Amount files, plus optional Category, Memo and Type columns
• Reads credit-card exports (Date, Amount, Type, Status, Merchant, …) with no setup; voided and declined rows are skipped, pending rows are optional
• Accepts dates like 2026-10-22 or 10/22/2026, and amounts like -4.50, $1,200.00 or (12.00)
• Matches category names to your Money Manager categories, and fills in categories from your earlier transactions with the same payee
• Skips transactions that are already in the account, even after you rename or recategorize them, and flags possible duplicates for review, so overlapping exports can be imported safely
• "Delete last import" undoes the most recent import

Works elsewhere too
BECU Money Manager is built on MX's Money Manager widget (widgets.moneydesktop.com). This extension talks to that widget the same way its own buttons do, so it may also work with Money Manager at other banks and credit unions that use MX. Only BECU has been tested.

Privacy
The extension runs only on widgets.moneydesktop.com. It sends requests only to Money Manager itself, using your existing signed-in session. Nothing is collected, tracked, or sent anywhere else. Your CSV is read in the browser and never uploaded except as the transactions you choose to import.

Open source: https://github.com/zaquestion/becu-money-manager-csv-import

This is an independent project. It is not made, endorsed, or supported by BECU or MX Technologies.

## Single purpose (Privacy practices tab)

Imports transactions from a CSV file into manual accounts in BECU Money Manager (MX Money Manager).

## Host permission justification

The content script runs on widgets.moneydesktop.com, where Money Manager is hosted, to add the Import CSV button and to create transactions in the user's manual account through Money Manager's own API, using the session the page already has. It does not run on any other site.

## Remote code

No, I am not using remote code. All code is bundled in the package.

## Data usage disclosures

Tick: **Financial and payment information** (transaction dates, amounts, payees, which the user imports into their own account) and **Authentication information** (the extension reuses the page's Money Manager session token to make the same requests the page makes).

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Firefox Add-ons (AMO)

Upload `.output/becu-import-<version>-firefox.zip`, then `.output/becu-import-<version>-sources.zip`
when asked for source code (both from `pnpm zip:firefox`). Add-on ID:
`becu-money-manager-csv-import@zaquestion.github.io`. Requires Firefox 140+. Reuse the name, the
detailed description, the icon and the screenshots from above.

**Summary (max 250 chars):** Bulk-import CSV transactions into BECU Money Manager manual accounts.
Unofficial; not affiliated with BECU or MX.

**Categories:** Other

**Tags:** csv, import, budget, finance, money manager, bank

**Support site:** https://github.com/zaquestion/becu-money-manager-csv-import/issues

**Homepage:** https://github.com/zaquestion/becu-money-manager-csv-import

**License:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later), as in `LICENSE`.

**Privacy policy:** paste the quoted text under [Privacy policy](#privacy-policy) below.

**Data collection (from the manifest):** Financial and payment information, required. Transactions
from the CSV the user picks are written to their own Money Manager manual account when they click
Import. Nothing is sent to the developer.

**Notes to reviewer:**

> Built with WXT (Vite). To reproduce the uploaded zip from the sources zip: Node 22 and pnpm
> 12.15.0 (pinned in package.json `packageManager`; `corepack enable` selects it), then
> `pnpm install --frozen-lockfile && pnpm zip:firefox`. The build is in `.output/firefox-mv3/`
> and the zip in `.output/`. No remote code; everything is bundled.
>
> Testing needs a BECU online banking account (Money Manager runs at widgets.moneydesktop.com
> inside it), so it can't be tried without one; `samples/test-import.csv` is a sample file. The
> only script is a MAIN-world content script on widgets.moneydesktop.com. It wraps fetch/XHR to
> reuse the widget's session headers and read the accounts, categories and transactions it loads,
> and adds an Import CSV button. The CSV is parsed locally (papaparse); on Import it sends the
> widget's own `POST /transactions` request per row, and "Delete last import" sends its
> `DELETE /transactions/{guid}`. A ledger of created transactions is kept in the page's
> localStorage to skip duplicates.

## Privacy policy

The dashboard needs a URL. You could link to this section on GitHub, or add a PRIVACY.md with:

> CSV Import for BECU Money Manager does not collect, store on any server, sell, or share any personal data. It runs only on widgets.moneydesktop.com. CSV files you pick are read locally in your browser. Transactions you choose to import are sent only to Money Manager, using your existing signed-in session. To avoid importing duplicates, the extension keeps a list of the transactions it created (date, amount, original payee, account and transaction IDs) in your browser's local storage for widgets.moneydesktop.com; it never leaves your device. The developer receives no data. Questions: open an issue at https://github.com/zaquestion/becu-money-manager-csv-import/issues
