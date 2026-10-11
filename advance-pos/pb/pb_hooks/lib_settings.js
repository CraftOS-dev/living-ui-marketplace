/// <reference path="../pb_data/types.d.ts" />
/**
 * The store's settings, first-run setup and the app's status.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function audit() {
  return require(`${__hooks}/lib_audit.js`);
}

/** Currencies whose minor unit is not hundredths. */
const DIGITS = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, PYG: 0, UGX: 0, XAF: 0, XOF: 0, IDR: 2, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3 };

/** Notes and coins per currency (minor units), for counting the drawer. */
const DENOMS = {
  USD: [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1],
  CAD: [10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5],
  EUR: [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  GBP: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  AUD: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5],
  NZD: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  SGD: [10000, 5000, 1000, 500, 200, 100, 50, 20, 10, 5],
  MYR: [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5],
  JPY: [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1],
  CHF: [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5],
  INR: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100],
  HKD: [100000, 50000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  PHP: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100],
  THB: [100000, 50000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25],
};

/** A currency's notes and coins: the stored list, the table, or a 1-2-5 series. */
function denominations(s) {
  const util = u();
  const stored = util.getJson(s, 'denominations');
  if (Array.isArray(stored) && stored.length > 0) return stored.filter((x) => Number.isInteger(x) && x > 0).sort((a, b) => b - a);
  const cur = s.getString('currency');
  if (DENOMS[cur]) return DENOMS[cur].slice();
  const d = s.getInt('currency_digits');
  const out = [];
  const unit = Math.pow(10, d);
  for (let p = unit * 100; p >= 1; p = p / 10) for (const m of [5, 2, 1]) if (Number.isInteger((p * m) / 10)) out.push((p * m) / 10);
  return out.filter((x) => x >= 1 && x <= unit * 500).sort((a, b) => b - a);
}

const BUILT_IN_TENDERS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'gift_card', label: 'Gift card' },
  { id: 'store_credit', label: 'Store credit' },
  { id: 'points', label: 'Points' },
];

function customTenders(s) {
  const t = u().getJson(s, 'tenders');
  return Array.isArray(t) ? t.filter((x) => x && typeof x.id === 'string' && typeof x.label === 'string') : [];
}

/** Settings as the app and the agent read them (the signing secret never leaves). */
function json(app, s) {
  const util = u();
  const money = require(`${__hooks}/lib_money.js`).of(s);
  const logo = s.getString('logo');
  return {
    setup_done: s.getBool('setup_done'),
    business_name: s.getString('business_name'),
    address: s.getString('address'),
    phone: s.getString('phone'),
    email: s.getString('email'),
    website: s.getString('website'),
    tax_number: s.getString('tax_number'),
    receipt_header: s.getString('receipt_header'),
    receipt_footer: s.getString('receipt_footer'),
    receipt_width: s.getString('receipt_width') || '80',
    logo: logo === '' ? '' : util.fileUrl(s, 'logo'),
    currency: money.currency,
    currency_digits: money.digits,
    prices_include_tax: s.getBool('prices_include_tax'),
    cash_round_to: s.getInt('cash_round_to'),
    cash_round_to_text: money.plain(s.getInt('cash_round_to')),
    denominations: denominations(s),
    tips_enabled: s.getBool('tips_enabled'),
    tip_presets: util.getJson(s, 'tip_presets') || [10, 15, 20],
    tip_basis: s.getString('tip_basis') || 'before_tax',
    card_reference: s.getString('card_reference') || 'optional',
    tenders: BUILT_IN_TENDERS.concat(customTenders(s).map((t) => ({ id: t.id, label: t.label, custom: true }))),
    custom_tenders: customTenders(s),
    loyalty_enabled: s.getBool('loyalty_enabled'),
    points_per_unit: s.getFloat('points_per_unit'),
    point_value: s.getInt('point_value'),
    point_value_text: money.plain(s.getInt('point_value')),
    points_min_redeem: s.getInt('points_min_redeem'),
    receipt_prefix: s.getString('receipt_prefix'),
    next_receipt: s.getInt('next_receipt'),
    require_shift: s.getBool('require_shift'),
    allow_negative_stock: s.getBool('allow_negative_stock'),
    low_stock_default: s.getFloat('low_stock_default'),
    lock_idle_minutes: s.getInt('lock_idle_minutes'),
    lock_after_sale: s.getBool('lock_after_sale'),
    auto_shift_review: s.getBool('auto_shift_review'),
    show_tile_prices: s.getBool('show_tile_prices'),
    permissions: auth().catalog(s),
    has_sales: hasSales(app),
  };
}

