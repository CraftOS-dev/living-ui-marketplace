/// <reference path="../pb_data/types.d.ts" />
/**
 * Expenses domain: settings, categories, the expense write path and the
 * shape every op answers with. UI and the AI agent (agent-app CLI) both go
 * through these functions, so a rule holds no matter who writes.
 */

function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', 'created', 1, 0);
  if (rows.length === 0) {
    const u = require(`${__hooks}/lib_util.js`);
    throw u.fail(500, 'settings row is missing');
  }
  return rows[0];
}

function homeCurrency(app) {
  return settings(app).getString('currency');
}

function categoryList(app) {
  return app.findRecordsByFilter('categories', '', 'sort,name', 0, 0);
}

/**
 * A category param: '' means uncategorized (null); otherwise the record id
 * or the exact name (case and spacing ignored). Unknown values are an error
 * that lists what exists, so the caller can pick or create one.
 */
function resolveCategory(app, value) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = u.squash(value);
  if (v === '') return null;
  const byId = u.byId(app, 'categories', v);
  if (byId !== null) return byId;
  const want = v.toLowerCase();
  const all = categoryList(app);
  for (const c of all) {
    if (u.squash(c.getString('name')).toLowerCase() === want) return c;
  }
  throw u.fail(
    400,
    'Unknown category "' + v + '". Use one of: ' + all.map((c) => c.getString('name')).join(', ') + '. Or create it first with categories.add.',
  );
}

function categoryIndex(app) {
  const out = {};
  for (const c of categoryList(app)) {
    out[c.id] = { id: c.id, name: c.getString('name'), icon: c.getString('icon') };
  }
  return out;
}

/** Duplicate identity: same day, same amount, same note (spacing and case ignored). */
function dedupeKey(date, amount, note) {
  // lib_util.squash inlined: this runs per CSV row, and each require costs about a millisecond.
  const words = String(note || '')
    .split(/\s+/)
    .filter((x) => x !== '');
  return date + '|' + amount + '|' + words.join(' ').toLowerCase();
}

/**
 * Record-level rules for every expense save (create or update, any writer):
 * a positive whole number of minor units, a real day, a tidy note, and the
 * duplicate key derived from those values.
 */
function checkRecord(r) {
  const u = require(`${__hooks}/lib_util.js`);
  const amount = r.getFloat('amount');
  if (!(amount > 0) || Math.floor(amount) !== amount) {
    throw new BadRequestError("amount must be a positive whole number of the currency's smallest unit (cents for USD)");
  }
  if (!u.isDay(r.getString('date'))) throw new BadRequestError('date must be a real day written YYYY-MM-DD');
  const note = u.squash(r.getString('note'));
  if (note !== r.getString('note')) r.set('note', note);
  if (r.getString('source') === '') r.set('source', 'app');
  r.set('dedupe_key', dedupeKey(r.getString('date'), r.getInt('amount'), note));
}

/** The one JSON shape for an expense (ops, CLI output, UI). */
function serialize(rec, ctx) {
  const money = require(`${__hooks}/lib_money.js`);
  const exp = money.exponent(ctx.currency);
  const catId = rec.getString('category');
  const cat = catId !== '' ? ctx.categories[catId] : undefined;
  const origCur = rec.getString('original_currency');
  const out = {
    id: rec.id,
    date: rec.getString('date'),
    amount: money.toMajor(rec.getInt('amount'), exp),
    amount_minor: rec.getInt('amount'),
    currency: ctx.currency,
    note: rec.getString('note'),
    category: cat ? cat.name : null,
    category_id: cat ? cat.id : null,
    category_icon: cat ? cat.icon : null,
    source: rec.getString('source') || 'app',
    receipt_id: rec.getString('receipt') || null,
    import_id: rec.getString('import') || null,
    recurring_id: rec.getString('recurring') || null,
    created: rec.getString('created'),
  };
  if (origCur !== '') {
    out.original_amount = money.toMajor(rec.getInt('original_amount'), money.exponent(origCur));
    out.original_currency = origCur;
    out.fx_rate = rec.getFloat('fx_rate');
  }
  return out;
}

function context(app) {
  return { currency: homeCurrency(app), categories: categoryIndex(app) };
}

/**
 * Read amount (+ optional currency and rate) params into home-currency minor
 * units. A foreign currency is converted at that day's ECB rate (or the given
 * rate) and the original kept beside it.
 */
