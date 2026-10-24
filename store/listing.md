# Chrome Web Store listing

Copy-paste text for the Developer Dashboard. Upload `.output/becu-import-<version>-chrome.zip`
(built with `pnpm zip`).

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
• Matches category names to your Money Manager categories
• Skips transactions that are already in the account, so overlapping exports can be imported safely
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

## Privacy policy

The dashboard needs a URL. You could link to this section on GitHub, or add a PRIVACY.md with:

> CSV Import for BECU Money Manager does not collect, store on any server, sell, or share any personal data. It runs only on widgets.moneydesktop.com. CSV files you pick are read locally in your browser. Transactions you choose to import are sent only to Money Manager, using your existing signed-in session. To avoid importing duplicates, the extension keeps a list of the transactions it created (date, amount, account and transaction IDs) in your browser's local storage for widgets.moneydesktop.com; it never leaves your device. The developer receives no data. Questions: open an issue at https://github.com/zaquestion/becu-money-manager-csv-import/issues
