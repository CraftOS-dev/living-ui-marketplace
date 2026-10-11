/// <reference path="../pb_data/types.d.ts" />
/**
 * The shop's settings, first-run setup, tax classes, payment methods and
 * registers.
 *
 * Changing a rate, a price mode or a payment method never changes a past
 * sale: every sale keeps its own copy of what it was computed with.
 */

const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'];

/** Settings the AI agent may change (wording on receipts and contact details). */
const BASIC_FIELDS = ['business_name', 'address', 'phone', 'email', 'website', 'receipt_header', 'receipt_footer'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

/* -------------------------------------------------------------- settings */

function serializeTax(rec) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    rate_bp: rec.getInt('rate_bp'),
    rate: u().bpText(rec.getInt('rate_bp')),
    dine_in_rate_bp: rec.getInt('dine_in_rate_bp'),
    dine_in_rate: rec.getInt('dine_in_rate_bp') >= 0 ? u().bpText(rec.getInt('dine_in_rate_bp')) : '',
    mark: rec.getString('mark'),
    sort: rec.getInt('sort'),
    is_default: rec.getBool('is_default'),
    archived: rec.getBool('archived'),
  };
}

function get(app) {
  const s = core().settings(app);
  const cur = s.getString('currency');
  const logo = s.getString('logo');
  return {
    setup_done: s.getBool('setup_done'),
    business_name: s.getString('business_name'),
    address: s.getString('address'),
    phone: s.getString('phone'),
    email: s.getString('email'),
    website: s.getString('website'),
    tax_reg_label: s.getString('tax_reg_label'),
    tax_reg_no: s.getString('tax_reg_no'),
    company_reg_no: s.getString('company_reg_no'),
    region: s.getString('region'),
    currency: cur,
    currency_decimals: core().exponent(cur),
    price_mode: s.getString('price_mode'),
    tax_rounding: s.getString('tax_rounding'),
    cash_rounding: s.getInt('cash_rounding'),
    cash_rounding_text: u().minorText(s.getInt('cash_rounding'), core().exponent(cur)),
    order_types: s.getStringSlice('order_types'),
    default_order_type: s.getString('default_order_type'),
    service_charge_bp: s.getInt('service_charge_bp'),
    service_charge: u().bpText(s.getInt('service_charge_bp')),
    service_charge_scope: s.getString('service_charge_scope') || 'dine_in',
    service_charge_tax: s.getString('service_charge_tax'),
    receipt_header: s.getString('receipt_header'),
    receipt_footer: s.getString('receipt_footer'),
    receipt_width: s.getString('receipt_width'),
    receipt_barcode: s.getBool('receipt_barcode'),
    after_sale: s.getString('after_sale'),
    logo: logo,
    logo_url: logo !== '' ? '/api/files/settings/' + s.id + '/' + logo : '',
    kitchen_enabled: s.getBool('kitchen_enabled'),
    order_numbers: s.getBool('order_numbers'),
    show_tile_prices: s.getBool('show_tile_prices'),
    lock_minutes: s.getInt('lock_minutes'),
    cashier_discount_bp: s.getInt('cashier_discount_bp'),
    cashier_discount: u().bpText(s.getInt('cashier_discount_bp')),
    day_cutoff_hour: s.getInt('day_cutoff_hour'),
    today: u().businessDay(s.getInt('day_cutoff_hour')),
  };
}

