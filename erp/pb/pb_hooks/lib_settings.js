/// <reference path="../pb_data/types.d.ts" />
/**
 * Company settings: details, modules, numbering, default accounts and
 * taxes, your AI agent's autonomy, and lock dates. Everyone reads the
 * company basics; administrators read and change the rest.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

/** Default-account keys people can point elsewhere (Settings, Default accounts). */
const DEFAULT_ACCOUNT_KEYS = [
  'ar', 'ap', 'inventory', 'grni', 'tax_payable', 'tax_receivable', 'sales', 'service_revenue', 'cogs', 'ppv', 'stock_adjustment', 'applied_overhead',
  'fx', 'retained_earnings', 'opening_balance', 'salaries', 'employer_contributions', 'salaries_payable', 'payroll_liabilities', 'reimbursements',
  'bank_fees', 'depreciation', 'accumulated_depreciation', 'general_expense',
];

const AUTO_KINDS = ['invoice', 'credit_note', 'bill', 'supplier_credit', 'delivery', 'goods_receipt', 'journal', 'stock_change', 'build'];

function get(ctx) {
  const util = u();
  const app = ctx.app;
  const s = core().settings(app);
  const out = {
    company_name: s.getString('company_name'),
    legal_name: s.getString('legal_name'),
    tax_id: s.getString('tax_id'),
    registration_no: s.getString('registration_no'),
    address: s.getString('address'),
    email: s.getString('email'),
    phone: s.getString('phone'),
    website: s.getString('website'),
    logo: s.getString('logo') !== '' ? '/api/files/settings/' + s.id + '/' + s.getString('logo') : '',
    country: s.getString('country'),
    base_currency: core().currency(app),
    fiscal_start_month: s.getInt('fiscal_start_month'),
    business_type: s.getString('business_type'),
    modules: util.jsonOf(s, 'modules') || {},
    prices_include_tax: s.getBool('prices_include_tax'),
    allow_negative_stock: s.getBool('allow_negative_stock'),
    invoice_footer: s.getString('invoice_footer'),
    quote_terms: s.getString('quote_terms'),
    quote_validity_days: s.getInt('quote_validity_days'),
    working_days: util.jsonOf(s, 'working_days') || [1, 2, 3, 4, 5],
    soft_lock_date: s.getString('soft_lock_date'),
    hard_lock_date: s.getString('hard_lock_date'),
  };
  if (ctx.isAgent || ctx.admin || auth().can(ctx, 'accounting', 'view')) {
    const numbering = {};
    for (const k of Object.keys(core().SERIES_DEFAULTS)) {
      const cfg = core().seriesConfig(app, k);
      numbering[k] = { prefix: cfg.prefix, width: cfg.width, next: core().peekNumber(app, k) };
    }
    out.numbering = numbering;
    const d = core().defaults(app);
    const accounts = {};
    for (const k of DEFAULT_ACCOUNT_KEYS) {
      let rec = null;
      try {
        rec = core().systemAccount(app, k);
      } catch {
        rec = null;
      }
      accounts[k] = rec !== null ? { id: rec.id, code: rec.getString('code'), name: rec.getString('name') } : null;
    }
    out.default_accounts = accounts;
    out.defaults = {
      warehouse: typeof d.warehouse === 'string' ? d.warehouse : '',
      bank: typeof d.bank === 'string' ? d.bank : '',
      sale_tax: typeof d.sale_tax === 'string' ? d.sale_tax : '',
      purchase_tax: typeof d.purchase_tax === 'string' ? d.purchase_tax : '',
      terms: typeof d.terms === 'string' ? d.terms : '',
    };
    const agent = util.jsonOf(s, 'agent') || {};
    out.agent = { auto: agent.auto || {}, limit: Number(agent.limit || 0), chase_overdue: agent.chase_overdue === true, auto_reorder: agent.auto_reorder === true, kinds: AUTO_KINDS };
  }
  return out;
}

