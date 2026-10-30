/**
 * Catalog: the guide, where things stand, settings, your AI agent's limits,
 * search, activity and the platform list.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const LEVEL = { enum: ['ask', 'auto'] };

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', effect: 'read', desc: 'START HERE: how Store OS works, the rules, the row formats for bringing in orders, conversations and products, and the recipe for every kind of task.', params: {} },
  { name: 'app.status', method: 'GET', fn: 'lib_app.status', effect: 'read', desc: 'Where the store stands: set up or not, the shops (with their sync and setup state), what needs attention (orders to ship and late, messages due, approvals, listing issues, low stock, missing costs) and your open tasks.', params: {} },
  { name: 'app.convert', method: 'GET', fn: 'lib_app.convert', effect: 'read', desc: "Convert an amount between currencies at the store's exchange rates (to price a listing in a shop's currency).", params: { amount: N('The amount (major units)', { required: true }), from: S('Its currency, e.g. MYR (default: the base currency)'), to: S('The currency wanted, e.g. SGD', { required: true }) } },
  { name: 'app.home', method: 'GET', fn: 'lib_reports.home', effect: 'read', desc: 'Everything the Home page shows (about 14 KB): settings, shops, attention counts, the sales report with its daily series, recent orders and activity. To answer the seller, reports.overview (figures) and reports.attention (what needs them, late orders named) are a quarter of the size.', params: { range: S('7d | 30d | 90d | 12m (default 30d)', { enum: ['7d', '30d', '90d', '12m'] }), shop: S('Only this shop (id or name)') } },
  { name: 'app.search', method: 'GET', fn: 'lib_app.search', effect: 'read', desc: 'Search orders (number, buyer), products (title, SKU, barcode), customers and conversations at once.', params: { q: S('What to look for', { required: true }) } },
  { name: 'app.export', method: 'GET', fn: 'lib_app.exportAll', effect: 'read', desc: 'Everything in the store as one JSON document (shops, catalog, stock ledger, orders, customers, conversations, proposals).', params: {} },
  { name: 'platforms.list', method: 'GET', fn: 'lib_shops.platforms', effect: 'read', desc: 'The platforms a shop can be on (id, kind, countries, title limit (0: no fixed limit known, not checked), seller sign-up and seller centre links), the countries and the currencies.', params: {} },
  { name: 'settings.get', method: 'GET', fn: 'lib_app.settingsGet', effect: 'read', desc: "The business, base currency, country, time zone, your AI agent's limits (autonomy), guards, buyer-data period, low-stock default and exchange rates.", params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_app.settingsUpdate',
    effect: 'write',
    desc: 'Change the business details and rules. The base currency cannot change once products have prices.',
    params: {
      business_name: S('The business name'),
      owner_name: S('What to call the seller'),
      country: S('Country code, e.g. MY'),
      base_currency: S('Currency of product prices, costs and reports, e.g. MYR'),
      timezone: S('IANA time zone, e.g. Asia/Kuala_Lumpur'),
      utc_offset: N("Minutes east of UTC in the seller's time zone (Malaysia 480); reports count days by it. The app keeps it equal to timezone, so set timezone instead."),
      pii_days: N('Days to keep buyer addresses and phone numbers after an order is finished (7 to 3650)'),
      low_stock: N('Default low-stock level per SKU'),
      max_price_drop_pct: N('A proposed price drop larger than this percentage is marked high risk'),
      min_margin_pct: N('Margin below which prices are flagged'),
      onboarded: B('The seller finished the first-run setup'),
    },
  },
  {
    name: 'settings.autonomy',
    method: 'POST',
    fn: 'lib_app.autonomy',
    effect: 'confirm',
    agent: 'deny',
    press: 'the switches under "Your AI agent" in Settings',
    desc: 'What your AI agent may change without asking: ask (it proposes, the seller approves) or auto, per kind of change.',
    params: { listings: S('Listing text and price', LEVEL), prices: S('SKU prices', LEVEL), stock: S('Stock changes', LEVEL), replies: S('Sending buyer replies', LEVEL), orders: S('Cancelling, refunding and returns', LEVEL) },
  },
  { name: 'settings.fx-refresh', method: 'POST', fn: 'lib_app.fxRefresh', effect: 'write', desc: "Fetch today's exchange rates against the base currency now (they also refresh every six hours).", params: {} },
  { name: 'activity.list', method: 'GET', fn: 'lib_app.activity', effect: 'read', desc: 'Who changed what, newest first.', params: { limit: N('Rows (default 40)'), target: S('Only this target, e.g. order:<id>, shop:<id>, product:<id>') } },
];