/** Settings a person (owner) or, for the basic fields, the AI agent changes. */
function update(e, app, p, ctx) {
  const util = u();
  const s = core().settings(app);
  const agent = ctx.actor === 'agent';
  const changed = [];
  const setText = (name, max) => {
    if (!util.has(p, name)) return;
    const v = util.str(p, name, '');
    if (v.length > max) throw util.fail(400, name + ' can be at most ' + max + ' characters');
    if (s.getString(name) !== v) changed.push(name);
    s.set(name, v);
  };
  for (const f of BASIC_FIELDS) setText(f, f === 'address' ? 300 : f === 'receipt_header' || f === 'receipt_footer' ? 500 : f === 'email' ? 120 : f === 'website' ? 200 : f === 'phone' ? 40 : 80);
  const ownerOnly = [
    'tax_reg_label', 'tax_reg_no', 'company_reg_no', 'region', 'currency', 'price_mode', 'tax_rounding', 'cash_rounding', 'order_types',
    'default_order_type', 'service_charge', 'service_charge_scope', 'service_charge_tax', 'receipt_width', 'receipt_barcode', 'after_sale',
    'kitchen_enabled', 'order_numbers', 'show_tile_prices', 'lock_minutes', 'cashier_discount', 'day_cutoff_hour', 'clear_logo',
  ];
  const asked = ownerOnly.filter((f) => util.has(p, f));
  if (agent && asked.length > 0) {
    throw util.fail(
      403,
      'Your AI agent can change only the business details and receipt wording (' + BASIC_FIELDS.join(', ') + '). ' + asked.join(', ') + ' are changed by the owner in Settings.',
      'agent_not_permitted',
    );
  }
  if (!agent) {
    setText('tax_reg_label', 40);
    setText('tax_reg_no', 40);
    setText('company_reg_no', 40);
    if (util.has(p, 'region')) {
      s.set('region', util.oneOf(p, 'region', require(`${__hooks}/lib_regions.js`).REGIONS, s.getString('region')));
      changed.push('region');
    }
    if (util.has(p, 'currency')) {
      const cur = util.str(p, 'currency', '').toUpperCase();
      if (!core().isCurrency(cur)) throw util.fail(400, 'currency must be a 3-letter code such as MYR, SGD, JPY or USD');
      if (cur !== s.getString('currency')) {
        if (util.scalarSql(app, 'SELECT COUNT(id) AS v FROM sales') > 0) {
          throw util.fail(409, 'The currency cannot change after the first sale: past sales and the cash in the drawer are in ' + s.getString('currency') + '.', 'has_sales');
        }
        const priced = util.scalarSql(app, 'SELECT COUNT(id) AS v FROM products WHERE price > 0');
        if (priced > 0 && core().exponent(cur) !== core().exponent(s.getString('currency'))) {
          throw util.fail(409, cur + ' has a different number of decimals than ' + s.getString('currency') + ', so the prices of ' + util.plural(priced, 'product') + ' would be wrong. Change the currency before entering prices.', 'prices_exist');
        }
        s.set('currency', cur);
        changed.push('currency');
      }
    }
    if (util.has(p, 'price_mode')) {
      s.set('price_mode', util.oneOf(p, 'price_mode', ['inclusive', 'exclusive'], s.getString('price_mode')));
      changed.push('price_mode');
    }
    if (util.has(p, 'tax_rounding')) {
      s.set('tax_rounding', util.oneOf(p, 'tax_rounding', ['half_up', 'floor', 'ceil'], s.getString('tax_rounding')));
      changed.push('tax_rounding');
    }
    const exp = core().exponent(s.getString('currency'));
    if (util.has(p, 'cash_rounding')) {
      const inc = util.money(p, 'cash_rounding', exp, {}) || 0;
      if (inc < 0 || inc > 100000) throw util.fail(400, 'cash_rounding is the smallest coin cash totals round to, e.g. 0.05');
      s.set('cash_rounding', inc);
      changed.push('cash_rounding');
    }
    if (util.has(p, 'order_types')) {
      const types = util.list(p, 'order_types') || [];
      for (const t of types) if (ORDER_TYPES.indexOf(t) < 0) throw util.fail(400, 'order_types can hold: ' + ORDER_TYPES.join(', '));
      s.set('order_types', ORDER_TYPES.filter((t) => types.indexOf(t) >= 0));
      if (types.length === 0) s.set('default_order_type', '');
      else if (types.indexOf(s.getString('default_order_type')) < 0) s.set('default_order_type', ORDER_TYPES.filter((t) => types.indexOf(t) >= 0)[0]);
      changed.push('order_types');
    }
    if (util.has(p, 'default_order_type')) {
      const t = util.str(p, 'default_order_type', '');
      const enabled = s.getStringSlice('order_types');
      if (t !== '' && enabled.indexOf(t) < 0) throw util.fail(400, 'default_order_type must be one of the enabled order types: ' + (enabled.join(', ') || 'none enabled'));
      s.set('default_order_type', t);
      changed.push('default_order_type');
    }
    if (util.has(p, 'service_charge')) {
      s.set('service_charge_bp', util.percent(p, 'service_charge', 0, 5000));
      changed.push('service_charge');
    }
    if (util.has(p, 'service_charge_scope')) {
      s.set('service_charge_scope', util.oneOf(p, 'service_charge_scope', ['dine_in', 'all'], 'dine_in'));
      changed.push('service_charge_scope');
    }
    if (util.has(p, 'service_charge_tax')) {
      const ref = util.str(p, 'service_charge_tax', '');
      s.set('service_charge_tax', ref === '' ? '' : core().taxClass(app, ref).id);
      changed.push('service_charge_tax');
    }
    if (util.has(p, 'receipt_width')) {
      s.set('receipt_width', util.oneOf(p, 'receipt_width', ['80', '58'], '80'));
      changed.push('receipt_width');
    }
    if (util.has(p, 'receipt_barcode')) {
      s.set('receipt_barcode', util.bool(p, 'receipt_barcode', true));
      changed.push('receipt_barcode');
    }
    if (util.has(p, 'after_sale')) {
      s.set('after_sale', util.oneOf(p, 'after_sale', ['ask', 'print', 'none'], 'ask'));
      changed.push('after_sale');
    }
    if (util.has(p, 'kitchen_enabled')) {
      s.set('kitchen_enabled', util.bool(p, 'kitchen_enabled', false));
      changed.push('kitchen_enabled');
    }
    if (util.has(p, 'order_numbers')) {
      s.set('order_numbers', util.bool(p, 'order_numbers', true));
      changed.push('order_numbers');
    }
    if (util.has(p, 'show_tile_prices')) {
      s.set('show_tile_prices', util.bool(p, 'show_tile_prices', true));
      changed.push('show_tile_prices');
    }
    if (util.has(p, 'lock_minutes')) {
      s.set('lock_minutes', util.int(p, 'lock_minutes', 0, 0, 240));
      changed.push('lock_minutes');
    }
    if (util.has(p, 'cashier_discount')) {
      s.set('cashier_discount_bp', util.percent(p, 'cashier_discount', 1000, 10000));
      changed.push('cashier_discount');
    }
    if (util.has(p, 'day_cutoff_hour')) {
      s.set('day_cutoff_hour', util.int(p, 'day_cutoff_hour', 0, 0, 12));
      changed.push('day_cutoff_hour');
    }
    const logo = util.uploaded(e, 'logo');
    if (logo !== null) {
      s.set('logo', logo);
      changed.push('logo');
    } else if (util.bool(p, 'clear_logo', false)) {
      s.set('logo', null);
      changed.push('logo');
    }
  }
  app.save(s);
  if (changed.length > 0) {
    core().audit(app, {
      kind: 'settings_change',
      actor: ctx.actor,
      staff: ctx.staff ? ctx.staff.id : '',
      ref: 'settings',
      summary: 'Settings changed: ' + changed.join(', '),
    });
  }
  return get(app);
}

