/// <reference path="../pb_data/types.d.ts" />
/**
 * Portfolio KPIs (SPEC 7.10): definitions, values (staged by your AI agent
 * or an import, verified or rejected by a person in one click), series
 * with currency modes, runway, the Portfolio page list, and alerts.
 *
 * A value is stored once per company, metric, period and forecast flag:
 * `value` is minor units of `currency` for money metrics, ppm for percent
 * metrics, a whole count otherwise. Staging a different value for a
 * verified period keeps the verified one until a person verifies the new
 * one (the old becomes `superseded`). Your AI agent never verifies.
 *
 * Currency (engines lib_eng_kpi and the kernel's lib_fx): flows (revenue,
 * burn) convert at the period's average rate, balances (cash, ARR) at the
 * period-end rate, ratios and counts never convert. Runway is
 * lib_eng_runway over verified cash and net burn only.
 *
 * Alerts (daily, and at once when values are verified): runway under the
 * threshold (6 months), cash under 3 months of burn, burn up 30% quarter
 * on quarter, and a missed update (no update 45 days after the period a
 * request asked for). Each fires once per breach: while an alert of a rule
 * is open or acknowledged no new one fires; it resolves itself when the
 * condition ends.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function P() {
  return L('lib_portfolio');
}

const KINDS = ['flow', 'stock', 'ratio'];
const UNITS = ['money', 'count', 'percent'];
const FLAGS = ['contracted_not_live', 'gross_not_net', 'bookings_not_revenue', 'run_rate', 'period_unclear', 'currency_unclear', 'restated', 'other'];
const FLAG_LABELS = { contracted_not_live: 'Contracted, not live', gross_not_net: 'Gross, not net', bookings_not_revenue: 'Bookings, not revenue', run_rate: 'Run rate', period_unclear: 'Period unclear', currency_unclear: 'Currency unclear', restated: 'Restated', other: 'Check' };
const RULES = ['runway_low', 'missed_update', 'burn_up', 'cash_low'];
const LIST_KEYS = ['arr', 'mrr', 'revenue', 'cash', 'net_burn'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ----------------------------------------------------------- settings */

function settings(app) {
  const s = L('lib_settings').module(app, 'portfolio');
  return {
    runway_months: Number(s.runway_months) || 6,
    cash_months: Number(s.cash_months) || 3,
    burn_up_pct: Number(s.burn_up_pct) || 30,
    missed_update_days: Number(s.missed_update_days) || 45,
  };
}

/* ---------------------------------------------------------- definitions */

function defView(r) {
  return { id: r.id, key: r.getString('key'), label: r.getString('label'), kind: r.getString('kind'), unit: r.getString('unit'), sort: r.getInt('sort'), active: r.getBool('active'), seeded: r.getBool('seeded') };
}

/** Every definition: { key: view } (sorted list in .list). */
function defs(app) {
  const list = u().findMany(app, 'kpi_defs', '1=1', 'sort,key', 0).map(defView);
  const byKey = {};
  for (const d of list) byKey[d.key] = d;
  return { list: list, byKey: byKey };
}

function defOf(app, key) {
  const util = u();
  const k = String(key || '')
    .trim()
    .toLowerCase();
  const all = defs(app);
  let d = all.byKey[k];
  if (d === undefined) {
    // A label typed by a person (an import column) names its metric too.
    for (const x of all.list) if (x.label.toLowerCase() === k) d = x;
  }
  if (d === undefined) {
    const near = util.nearest(k, all.list.map((x) => x.key));
    throw util.fail(400, 'Unknown metric "' + key + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Metrics: ' + all.list.map((x) => x.key).join(', ') + '.', 'invalid_param', { param: 'key', allowed: all.list.map((x) => x.key) });
  }
  return d;
}

function opDefsList(ctx) {
  return { defs: defs(ctx.app).list, flags: FLAGS.map((f) => ({ code: f, label: FLAG_LABELS[f] })) };
}

/** kpi-defs.save: a new metric, or a label, order or on/off change (a seeded metric keeps its kind and unit). */
function opDefSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const key = util
    .req(p, 'key', 'nrr')
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) throw util.fail(400, 'key is lower case letters, digits and _ (2 to 31 characters), e.g. pipeline_value.', 'invalid_param', { param: 'key' });
  let r = util.findOne(app, 'kpi_defs', 'key = {:k}', { k: key });
  const isNew = r === null;
  if (isNew) {
    r = util.newRecord(app, 'kpi_defs');
    r.set('key', key);
    r.set('seeded', false);
    r.set('active', true);
    r.set('sort', 1000);
    const kind = util.oneOf(p, 'kind', KINDS, '');
    const unit = util.oneOf(p, 'unit', UNITS, '');
    if (kind === '') throw util.fail(400, 'kind is required for a new metric: flow (summed over a period, like revenue), stock (a balance at a day, like cash) or ratio (a percent, like margin).', 'missing_param', { param: 'kind' });
    if (unit === '') throw util.fail(400, 'unit is required for a new metric: money, count or percent.', 'missing_param', { param: 'unit' });
    r.set('kind', kind);
    r.set('unit', unit);
    r.set('label', util.text(p, 'label', 60, '') || key);
  } else {
    if (r.getBool('seeded') && (util.has(p, 'kind') || util.has(p, 'unit')) && (util.str(p, 'kind', r.getString('kind')) !== r.getString('kind') || util.str(p, 'unit', r.getString('unit')) !== r.getString('unit'))) throw util.fail(409, 'A standard metric keeps its kind and unit; add a new metric instead.', 'seeded');
    if (r.getString('kind') === 'computed' && util.has(p, 'kind')) throw util.fail(409, 'Runway is computed from cash and burn.', 'computed');
    if (!r.getBool('seeded')) {
      if (util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', KINDS, r.getString('kind')));
      if (util.has(p, 'unit')) r.set('unit', util.oneOf(p, 'unit', UNITS, r.getString('unit')));
    }
    if (util.has(p, 'label')) {
      const l = util.squash(util.text(p, 'label', 60, ''));
      if (l === '') throw util.fail(400, 'label cannot be empty.', 'invalid_param', { param: 'label' });
      r.set('label', l);
    }
  }
  if (util.has(p, 'active')) r.set('active', util.bool(p, 'active', true));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 1000, 0, 100000));
  P().stamp(ctx, r);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'kpi_defs', record: r.id, summary: (isNew ? 'Added the metric ' : 'Changed the metric ') + r.getString('label') });
  return { def: defView(r) };
}

/* --------------------------------------------------------------- values */

/** A value as given (major units text for money, percent text, a whole count) -> the stored integer. */
function parseValue(def, raw, currency, where) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') throw util.fail(400, where + ': value is required.', 'missing_param', { param: 'value' });
  const s = typeof raw === 'number' ? String(raw) : String(raw).trim().replace(/,/g, '');
  if (def.unit === 'money') {
    const v = L('lib_money').toMinor(s, currency, true);
    if (v === null) throw util.fail(400, where + ': value must be an amount in ' + currency + ' (major units, "." decimals, e.g. 125000.50), got "' + raw + '".', 'invalid_amount', { param: 'value' });
    return v;
  }
  if (def.unit === 'percent') {
    const v = L('lib_money').parseScaled(s.replace(/%$/, ''), 4, true);
    if (v === null) throw util.fail(400, where + ': value must be a percent such as 72.5, got "' + raw + '".', 'invalid_param', { param: 'value' });
    return v;
  }
  const n = Number(s);
  if (!Number.isInteger(n)) throw util.fail(400, where + ': value must be a whole number, got "' + raw + '".', 'invalid_param', { param: 'value' });
  return n;
}

