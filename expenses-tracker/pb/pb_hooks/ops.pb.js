/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: app guide, settings, summaries and expenses.
 *
 * Every route here is declared in operations.json, and the UI calls the same
 * routes, so the AI agent (agent-app CLI) can do everything the user can. Routes
 * run in isolated VMs: each handler requires its modules inside itself.
 * Inside runInTransaction only the transaction handle (tx) is used.
 */

/* ------------------------------------------------------------- app guide */

routerAdd('POST', '/api/ops/app/guide', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)),
);

/* --------------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const s = ex.settings(app);
    const cur = s.getString('currency');
    const budget = s.getInt('monthly_budget');
    return {
      currency: cur,
      currency_decimals: money.exponent(cur),
      currency_confirmed: s.getBool('currency_confirmed'),
      monthly_budget: budget > 0 ? money.toMajor(budget, money.exponent(cur)) : null,
      monthly_budget_minor: budget,
    };
  }),
);

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const s = ex.settings(app);
    const oldCur = s.getString('currency');
    const newCur = u.str(p, 'currency', '').toUpperCase();
    if (newCur !== '' && !money.isCurrency(newCur)) throw u.fail(400, 'currency must be a 3-letter ISO code such as USD, EUR, JPY');
    const cur = newCur !== '' ? newCur : oldCur;
    // Read and check every param before writing anything.
    let budget = null;
    if (u.has(p, 'monthly_budget')) {
      budget = money.amountParam(p, 'monthly_budget', cur, false);
      if (budget === null) budget = 0;
    }
    const confirmed = u.has(p, 'currency_confirmed') ? u.bool(p, 'currency_confirmed', true) : null;
    const rescale = newCur !== '' && newCur !== oldCur ? money.exponent(newCur) - money.exponent(oldCur) : 0;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      const st = tx.findRecordById('settings', s.id);
      // Same amounts, new label: when the decimals differ, minor units are rescaled.
      if (rescale !== 0) {
        lib.rescaleAll(tx, rescale);
        st.set('monthly_budget', lib.scale(st.getInt('monthly_budget'), rescale));
      }
      if (newCur !== '') {
        st.set('currency', newCur);
        st.set('currency_confirmed', true);
      }
      if (budget !== null) st.set('monthly_budget', budget);
      if (confirmed !== null) st.set('currency_confirmed', confirmed);
      tx.save(st);
    });
    const after = ex.settings(app);
    const b = after.getInt('monthly_budget');
    return {
      currency: after.getString('currency'),
      currency_decimals: money.exponent(after.getString('currency')),
      currency_confirmed: after.getBool('currency_confirmed'),
      monthly_budget: b > 0 ? money.toMajor(b, money.exponent(after.getString('currency'))) : null,
      monthly_budget_minor: b,
    };
  }),
);

/* -------------------------------------------------------------- summaries */

routerAdd('GET', '/api/ops/summary/month', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_summary.js`).month(app, u.month(p, 'month', u.today().slice(0, 7)));
  }),
);

routerAdd('GET', '/api/ops/summary/trend', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_summary.js`).trend(app, u.month(p, 'end', u.today().slice(0, 7)), u.int(p, 'months', 12, 1, 60));
  }),
);

/* --------------------------------------------------------------- expenses */

routerAdd('GET', '/api/ops/expenses/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const parts = ["id != ''"];
    const params = {};
    const m = u.month(p, 'month', '');
    if (m !== '') {
      const r = u.monthRange(m);
      parts.push('date >= {:from} && date < {:to}');
      params.from = r.from;
      params.to = r.to;
    }
    const from = u.day(p, 'from', '');
    if (from !== '') {
      parts.push('date >= {:dfrom}');
      params.dfrom = from;
    }
    const to = u.day(p, 'to', '');
    if (to !== '') {
      parts.push('date <= {:dto}');
      params.dto = to;
    }
    if (u.bool(p, 'uncategorized', false)) {
      parts.push("category = ''");
    } else {
      const catText = u.str(p, 'category', '');
      if (catText !== '') {
        const cat = ex.resolveCategory(app, catText);
        parts.push('category = {:cat}');
        params.cat = cat.id;
      }
    }
    const q = u.str(p, 'q', '');
    if (q !== '') {
      parts.push('note ~ {:q}');
      params.q = q;
    }
    const source = u.oneOf(p, 'source', ['app', 'agent', 'receipt', 'csv', 'recurring'], '');
    if (source !== '') {
      parts.push('source = {:src}');
      params.src = source;
    }
    if (u.bool(p, 'has_receipt', false)) parts.push("receipt != ''");
    const limit = u.int(p, 'limit', 200, 1, 2000);
    const offset = u.int(p, 'offset', 0, 0, 10000000);
    const all = app.findRecordsByFilter('expenses', parts.join(' && '), '-date,-created', 0, 0, params);
    const ctx = ex.context(app);
    let sum = 0;
    for (const r of all) sum += r.getInt('amount');
    return {
      currency: ctx.currency,
      count: all.length,
      total: money.toMajor(sum, money.exponent(ctx.currency)),
      total_minor: sum,
      limit: limit,
      offset: offset,
      expenses: all.slice(offset, offset + limit).map((r) => ex.serialize(r, ctx)),
    };
  }),
);