/* ------------------------------------------------------------ first run */

/**
 * The first open: the business, its country (which sets the currency and
 * the starting tax classes) and the owner with their PIN. Runs once.
 */
function setup(e, app, p) {
  const util = u();
  const regions = require(`${__hooks}/lib_regions.js`);
  const auth = require(`${__hooks}/lib_auth.js`);
  if (core().settings(app).getBool('setup_done')) throw util.fail(409, 'This register is already set up.', 'already_setup');
  const business = util.squash(util.req(p, 'business_name', '"Corner Cafe"'));
  if (business.length > 80) throw util.fail(400, 'business_name can be at most 80 characters');
  const region = util.oneOf(p, 'region', regions.REGIONS, '');
  if (region === '') throw util.fail(400, 'region is required: one of ' + regions.REGIONS.join(', '));
  const preset = regions.PRESETS[region];
  const currency = (util.str(p, 'currency', '') || preset.currency).toUpperCase();
  if (!core().isCurrency(currency)) throw util.fail(400, 'currency must be a 3-letter code such as MYR');
  const ownerName = util.squash(util.req(p, 'owner_name', '"Aiko"'));
  if (ownerName.length > 40) throw util.fail(400, 'owner_name can be at most 40 characters');
  const pin = util.req(p, 'pin', '1234');
  auth.checkPinFormat(pin);
  let out = null;
  app.runInTransaction((tx) => {
    const s = core().settings(tx);
    if (s.getBool('setup_done')) throw util.fail(409, 'This register is already set up.', 'already_setup');
    for (const old of tx.findRecordsByFilter('tax_classes', '', '', 0, 0)) tx.delete(tx.findRecordById('tax_classes', old.id));
    const coll = tx.findCollectionByNameOrId('tax_classes');
    preset.classes.forEach((c, i) => {
      const t = new Record(coll);
      t.set('name', c.name);
      t.set('rate_bp', c.rate_bp);
      t.set('dine_in_rate_bp', c.dine_in_rate_bp);
      t.set('mark', c.mark);
      t.set('sort', i + 1);
      t.set('is_default', c.is_default === true);
      t.set('archived', false);
      tx.save(t);
    });
    s.set('business_name', business);
    s.set('region', region);
    s.set('currency', currency);
    s.set('price_mode', preset.price_mode);
    s.set('tax_rounding', preset.tax_rounding);
    s.set('cash_rounding', currency === preset.currency ? preset.cash_rounding : 0);
    s.set('tax_reg_label', preset.tax_reg_label);
    s.set('order_types', preset.order_types);
    s.set('default_order_type', preset.default_order_type);
    s.set('setup_done', true);
    tx.save(s);
    const owner = new Record(tx.findCollectionByNameOrId('staff'));
    owner.set('name', ownerName);
    owner.set('role', 'owner');
    owner.set('color', 1);
    owner.set('active', true);
    owner.set('training', false);
    owner.set('pin_set', false);
    owner.set('failed', 0);
    owner.set('locked_until', '');
    tx.save(owner);
    auth.setPin(tx, owner, pin);
    core().audit(tx, { kind: 'settings_change', actor: 'staff', staff: owner.id, ref: 'setup', summary: 'Set up ' + business + ' (' + preset.label + ', ' + currency + ')' });
    out = owner;
  });
  const reg = app.findRecordsByFilter('registers', 'archived = false', 'code', 1, 0);
  const session = auth.login(app, out, pin, reg.length > 0 ? reg[0].id : '');
  return { settings: get(app), session: session };
}

