import { defineContentScript } from '#imports';
import { mountPanel } from '@/lib/panel';
import { installHooks } from '@/lib/session';

export default defineContentScript({
  matches: ['https://widgets.moneydesktop.com/*'],
  allFrames: true,
  runAt: 'document_start',
  // MAIN world so our fetch/XHR wrappers see the widget's own requests.
  world: 'MAIN',
  main() {
    installHooks();
    // Only show the UI in the Money Manager app document itself.
    if (!location.pathname.startsWith('/md/')) return;
    if (document.body) mountPanel();
    else document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  },
});
