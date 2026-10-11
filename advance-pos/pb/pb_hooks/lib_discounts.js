/// <reference path="../pb_data/types.d.ts" />
/**
 * Promotions. A discount is percent or amount off, or buy X get Y; it
 * applies to items (all, some categories, some products) or to the whole
 * order; it is given by hand (manual), applies on its own when its
 * conditions hold (auto), or with a coupon code. Auto and code discounts
 * can be limited to a minimum spend or quantity, days of the week, hours,
 * and a date range.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

/** A discount as plain data (what the pricing engine reads). */
function plain(r) {
  return {
    id: r.id,
    name: r.getString('name'),
    kind: r.getString('kind'),
    value: r.getFloat('value'),
    scope: r.getString('scope'),
    applies: r.getString('applies') || 'all',
    categories: r.getStringSlice('categories'),
    products: r.getStringSlice('products'),
    mode: r.getString('mode'),
    code: r.getString('code'),
    min_subtotal: r.getInt('min_subtotal'),
    min_qty: r.getFloat('min_qty'),
    buy_qty: r.getInt('buy_qty'),
    get_qty: r.getInt('get_qty'),
    days: u().getJson(r, 'days') || [],
    start_time: r.getString('start_time'),
    end_time: r.getString('end_time'),
    starts_on: r.getString('starts_on'),
    ends_on: r.getString('ends_on'),
    manager_only: r.getBool('manager_only'),
    active: r.getBool('active'),
    uses: r.getInt('uses'),
  };
}

function json(r, money) {
  const d = plain(r);
  d.value_text = d.kind === 'amount' ? money.plain(d.value) : u().fmt(d.value) + '%';
  d.min_subtotal_text = money.plain(d.min_subtotal);
  d.live = isLive(d, new Date());
  d.summary = summary(d, money);
  return d;
}

/** One line a person reads: "20% off Drinks, Mon to Fri 15:00 to 17:00". */
function summary(d, money) {
  const util = u();
  let what = d.kind === 'percent' ? util.fmt(d.value) + '% off' : d.kind === 'amount' ? money.plain(d.value) + ' off' : 'Buy ' + d.buy_qty + ' get ' + d.get_qty + (d.value >= 100 ? ' free' : ' at ' + util.fmt(d.value) + '% off');
  if (d.scope === 'order') what += ' the order';
  else if (d.applies === 'categories') what += ' selected categories';
  else if (d.applies === 'products') what += ' selected products';
  else if (d.kind === 'amount') what += ' each item';
  const conds = [];
  if (d.min_subtotal > 0) conds.push('over ' + money.plain(d.min_subtotal));
  if (d.min_qty > 0) conds.push('from ' + util.fmt(d.min_qty) + ' items');
  if (d.days.length > 0 && d.days.length < 7) conds.push(d.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', '));
  if (d.start_time !== '' || d.end_time !== '') conds.push((d.start_time || '00:00') + ' to ' + (d.end_time || '24:00'));
  if (d.mode === 'code') conds.push('code ' + d.code);
  return what + (conds.length ? ', ' + conds.join(', ') : '');
}

function minutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
}

/** Whether a discount's dates, days and hours hold at `now` (local time). */
function isLive(d, now) {
  if (!d.active) return false;
  const day = u().dayOf(now);
  if (d.starts_on !== '' && day < d.starts_on) return false;
  if (d.ends_on !== '' && day > d.ends_on) return false;
  if (d.days.length > 0 && d.days.indexOf(now.getDay()) < 0) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const a = d.start_time === '' ? 0 : minutes(d.start_time);
  const b = d.end_time === '' ? 24 * 60 : minutes(d.end_time);
  if (a !== null && b !== null) {
    if (a <= b ? t < a || t >= b : t < a && t >= b) return false;
  }
  return true;
}

/** The discounts that apply on their own right now. */
function autoNow(db, now) {
  return db
    .findRecordsByFilter('discounts', "mode = 'auto' && active = true", '', 0, 0)
    .map(plain)
    .filter((d) => isLive(d, now));
}

function byCode(db, code) {
  const c = String(code || '').trim();
  if (c === '') return null;
  return u().findOne(db, 'discounts', "mode = 'code' && code = {:c}", { c: c });
}

function list(app, p) {
  const util = u();
  const money = require(`${__hooks}/lib_money.js`).of(auth().settingsRow(app));
  const mode = util.oneOf(p, 'mode', ['manual', 'auto', 'code'], '');
  const rows = app.findRecordsByFilter('discounts', mode === '' ? '' : 'mode = {:m}', '-active,name', 0, 0, { m: mode });
  return { discounts: rows.map((r) => json(r, money)) };
}