/* ---------------------------------------------------------- tax classes */

function listTax(app, includeArchived) {
  const recs = app.findRecordsByFilter('tax_classes', includeArchived ? '' : 'archived = false', 'sort,name', 0, 0);
  const counts = {};
  for (const r of u().rows(app, "SELECT tax_class, COUNT(id) AS n FROM products WHERE archived = false AND tax_class != '' GROUP BY tax_class", { tax_class: '', n: 0 })) counts[r.tax_class] = r.n;
  return { tax_classes: recs.map((r) => Object.assign(serializeTax(r), { products: counts[r.id] || 0 })) };
}

function saveTax(app, rec, p, isNew) {
  const util = u();
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"SST 6%"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 40) throw util.fail(400, 'A tax class needs a name of at most 40 characters');
    const clash = util.idsNocase(app, 'tax_classes', 'name', name, 2).filter((id) => id !== rec.id);
    if (clash.length > 0) throw util.fail(400, 'There is already a tax class called "' + name + '"');
    rec.set('name', name);
  }
  if (isNew || util.has(p, 'rate')) rec.set('rate_bp', util.percent(p, 'rate', isNew ? 0 : rec.getInt('rate_bp'), 10000));
  if (util.has(p, 'dine_in_rate')) {
    const raw = util.str(p, 'dine_in_rate', '');
    rec.set('dine_in_rate_bp', raw === '' ? -1 : util.percent(p, 'dine_in_rate', -1, 10000));
  } else if (isNew) rec.set('dine_in_rate_bp', -1);
  if (isNew || util.has(p, 'mark')) {
    const mark = util.str(p, 'mark', '');
    if (mark.length > 4) throw util.fail(400, 'mark is a short sign printed next to items with this rate, at most 4 characters (e.g. ※)');
    rec.set('mark', mark);
  }
  if (isNew) {
    rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM tax_classes'));
    rec.set('archived', false);
  }
  if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', rec.getInt('sort'), 0, 100000));
  const makeDefault = util.bool(p, 'is_default', isNew ? false : rec.getBool('is_default'));
  rec.set('is_default', makeDefault);
  app.runInTransaction((tx) => {
    if (makeDefault) {
      const others = rec.id ? tx.findRecordsByFilter('tax_classes', 'is_default = true && id != {:id}', '', 0, 0, { id: rec.id }) : tx.findRecordsByFilter('tax_classes', 'is_default = true', '', 0, 0);
      for (const other of others) {
        other.set('is_default', false);
        tx.save(other);
      }
    }
    tx.save(rec);
  });
  return serializeTax(rec);
}

