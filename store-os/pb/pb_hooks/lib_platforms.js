/**
 * The platforms a shop can live on, the countries a shop can sell in, and
 * the setup checklist for opening a shop. Plain data (Node reads it too).
 *
 * Opening a seller account cannot be done for you through any platform's API
 * (identity, bank and tax checks happen on the platform's own pages), so the
 * checklist links to those pages and records what is done; your AI agent can
 * help with the steps marked `help`.
 *
 * title_max is only set where the limit is firm and well known; 0 means the
 * app does not check it.
 */

const COUNTRIES = [
  { code: 'MY', name: 'Malaysia', currency: 'MYR' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR' },
  { code: 'TH', name: 'Thailand', currency: 'THB' },
  { code: 'PH', name: 'Philippines', currency: 'PHP' },
  { code: 'VN', name: 'Vietnam', currency: 'VND' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'KR', name: 'South Korea', currency: 'KRW' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD' },
  { code: 'CN', name: 'China', currency: 'CNY' },
  { code: 'IN', name: 'India', currency: 'INR' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'MX', name: 'Mexico', currency: 'MXN' },
  { code: 'BR', name: 'Brazil', currency: 'BRL' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
];

const CURRENCIES = ['MYR', 'SGD', 'IDR', 'THB', 'PHP', 'VND', 'JPY', 'KRW', 'TWD', 'HKD', 'CNY', 'INR', 'AUD', 'NZD', 'USD', 'CAD', 'MXN', 'BRL', 'GBP', 'EUR', 'AED', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'ZAR', 'SAR'];

// Where to open a seller account, and the seller centre, per country where the
// platform runs a local site. `*` is the fallback for every other country.
const PLATFORMS = [
  {
    id: 'shopify',
    name: 'Shopify',
    kind: 'store',
    blurb: 'Your own online store',
    regions: ['*'],
    ship_days: 2,
    title_max: 255,
    chat: 'email',
    start: { '*': 'www.shopify.com/free-trial' },
    admin: { '*': 'admin.shopify.com' },
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    kind: 'store',
    blurb: 'A store on your WordPress site',
    regions: ['*'],
    ship_days: 2,
    title_max: 0,
    chat: 'email',
    start: { '*': 'woocommerce.com/start/' },
    admin: {},
  },
  {
    id: 'shopee',
    name: 'Shopee',
    kind: 'marketplace',
    blurb: 'Marketplace across Southeast Asia and Taiwan',
    regions: ['MY', 'SG', 'ID', 'TH', 'PH', 'VN', 'TW', 'BR'],
    ship_days: 2,
    title_max: 120,
    chat: 'marketplace',
    start: { MY: 'seller.shopee.com.my', SG: 'seller.shopee.sg', ID: 'seller.shopee.co.id', TH: 'seller.shopee.co.th', PH: 'seller.shopee.ph', VN: 'banhang.shopee.vn', TW: 'seller.shopee.tw', BR: 'seller.shopee.com.br', '*': 'shopee.com' },
    admin: { MY: 'seller.shopee.com.my', SG: 'seller.shopee.sg', ID: 'seller.shopee.co.id', TH: 'seller.shopee.co.th', PH: 'seller.shopee.ph', VN: 'banhang.shopee.vn', TW: 'seller.shopee.tw', BR: 'seller.shopee.com.br' },
  },
  {
    id: 'lazada',
    name: 'Lazada',
    kind: 'marketplace',
    blurb: 'Marketplace across Southeast Asia',
    regions: ['MY', 'SG', 'ID', 'TH', 'PH', 'VN'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: { MY: 'sellercenter.lazada.com.my', SG: 'sellercenter.lazada.sg', ID: 'sellercenter.lazada.co.id', TH: 'sellercenter.lazada.co.th', PH: 'sellercenter.lazada.com.ph', VN: 'sellercenter.lazada.vn', '*': 'www.lazada.com' },
    admin: { MY: 'sellercenter.lazada.com.my', SG: 'sellercenter.lazada.sg', ID: 'sellercenter.lazada.co.id', TH: 'sellercenter.lazada.co.th', PH: 'sellercenter.lazada.com.ph', VN: 'sellercenter.lazada.vn' },
  },
  {
    id: 'tiktok_shop',
    name: 'TikTok Shop',
    kind: 'marketplace',
    blurb: 'Sell in videos and live streams',
    regions: ['MY', 'SG', 'ID', 'TH', 'PH', 'VN', 'JP', 'US', 'GB', 'MX', 'BR', 'DE', 'FR', 'ES', 'IT', 'IE'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: {},
    admin: {},
  },
  {
    id: 'amazon',
    name: 'Amazon',
    kind: 'marketplace',
    blurb: 'The largest marketplace in many countries',
    regions: ['US', 'CA', 'MX', 'BR', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'JP', 'SG', 'AU', 'IN', 'AE'],
    ship_days: 2,
    title_max: 200,
    chat: 'marketplace',
    start: { '*': 'sell.amazon.com', JP: 'sell.amazon.co.jp', GB: 'sell.amazon.co.uk', DE: 'sell.amazon.de', SG: 'sell.amazon.sg', AU: 'sell.amazon.com.au', IN: 'sell.amazon.in' },
    admin: { '*': 'sellercentral.amazon.com', JP: 'sellercentral.amazon.co.jp', GB: 'sellercentral.amazon.co.uk', DE: 'sellercentral.amazon.de', SG: 'sellercentral.amazon.sg', AU: 'sellercentral.amazon.com.au', IN: 'sellercentral.amazon.in' },
  },
  {
    id: 'ebay',
    name: 'eBay',
    kind: 'marketplace',
    blurb: 'Marketplace for new and used goods',
    regions: ['US', 'GB', 'DE', 'AU', 'CA', 'FR', 'IT', 'ES'],
    ship_days: 1,
    title_max: 80,
    chat: 'marketplace',
    start: { '*': 'www.ebay.com/sl/sell' },
    admin: { '*': 'www.ebay.com/sh/ovw' },
  },
  {
    id: 'etsy',
    name: 'Etsy',
    kind: 'marketplace',
    blurb: 'Handmade, vintage and craft supplies',
    regions: ['*'],
    ship_days: 3,
    title_max: 140,
    chat: 'marketplace',
    start: { '*': 'www.etsy.com/sell' },
    admin: { '*': 'www.etsy.com/your/shops/me/dashboard' },
  },
  {
    id: 'tokopedia',
    name: 'Tokopedia',
    kind: 'marketplace',
    blurb: 'Marketplace in Indonesia',
    regions: ['ID'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: { '*': 'seller.tokopedia.com' },
    admin: { '*': 'seller.tokopedia.com' },
  },
  {
    id: 'zalora',
    name: 'Zalora',
    kind: 'marketplace',
    blurb: 'Fashion marketplace in Southeast Asia',
    regions: ['MY', 'SG', 'ID', 'PH', 'HK', 'TW'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: {},
    admin: {},
  },
  {
    id: 'rakuten',
    name: 'Rakuten Ichiba',
    kind: 'marketplace',
    blurb: 'Marketplace in Japan',
    regions: ['JP'],
    ship_days: 2,
    title_max: 0,
    chat: 'email',
    start: { '*': 'www.rakuten.co.jp/ec/' },
    admin: {},
  },
  {
    id: 'yahoo_shopping',
    name: 'Yahoo! Shopping',
    kind: 'marketplace',
    blurb: 'Marketplace in Japan',
    regions: ['JP'],
    ship_days: 2,
    title_max: 0,
    chat: 'email',
    start: {},
    admin: {},
  },
  {
    id: 'walmart',
    name: 'Walmart Marketplace',
    kind: 'marketplace',
    blurb: 'Marketplace in the United States',
    regions: ['US', 'CA', 'MX'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: { '*': 'marketplace.walmart.com' },
    admin: { '*': 'seller.walmart.com' },
  },
  {
    id: 'mercado_libre',
    name: 'Mercado Libre',
    kind: 'marketplace',
    blurb: 'Marketplace in Latin America',
    regions: ['MX', 'BR'],
    ship_days: 2,
    title_max: 0,
    chat: 'marketplace',
    start: {},
    admin: {},
  },
  {
    id: 'direct',
    name: 'Direct',
    kind: 'direct',
    blurb: 'Orders taken in chat, on social media or in person',
    regions: ['*'],
    ship_days: 2,
    title_max: 0,
    chat: 'direct',
    start: {},
    admin: {},
  },
  {
    id: 'other',
    name: 'Other',
    kind: 'store',
    blurb: 'Any other shop or marketplace',
    regions: ['*'],
    ship_days: 2,
    title_max: 0,
    chat: 'email',
    start: {},
    admin: {},
  },
];

const STEPS = {
  marketplace: [
    { key: 'account', title: 'Create your seller account', body: 'Sign up on the platform\'s seller site with your email or phone and a shop name.', help: true, link: 'start' },
    { key: 'verify', title: 'Verify your identity and business', body: 'Upload your ID or business registration. The platform checks it; this can take a few days.', help: true, link: 'admin' },
    { key: 'payout', title: 'Add a payout account', body: 'Add the bank account your sales are paid into. Only you can do this.', help: false, link: 'admin' },
    { key: 'shipping', title: 'Choose couriers and shipping', body: 'Turn on the couriers or the platform\'s shipping programme and set your handling time.', help: true, link: 'admin' },
    { key: 'policies', title: 'Write your return and shipping policies', body: 'Your AI agent can draft them from how you work; they are also what it quotes when it answers buyers.', help: true, link: '' },
    { key: 'first_listing', title: 'List your first products', body: 'Prepare listings in Products, then publish them on the platform.', help: true, link: '' },
    { key: 'connect', title: 'Choose how orders come into Store OS', body: 'Your AI agent syncs it for you, or you import the platform\'s order exports, or you add orders yourself.', help: false, link: '' },
  ],
  store: [
    { key: 'account', title: 'Create your store', body: 'Start the store and pick its name and address on the web.', help: true, link: 'start' },
    { key: 'payments', title: 'Turn on payments', body: 'Connect a payment provider and the bank account your sales are paid into. Only you can do this.', help: false, link: 'admin' },
    { key: 'shipping', title: 'Set shipping zones and rates', body: 'Decide where you ship, what it costs and how fast you send.', help: true, link: 'admin' },
    { key: 'policies', title: 'Write your return, shipping and privacy policies', body: 'Your AI agent can draft them; they are also what it quotes when it answers buyers.', help: true, link: '' },
    { key: 'first_listing', title: 'Add your first products', body: 'Prepare listings in Products, then publish them on the store.', help: true, link: '' },
    { key: 'launch', title: 'Remove the password and launch', body: 'Check the store on your phone, place a test order, then open it to buyers.', help: true, link: 'admin' },
    { key: 'connect', title: 'Choose how orders come into Store OS', body: 'Your AI agent syncs it for you, or you import the store\'s order exports, or you add orders yourself.', help: false, link: '' },
  ],
  direct: [
    { key: 'payments', title: 'Decide how buyers pay you', body: 'Bank transfer, a payment link or cash on delivery; write it in your policies so your AI agent can tell buyers.', help: false, link: '' },
    { key: 'policies', title: 'Write your return and delivery policies', body: 'Your AI agent can draft them; it quotes them when it answers buyers.', help: true, link: '' },
  ],
};

function get(id) {
  for (const p of PLATFORMS) if (p.id === id) return p;
  return null;
}

function ids() {
  return PLATFORMS.map((p) => p.id);
}

function country(code) {
  for (const c of COUNTRIES) if (c.code === code) return c;
  return null;
}

/**
 * A platform link for a country. Links are kept without their scheme: they
 * are pages for the seller to open, never addresses this app calls.
 */
function linkOf(map, region) {
  if (!map) return '';
  const l = region && map[region] ? map[region] : map['*'] || '';
  return l === '' ? '' : 'https://' + l;
}

/** The setup checklist of a platform, with each step's link for the shop's country. */
function steps(platformId, region) {
  const p = get(platformId);
  const kind = p === null ? 'store' : p.kind;
  const list = STEPS[kind] || STEPS.store;
  return list.map((s) => ({ key: s.key, title: s.title, body: s.body, help: s.help, link: s.link === 'start' ? linkOf(p && p.start, region) : s.link === 'admin' ? linkOf(p && p.admin, region) : '' }));
}

function withScheme(map) {
  const out = {};
  for (const k of Object.keys(map || {})) out[k] = 'https://' + map[k];
  return out;
}

function catalog() {
  return {
    platforms: PLATFORMS.map((p) => ({ id: p.id, name: p.name, kind: p.kind, blurb: p.blurb, regions: p.regions, ship_days: p.ship_days, title_max: p.title_max, chat: p.chat, start: withScheme(p.start), admin: withScheme(p.admin) })),
    countries: COUNTRIES,
    currencies: CURRENCIES,
  };
}

module.exports = { COUNTRIES: COUNTRIES, CURRENCIES: CURRENCIES, PLATFORMS: PLATFORMS, STEPS: STEPS, get: get, ids: ids, country: country, linkOf: linkOf, steps: steps, catalog: catalog };