/** The value as people read it: USD 1.2M, 72.5%, 48. */
function valueText(def, value, currency) {
  if (value === null || value === undefined) return '';
  if (def.unit === 'money') return P().short(value, currency);
  if (def.unit === 'percent') return P().pct(value, 1);
  if (def.unit === 'months') return Number(value).toFixed(1) + ' mo';
  return (value < 0 ? '-' : '') + u().group(String(Math.abs(Math.round(value))));
}

function monthLabel(day) {
  if (!day) return '';
  return MONTH_NAMES[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4);
}

function valueView(app, r, defsByKey) {
  const util = u();
  const d = defsByKey[r.getString('key')] || { key: r.getString('key'), label: r.getString('key'), unit: 'count', kind: 'stock' };
  return {
    id: r.id,
    company: r.getString('company'),
    holding: r.getString('holding'),
    key: r.getString('key'),
    label: d.label,
    unit: d.unit,
    kind: d.kind,
    period_start: r.getString('period_start'),
    period_end: r.getString('period_end'),
    months: r.getInt('months') || 1,
    value: r.getInt('value'),
    value_text: valueText(d, r.getInt('value'), r.getString('currency')),
    currency: r.getString('currency'),
    forecast: r.getBool('forecast'),
    status: r.getString('status'),
    source: r.getString('source'),
    update: r.getString('update'),
    anchor: r.getString('anchor'),
    quote: r.getString('quote'),
    flags: (util.jsonOf(r, 'flags', []) || []).map((f) => Object.assign({ label: FLAG_LABELS[f.code] || f.code }, f)),
    note: r.getString('note'),
    verified_by: r.getString('verified_by'),
    verified_at: r.getString('verified_at'),
    actor: r.getString('actor'),
  };
}

function periodStart(periodEnd, months) {
  const util = u();
  return util.addMonths(periodEnd.slice(0, 8) + '01', -((months || 1) - 1));
}

/** The holding a company's values attach to (its first active one ctx may see). */
function holdingFor(ctx, companyId) {
  const mine = P().holdingsOfCompany(ctx, companyId);
  if (mine.rows.length === 0) {
    if (mine.hidden > 0) throw u().fail(403, 'This company belongs to a fund outside your scope.', 'not_permitted');
    throw u().fail(404, 'The firm holds nothing in this company; KPIs are kept for portfolio companies.', 'not_found');
  }
  const active = mine.rows.filter((h) => h.getString('status') === 'active');
  return active.length > 0 ? active[0] : mine.rows[0];
}

function flagsOf(raw, where) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.slice(0, 6).map((f, i) => {
    const code = typeof f === 'string' ? f : f && f.code;
    if (FLAGS.indexOf(code) < 0) throw util.fail(400, where + '.flags[' + i + ']: code must be one of: ' + FLAGS.join(', ') + '.', 'invalid_param', { param: 'flags', allowed: FLAGS });
    return { code: code, note: typeof f === 'object' && f.note ? util.clip(String(f.note), 300) : '' };
  });
}

/** The live rows of a slot (company, metric, period, months, forecast): staged and verified. */
function slotRows(app, companyId, key, periodEnd, months, forecast) {
  return u().findMany(app, 'kpi_values', "company = {:c} && key = {:k} && period_end = {:p} && months = {:m} && forecast = {:f} && (status = 'staged' || status = 'verified')", '-created', 0, { c: companyId, k: key, p: periodEnd, m: months, f: forecast });
}

function writeValue(ctx, o) {
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'kpi_values');
  r.set('company', o.company);
  r.set('holding', o.holding || '');
  r.set('key', o.def.key);
  r.set('def', o.def.id);
  r.set('period_start', periodStart(o.period_end, o.months));
  r.set('period_end', o.period_end);
  r.set('months', o.months);
  r.set('value', o.value);
  r.set('currency', o.def.unit === 'money' ? o.currency : '');
  r.set('forecast', o.forecast === true);
  r.set('status', o.status);
  r.set('source', o.source);
  r.set('update', o.update || '');
  r.set('anchor', o.anchor || '');
  r.set('quote', util.clip(o.quote || '', 1000));
  r.set('flags', o.flags || []);
  if (o.note) r.set('note', util.clip(o.note, 600));
  if (o.status === 'verified') {
    r.set('verified_by', ctx.memberId || '');
    r.set('verified_at', util.nowIso());
  }
  r.set('run', ctx.run || '');
  r.set('prov', { by: ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system', at: util.nowIso(), run: ctx.run || '', source: util.clip(o.source_ref || '', 300), member: ctx.memberId || '' });
  P().stamp(ctx, r);
  app.save(r);
  return r;
}

/** Read one value item of kpis.stage / kpis.save into a plain object (refused with the item's index). */
function readItem(ctx, it, i, dflt) {
  const util = u();
  const where = 'values[' + i + ']';
  util.keysOnly(it, ['key', 'period_end', 'months', 'value', 'currency', 'forecast', 'quote', 'start', 'end', 'anchor', 'flags', 'note'], where);
  const def = defOf(ctx.app, it.key);
  if (def.kind === 'computed') throw util.fail(400, where + ': ' + def.label + ' is computed from cash and net burn; stage those instead.', 'computed', { param: 'key' });
  if (!def.active) throw util.fail(400, where + ': the metric ' + def.label + ' is switched off in Settings.', 'inactive', { param: 'key' });
  const pe = String(it.period_end || dflt.period_end || '').trim();
  if (!util.isDay(pe)) throw util.fail(400, where + ': period_end must be a day written YYYY-MM-DD (the last day of the period).', 'invalid_param', { param: 'period_end' });
  if (pe !== util.monthEnd(pe)) throw util.fail(400, where + ': period_end must be the last day of a month (' + util.monthEnd(pe) + ' for that month).', 'invalid_param', { param: 'period_end' });
  const months = it.months === undefined || it.months === null || it.months === '' ? 1 : Number(it.months);
  if ([1, 3, 12].indexOf(months) < 0) throw util.fail(400, where + ': months is 1 (a month), 3 (a quarter) or 12 (a year).', 'invalid_param', { param: 'months' });
  const currency = String(it.currency || dflt.currency || '').toUpperCase();
  if (def.unit === 'money' && !/^[A-Z]{3}$/.test(currency)) throw util.fail(400, where + ': currency is a three-letter code such as USD.', 'invalid_param', { param: 'currency' });
  const forecast = it.forecast === true || it.forecast === 'true';
  return { def: def, period_end: pe, months: months, value: parseValue(def, it.value, currency, where), currency: currency, forecast: forecast, quote: it.quote ? util.squash(String(it.quote)) : '', start: it.start, end: it.end, anchor: it.anchor ? String(it.anchor) : '', flags: flagsOf(it.flags, where), note: it.note ? util.clip(util.squash(String(it.note)), 600) : '', where: where };
}

/** A message anchor in the update's text for a quote (offsets given, or the quote found in the text). */
function anchorInUpdate(ctx, upd, item) {
  const util = u();
  if (upd === null || item.quote === '') return '';
  const body = upd.getString('body');
  let start = item.start === undefined || item.start === null || item.start === '' ? -1 : Number(item.start);
  let end = item.end === undefined || item.end === null || item.end === '' ? -1 : Number(item.end);
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= body.length)) {
    start = body.indexOf(item.quote);
    end = start >= 0 ? start + item.quote.length : -1;
  }
  if (start < 0) return '';
  const a = L('lib_text').messageAnchor(ctx, { message_id: upd.getString('message_id') || 'update:' + upd.id, ref_collection: 'updates', ref_id: upd.id, start: start, end: end, quote: body.slice(start, end) || item.quote });
  return a.id;
}