function archiveTax(app, rec, archived) {
  const util = u();
  if (archived) {
    if (rec.getBool('is_default')) throw util.fail(409, '"' + rec.getString('name') + '" is the default for new products. Make another class the default first.', 'is_default');
    const used = util.scalarSql(app, 'SELECT COUNT(id) AS v FROM products WHERE tax_class = {:t} AND archived = false', { t: rec.id });
    if (used > 0) throw util.fail(409, used + ' product' + (used === 1 ? ' uses' : 's use') + ' "' + rec.getString('name') + '". Move them to another tax class first.', 'in_use');
    if (core().settings(app).getString('service_charge_tax') === rec.id) throw util.fail(409, 'The service charge is taxed with "' + rec.getString('name') + '". Change that in Settings first.', 'in_use');
  }
  rec.set('archived', archived);
  app.save(rec);
  return serializeTax(rec);
}

/* -------------------------------------------------------------- tenders */

function serializeTender(rec) {
  const qr = rec.getString('qr');
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind'),
    ask_reference: rec.getBool('ask_reference'),
    active: rec.getBool('active'),
    sort: rec.getInt('sort'),
    qr: qr,
    qr_url: qr !== '' ? '/api/files/tenders/' + rec.id + '/' + qr : '',
  };
}

function listTenders(app, includeInactive) {
  return { tenders: app.findRecordsByFilter('tenders', includeInactive ? '' : 'active = true', 'sort,name', 0, 0).map(serializeTender) };
}

function saveTender(e, app, rec, p, isNew) {
  const util = u();
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"DuitNow QR"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 30) throw util.fail(400, 'A payment method needs a name of at most 30 characters');
    const clash = util.idsNocase(app, 'tenders', 'name', name, 2).filter((id) => id !== rec.id);
    if (clash.length > 0) throw util.fail(400, 'There is already a payment method called "' + name + '"');
    rec.set('name', name);
  }
  if (isNew) {
    rec.set('kind', util.oneOf(p, 'kind', ['cash', 'card', 'qr', 'other'], 'other'));
    rec.set('active', true);
    rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM tenders'));
  }
  if (util.has(p, 'ask_reference')) rec.set('ask_reference', util.bool(p, 'ask_reference', false));
  if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', rec.getInt('sort'), 0, 100000));
  if (util.has(p, 'active')) {
    const on = util.bool(p, 'active', true);
    if (!on && rec.getBool('active')) {
      const others = util.scalarSql(app, 'SELECT COUNT(id) AS v FROM tenders WHERE active = true AND id != {:id}', { id: rec.id || '' });
      if (others === 0) throw util.fail(409, 'At least one payment method must stay on.', 'last_tender');
    }
    rec.set('active', on);
  }
  const file = util.uploaded(e, 'qr');
  if (file !== null) rec.set('qr', file);
  else if (util.str(p, 'qr_path', '') !== '') rec.set('qr', util.localFile(util.str(p, 'qr_path', ''), 'qr_path'));
  else if (util.bool(p, 'clear_qr', false)) rec.set('qr', null);
  app.save(rec);
  return serializeTender(rec);
}