function save(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_discounts', p, { what: 'Editing promotions' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('discounts')) : util.byId(tx, 'discounts', id);
    if (r === null) throw util.fail(404, 'No promotion ' + id);
    const cur = id === '' ? null : plain(r);
    const pick = (k, d) => (util.has(p, k) ? undefined : cur === null ? d : cur[k]);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Happy hour"'));
      if (name.length > 80) throw util.fail(400, 'name can be at most 80 characters');
      r.set('name', name);
    }
    const kind = util.has(p, 'kind') ? util.oneOf(p, 'kind', ['percent', 'amount', 'bogo'], 'percent') : pick('kind', 'percent');
    const scope = util.has(p, 'scope') ? util.oneOf(p, 'scope', ['order', 'item'], 'item') : pick('scope', 'item');
    const mode = util.has(p, 'mode') ? util.oneOf(p, 'mode', ['manual', 'auto', 'code'], 'auto') : pick('mode', 'manual');
    if (kind === 'bogo' && scope !== 'item') throw util.fail(400, 'Buy X get Y applies to items (scope item)');
    r.set('kind', kind);
    r.set('scope', scope);
    r.set('mode', mode);
    if (util.has(p, 'value') || id === '' || (cur !== null && cur.kind !== kind)) {
      if (kind === 'amount') {
        const v = money.param(p, 'value', { required: true, min: 1, example: '2.00' });
        r.set('value', v);
      } else {
        const v = util.number(p, 'value', { required: true, min: 0.01, max: 100, example: kind === 'bogo' ? '100' : '10' });
        r.set('value', Math.round(v * 100) / 100);
      }
    }
    if (kind === 'bogo') {
      const b = util.int(p, 'buy_qty', cur === null ? 1 : Math.max(cur.buy_qty, 1), 1, 100);
      const g = util.int(p, 'get_qty', cur === null ? 1 : Math.max(cur.get_qty, 1), 1, 100);
      r.set('buy_qty', b);
      r.set('get_qty', g);
    } else {
      r.set('buy_qty', 0);
      r.set('get_qty', 0);
    }
    if (util.has(p, 'applies') || id === '') r.set('applies', scope === 'order' ? 'all' : util.oneOf(p, 'applies', ['all', 'categories', 'products'], 'all'));
    if (scope === 'order') r.set('applies', 'all');
    if (util.has(p, 'categories')) {
      const ids = (util.list(p, 'categories', '["<category id>"]') || []).map((x, i) => {
        const cat = util.byId(tx, 'categories', String(x)) || util.findOne(tx, 'categories', 'name = {:n}', { n: String(x) });
        if (cat === null) throw util.fail(404, 'categories[' + i + ']: no category "' + x + '"');
        return cat.id;
      });
      r.set('categories', ids);
    }
    if (util.has(p, 'products')) {
      const ids = (util.list(p, 'products', '["<product id>"]') || []).map((x, i) => {
        const prod = util.byId(tx, 'products', String(x));
        if (prod === null) throw util.fail(404, 'products[' + i + ']: no product with id "' + x + '"');
        return prod.id;
      });
      r.set('products', ids);
    }
    if (r.getString('applies') === 'categories' && r.getStringSlice('categories').length === 0) throw util.fail(400, 'Choose at least one category');
    if (r.getString('applies') === 'products' && r.getStringSlice('products').length === 0) throw util.fail(400, 'Choose at least one product');
    if (mode === 'code') {
      const code = util.str(p, 'code', cur === null ? '' : cur.code).toUpperCase();
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw util.fail(400, 'code must be 3 to 40 letters, digits, - or _');
      if (util.findOne(tx, 'discounts', 'code = {:c} && id != {:i}', { c: code, i: r.id || '' }) !== null) throw util.fail(400, 'Another promotion uses the code ' + code);
      r.set('code', code);
    } else r.set('code', '');
    if (util.has(p, 'min_subtotal')) r.set('min_subtotal', money.param(p, 'min_subtotal', { min: 0 }) || 0);
    if (util.has(p, 'min_qty')) r.set('min_qty', util.number(p, 'min_qty', { min: 0, max: 100000 }) || 0);
    if (util.has(p, 'days')) {
      const days = util.list(p, 'days', '[1, 2, 3, 4, 5]') || [];
      if (days.some((x) => !Number.isInteger(Number(x)) || Number(x) < 0 || Number(x) > 6)) throw util.fail(400, 'days are 0 (Sunday) to 6 (Saturday)');
      r.set('days', days.map(Number).filter((x, i, a) => a.indexOf(x) === i).sort());
    }
    for (const k of ['start_time', 'end_time']) {
      if (!util.has(p, k)) continue;
      const v = util.str(p, k, '');
      if (v !== '' && (minutes(v) === null || minutes(v) > 24 * 60)) throw util.fail(400, k + ' is a time like 15:00');
      r.set(k, v);
    }
    for (const k of ['starts_on', 'ends_on']) {
      if (!util.has(p, k)) continue;
      const v = util.str(p, k, '');
      if (v !== '') util.dayStart(v, k);
      r.set(k, v);
    }
    if (r.getString('starts_on') !== '' && r.getString('ends_on') !== '' && r.getString('ends_on') < r.getString('starts_on')) throw util.fail(400, 'ends_on is before starts_on');
    if (util.has(p, 'manager_only')) r.set('manager_only', util.bool(p, 'manager_only', false));
    r.set('active', util.bool(p, 'active', cur === null ? true : cur.active));
    tx.save(r);
    require(`${__hooks}/lib_audit.js`).log(tx, 'catalog', c, { approver: approver, detail: (id === '' ? 'Promotion added: ' : 'Promotion changed: ') + r.getString('name') + ' (' + summary(plain(r), money) + ')' });
    out = r;
  });
  return { discount: json(out, money) };
}

module.exports = { plain: plain, json: json, summary: summary, isLive: isLive, autoNow: autoNow, byCode: byCode, list: list, save: save };