/** kpis.stage: values for a period with their source (your AI agent or a person); never verified here. */
function opStage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const updId = util.str(p, 'update', '');
  let upd = null;
  let companyId = '';
  if (updId !== '') {
    upd = util.byId(app, 'updates', updId);
    if (upd === null) throw util.fail(404, 'No update ' + updId + '. Run updates.list.', 'not_found', { param: 'update' });
    if (upd.getString('company') === '') throw util.fail(409, 'This update is not filed to a company yet: run updates.assign first.', 'unassigned');
    if (upd.getString('status') === 'dismissed') throw util.fail(409, 'This update was dismissed.', 'dismissed');
    companyId = upd.getString('company');
  } else companyId = P().companyRef(app, util.req(p, 'company', 'acme.com')).id;
  const h = holdingFor(ctx, companyId);
  const items = util.list(p, 'values');
  if (!items || items.length === 0) throw util.fail(400, 'values is required: a JSON list of {"key","period_end","value","currency","quote"}.', 'missing_param', { param: 'values' });
  if (items.length > 200) throw util.fail(400, 'At most 200 values in one call.', 'invalid_param', { param: 'values' });
  const dflt = { period_end: util.str(p, 'period_end', ''), currency: util.str(p, 'currency', '') || h.getString('report_currency') || h.getString('currency') };
  const read = items.map((it, i) => readItem(ctx, it, i, dflt));
  if (ctx.isAgent) for (const it of read) if (it.quote === '' && it.anchor === '') throw util.fail(400, it.where + ': give the source of every value: quote (the exact words of the update) or anchor (from anchors.create on a file page).', 'missing_source', { param: 'values' });
  const all = defs(app).byKey;
  const staged = [];
  const unchanged = [];
  for (const it of read) {
    const live = slotRows(app, companyId, it.def.key, it.period_end, it.months, it.forecast);
    const verified = live.filter((r) => r.getString('status') === 'verified');
    if (verified.length > 0 && verified[0].getInt('value') === it.value && (it.def.unit !== 'money' || verified[0].getString('currency') === it.currency)) {
      unchanged.push(valueView(app, verified[0], all));
      continue;
    }
    for (const r of live) {
      if (r.getString('status') !== 'staged') continue;
      r.set('status', 'superseded');
      app.save(r);
    }
    const flags = it.flags.slice();
    if (verified.length > 0 && !flags.some((f) => f.code === 'restated')) flags.push({ code: 'restated', note: 'Verified before as ' + valueText(it.def, verified[0].getInt('value'), verified[0].getString('currency')) + ' for the ' + (it.months === 1 ? 'month' : it.months === 3 ? 'quarter' : 'year') + ' ending ' + it.period_end });
    const anchor = it.anchor !== '' ? it.anchor : anchorInUpdate(ctx, upd, it);
    const rec = writeValue(ctx, { company: companyId, holding: h.id, def: it.def, period_end: it.period_end, months: it.months, value: it.value, currency: it.currency, forecast: it.forecast, status: 'staged', source: upd !== null ? 'update' : 'manual', update: upd !== null ? upd.id : '', anchor: anchor, quote: it.quote, flags: flags, note: it.note, source_ref: upd !== null ? 'updates:' + upd.id : '' });
    staged.push(valueView(app, rec, all));
  }
  if (upd !== null) refreshUpdate(app, upd.id);
  const name = (P().companyMini(app, companyId) || {}).name;
  L('lib_audit').note(ctx, { collection: 'kpi_values', record: staged.length > 0 ? staged[0].id : '', summary: (ctx.isAgent ? 'Your AI agent staged ' : 'Staged ') + staged.length + ' value' + (staged.length === 1 ? '' : 's') + ' for ' + name });
  return { company: companyId, update: upd !== null ? upd.id : '', staged: staged, unchanged: unchanged, message: staged.length + ' staged for a person to verify' + (unchanged.length > 0 ? '; ' + unchanged.length + ' already verified with the same value' : '') + '.' };
}

/** An update's status from its values: staged while any value waits, verified when all were verified, received otherwise. */
function refreshUpdate(app, updateId) {
  const util = u();
  const upd = util.byId(app, 'updates', updateId);
  if (upd === null || upd.getString('status') === 'dismissed') return;
  const staged = util.count(app, "SELECT COUNT(*) AS n FROM kpi_values WHERE \"update\" = {:u} AND status = 'staged'", { u: updateId });
  const verified = util.count(app, "SELECT COUNT(*) AS n FROM kpi_values WHERE \"update\" = {:u} AND status = 'verified'", { u: updateId });
  const st = staged > 0 ? 'staged' : verified > 0 ? 'verified' : 'received';
  const pe = util.one(app, "SELECT COALESCE(MAX(period_end), '') AS d FROM kpi_values WHERE \"update\" = {:u} AND forecast = FALSE AND (status = 'staged' OR status = 'verified')", { d: '' }, { u: updateId });
  let changed = false;
  if (upd.getString('status') !== st) {
    upd.set('status', st);
    changed = true;
  }
  if (pe && pe.d !== '' && upd.getString('period_end') !== pe.d) {
    upd.set('period_end', pe.d);
    changed = true;
  }
  if (changed) app.save(upd);
}

/** The staged rows a verify or reject call names: --ids, --id, or --update (every staged value of that update). */
function targets(ctx, p) {
  const util = u();
  const app = ctx.app;
  let rows = [];
  const ids = util.list(p, 'ids');
  const id = util.str(p, 'id', '');
  const updId = util.str(p, 'update', '');
  if (ids && ids.length > 0) rows = ids.map((x) => util.byId(app, 'kpi_values', String(x))).filter((r) => r !== null);
  else if (id !== '') {
    const r = util.byId(app, 'kpi_values', id);
    if (r === null) throw util.fail(404, 'No value ' + id + '.', 'not_found', { param: 'id' });
    rows = [r];
  } else if (updId !== '') {
    if (util.byId(app, 'updates', updId) === null) throw util.fail(404, 'No update ' + updId + '.', 'not_found', { param: 'update' });
    rows = util.findMany(app, 'kpi_values', "update = {:u} && status = 'staged'", 'key,period_end', 0, { u: updId });
  } else throw util.fail(400, 'Give --update (all its staged values), --ids, or --id.', 'missing_param', { param: 'update' });
  const seen = {};
  for (const r of rows) {
    if (seen[r.getString('company')]) continue;
    holdingFor(ctx, r.getString('company'));
    seen[r.getString('company')] = true;
  }
  return rows;
}

/**
 * kpis.verify (people): staged values become verified (one, a list, or a
 * whole update); --value with --id corrects the value as it is verified.
 * Fires kpi.verified per company and period and checks the alert rules at once.
 */
function opVerify(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rows = targets(ctx, p);
  const all = defs(app).byKey;
  const fix = util.has(p, 'value') && util.str(p, 'value', '') !== '';
  if (fix && rows.length !== 1) throw util.fail(400, '--value corrects one value: give it with --id.', 'invalid_param', { param: 'value' });
  const done = [];
  const updates = {};
  const periods = {};
  for (const r of rows) {
    const st = r.getString('status');
    if (st === 'verified' && !fix) continue;
    if (st !== 'staged' && !(st === 'verified' && fix)) throw util.fail(409, 'This value is ' + st + '; only a staged value can be verified.', 'conflict', { id: r.id });
    if (fix) {
      const d = all[r.getString('key')];
      const before = r.getInt('value');
      const v = parseValue(d, p.value, r.getString('currency') || 'USD', 'value');
      if (v !== before) {
        r.set('value', v);
        r.set('note', util.clip('Corrected from ' + valueText(d, before, r.getString('currency')), 600));
        const pv = util.jsonOf(r, 'prov', {}) || {};
        pv.corrected_by = ctx.memberId;
        pv.corrected_at = util.nowIso();
        r.set('prov', pv);
      }
    }
    for (const o of slotRows(app, r.getString('company'), r.getString('key'), r.getString('period_end'), r.getInt('months'), r.getBool('forecast'))) {
      if (o.id === r.id) continue;
      o.set('status', 'superseded');
      app.save(o);
    }
    r.set('status', 'verified');
    r.set('verified_by', ctx.memberId || '');
    r.set('verified_at', util.nowIso());
    app.save(r);
    done.push(valueView(app, r, all));
    if (r.getString('update') !== '') updates[r.getString('update')] = true;
    if (!r.getBool('forecast')) periods[r.getString('company') + '|' + r.getString('period_end')] = true;
  }
  for (const uid of Object.keys(updates)) refreshUpdate(app, uid);
  const fired = [];
  const companies = {};
  for (const k of Object.keys(periods)) {
    const parts = k.split('|');
    companies[parts[0]] = true;
    P().emit(ctx, 'kpi.verified', { company: parts[0], period_end: parts[1] });
  }
  for (const c of Object.keys(companies)) for (const a of checkCompany(app, c, util.today(app))) fired.push(a);
  L('lib_audit').note(ctx, { collection: 'kpi_values', record: done.length > 0 ? done[0].id : '', summary: 'Verified ' + done.length + ' value' + (done.length === 1 ? '' : 's') + (fix ? ' (corrected)' : '') });
  return { verified: done.length, values: done, updates: Object.keys(updates), alerts_fired: fired };
}