function update(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, 'change company settings');
  const app = ctx.app;
  const s = core().settings(app);
  const texts = [['company_name', 120], ['legal_name', 160], ['tax_id', 60], ['registration_no', 60], ['address', 600], ['email', 160], ['phone', 40], ['website', 160], ['invoice_footer', 2000], ['quote_terms', 2000]];
  for (const t of texts) if (util.has(p, t[0])) s.set(t[0], util.text(p, t[0], t[1], ''));
  if (util.has(p, 'company_name') && s.getString('company_name').trim() === '') throw util.fail(400, 'The company needs a name.', 'invalid_param');
  // The email is printed on every document: it must be one.
  if (util.has(p, 'email') && s.getString('email').trim() !== '') auth().checkEmail(s.getString('email').trim().toLowerCase());
  if (util.has(p, 'fiscal_start_month')) s.set('fiscal_start_month', util.int(p, 'fiscal_start_month', 1, 1, 12));
  if (util.has(p, 'prices_include_tax')) s.set('prices_include_tax', util.bool(p, 'prices_include_tax', false));
  if (util.has(p, 'allow_negative_stock')) s.set('allow_negative_stock', util.bool(p, 'allow_negative_stock', false));
  if (util.has(p, 'quote_validity_days')) s.set('quote_validity_days', util.int(p, 'quote_validity_days', 30, 0, 365));
  if (util.has(p, 'working_days')) {
    const days = (util.list(p, 'working_days') || []).map((x) => Number(x));
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw util.fail(400, 'working_days are numbers 1 (Monday) to 7 (Sunday)', 'invalid_param');
    s.set('working_days', days);
  }
  if (ctx.e) {
    const logo = util.uploaded(ctx.e, 'logo');
    if (logo !== null) s.set('logo', logo);
  }
  if (util.bool(p, 'remove_logo', false)) s.set('logo', null);
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'settings', entity: 'settings', ref: s.id, label: 'Company', summary: 'Changed company settings' });
  return get(ctx);
}

function setModules(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, 'switch modules on and off');
  const app = ctx.app;
  const s = core().settings(app);
  const raw = util.obj(p, 'modules') || {};
  const cur = util.jsonOf(s, 'modules') || {};
  for (const k of Object.keys(raw)) {
    if (auth().SWITCHABLE.indexOf(k) < 0) throw util.fail(400, 'Unknown module ' + k + '. Modules: ' + auth().SWITCHABLE.join(', '), 'invalid_param');
    cur[k] = raw[k] === true || raw[k] === 'true';
  }
  if (cur.manufacturing && !cur.inventory) throw util.fail(400, 'Manufacturing needs Inventory switched on.', 'invalid_param');
  if (cur.payroll && !cur.people) throw util.fail(400, 'Payroll needs People switched on.', 'invalid_param');
  s.set('modules', cur);
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'settings', entity: 'settings', ref: s.id, label: 'Modules', summary: 'Modules: ' + Object.keys(cur).filter((k) => cur[k]).join(', '), data: cur });
  return get(ctx);
}

function setNumbering(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, 'change numbering');
  const app = ctx.app;
  const s = core().settings(app);
  const series = util.oneOf(p, 'series', Object.keys(core().SERIES_DEFAULTS), '');
  if (series === '') throw util.fail(400, 'series is required: ' + Object.keys(core().SERIES_DEFAULTS).join(', '), 'missing_param');
  const all = util.jsonOf(s, 'numbering') || {};
  const cfg = core().seriesConfig(app, series);
  if (util.has(p, 'prefix')) {
    const pre = util.text(p, 'prefix', 12, '');
    if (!/^[A-Za-z0-9\-/._]*$/.test(pre)) throw util.fail(400, 'A prefix uses letters, digits and - / . _ only.', 'invalid_param');
    cfg.prefix = pre;
  }
  if (util.has(p, 'width')) cfg.width = util.int(p, 'width', 5, 1, 10);
  all[series] = cfg;
  s.set('numbering', all);
  if (util.has(p, 'next')) {
    // Jump the counter forward (never back: numbers already used stay unique).
    const next = util.int(p, 'next', 1, 1, 999999999);
    app.runInTransaction((tx) => {
      const row = util.findOne(tx, 'counters', 'key = {:k}', { k: series });
      const curN = row === null ? 0 : row.getInt('num');
      if (next - 1 < curN) throw util.fail(409, 'Numbers can only move forward: ' + (curN + 1) + ' is next.', 'invalid');
      const r = row === null ? util.newRecord(tx, 'counters') : row;
      r.set('key', series);
      r.set('num', next - 1);
      tx.save(r);
    });
  }
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'settings', entity: 'settings', ref: s.id, label: 'Numbering', summary: 'Numbering of ' + series + ': ' + cfg.prefix + ' width ' + cfg.width });
  return get(ctx);
}