function hasSales(app) {
  return app.countRecords('orders', $dbx.exp("status = 'paid'")) > 0;
}

function get(app) {
  return json(app, auth().settingsRow(app));
}

/** The public subset the lock screen needs before anyone signs in. */
function publicInfo(app) {
  const s = auth().settingsRow(app);
  const util = u();
  return {
    setup_done: s.getBool('setup_done'),
    business_name: s.getString('business_name'),
    logo: s.getString('logo') === '' ? '' : util.fileUrl(s, 'logo'),
    currency: s.getString('currency'),
    currency_digits: s.getInt('currency_digits'),
    lock_idle_minutes: s.getInt('lock_idle_minutes'),
    has_staff: app.countRecords('staff', $dbx.exp('active = true')) > 0,
    registers: app.findRecordsByFilter('registers', 'active = true', 'name', 0, 0).map((r) => ({ id: r.id, name: r.getString('name') })),
  };
}

const TEXT_FIELDS = { business_name: 120, address: 600, phone: 60, email: 200, website: 200, tax_number: 80, receipt_header: 600, receipt_footer: 600, receipt_prefix: 12 };
const BOOL_FIELDS = ['prices_include_tax', 'tips_enabled', 'loyalty_enabled', 'require_shift', 'allow_negative_stock', 'lock_after_sale', 'auto_shift_review', 'show_tile_prices'];