/** kpis.reject (people): staged values are rejected with a note. */
function opReject(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rows = targets(ctx, p);
  const note = util.text(p, 'note', 600, '');
  const all = defs(app).byKey;
  const updates = {};
  const out = [];
  for (const r of rows) {
    if (r.getString('status') !== 'staged') continue;
    r.set('status', 'rejected');
    r.set('note', note);
    app.save(r);
    out.push(valueView(app, r, all));
    if (r.getString('update') !== '') updates[r.getString('update')] = true;
  }
  for (const uid of Object.keys(updates)) refreshUpdate(app, uid);
  L('lib_audit').note(ctx, { collection: 'kpi_values', record: out.length > 0 ? out[0].id : '', summary: 'Rejected ' + out.length + ' value' + (out.length === 1 ? '' : 's') + (note !== '' ? ': ' + util.clip(note, 80) : '') });
  return { rejected: out.length, values: out };
}

/** kpis.save (people): a value a person enters is verified at once (it replaces the slot's staged or verified value). */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const company = P().companyRef(app, util.req(p, 'company', 'acme.com'));
  const h = holdingFor(ctx, company.id);
  const it = readItem(ctx, { key: util.req(p, 'key', 'cash'), period_end: util.req(p, 'period_end', '2026-10-31'), months: util.has(p, 'months') ? util.num(p, 'months') : undefined, value: util.req(p, 'value', '1250000'), currency: util.str(p, 'currency', ''), forecast: util.bool(p, 'forecast', false) }, 0, { currency: h.getString('report_currency') || h.getString('currency') });
  for (const o of slotRows(app, company.id, it.def.key, it.period_end, it.months, it.forecast)) {
    o.set('status', 'superseded');
    app.save(o);
  }
  const r = writeValue(ctx, { company: company.id, holding: h.id, def: it.def, period_end: it.period_end, months: it.months, value: it.value, currency: it.currency, forecast: it.forecast, status: 'verified', source: 'manual' });
  if (!it.forecast) P().emit(ctx, 'kpi.verified', { company: company.id, period_end: it.period_end });
  const fired = checkCompany(app, company.id, util.today(app));
  L('lib_audit').note(ctx, { collection: 'kpi_values', record: r.id, summary: 'Entered ' + it.def.label + ' ' + monthLabel(it.period_end) + ' for ' + company.getString('name') });
  return { value: valueView(app, r, defs(app).byKey), alerts_fired: fired };
}

/* ---------------------------------------------------------------- series */

/** Points without overlap: monthly first, then longer periods only where their months are free. */
function nonOverlapping(points) {
  const util = u();
  const sorted = points.slice().sort((a, b) => a.months - b.months || (a.period_end < b.period_end ? -1 : 1));
  const covered = {};
  const out = [];
  for (const pt of sorted) {
    const keys = [];
    for (let i = 0; i < pt.months; i++) keys.push(util.addMonths(pt.period_end.slice(0, 8) + '01', -i).slice(0, 7));
    if (keys.some((k) => covered[k])) continue;
    for (const k of keys) covered[k] = true;
    out.push(pt);
  }
  out.sort((a, b) => (a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : 0));
  return out;
}

/**
 * Raw rows of a metric for a company as plain points (staged and verified;
 * verified wins its slot), one granularity: monthly when the metric has
 * monthly values, else quarterly, else yearly (stocks keep every row).
 */
function pointsOf(app, companyId, key, opts) {
  const util = u();
  const o = opts || {};
  const rows = util.rows(app, "SELECT id, period_start, period_end, months, value, currency, status, forecast FROM kpi_values WHERE company = {:c} AND key = {:k} AND (status = 'staged' OR status = 'verified') ORDER BY period_end, created", { id: '', period_start: '', period_end: '', months: 0, value: 0, currency: '', status: '', forecast: false }, { c: companyId, k: key });
  const slots = {};
  for (const r of rows) {
    if (r.forecast !== (o.forecast === true)) continue;
    if (o.verified_only && r.status !== 'verified') continue;
    if (o.from_day && r.period_end < o.from_day) continue;
    if (o.to_day && r.period_end > o.to_day) continue;
    const k = r.period_end + '|' + r.months;
    const cur = slots[k];
    if (cur === undefined || (cur.status !== 'verified' && r.status === 'verified')) slots[k] = r;
  }
  const pts = Object.keys(slots).map((k) => {
    const r = slots[k];
    return { id: r.id, period_start: r.period_start, period_end: r.period_end, months: r.months || 1, value: r.value, currency: r.currency, status: r.status, forecast: r.forecast };
  });
  return pts;
}

/** One series per metric kind: flows and ratios without overlapping periods; stocks one point per day. */
function seriesPoints(def, pts) {
  if (def.kind === 'stock') {
    const byDay = {};
    for (const pt of pts) {
      const cur = byDay[pt.period_end];
      if (cur === undefined || (cur.status !== 'verified' && pt.status === 'verified') || (cur.status === pt.status && pt.months < cur.months)) byDay[pt.period_end] = pt;
    }
    return Object.keys(byDay)
      .sort()
      .map((d) => byDay[d]);
  }
  return nonOverlapping(pts);
}

/** Convert money points to `to` (flows at the period average, stocks at the period end); null value with a reason when no rate. */
function convertPoints(app, def, pts, to) {
  const fx = L('lib_fx');
  if (def.unit !== 'money' || !to) return pts;
  return pts.map((pt) => {
    if (!pt.currency || pt.currency === to) return Object.assign({}, pt, { currency: to });
    const mode = L('lib_eng_kpi').modeFor(def.kind) === 'avg' ? 'avg' : 'end';
    const c = fx.convert(app, pt.value, pt.currency, to, pt.period_end, mode, pt.period_start || periodStart(pt.period_end, pt.months));
    return Object.assign({}, pt, { value: c.minor, currency: to, native_value: pt.value, native_currency: pt.currency, rate_e8: c.rate_e8 || null, mode: mode, reason: c.minor === null ? c.reason : null });
  });
}

/** kpiSeries (SPEC 4.6): [{ period_end, value, status, period_start, months, currency, id }] for a metric, converted when opts.currency names a currency. */
function kpiSeries(app, companyId, key, opts) {
  const o = opts || {};
  const def = defOf(app, key);
  const pts = seriesPoints(def, pointsOf(app, companyId, def.key, { from_day: o.from_day, to_day: o.to_day, forecast: o.forecast === true }));
  const cur = o.currency && o.currency !== 'native' ? String(o.currency).toUpperCase() : '';
  return convertPoints(app, def, pts, cur);
}