routerAdd('GET', '/api/ops/expenses/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = ex.mustGet(app, u.req(p, 'expense_id'));
    const out = ex.serialize(rec, ex.context(app));
    const rid = rec.getString('receipt');
    if (rid !== '') {
      const r = u.byId(app, 'receipts', rid);
      if (r !== null) out.receipt = rc.serialize(app, r, rec.id);
    }
    return out;
  }),
);

routerAdd('POST', '/api/ops/expenses/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const home = ex.homeCurrency(app);
    const date = u.day(p, 'date', u.today());
    const amt = ex.amountFromParams(app, p, home, date, true);
    const note = u.squash(u.str(p, 'note', '')).slice(0, 200);
    const category = ex.resolveCategory(app, u.str(p, 'category', ''));
    const agent = u.fromAgent(ev);
    if (u.bool(p, 'skip_if_duplicate', false)) {
      const dup = u.findOne(app, 'expenses', 'dedupe_key = {:k}', { k: ex.dedupeKey(date, amt.amount, note) });
      if (dup !== null) return { duplicate: true, message: 'Already recorded; nothing added.', expense: ex.serialize(dup, ex.context(app)) };
    }
    // A receipt: a local file path (the AI agent) or an uploaded file (the app).
    let file = null;
    const receiptPath = u.str(p, 'receipt_path', '');
    if (receiptPath !== '') file = rc.fileFromLocalPath(receiptPath);
    else {
      let uploaded = [];
      try {
        uploaded = ev.findUploadedFiles('receipt');
      } catch {
        uploaded = [];
      }
      if (uploaded.length > 0) file = uploaded[0];
    }
    let created = null;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      const rcpt = require(`${__hooks}/lib_receipts.js`);
      let receiptId = '';
      if (file !== null) receiptId = rcpt.store(tx, file, 'done', agent ? 'agent' : 'app').id;
      created = lib.create(tx, {
        amount: amt.amount,
        date: date,
        note: note,
        category: category,
        source: receiptId !== '' ? 'receipt' : agent ? 'agent' : 'app',
        receipt: receiptId,
        original_amount: amt.original_amount,
        original_currency: amt.original_currency,
        fx_rate: amt.fx_rate,
      });
    });
    const out = ex.serialize(ex.mustGet(app, created.id), ex.context(app));
    return { expense: out, message: 'Added ' + money.format(out.amount_minor, home) + ' on ' + date + (out.category ? ' (' + out.category + ')' : '') };
  }),
);

routerAdd('POST', '/api/ops/expenses/add-many', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const items = u.list(p, 'items');
    if (items === undefined || items.length === 0) throw u.fail(400, 'items is required: a JSON list of {amount, date, note, category, currency}');
    if (items.length > 1000) throw u.fail(400, 'items: at most 1000 per call');
    const skip = u.bool(p, 'skip_duplicates', true);
    const home = ex.homeCurrency(app);
    const agent = u.fromAgent(ev);
    // Validate everything first: one bad item writes nothing.
    const planned = [];
    const errors = [];
    items.forEach((it, i) => {
      try {
        if (it === null || typeof it !== 'object' || Array.isArray(it)) throw u.fail(400, 'must be an object');
        const date = u.day(it, 'date', u.today());
        const amt = ex.amountFromParams(app, it, home, date, true);
        planned.push({
          index: i,
          amount: amt.amount,
          original_amount: amt.original_amount,
          original_currency: amt.original_currency,
          fx_rate: amt.fx_rate,
          date: date,
          note: u.squash(u.str(it, 'note', '')).slice(0, 200),
          category: ex.resolveCategory(app, u.str(it, 'category', '')),
        });
      } catch (err) {
        errors.push('item ' + i + ': ' + String((err && err.message) || err));
      }
    });
    if (errors.length > 0) throw u.fail(400, 'Nothing was added. Fix these items: ' + errors.slice(0, 20).join('; '));
    let skipped = 0;
    const toAdd = [];
    if (skip) {
      const have = ex.existingKeyCounts(app, planned.map((x) => ex.dedupeKey(x.date, x.amount, x.note)));
      for (const x of planned) {
        const k = ex.dedupeKey(x.date, x.amount, x.note);
        if (have[k] > 0) {
          have[k] -= 1;
          skipped++;
        } else toAdd.push(x);
      }
    } else {
      for (const x of planned) toAdd.push(x);
    }
    const ids = [];
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      for (const x of toAdd) {
        x.source = agent ? 'agent' : 'app';
        ids.push(lib.create(tx, x).id);
      }
    });
    const ctx = ex.context(app);
    const added = ids.map((id) => ex.serialize(ex.mustGet(app, id), ctx));
    let sum = 0;
    for (const a of added) sum += a.amount_minor;
    return { added: added.length, skipped_duplicates: skipped, total: money.toMajor(sum, money.exponent(home)), expenses: added };
  }),
);