/** Apply settings params to the row; answers the names of what changed. */
function apply(app, s, p, ev, opts) {
  const util = u();
  const o = opts || {};
  const changed = [];
  const set = (k, v) => {
    if (String(s.get(k)) !== String(v)) changed.push(k);
    s.set(k, v);
  };
  for (const k of Object.keys(TEXT_FIELDS)) {
    if (!util.has(p, k)) continue;
    const v = util.str(p, k, '');
    if (v.length > TEXT_FIELDS[k]) throw util.fail(400, k + ' can be at most ' + TEXT_FIELDS[k] + ' characters');
    if (k === 'business_name' && util.squash(v) === '') throw util.fail(400, 'business_name cannot be empty');
    set(k, k === 'business_name' ? util.squash(v) : v);
  }
  for (const k of BOOL_FIELDS) if (util.has(p, k)) set(k, util.bool(p, k, false));
  if (util.has(p, 'receipt_width')) set('receipt_width', util.oneOf(p, 'receipt_width', ['58', '80'], '80'));
  if (util.has(p, 'tip_basis')) set('tip_basis', util.oneOf(p, 'tip_basis', ['before_tax', 'after_tax'], 'before_tax'));
  if (util.has(p, 'card_reference')) set('card_reference', util.oneOf(p, 'card_reference', ['off', 'optional', 'required'], 'optional'));
  if (util.has(p, 'currency') || util.has(p, 'currency_digits')) {
    const cur = util.str(p, 'currency', s.getString('currency')).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw util.fail(400, 'currency must be a 3-letter ISO code like USD, EUR or JPY');
    const d = util.int(p, 'currency_digits', DIGITS[cur] !== undefined ? DIGITS[cur] : 2, 0, 3);
    if ((cur !== s.getString('currency') || d !== s.getInt('currency_digits')) && !o.setup && hasSales(app)) {
      throw util.fail(400, 'The currency cannot change once sales are recorded (every stored amount is in it)');
    }
    if (cur !== s.getString('currency')) s.set('denominations', []);
    set('currency', cur);
    set('currency_digits', d);
  }
  const money = require(`${__hooks}/lib_money.js`).of(s);
  if (util.has(p, 'cash_round_to')) {
    const v = money.param(p, 'cash_round_to', { min: 0 });
    if (v !== null && v > money.unit * 10) throw util.fail(400, 'cash_round_to is the step cash totals round to, like 0.05');
    set('cash_round_to', v === null ? 0 : v);
  }
  if (util.has(p, 'denominations')) {
    const list = util.list(p, 'denominations', '["100", "50", "20", "10", "5", "1", "0.25"]');
    const mins = (list || []).map((x, i) => money.toMinor(x, 'denominations[' + i + ']'));
    if (mins.some((x) => x <= 0)) throw util.fail(400, 'denominations must be positive amounts');
    set('denominations', mins.sort((a, b) => b - a));
  }
  if (util.has(p, 'tip_presets')) {
    const list = util.list(p, 'tip_presets', '[10, 15, 20]') || [];
    if (list.length > 5 || list.some((x) => !isFinite(Number(x)) || Number(x) <= 0 || Number(x) > 100)) throw util.fail(400, 'tip_presets is up to 5 percentages from 1 to 100');
    set('tip_presets', list.map((x) => Number(x)));
  }
  if (util.has(p, 'tenders')) {
    const list = util.list(p, 'tenders', '[{"label": "Bank transfer"}]') || [];
    if (list.length > 10) throw util.fail(400, 'At most 10 custom tenders');
    const seen = {};
    const out = list.map((t, i) => {
      const lbl = util.squash(t && t.label);
      if (lbl === '' || lbl.length > 40) throw util.fail(400, 'tenders[' + i + '].label must be 1 to 40 characters');
      const key = lbl.toLowerCase();
      if (seen[key] || BUILT_IN_TENDERS.some((b) => b.label.toLowerCase() === key)) throw util.fail(400, 'Tender "' + lbl + '" is listed twice');
      seen[key] = true;
      const id = t && typeof t.id === 'string' && /^t_[a-z0-9]{6,20}$/.test(t.id) ? t.id : 't_' + $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
      return { id: id, label: lbl };
    });
    set('tenders', out);
  }
  if (util.has(p, 'points_per_unit')) set('points_per_unit', util.number(p, 'points_per_unit', { min: 0, max: 1000 }) || 0);
  if (util.has(p, 'point_value')) {
    const v = money.param(p, 'point_value', { min: 0 });
    set('point_value', v === null ? 0 : v);
  }
  if (util.has(p, 'points_min_redeem')) set('points_min_redeem', util.int(p, 'points_min_redeem', 0, 0, 1000000));
  if (util.has(p, 'next_receipt')) {
    const n = util.int(p, 'next_receipt', 1001, 1, 999999999);
    if (n < s.getInt('next_receipt') && hasSales(app)) throw util.fail(400, 'Receipt numbers only go forward (the next is ' + s.getInt('next_receipt') + ')');
    set('next_receipt', n);
  }
  if (util.has(p, 'low_stock_default')) set('low_stock_default', util.number(p, 'low_stock_default', { min: 0, max: 1000000 }) || 0);
  if (util.has(p, 'lock_idle_minutes')) set('lock_idle_minutes', util.int(p, 'lock_idle_minutes', 5, 0, 240));
  if (ev) {
    const file = util.uploaded(ev, 'logo');
    if (file !== null) {
      s.set('logo', file);
      changed.push('logo');
    }
  }
  if (util.bool(p, 'remove_logo', false) && s.getString('logo') !== '') {
    s.set('logo', null);
    changed.push('logo');
  }
  return changed;
}

function update(app, e, p) {
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_settings', p, { what: 'Changing settings' });
  let changed = [];
  app.runInTransaction((tx) => {
    const s = auth().settingsRow(tx);
    changed = apply(tx, s, p, e, {});
    if (changed.length === 0) return;
    tx.save(s);
    audit().log(tx, 'settings', c, { approver: approver, detail: 'Settings changed: ' + changed.join(', ') });
  });
  return Object.assign(get(app), { changed: changed });
}

/* ------------------------------------------------------------------ setup */

function setupStatus(app) {
  const info = publicInfo(app);
  return Object.assign(info, { needs_setup: !info.setup_done, currencies_with_other_digits: DIGITS });
}