function amountFromParams(app, p, home, day, required) {
  const u = require(`${__hooks}/lib_util.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const cur = u.str(p, 'currency', '').toUpperCase();
  const code = cur === '' ? home : cur;
  if (!money.isCurrency(code)) throw u.fail(400, 'currency must be a 3-letter ISO code such as USD, EUR, JPY');
  const minor = money.amountParam(p, 'amount', code, required);
  if (minor === null) return null;
  if (minor <= 0) throw u.fail(400, 'amount must be more than zero');
  if (code === home) return { amount: minor, original_amount: 0, original_currency: '', fx_rate: 0 };
  const rateText = u.str(p, 'rate', '');
  let explicit = null;
  if (rateText !== '') {
    explicit = Number(rateText);
    if (!(explicit > 0)) throw u.fail(400, 'rate must be a positive number: ' + home + ' per 1 ' + code);
  }
  const conv = fx.convert(app, minor, code, home, day, explicit);
  if (conv.minor <= 0) throw u.fail(400, 'amount converts to zero ' + home + '; check the amount and currency');
  return { amount: conv.minor, original_amount: minor, original_currency: code, fx_rate: conv.rate };
}

/** Create one expense. `f` holds validated values (category is a record or null). */
function create(app, f) {
  const rec = new Record(app.findCollectionByNameOrId('expenses'));
  rec.set('amount', f.amount);
  rec.set('date', f.date);
  rec.set('note', f.note || '');
  rec.set('category', f.category ? f.category.id : '');
  rec.set('source', f.source || 'app');
  rec.set('receipt', f.receipt || '');
  rec.set('import', f.import || '');
  rec.set('recurring', f.recurring || '');
  rec.set('original_amount', f.original_amount || 0);
  rec.set('original_currency', f.original_currency || '');
  rec.set('fx_rate', f.fx_rate || 0);
  app.save(rec);
  return rec;
}

/** How many expenses already carry each dedupe key (for multiset duplicate checks). */
function existingKeyCounts(app, keys) {
  const counts = {};
  const unique = [];
  for (const k of keys) {
    if (counts[k] === undefined) {
      counts[k] = 0;
      unique.push(k);
    }
  }
  // Chunked IN-style lookups keep each filter small.
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const params = {};
    const ors = chunk.map((k, j) => {
      params['k' + j] = k;
      return 'dedupe_key = {:k' + j + '}';
    });
    const rows = app.findRecordsByFilter('expenses', ors.join(' || '), '', 0, 0, params);
    for (const r of rows) {
      const k = r.getString('dedupe_key');
      if (counts[k] !== undefined) counts[k] += 1;
    }
  }
  return counts;
}

/** Delete an expense and the receipt that belongs only to it. */
function remove(app, rec) {
  const receiptId = rec.getString('receipt');
  app.delete(rec);
  if (receiptId !== '') {
    try {
      app.delete(app.findRecordById('receipts', receiptId));
    } catch (err) {
      console.log('[expenses] receipt already gone: ' + err);
    }
  }
}

/**
 * Change the minor-unit scale of every stored amount by `diff` decimal places
 * (the home currency changed to one with other decimals; the amounts keep
 * their value). Runs on a transaction handle. Settings are left to the caller.
 */
function scale(v, diff) {
  return diff > 0 ? v * Math.pow(10, diff) : Math.round(v / Math.pow(10, -diff));
}

function rescaleAll(tx, diff) {
  for (const r of tx.findRecordsByFilter('expenses', "id != ''", '', 0, 0)) {
    r.set('amount', Math.max(1, scale(r.getInt('amount'), diff)));
    tx.save(r);
  }
  for (const r of tx.findRecordsByFilter('recurring', "id != ''", '', 0, 0)) {
    r.set('amount', Math.max(1, scale(r.getInt('amount'), diff)));
    tx.save(r);
  }
  for (const r of tx.findRecordsByFilter('categories', 'budget > 0', '', 0, 0)) {
    r.set('budget', scale(r.getInt('budget'), diff));
    tx.save(r);
  }
}

/** The expense record for an id param, or a 404 naming it. */
function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'expenses', id);
  if (rec === null) throw u.fail(404, 'No expense with id "' + id + '". List them with expenses.list.');
  return rec;
}

module.exports = {
  settings: settings,
  homeCurrency: homeCurrency,
  categoryList: categoryList,
  resolveCategory: resolveCategory,
  categoryIndex: categoryIndex,
  dedupeKey: dedupeKey,
  checkRecord: checkRecord,
  serialize: serialize,
  context: context,
  amountFromParams: amountFromParams,
  create: create,
  existingKeyCounts: existingKeyCounts,
  remove: remove,
  scale: scale,
  rescaleAll: rescaleAll,
  mustGet: mustGet,
};
