/// <reference path="../pb_data/types.d.ts" />
/**
 * Custom agent operations for Invoice & Subscription Tracker.
 */

// invoices.simulate-bill — simulate incoming email bill (the feed's Refresh Feed).
// The logic is lib_agent.simulateBill: the bill is filed in the `group` workspace
// (id, exact name or 'all'; default the newest), like a manual entry.
routerAdd('POST', '/api/ops/invoices/simulate-bill', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.simulateBill(app, p));
});