/**
 * First run: the store, its currency and tax, the owner and the first
 * register. Answers a session for the owner. Only while not set up.
 */
function setupComplete(app, e, p) {
  const util = u();
  const A = auth();
  const s0 = A.settingsRow(app);
  if (s0.getBool('setup_done')) throw util.fail(409, 'The store is already set up');
  const ownerName = util.squash(util.req(p, 'owner_name', 'Sam Lee'));
  const pin = util.req(p, 'owner_pin', '2580');
  A.checkPinFormat(pin);
  util.req(p, 'business_name', '"Corner Cafe"');
  util.req(p, 'currency', 'USD');
  const regName = util.squash(util.str(p, 'register_name', 'Register 1')) || 'Register 1';
  const taxName = util.squash(util.str(p, 'tax_name', ''));
  const taxRate = util.number(p, 'tax_rate', { min: 0, max: 100 });
  let regId = '';
  app.runInTransaction((tx) => {
    const s = A.settingsRow(tx);
    apply(tx, s, p, e, { setup: true });
    s.set('setup_done', true);
    tx.save(s);
    const owner = new Record(tx.findCollectionByNameOrId('staff'));
    owner.set('name', ownerName);
    owner.set('role', 'owner');
    owner.set('active', true);
    owner.set('color', 'accent');
    A.setPin(tx, owner, pin);
    tx.save(owner);
    const reg = new Record(tx.findCollectionByNameOrId('registers'));
    reg.set('name', regName);
    reg.set('active', true);
    tx.save(reg);
    regId = reg.id;
    if (taxRate !== null && taxRate > 0) {
      const t = new Record(tx.findCollectionByNameOrId('taxes'));
      t.set('name', taxName || 'Sales tax');
      t.set('rate', taxRate);
      t.set('is_default', true);
      tx.save(t);
    }
    audit().log(tx, 'settings', { actor: util.fromAgent(e) ? 'agent' : 'staff', staffId: util.fromAgent(e) ? '' : owner.id }, { register: reg.id, detail: 'Store set up: ' + s.getString('business_name') + ', ' + s.getString('currency') });
  });
  return A.unlock(app, { register: regId, pin: pin });
}

/* ----------------------------------------------------------------- status */

/** A quick look at the store: today, the drawers, open tickets, stock and requests. */
function status(app) {
  const util = u();
  const s = auth().settingsRow(app);
  const money = require(`${__hooks}/lib_money.js`).of(s);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sum = util.rows(
    app,
    "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'paid' AND paid_at >= {:a}",
    { n: 0, total: 0 },
    { a: util.dbDate(start) },
  )[0];
  const shifts = app.findRecordsByFilter('shifts', "status = 'open'", '', 0, 0);
  const regs = {};
  for (const r of app.findRecordsByFilter('registers', '', 'name', 0, 0)) regs[r.id] = r.getString('name');
  const low = util.rows(app, 'SELECT COUNT(*) AS n FROM variants v JOIN products p ON p.id = v.product WHERE v.track_stock = TRUE AND v.archived = FALSE AND p.archived = FALSE AND v.stock <= (CASE WHEN v.low_at > 0 THEN v.low_at ELSE {:d} END)', { n: 0 }, { d: s.getFloat('low_stock_default') })[0];
  return {
    store: s.getString('business_name'),
    setup_done: s.getBool('setup_done'),
    currency: money.currency,
    today: { sales: sum.n, total: sum.total, total_text: money.text(sum.total) },
    open_shifts: shifts.map((x) => ({ id: x.id, register: regs[x.getString('register')] || '', opened_at: x.getString('opened_at') })),
    open_tickets: app.countRecords('orders', $dbx.exp("status = 'open'")),
    low_stock: low.n,
    open_requests: app.countRecords('requests', $dbx.exp("status IN ('sent', 'working')")),
    now: new Date().toISOString(),
  };
}

module.exports = { DIGITS: DIGITS, denominations: denominations, BUILT_IN_TENDERS: BUILT_IN_TENDERS, customTenders: customTenders, json: json, get: get, publicInfo: publicInfo, update: update, setupStatus: setupStatus, setupComplete: setupComplete, status: status, hasSales: hasSales };
