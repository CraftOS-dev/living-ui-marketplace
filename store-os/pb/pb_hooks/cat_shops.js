/**
 * Catalog: shops, their setup checklist, rules and policies, and syncing.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PLATFORMS = ['shopify', 'woocommerce', 'shopee', 'lazada', 'tiktok_shop', 'amazon', 'ebay', 'etsy', 'tokopedia', 'zalora', 'rakuten', 'yahoo_shopping', 'walmart', 'mercado_libre', 'direct', 'other'];
const SHOP = S('The shop (id or name)', { required: true });
const FIELDS = {
  name: S('Shop name (unique), e.g. "Shopee MY"'),
  region: S('Country code the shop sells in, e.g. MY'),
  currency: S("Currency of the shop's prices and orders, e.g. MYR"),
  url: S("The shop's public link"),
  admin_url: S("The shop's seller centre or admin link"),
  connection: S('How its data comes in: agent (your AI agent syncs it), files (seller-centre exports), manual', { enum: ['agent', 'files', 'manual'] }),
};

module.exports = [
  { name: 'shops.list', method: 'GET', fn: 'lib_shops.list', effect: 'read', desc: 'Every shop with its platform, currency, status, connection, setup progress, last sync, orders to ship, open conversations, live listings and any task your AI agent is on.', params: {} },
  { name: 'shops.get', method: 'GET', fn: 'lib_shops.get', effect: 'read', desc: 'One shop: everything in shops.list plus its setup checklist (steps with links), fee rates, ship-by days, reply hours, stock rule, policies, recent imports and tasks.', params: { shop: SHOP } },
  {
    name: 'shops.add',
    method: 'POST',
    fn: 'lib_shops.add',
    effect: 'write',
    desc: 'Add a shop you have, or start opening a new one (opening=true starts its setup checklist). Two shops on one platform are two shops with their own names.',
    params: Object.assign({ platform: S('The platform', { required: true, enum: PLATFORMS }), opening: B('true when the shop is not open yet (shows the setup checklist)') }, FIELDS),
  },
  {
    name: 'shops.update',
    method: 'POST',
    fn: 'lib_shops.update',
    effect: 'write',
    desc: 'Change a shop: details, status, connection, fee rates (used to estimate profit until real fees arrive), days to ship, reply hours and the stock rule.',
    params: Object.assign(
      {
        shop: SHOP,
        status: S('setting_up | active | paused', { enum: ['setting_up', 'active', 'paused'] }),
        commission_pct: N('Commission the platform takes on items, in percent'),
        payment_pct: N('Payment or transaction fee on the order total, in percent'),
        fixed_fee: N("Fixed fee per order, in the shop's currency"),
        ship_days: N('Days from order to hand-over (the ship-by clock)'),
        reply_hours: N('Hours to answer a buyer (the reply clock)'),
        stock_share: N('Percent of available stock the shop shows (0 to 100)'),
        stock_buffer: N('Units held back from this shop'),
        stock_max: N('Most units the shop shows (0: no limit)'),
      },
      FIELDS,
    ),
  },
  { name: 'shops.policies', method: 'POST', fn: 'lib_shops.policies', effect: 'write', desc: "Write the shop's return, shipping and FAQ text and the reply voice; your AI agent quotes them when it answers buyers.", params: { shop: SHOP, returns: S('Return and refund policy'), shipping: S('Shipping and delivery policy'), faq: S('Answers to common questions'), voice: S('How replies should sound, e.g. "friendly, short, sign as Aina"') } },
  { name: 'shops.step', method: 'POST', fn: 'lib_shops.step', effect: 'write', desc: "Tick (or untick) a step of the shop's setup checklist. When every step is done, a shop being opened becomes active.", params: { shop: SHOP, step: S('Step key from shops.get steps', { required: true }), done: B('false to untick (default true)') } },
  { name: 'shops.remove', method: 'POST', fn: 'lib_shops.remove', effect: 'write', agent: 'deny', destructive: true, lookup: 'lib_shops.lookupName', press: "Delete shop in the shop's settings", desc: 'Delete a shop with its orders, listings and conversations. The Direct shop stays.', params: { shop: SHOP } },
  { name: 'shops.sync', method: 'POST', fn: 'lib_shops.requestSync', effect: 'write', desc: "Ask your AI agent to bring in the shop's new orders, buyer messages and listings (a sync task).", params: { shop: SHOP } },
  { name: 'shops.help', method: 'POST', fn: 'lib_shops.requestHelp', effect: 'write', desc: 'Ask your AI agent to help with one setup step of a shop (a setup_help task).', params: { shop: SHOP, step: S('Step key', { required: true }), note: S('Anything the seller wants it to know') } },
  { name: 'shops.sync-finish', method: 'POST', fn: 'lib_shops.syncFinish', effect: 'write', desc: 'Your AI agent: record that a sync ended (sets the last sync time unless failed) and finish the sync task.', params: { shop: SHOP, note: S('What came in, e.g. "12 new orders, 3 updated, 4 messages"'), failed: B('true when the sync could not be done') } },
];