/* ------------------------------------------------------------ registers */

function serializeRegister(app, rec) {
  const util = u();
  const open = util.findOne(app, 'shifts', 'register = {:r} && status = "open"', { r: rec.id });
  const receipts = core().counter(app, 'receipt:' + rec.id);
  return {
    id: rec.id,
    name: rec.getString('name'),
    code: rec.getString('code'),
    archived: rec.getBool('archived'),
    receipts: receipts === null ? 0 : receipts.getInt('num'),
    shift: open === null ? null : { id: open.id, number: open.getInt('number'), opened: open.getString('created') },
  };
}

function listRegisters(app, includeArchived) {
  return { registers: app.findRecordsByFilter('registers', includeArchived ? '' : 'archived = false', 'code', 0, 0).map((r) => serializeRegister(app, r)) };
}

function saveRegister(app, rec, p, isNew) {
  const util = u();
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Front counter"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 40) throw util.fail(400, 'A register needs a name of at most 40 characters');
    rec.set('name', name);
  }
  if (isNew) {
    let code = util.str(p, 'code', '').toUpperCase();
    if (code === '') {
      let n = app.findRecordsByFilter('registers', '', '', 0, 0).length + 1;
      while (util.findOne(app, 'registers', 'code = {:c}', { c: 'R' + n }) !== null) n++;
      code = 'R' + n;
    }
    if (!/^[A-Z0-9]{1,8}$/.test(code)) throw util.fail(400, 'code is up to 8 letters or digits, e.g. R2');
    if (util.findOne(app, 'registers', 'code = {:c}', { c: code }) !== null) throw util.fail(400, 'There is already a register ' + code);
    rec.set('code', code);
    rec.set('z_seq', 0);
    rec.set('archived', false);
  }
  if (util.has(p, 'archived')) {
    const arch = util.bool(p, 'archived', false);
    if (arch && util.findOne(app, 'shifts', 'register = {:r} && status = "open"', { r: rec.id }) !== null) {
      throw util.fail(409, 'Close this register before archiving it.', 'shift_open');
    }
    if (arch && util.scalarSql(app, 'SELECT COUNT(id) AS v FROM registers WHERE archived = false AND id != {:id}', { id: rec.id }) === 0) {
      throw util.fail(409, 'At least one register must stay in use.', 'last_register');
    }
    rec.set('archived', arch);
  }
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (isNew) {
      const coll = tx.findCollectionByNameOrId('counters');
      for (const key of ['receipt:' + rec.id, 'training:' + rec.id, 'hash:' + rec.id]) {
        const c = new Record(coll);
        c.set('key', key);
        c.set('num', 0);
        c.set('text', '');
        tx.save(c);
      }
    }
  });
  return serializeRegister(app, rec);
}

module.exports = {
  ORDER_TYPES: ORDER_TYPES,
  BASIC_FIELDS: BASIC_FIELDS,
  get: get,
  update: update,
  setup: setup,
  serializeTax: serializeTax,
  listTax: listTax,
  saveTax: saveTax,
  archiveTax: archiveTax,
  serializeTender: serializeTender,
  listTenders: listTenders,
  saveTender: saveTender,
  serializeRegister: serializeRegister,
  listRegisters: listRegisters,
  saveRegister: saveRegister,
};