function setDefaults(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, 'change default accounts');
  const app = ctx.app;
  const s = core().settings(app);
  const d = core().defaults(app);
  const acc = util.obj(p, 'accounts');
  if (acc !== undefined) {
    for (const k of Object.keys(acc)) {
      if (DEFAULT_ACCOUNT_KEYS.indexOf(k) < 0) throw util.fail(400, 'Unknown default account ' + k + '. Keys: ' + DEFAULT_ACCOUNT_KEYS.join(', '), 'invalid_param');
      const a = core().resolve(app, 'accounts', String(acc[k]));
      d[k] = a.id;
    }
  }
  for (const k of [['warehouse', 'warehouses'], ['bank', 'banks'], ['sale_tax', 'taxes'], ['purchase_tax', 'taxes'], ['terms', 'payment_terms']]) {
    if (!util.has(p, k[0])) continue;
    const r = core().resolveOpt(app, k[1], util.str(p, k[0], ''));
    d[k[0]] = r !== null ? r.id : '';
  }
  s.set('defaults', d);
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'settings', entity: 'settings', ref: s.id, label: 'Defaults', summary: 'Changed default accounts and choices' });
  return get(ctx);
}

function setAgent(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, "change your AI agent's autonomy");
  const app = ctx.app;
  const s = core().settings(app);
  const cur = util.jsonOf(s, 'agent') || {};
  const auto = cur.auto || {};
  const given = util.obj(p, 'auto');
  if (given !== undefined) {
    for (const k of Object.keys(given)) {
      if (AUTO_KINDS.indexOf(k) < 0) throw util.fail(400, 'Unknown kind ' + k + '. Kinds: ' + AUTO_KINDS.join(', '), 'invalid_param');
      auto[k] = given[k] === true || given[k] === 'true';
    }
  }
  cur.auto = auto;
  if (util.has(p, 'limit')) cur.limit = util.money(p, 'limit', core().currency(app)) || 0;
  if (util.has(p, 'chase_overdue')) cur.chase_overdue = util.bool(p, 'chase_overdue', false);
  if (util.has(p, 'auto_reorder')) cur.auto_reorder = util.bool(p, 'auto_reorder', false);
  s.set('agent', cur);
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'settings', entity: 'settings', ref: s.id, label: 'Your AI agent', summary: "Changed your AI agent's autonomy", data: cur });
  return get(ctx);
}

function setLocks(ctx, p) {
  const util = u();
  auth().needAdmin(ctx, 'change lock dates');
  const app = ctx.app;
  const s = core().settings(app);
  if (util.has(p, 'soft_lock_date')) s.set('soft_lock_date', util.day(p, 'soft_lock_date', ''));
  if (util.has(p, 'hard_lock_date')) {
    const next = util.day(p, 'hard_lock_date', '');
    const prev = s.getString('hard_lock_date');
    if (prev !== '' && (next === '' || next < prev) && !auth().isOwner(ctx)) throw util.fail(403, 'Only an owner can move the hard lock back.', 'not_permitted');
    s.set('hard_lock_date', next);
  }
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'lock', entity: 'settings', ref: s.id, label: 'Lock dates', summary: 'Lock dates: closed through ' + (s.getString('soft_lock_date') || 'none') + ', locked through ' + (s.getString('hard_lock_date') || 'none') });
  return get(ctx);
}

module.exports = {
  DEFAULT_ACCOUNT_KEYS: DEFAULT_ACCOUNT_KEYS,
  AUTO_KINDS: AUTO_KINDS,
  get: get,
  update: update,
  setModules: setModules,
  setNumbering: setNumbering,
  setDefaults: setDefaults,
  setAgent: setAgent,
  setLocks: setLocks,
};