/** Runway (SPEC 4.6) from verified cash and verified net burn (lib_eng_runway); burn in another currency converts to the cash currency. */
function runwayFrom(app, cashPts, burnPts) {
  const util = u();
  const cash = cashPts.filter((x) => x.status === 'verified' && !x.forecast);
  const out0 = { months: null, state: 'unknown', reason: 'no_cash', cash_minor: null, avg_burn_minor: null, as_of_day: null, missing: [], zero_day: null, currency: '' };
  if (cash.length === 0) return out0;
  const latest = cash.slice().sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0];
  const ccy = latest.currency;
  const rows = [];
  for (const c of cash) if (c.currency === ccy) rows.push({ period_end: c.period_end, months: 1, cash_minor: c.value, net_burn_minor: null, verified: true });
  for (const b of nonOverlapping(burnPts.filter((x) => x.status === 'verified' && !x.forecast && (x.months === 1 || x.months === 3)))) {
    let v = b.value;
    if (b.currency !== ccy) {
      const c = L('lib_fx').convert(app, b.value, b.currency, ccy, b.period_end, 'avg', b.period_start || periodStart(b.period_end, b.months));
      if (c.minor === null) continue;
      v = c.minor;
    }
    rows.push({ period_end: b.period_end, months: b.months, cash_minor: null, net_burn_minor: v, verified: true });
  }
  const r = L('lib_eng_runway').runway({ rows: rows });
  return { months: r.months, state: r.state, reason: r.reason, cash_minor: r.cash_minor, avg_burn_minor: r.avg_burn_minor, as_of_day: r.as_of_day, missing: r.missing || [], zero_day: r.zero_day, currency: ccy };
}

function runwayOf(app, companyId) {
  return runwayFrom(app, pointsOf(app, companyId, 'cash', { verified_only: true }), pointsOf(app, companyId, 'net_burn', { verified_only: true }));
}

/** Growth from the point before (same period length): { growth_ppm, reason } (lib_eng_kpi). */
function growthOf(pts) {
  const v = pts.filter((x) => x.value !== null);
  if (v.length < 2) return { growth_ppm: null, reason: 'missing' };
  const last = v[v.length - 1];
  const prev = v[v.length - 2];
  return L('lib_eng_kpi').growth(last.value, prev.value);
}

/** kpis.list: a portfolio company's metrics (charts), the latest verified figures and runway. */
/**
 * kpis.fund: the verified figures of every company a fund holds for one quarter (an LP letter's portfolio
 * highlights in one read): per company, the latest verified value of each metric whose period ends in the
 * quarter (a monthly value at the quarter's last month, or the quarter itself), with the period before it.
 */
function opFund(ctx, p) {
  const util = u();
  const app = ctx.app;
  const F = L('lib_funds');
  const f = F.fundOf(ctx, util.str(p, 'fund', ''));
  const qtext = util.str(p, 'quarter', '');
  let end = util.day(p, 'period_end', '');
  if (qtext !== '') {
    const m = /Q([1-4])[\s-]*(\d{4})/i.exec(qtext);
    if (m) end = util.monthEnd(m[2] + '-' + util.pad(Number(m[1]) * 3) + '-01');
    else {
      const q = util.byId(app, 'quarters', qtext);
      if (q === null) throw util.fail(400, 'quarter is a label such as "Q3 2026" or a quarter id.', 'invalid_param', { param: 'quarter' });
      end = q.getString('period_end');
    }
  }
  if (end === '') throw util.fail(400, 'Give --quarter "Q3 2026" or --period_end 2026-09-30.', 'missing_param', { param: 'quarter' });
  // The quarter's three months: from the first day of the month two before the end's month.
  let y0 = Number(end.slice(0, 4));
  let m0 = Number(end.slice(5, 7)) - 2;
  if (m0 < 1) {
    m0 += 12;
    y0 -= 1;
  }
  const start = y0 + '-' + util.pad(m0) + '-01';
  const dfs = defs(app).byKey;
  const holdings = L('lib_portfolio').holdingsFor(ctx, { fund: f.id });
  const seen = {};
  const out = [];
  for (const h of holdings) {
    const cid = h.company && typeof h.company === 'object' ? h.company.id : h.company;
    if (!cid || seen[cid]) continue;
    seen[cid] = true;
    const rows = util.findMany(app, 'kpi_values', "company = {:c} && status = 'verified' && forecast = false && period_end >= {:s} && period_end <= {:e}", '-period_end', 200, { c: cid, s: start, e: end });
    const byKey = {};
    for (const r of rows) {
      const k = r.getString('key');
      if (byKey[k] !== undefined) continue;
      const v = valueView(app, r, dfs);
      byKey[k] = { key: k, label: v.label, value: v.value_text, period_end: v.period_end, months: v.months };
    }
    const c = util.byId(app, 'companies', cid);
    out.push({ company: c !== null ? c.getString('name') : cid, id: cid, values: Object.keys(byKey).map((k) => byKey[k]), staged: util.count(app, "SELECT COUNT(*) AS n FROM kpi_values WHERE company = {:c} AND status = 'staged' AND period_end >= {:s} AND period_end <= {:e}", { c: cid, s: start, e: end }) });
  }
  return { fund: { id: f.id, name: f.getString('name') }, from_day: start, to_day: end, companies: out, rule: 'Verified values only (staged ones are not facts; staged counts what waits); forecasts left out.' };
}

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const company = P().companyRef(app, util.req(p, 'company', 'acme.com'));
  const h = holdingFor(ctx, company.id);
  const cur = util.str(p, 'currency', 'native');
  const to = cur === '' || cur === 'native' ? '' : cur.toUpperCase();
  if (to !== '' && !/^[A-Z]{3}$/.test(to)) throw util.fail(400, 'currency is native or a three-letter code such as USD.', 'invalid_param', { param: 'currency' });
  const keys = util.list(p, 'keys');
  const from = util.day(p, 'from_day', '');
  const toDay = util.day(p, 'to_day', '');
  const all = defs(app);
  const metrics = [];
  for (const d of all.list) {
    if (!d.active || d.kind === 'computed') continue;
    if (keys && keys.length > 0 && keys.indexOf(d.key) < 0) continue;
    const raw = pointsOf(app, company.id, d.key, { from_day: from, to_day: toDay });
    const pts = convertPoints(app, d, seriesPoints(d, raw), to);
    const fc = convertPoints(app, d, seriesPoints(d, pointsOf(app, company.id, d.key, { forecast: true, from_day: from, to_day: toDay })), to);
    const verified = pts.filter((x) => x.status === 'verified' && x.value !== null);
    const latest = verified.length > 0 ? verified[verified.length - 1] : null;
    metrics.push({ key: d.key, label: d.label, kind: d.kind, unit: d.unit, points: pts, forecast: fc, latest: latest ? Object.assign({}, latest, { value_text: valueText(d, latest.value, latest.currency) }) : null, staged: pts.filter((x) => x.status === 'staged').length, growth: growthOf(verified) });
  }
  const rw = runwayOf(app, company.id);
  return { company: P().companyMini(app, company.id), holding: h.id, fy_end_month: h.getInt('fy_end_month') || 12, report_currency: h.getString('report_currency') || h.getString('currency'), currency: to === '' ? 'native' : to, metrics: metrics, runway: rw, flags: FLAGS.map((f) => ({ code: f, label: FLAG_LABELS[f] })) };
}

/* ------------------------------------------------------------ portfolio list */

/** The reporting dot of a company: none, requested, received, staged or verified (the latest update, or a request sent after it). */
function reportingOf(latestUpd, req) {
  if (latestUpd) {
    // A request sent after the latest update and still unanswered shows as requested.
    const sentAfter = req && req.enabled && req.sent_at !== '' && req.received_at === '' && req.sent_at > latestUpd.received_at;
    if (!sentAfter) return latestUpd.status === 'dismissed' ? 'none' : latestUpd.status;
  }
  if (req && req.enabled && req.sent_at !== '') return 'requested';
  return 'none';
}