routerAdd('POST', '/api/ops/expenses/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = ex.mustGet(app, u.req(p, 'expense_id'));
    const home = ex.homeCurrency(app);
    const date = u.str(p, 'date', '') !== '' ? u.day(p, 'date', '') : rec.getString('date');
    rec.set('date', date);
    if (u.str(p, 'amount', '') !== '') {
      const amt = ex.amountFromParams(app, p, home, date, true);
      rec.set('amount', amt.amount);
      rec.set('original_amount', amt.original_amount);
      rec.set('original_currency', amt.original_currency);
      rec.set('fx_rate', amt.fx_rate);
    } else if (u.str(p, 'currency', '') !== '') {
      throw u.fail(400, 'currency needs amount too: give the amount in that currency');
    }
    if (u.has(p, 'note')) rec.set('note', u.squash(u.str(p, 'note', '')).slice(0, 200));
    if (u.has(p, 'category')) {
      const cat = ex.resolveCategory(app, u.str(p, 'category', ''));
      rec.set('category', cat ? cat.id : '');
    }
    app.save(rec);
    return { expense: ex.serialize(ex.mustGet(app, rec.id), ex.context(app)) };
  }),
);

routerAdd('POST', '/api/ops/expenses/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = ex.mustGet(app, u.req(p, 'expense_id'));
    const gone = ex.serialize(rec, ex.context(app));
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      lib.remove(tx, tx.findRecordById('expenses', rec.id));
    });
    return { deleted: 1, expense: gone };
  }),
);

routerAdd('POST', '/api/ops/expenses/delete-many', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'ids');
    if (ids === undefined || ids.length === 0) throw u.fail(400, 'ids is required: a JSON list of expense ids');
    const missing = ids.filter((id) => u.byId(app, 'expenses', String(id)) === null);
    if (missing.length > 0) throw u.fail(404, 'Nothing was deleted. Unknown expense ids: ' + missing.join(', '));
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      for (const id of ids) lib.remove(tx, tx.findRecordById('expenses', String(id)));
    });
    return { deleted: ids.length };
  }),
);

routerAdd('POST', '/api/ops/expenses/set-category', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const ids = u.list(p, 'ids');
    if (ids === undefined || ids.length === 0) throw u.fail(400, 'ids is required: a JSON list of expense ids');
    const cat = ex.resolveCategory(app, u.str(p, 'category', ''));
    const missing = ids.filter((id) => u.byId(app, 'expenses', String(id)) === null);
    if (missing.length > 0) throw u.fail(404, 'Nothing was changed. Unknown expense ids: ' + missing.join(', '));
    app.runInTransaction((tx) => {
      for (const id of ids) {
        const r = tx.findRecordById('expenses', String(id));
        r.set('category', cat ? cat.id : '');
        tx.save(r);
      }
    });
    return { updated: ids.length, category: cat ? cat.getString('name') : null };
  }),
);

routerAdd('POST', '/api/ops/expenses/attach-receipt', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = ex.mustGet(app, u.req(p, 'expense_id'));
    let file = null;
    const path = u.str(p, 'path', '');
    if (path !== '') file = rc.fileFromLocalPath(path);
    else {
      let uploaded = [];
      try {
        uploaded = ev.findUploadedFiles('file');
      } catch {
        uploaded = [];
      }
      if (uploaded.length > 0) file = uploaded[0];
    }
    if (file === null) throw u.fail(400, 'Give path (absolute path of the image or PDF) or upload a file');
    const agent = u.fromAgent(ev);
    const oldId = rec.getString('receipt');
    app.runInTransaction((tx) => {
      const rcpt = require(`${__hooks}/lib_receipts.js`);
      const r = tx.findRecordById('expenses', rec.id);
      const stored = rcpt.store(tx, file, 'done', agent ? 'agent' : 'app');
      r.set('receipt', stored.id);
      tx.save(r);
      if (oldId !== '') {
        try {
          tx.delete(tx.findRecordById('receipts', oldId));
        } catch (err) {
          console.log('[expenses] old receipt already gone: ' + err);
        }
      }
    });
    return { expense: ex.serialize(ex.mustGet(app, rec.id), ex.context(app)) };
  }),
);

routerAdd('POST', '/api/ops/expenses/remove-receipt', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = ex.mustGet(app, u.req(p, 'expense_id'));
    const rid = rec.getString('receipt');
    if (rid === '') return { removed: 0 };
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('expenses', rec.id);
      r.set('receipt', '');
      tx.save(r);
      try {
        tx.delete(tx.findRecordById('receipts', rid));
      } catch (err) {
        console.log('[expenses] receipt already gone: ' + err);
      }
    });
    return { removed: 1 };
  }),
);
