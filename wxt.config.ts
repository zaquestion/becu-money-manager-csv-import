import { defineConfig } from 'wxt';

export default defineConfig({
  // WXT defaults Firefox to MV2.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'CSV Import for BECU Money Manager',
    description:
      'Bulk-import CSV transactions into BECU Money Manager manual accounts. Unofficial; not affiliated with BECU or MX.',
    homepage_url: 'https://github.com/zaquestion/becu-money-manager-csv-import',
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'becu-money-manager-csv-import@zaquestion.github.io',
          // data_collection_permissions needs 140 (MAIN-world content scripts need 128).
          strict_min_version: '140.0',
          // Transactions from the user's CSV are written to their Money Manager (MX).
          data_collection_permissions: { required: ['financialAndPaymentInfo'] },
        },
      },
    }),
  }),
  zip: {
    // Firefox's sources zip; the top-level captures and CSVs hold personal data.
    excludeSources: ['store/**', 'categories', 'delete', 'transaction_tabs', '*.csv', '*.png'],
  },
});