/** holdings.list: the figure strip (Companies, Invested, Value, MOIC, Runway under 6 months) and one row per holding. */
function portfolioList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const base = P().baseCurrency(app);
  const st = util.oneOf(p, 'status', ['active', 'exited', 'written_off', 'all'], 'active');
  const fundText = util.str(p, 'fund', '');
  const fund = fundText !== '' ? P().fundRef(app, fundText) : null;
  const q = util.squash(util.str(p, 'q', '')).toLowerCase();
  const s = settings(app);
  const all = util.findMany(app, 'holdings', "deleted_at = ''", 'created', 0);
  const seen = all.filter((h) => P().visible(ctx, h));
  const hidden = all.length - seen.length;
  const inFund = fund ? seen.filter((h) => h.getString('fund') === fund.id) : seen;
  // Bulk reads (one query each) so the page stays fast with hundreds of holdings.
  const cost = {};
  for (const r of util.rows(app, 'SELECT holding, COALESCE(SUM(cost_minor), 0) AS n FROM securities GROUP BY holding', { holding: '', n: 0 })) cost[r.holding] = r.n;
  const own = {};
  for (const r of util.rows(app, 'SELECT holding, ppm, day FROM ownership ORDER BY day, created', { holding: '', ppm: 0, day: '' })) own[r.holding] = r;
  const kpi = {};
  for (const r of util.rows(app, "SELECT company, key, period_start, period_end, months, value, currency, status, forecast, id FROM kpi_values WHERE (status = 'staged' OR status = 'verified') AND forecast = FALSE AND key IN ('arr','mrr','revenue','cash','net_burn') ORDER BY period_end, created", { company: '', key: '', period_start: '', period_end: '', months: 0, value: 0, currency: '', status: '', forecast: false, id: '' })) {
    const k = r.company + '|' + r.key;
    if (kpi[k] === undefined) kpi[k] = [];
    kpi[k].push(r);
  }
  const latestUpd = {};
  for (const r of util.rows(app, "SELECT company, id, received_at, status FROM updates WHERE company != '' ORDER BY received_at, created", { company: '', id: '', received_at: '', status: '' })) latestUpd[r.company] = r;
  const reqs = {};
  for (const r of util.rows(app, 'SELECT company, enabled, sent_at, received_at, period_end, cadence FROM requests', { company: '', enabled: false, sent_at: '', received_at: '', period_end: '', cadence: '' })) reqs[r.company] = r;
  const stage = {};
  for (const r of util.rows(app, "SELECT company, type, label, day FROM rounds WHERE type != '' OR label != '' ORDER BY day, created", { company: '', type: '', label: '', day: '' })) stage[r.company] = r.label || P().ROUND_LABELS[r.type] || '';
  const alerts = {};
  for (const r of util.rows(app, "SELECT company, rule, level FROM alerts WHERE status = 'open'", { company: '', rule: '', level: '' })) {
    if (alerts[r.company] === undefined || r.level === 'bad') alerts[r.company] = r.level;
  }
  const dl = defs(app).byKey;
  const runwayCache = {};
  const runwayFor = (cid) => {
    if (runwayCache[cid] === undefined) {
      const pts = (k) => (kpi[cid + '|' + k] || []).map((r) => ({ id: r.id, period_start: r.period_start, period_end: r.period_end, months: r.months || 1, value: r.value, currency: r.currency, status: r.status, forecast: false }));
      runwayCache[cid] = runwayFrom(app, pts('cash'), pts('net_burn'));
    }
    return runwayCache[cid];
  };
  const rowOf = (h) => {
    const cid = h.getString('company');
    const c = P().companyMini(app, cid) || { id: cid, name: '', domain: '' };
    const key = (kpi[cid + '|arr'] || []).length > 0 ? 'arr' : (kpi[cid + '|mrr'] || []).length > 0 ? 'mrr' : 'revenue';
    const d = dl[key];
    const raw = (kpi[cid + '|' + key] || []).map((r) => ({ id: r.id, period_start: r.period_start, period_end: r.period_end, months: r.months || 1, value: r.value, currency: r.currency, status: r.status, forecast: false }));
    const slots = {};
    for (const r of raw) {
      const sk = r.period_end + '|' + r.months;
      if (slots[sk] === undefined || (slots[sk].status !== 'verified' && r.status === 'verified')) slots[sk] = r;
    }
    const series = d ? seriesPoints(d, Object.keys(slots).map((k) => slots[k])) : [];
    const spark = series.slice(-12);
    const last = spark.length > 0 ? spark[spark.length - 1] : null;
    const costM = cost[h.id] || 0;
    const v = P().valueOf(app, h, costM, today);
    const rw = runwayFor(cid);
    const lu = latestUpd[cid] || null;
    return {
      id: h.id,
      company: c,
      fund: P().fundOf(app, h.getString('fund')),
      status: h.getString('status'),
      stage: stage[cid] || '',
      currency: h.getString('currency'),
      cost_minor: costM,
      value_minor: v.value_minor,
      value_basis: v.value_basis,
      ownership_ppm: own[h.id] ? own[h.id].ppm : null,
      kpi: { key: key, label: d ? d.label : key, currency: last ? last.currency : '', value: last ? last.value : null, value_text: last && d ? valueText(d, last.value, last.currency) : '', period_end: last ? last.period_end : '', status: last ? last.status : '', spark: spark.map((x) => ({ period_end: x.period_end, value: x.value, status: x.status })), growth_ppm: growthOf(spark).growth_ppm },
      runway: { months: rw.months, state: rw.state, reason: rw.reason, as_of_day: rw.as_of_day },
      reporting: reportingOf(lu, reqs[cid]),
      requests_on: reqs[cid] ? reqs[cid].enabled === true : false,
      last_update_at: lu ? lu.received_at : '',
      alert: alerts[cid] || '',
      _h: h,
    };
  };
  const rowsAll = inFund.map(rowOf);
  // Figures over every holding in scope (and the fund filter): converted to the firm's currency at today's rate.
  let invested = 0;
  let value = 0;
  let proceeds = 0;
  let convOk = true;
  const companies = {};
  let low = 0;
  let atCost = 0;
  const lowSeen = {};
  for (const r of rowsAll) {
    const h = r._h;
    const ccy = h.getString('currency') || base;
    const conv = (minor) => {
      if (minor === 0 || ccy === base) return minor;
      const c = L('lib_fx').convert(app, minor, ccy, base, today, 'end');
      if (c.minor === null) convOk = false;
      return c.minor === null ? 0 : c.minor;
    };
    invested += conv(r.cost_minor);
    value += conv(r.value_minor);
    proceeds += conv(h.getInt('proceeds_minor'));
    if (r.status === 'active') {
      companies[r.company.id] = true;
      if (r.value_basis === 'cost') atCost++;
      if (r.runway.months !== null && r.runway.months < s.runway_months && !lowSeen[r.company.id]) {
        low++;
        lowSeen[r.company.id] = true;
      }
    }
  }
  const flows = [];
  if (invested > 0) flows.push({ day: today, amount_minor: -invested });
  if (proceeds > 0) flows.push({ day: today, amount_minor: proceeds });
  const g = L('lib_eng_metrics').gross({ company_flows: flows, value_minor: value, as_of_day: today });
  let rows = rowsAll.filter((r) => st === 'all' || r.status === st);
  if (q !== '') rows = rows.filter((r) => String(r.company.name || '').toLowerCase().indexOf(q) >= 0);
  rows.sort((a, b) => (String(a.company.name).toLowerCase() < String(b.company.name).toLowerCase() ? -1 : 1));
  const pg = util.page(p, 200, 1000);
  const funds = L('lib_entities').visible(ctx, { kinds: ['fund', 'spv'] }).map((f) => ({ id: f.id, name: f.name, currency: f.currency }));
  return {
    figures: { companies: Object.keys(companies).length, invested_minor: convOk ? invested : null, value_minor: convOk ? value : null, currency: base, moic_e8: convOk ? g.moic_e8 : null, moic_reason: convOk ? g.reasons.moic : 'no_rate', runway_low: low, runway_months: s.runway_months, held_at_cost: atCost },
    rows: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => {
      const o = Object.assign({}, r);
      delete o._h;
      return o;
    }),
    total: rows.length,
    hidden: hidden,
    funds: funds,
  };
}

/* ----------------------------------------------------------------- alerts */

function holdingsActive(app, companyId) {
  return u().findMany(app, 'holdings', "company = {:c} && deleted_at = '' && status = 'active'", 'created', 0, { c: companyId });
}

/** The last complete period a request asked for and whether an update came after it. */
function missedOf(app, companyId, s, today) {
  const util = u();
  const req = util.findOne(app, 'requests', 'company = {:c}', { c: companyId });
  if (req === null || !req.getBool('enabled') || req.getString('sent_at') === '' || req.getString('period_end') === '') return null;
  const pe = req.getString('period_end');
  const due = util.dayAdd(pe, s.missed_update_days);
  if (today < due) return null;
  const after = util.atOf(app, util.dayAdd(pe, 1));
  const got = util.count(app, "SELECT COUNT(*) AS n FROM updates WHERE company = {:c} AND status != 'dismissed' AND received_at >= {:a}", { c: companyId, a: after });
  return { period_end: pe, days: util.daysBetween(pe, today), received: got > 0 };
}

/** Burn up quarter on quarter: the last two complete fiscal quarters of verified net burn (lib_eng_kpi rollup and growth). */
function burnUpOf(app, companyId, fyEnd) {
  const pts = nonOverlapping(pointsOf(app, companyId, 'net_burn', { verified_only: true }).filter((x) => x.months === 1 || x.months === 3));
  if (pts.length === 0) return null;
  const K = L('lib_eng_kpi');
  const q = K.rollup({ points: pts.map((x) => ({ period_end: x.period_end, months: x.months, value: x.value })), kind: 'flow', fy_end_month: fyEnd || 12, to: 'quarter' }).filter((x) => x.value !== null);
  if (q.length < 2) return null;
  const cur = q[q.length - 1];
  const prev = q[q.length - 2];
  if (u().addMonths(prev.start, 3) !== cur.start) return null;
  const g = K.growth(cur.value, prev.value);
  return { growth_ppm: g.growth_ppm, quarter_end: cur.end, current: cur.value, prior: prev.value, currency: pts[pts.length - 1].currency, series: q.slice(-4).map((x) => ({ period_end: x.end, value: x.value })) };
}

/** The rules that hold now for a company: [{ rule, level, breach, title, figure }]. */
function conditions(app, companyId, s, today) {
  const util = u();
  const out = [];
  const hs = holdingsActive(app, companyId);
  if (hs.length === 0) return { holds: out, holding: '' };
  const h = hs[0];
  const rw = runwayOf(app, companyId);
  if (rw.state === 'known' && rw.months !== null) {
    const cashPts = pointsOf(app, companyId, 'cash', { verified_only: true }).slice(-6).map((x) => ({ period_end: x.period_end, value: x.value }));
    const fig = { value: rw.months, threshold: rw.months < s.cash_months ? s.cash_months : s.runway_months, unit: 'months', as_of_day: rw.as_of_day, cash_minor: rw.cash_minor, avg_burn_minor: rw.avg_burn_minor, currency: rw.currency, zero_day: rw.zero_day, series: cashPts };
    if (rw.months < s.cash_months) out.push({ rule: 'cash_low', level: 'bad', breach: rw.as_of_day, title: 'Cash under ' + s.cash_months + ' months of burn', figure: fig });
    else if (rw.months < s.runway_months) out.push({ rule: 'runway_low', level: 'warn', breach: rw.as_of_day, title: 'Runway ' + rw.months.toFixed(1) + ' months', figure: fig });
  }
  const b = burnUpOf(app, companyId, h.getInt('fy_end_month') || 12);
  if (b && b.growth_ppm !== null && b.current > 0 && b.growth_ppm >= s.burn_up_pct * 10000) out.push({ rule: 'burn_up', level: 'warn', breach: b.quarter_end, title: 'Burn up ' + Math.round(b.growth_ppm / 10000) + '% on last quarter', figure: { value: b.growth_ppm, threshold: s.burn_up_pct * 10000, unit: 'ppm', current_minor: b.current, prior_minor: b.prior, currency: b.currency, series: b.series } });
  const m = missedOf(app, companyId, s, today);
  if (m && !m.received) out.push({ rule: 'missed_update', level: 'warn', breach: m.period_end, title: 'No update for ' + monthLabel(m.period_end), figure: { value: m.days, threshold: s.missed_update_days, unit: 'days', period_end: m.period_end, series: [] } });
  return { holds: out, holding: h.id };
}

function alertView(app, a) {
  const util = u();
  const c = P().companyMini(app, a.getString('company'));
  return { id: a.id, company: c, holding: a.getString('holding'), rule: a.getString('rule'), level: a.getString('level'), breach: a.getString('breach'), title: a.getString('title'), figure: util.jsonOf(a, 'figure', {}) || {}, fired_at: a.getString('fired_at'), status: a.getString('status'), acked_by: L('lib_records').mini(app, 'members', a.getString('acked_by')), acked_at: a.getString('acked_at'), resolved_at: a.getString('resolved_at'), note: a.getString('note') };
}

/**
 * Check one company's rules now: fire what newly holds (once per breach:
 * nothing new while an alert of that rule is open or acknowledged) and
 * resolve what no longer holds. Answers the alerts fired.
 */
function checkCompany(app, companyId, today) {
  const util = u();
  const s = settings(app);
  const c = conditions(app, companyId, s, today);
  const holds = {};
  for (const x of c.holds) holds[x.rule] = x;
  const fired = [];
  const sys = L('lib_auth').systemCtx(app);
  for (const rule of RULES) {
    const live = util.findMany(app, 'alerts', "company = {:c} && rule = {:r} && status != 'resolved'", '-fired_at', 0, { c: companyId, r: rule });
    const x = holds[rule];
    // Cash under 3 months is the sharper form of runway under 6: it resolves the runway alert.
    const escalated = rule === 'runway_low' && holds.cash_low !== undefined;
    if (x === undefined || escalated) {
      for (const a of live) {
        a.set('status', 'resolved');
        a.set('resolved_at', util.nowIso());
        app.save(a);
      }
      continue;
    }
    if (live.length > 0) {
      const a = live[0];
      a.set('figure', x.figure);
      a.set('title', x.title);
      app.save(a);
      continue;
    }
    if (util.findOne(app, 'alerts', 'company = {:c} && rule = {:r} && breach = {:b}', { c: companyId, r: rule, b: x.breach }) !== null) continue;
    const a = util.newRecord(app, 'alerts');
    a.set('company', companyId);
    a.set('holding', c.holding);
    a.set('rule', rule);
    a.set('level', x.level);
    a.set('breach', x.breach);
    a.set('title', x.title);
    a.set('figure', x.figure);
    a.set('fired_at', util.nowIso());
    a.set('status', 'open');
    a.set('actor', 'system');
    app.save(a);
    fired.push(alertView(app, a));
    L('lib_events').emit(Object.assign({}, sys, { app: app }), 'alert.fired', { alert: a.id, company: companyId, rule: rule });
    const h = util.byId(app, 'holdings', c.holding);
    const lead = h ? h.getString('lead') : '';
    if (lead !== '') L('lib_notify').notify(app, [lead], { kind: 'alert', title: ((P().companyMini(app, companyId) || {}).name || '') + ': ' + x.title, body: '', link: '#/portfolio/' + companyId, ref: 'alerts:' + a.id });
  }
  return fired;
}

/** Daily: check every active portfolio company. */
function alertsDaily(app) {
  const util = u();
  const today = util.today(app);
  let n = 0;
  for (const r of util.rows(app, "SELECT DISTINCT company FROM holdings WHERE deleted_at = '' AND status = 'active'", { company: '' })) {
    try {
      n += checkCompany(app, r.company, today).length;
    } catch (err) {
      console.error('[vo] portfolio alerts for ' + r.company + ' failed:', err);
    }
  }
  return n;
}

/** alerts.run: check the rules now (every company, or one). */
function opAlertsRun(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const cref = util.str(p, 'company', '');
  let fired = [];
  if (cref !== '') {
    const c = P().companyRef(app, cref);
    holdingFor(ctx, c.id);
    fired = checkCompany(app, c.id, today);
  } else {
    for (const r of util.rows(app, "SELECT DISTINCT company FROM holdings WHERE deleted_at = '' AND status = 'active'", { company: '' })) fired = fired.concat(checkCompany(app, r.company, today));
  }
  L('lib_audit').note(ctx, { collection: 'alerts', summary: 'Checked the alert rules: ' + fired.length + ' fired' });
  return { fired: fired, open: util.count(app, "SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'") };
}

function alertVisible(ctx, a) {
  const mine = P().holdingsOfCompany(ctx, a.getString('company'));
  return mine.rows.length > 0;
}

/** alerts.list: open alerts by default (--status all for every one), optionally for one company. */
function opAlertsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const st = util.oneOf(p, 'status', ['open', 'acked', 'resolved', 'live', 'all'], 'live');
  const where = [];
  const bind = {};
  if (st === 'live') where.push("status != 'resolved'");
  else if (st !== 'all') {
    where.push('status = {:s}');
    bind.s = st;
  }
  const cref = util.str(p, 'company', '');
  if (cref !== '') {
    where.push('company = {:c}');
    bind.c = P().companyRef(app, cref).id;
  }
  const rows = util.findMany(app, 'alerts', where.length > 0 ? where.join(' && ') : '1=1', '-fired_at', 500, bind);
  const vis = rows.filter((a) => alertVisible(ctx, a));
  return { alerts: vis.map((a) => alertView(app, a)), hidden: rows.length - vis.length, rules: settings(app) };
}

/** alerts.ack (people): acknowledge an alert; it stays until the condition ends, and does not fire again for this breach. */
function opAck(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = util.byId(app, 'alerts', util.req(p, 'alert'));
  if (a === null || !alertVisible(ctx, a)) throw util.fail(404, 'No alert ' + p.alert + ' you can see.', 'not_found', { param: 'alert' });
  if (a.getString('status') === 'open') {
    a.set('status', 'acked');
    a.set('acked_by', ctx.memberId || '');
    a.set('acked_at', util.nowIso());
    a.set('note', util.text(p, 'note', 600, ''));
    app.save(a);
  }
  L('lib_audit').note(ctx, { collection: 'alerts', record: a.id, summary: 'Acknowledged: ' + a.getString('title') });
  return { alert: alertView(app, a) };
}

/** alerts.rules-save (people): the thresholds. */
function opRulesSave(ctx, p) {
  const util = u();
  const change = {};
  const n = (k, min, max) => {
    if (!util.has(p, k)) return;
    change[k] = util.num(p, k, { min: min, max: max });
  };
  n('runway_months', 1, 36);
  n('cash_months', 1, 24);
  n('burn_up_pct', 1, 500);
  n('missed_update_days', 7, 365);
  if (Object.keys(change).length === 0) throw util.fail(400, 'Give at least one of runway_months, cash_months, burn_up_pct, missed_update_days.', 'missing_param');
  const merged = Object.assign(settings(ctx.app), change);
  if (merged.cash_months >= merged.runway_months) throw util.fail(400, 'cash_months must be below runway_months.', 'invalid_param', { param: 'cash_months' });
  L('lib_settings').update(ctx, { modules: { portfolio: change } });
  return { rules: settings(ctx.app) };
}

/* ------------------------------------------------------------------ import */

/** KPI CSV row: company, period end, metric, value, currency (and months, forecast); a person's import is verified. */
function importKpi(ctx, row) {
  const util = u();
  const app = ctx.app;
  const company = P().companyRef(app, String(row.company || ''));
  const h = holdingFor(ctx, company.id);
  const months = row.months === undefined || row.months === null || row.months === '' ? 1 : Number(row.months);
  const rawDay = String(row.period_end || '').trim();
  let day;
  if (/^\d{4}-\d{1,2}$/.test(rawDay)) day = rawDay.slice(0, 5) + util.pad(Number(rawDay.slice(5))) + '-01';
  else {
    try {
      day = L('lib_imports').dayValue(app, rawDay);
    } catch {
      throw util.fail(400, 'period end "' + rawDay + '" is not a month (2026-10) or a date (2026-10-31).', 'invalid_param');
    }
  }
  if (!util.isDay(day)) throw util.fail(400, 'period end "' + rawDay + '" is not a month (2026-10) or a date (2026-10-31).', 'invalid_param');
  const it = readItem(ctx, { key: String(row.metric || ''), period_end: util.monthEnd(day), months: months, value: row.value, currency: row.currency || '', forecast: row.forecast === true }, 0, { currency: h.getString('report_currency') || h.getString('currency') });
  const live = slotRows(app, company.id, it.def.key, it.period_end, it.months, it.forecast);
  if (live.some((r) => r.getString('status') === 'verified' && r.getInt('value') === it.value)) return { action: 'skipped', id: live[0].id, message: 'Same value already verified' };
  for (const o of live) {
    o.set('status', 'superseded');
    app.save(o);
  }
  const verified = !ctx.isAgent;
  const r = writeValue(ctx, { company: company.id, holding: h.id, def: it.def, period_end: it.period_end, months: it.months, value: it.value, currency: it.currency, forecast: it.forecast, status: verified ? 'verified' : 'staged', source: 'import', source_ref: 'import' });
  return { action: live.length > 0 ? 'updated' : 'created', id: r.id, message: company.getString('name') + ' ' + it.def.label + ' ' + monthLabel(it.period_end) };
}

module.exports = {
  opFund: opFund,
  KINDS: KINDS,
  UNITS: UNITS,
  FLAGS: FLAGS,
  FLAG_LABELS: FLAG_LABELS,
  RULES: RULES,
  LIST_KEYS: LIST_KEYS,
  settings: settings,
  defs: defs,
  defOf: defOf,
  opDefsList: opDefsList,
  opDefSave: opDefSave,
  parseValue: parseValue,
  valueText: valueText,
  monthLabel: monthLabel,
  valueView: valueView,
  holdingFor: holdingFor,
  opStage: opStage,
  refreshUpdate: refreshUpdate,
  opVerify: opVerify,
  opReject: opReject,
  opSave: opSave,
  pointsOf: pointsOf,
  seriesPoints: seriesPoints,
  kpiSeries: kpiSeries,
  runwayFrom: runwayFrom,
  runwayOf: runwayOf,
  opList: opList,
  portfolioList: portfolioList,
  conditions: conditions,
  checkCompany: checkCompany,
  alertsDaily: alertsDaily,
  alertView: alertView,
  opAlertsRun: opAlertsRun,
  opAlertsList: opAlertsList,
  opAck: opAck,
  opRulesSave: opRulesSave,
  importKpi: importKpi,
};
