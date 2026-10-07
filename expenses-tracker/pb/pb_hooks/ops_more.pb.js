/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: categories, receipts, CSV import and export, recurring
 * expenses and exchange rates. Same rules as ops.pb.js: declared in
 * operations.json, used by the UI and by the AI agent alike.
 */

/* ------------------------------------------------------------- categories */

routerAdd('GET', '/api/ops/categories/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const cur = ex.homeCurrency(app);
    const exp = money.exponent(cur);
    const m = u.month(p, 'month', u.today().slice(0, 7));
    const range = u.monthRange(m);
    const since = u.addDays(u.today(), -90);
    const stats = {};
    for (const r of app.findRecordsByFilter('expenses', "category != ''", '', 0, 0)) {
      const c = r.getString('category');
      if (!stats[c]) stats[c] = { count: 0, recent: 0, month: 0 };
      stats[c].count += 1;
      const d = r.getString('date');
      if (d >= since) stats[c].recent += 1;
      if (d >= range.from && d < range.to) stats[c].month += r.getInt('amount');
    }
    return {
      currency: cur,
      month: m,
      categories: ex.categoryList(app).map((c) => {
        const s = stats[c.id] || { count: 0, recent: 0, month: 0 };
        const b = c.getInt('budget');
        return {
          id: c.id,
          name: c.getString('name'),
          icon: c.getString('icon'),
          sort: c.getInt('sort'),
          count: s.count,
          recent_count: s.recent,
          month_total: money.toMajor(s.month, exp),
          month_total_minor: s.month,
          budget: b > 0 ? money.toMajor(b, exp) : null,
          budget_minor: b,
        };
      }),
    };
  }),
);

routerAdd('POST', '/api/ops/categories/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const name = u.squash(u.req(p, 'name'));
    if (name.length > 40) throw u.fail(400, 'name: at most 40 characters');
    const all = ex.categoryList(app);
    if (all.some((c) => u.squash(c.getString('name')).toLowerCase() === name.toLowerCase())) {
      throw u.fail(409, 'A category named "' + name + '" already exists');
    }
    const icons = require(`${__hooks}/lib_icons.js`);
    const icon = u.oneOf(p, 'icon', icons.ICONS, icons.DEFAULT_ICON);
    const budget = money.amountParam(p, 'budget', ex.homeCurrency(app), false);
    const rec = new Record(app.findCollectionByNameOrId('categories'));
    rec.set('name', name);
    rec.set('icon', icon);
    rec.set('budget', budget === null ? 0 : budget);
    rec.set('sort', all.reduce((mx, c) => Math.max(mx, c.getInt('sort')), 0) + 1);
    app.save(rec);
    return { category: { id: rec.id, name: rec.getString('name'), icon: rec.getString('icon') } };
  }),
);

routerAdd('POST', '/api/ops/categories/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const rec = ex.resolveCategory(app, u.req(p, 'category_id'));
    if (u.str(p, 'name', '') !== '') {
      const name = u.squash(u.str(p, 'name', ''));
      if (name.length > 40) throw u.fail(400, 'name: at most 40 characters');
      const clash = ex.categoryList(app).some((c) => c.id !== rec.id && u.squash(c.getString('name')).toLowerCase() === name.toLowerCase());
      if (clash) throw u.fail(409, 'A category named "' + name + '" already exists');
      rec.set('name', name);
    }
    const icons = require(`${__hooks}/lib_icons.js`);
    const icon = u.oneOf(p, 'icon', icons.ICONS, '');
    if (icon !== '') rec.set('icon', icon);
    if (u.has(p, 'budget')) {
      const b = money.amountParam(p, 'budget', ex.homeCurrency(app), false);
      rec.set('budget', b === null ? 0 : b);
    }
    app.save(rec);
    return { category: { id: rec.id, name: rec.getString('name'), icon: rec.getString('icon'), budget_minor: rec.getInt('budget') } };
  }),
);

routerAdd('POST', '/api/ops/categories/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = ex.resolveCategory(app, u.req(p, 'category_id'));
    const target = ex.resolveCategory(app, u.str(p, 'move_to', ''));
    if (target !== null && target.id === rec.id) throw u.fail(400, 'move_to must be a different category (or empty for uncategorized)');
    let moved = 0;
    app.runInTransaction((tx) => {
      for (const name of ['expenses', 'recurring']) {
        for (const r of tx.findRecordsByFilter(name, 'category = {:c}', '', 0, 0, { c: rec.id })) {
          r.set('category', target ? target.id : '');
          tx.save(r);
          if (name === 'expenses') moved++;
        }
      }
      tx.delete(tx.findRecordById('categories', rec.id));
    });
    return { deleted: rec.getString('name'), moved: moved, moved_to: target ? target.getString('name') : null };
  }),
);

/* --------------------------------------------------------------- receipts */

routerAdd('GET', '/api/ops/receipts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const status = u.oneOf(p, 'status', ['waiting', 'reading', 'done', 'failed'], '');
    const limit = u.int(p, 'limit', 100, 1, 1000);
    const rows = app.findRecordsByFilter('receipts', status === '' ? "id != ''" : 'status = {:s}', '-created', limit, 0, { s: status });
    const links = rc.expenseLinks(app, rows.map((r) => r.id));
    return { receipts: rows.map((r) => rc.serialize(app, r, links[r.id])) };
  }),
);

routerAdd('GET', '/api/ops/receipts/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    const links = rc.expenseLinks(app, [rec.id]);
    const out = rc.serialize(app, rec, links[rec.id]);
    if (links[rec.id]) out.expense = ex.serialize(ex.mustGet(app, links[rec.id]), ex.context(app));
    return out;
  }),
);

routerAdd('POST', '/api/ops/receipts/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const files = [];
    const path = u.str(p, 'path', '');
    if (path !== '') files.push(rc.fileFromLocalPath(path));
    else {
      try {
        for (const f of ev.findUploadedFiles('file')) files.push(f);
      } catch {
        /* no upload */
      }
    }
    if (files.length === 0) throw u.fail(400, 'Give path (absolute path of a receipt image or PDF) or upload files');
    if (files.length > 30) throw u.fail(400, 'At most 30 receipts at once');
    const by = u.fromAgent(ev) ? 'agent' : 'app';
    const ids = [];
    app.runInTransaction((tx) => {
      const rcpt = require(`${__hooks}/lib_receipts.js`);
      for (const f of files) ids.push(rcpt.store(tx, f, 'waiting', by).id);
    });
    rc.markDirty(app);
    const asked = rc.fireIfNeeded(app);
    return {
      receipts: ids.map((id) => rc.serialize(app, rc.mustGet(app, id), null)),
      asked_agent: asked.fired === true || asked.reason === 'already asked',
    };
  }),
);

routerAdd('POST', '/api/ops/receipts/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    if (rec.getString('status') === 'done') throw u.fail(409, 'This receipt is already done; see receipts.get');
    rec.set('status', 'reading');
    rec.set('error', '');
    app.save(rec);
    return rc.serialize(app, rec, null);
  }),
);

routerAdd('POST', '/api/ops/receipts/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    const linked = rc.expenseLinks(app, [rec.id])[rec.id];
    if (linked) {
      return { already: true, message: 'This receipt already has its expense.', expense: ex.serialize(ex.mustGet(app, linked), ex.context(app)) };
    }
    const home = ex.homeCurrency(app);
    const date = u.day(p, 'date', u.today());
    const amt = ex.amountFromParams(app, p, home, date, true);
    const note = u.squash(u.str(p, 'note', '')).slice(0, 200);
    const category = ex.resolveCategory(app, u.str(p, 'category', ''));
    let createdId = '';
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      const created = lib.create(tx, {
        amount: amt.amount,
        date: date,
        note: note,
        category: category,
        source: 'receipt',
        receipt: rec.id,
        original_amount: amt.original_amount,
        original_currency: amt.original_currency,
        fx_rate: amt.fx_rate,
      });
      createdId = created.id;
      const r = tx.findRecordById('receipts', rec.id);
      r.set('status', 'done');
      r.set('error', '');
      tx.save(r);
    });
    const out = ex.serialize(ex.mustGet(app, createdId), ex.context(app));
    return { expense: out, message: 'Added ' + money.format(out.amount_minor, home) + ' on ' + date + ' from the receipt' };
  }),
);

routerAdd('POST', '/api/ops/receipts/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    if (rec.getString('status') === 'done') throw u.fail(409, 'This receipt is already done');
    rec.set('status', 'failed');
    rec.set('error', u.req(p, 'reason').slice(0, 500));
    app.save(rec);
    return rc.serialize(app, rec, null);
  }),
);

routerAdd('POST', '/api/ops/receipts/retry', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    if (rec.getString('status') === 'done') throw u.fail(409, 'This receipt is already done');
    rec.set('status', 'waiting');
    rec.set('error', '');
    app.save(rec);
    rc.markDirty(app);
    const asked = rc.fireIfNeeded(app);
    return { receipt: rc.serialize(app, rec, null), asked_agent: asked.fired === true || asked.reason === 'already asked' };
  }),
);

routerAdd('POST', '/api/ops/receipts/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rc = require(`${__hooks}/lib_receipts.js`);
    const rec = rc.mustGet(app, u.req(p, 'receipt_id'));
    app.runInTransaction((tx) => {
      for (const ex of tx.findRecordsByFilter('expenses', 'receipt = {:r}', '', 0, 0, { r: rec.id })) {
        ex.set('receipt', '');
        tx.save(ex);
      }
      tx.delete(tx.findRecordById('receipts', rec.id));
    });
    return { deleted: 1 };
  }),
);

/* ------------------------------------------------------- import and export */

routerAdd('POST', '/api/ops/import/preview', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const im = require(`${__hooks}/lib_import.js`);
    const imp = im.source(app, p, ev);
    const opts = im.options(imp, p);
    const csv = require(`${__hooks}/lib_csv.js`);
    const pl = csv.plan(app, im.filePath(app, imp), opts);
    imp.set('rows', pl.counts.rows);
    if (imp.getString('status') === 'previewed') imp.set('mapping', im.savedMapping(pl));
    app.save(imp);
    return im.previewOut(imp, pl, u.int(p, 'show', 50, 1, 500));
  }),
);

routerAdd('POST', '/api/ops/import/run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const im = require(`${__hooks}/lib_import.js`);
    const imp = im.source(app, p, ev);
    return im.run(app, imp, im.options(imp, p));
  }),
);

routerAdd('GET', '/api/ops/import/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rows = app.findRecordsByFilter('imports', "status != 'previewed'", '-created', u.int(p, 'limit', 50, 1, 500), 0);
    return {
      imports: rows.map((r) => ({
        id: r.id,
        filename: r.getString('filename'),
        status: r.getString('status'),
        rows: r.getInt('rows'),
        added: r.getInt('added'),
        skipped: r.getInt('skipped'),
        created: r.getString('created'),
        updated: r.getString('updated'),
      })),
    };
  }),
);

routerAdd('POST', '/api/ops/import/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const imp = u.byId(app, 'imports', u.req(p, 'import_id'));
    if (imp === null) throw u.fail(404, 'No import with that id; see import.list');
    if (imp.getString('status') !== 'imported') throw u.fail(409, 'Only a finished import can be undone (this one is ' + imp.getString('status') + ')');
    let removed = 0;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_expenses.js`);
      for (const r of tx.findRecordsByFilter('expenses', 'import = {:i}', '', 0, 0, { i: imp.id })) {
        lib.remove(tx, r);
        removed++;
      }
      const row = tx.findRecordById('imports', imp.id);
      row.set('status', 'undone');
      tx.save(row);
    });
    return { removed: removed, import_id: imp.id };
  }),
);

routerAdd('GET', '/api/ops/export/csv', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const from = u.day(p, 'from', u.today().slice(0, 7) + '-01');
    const to = u.day(p, 'to', u.today());
    if (to < from) throw u.fail(400, 'to must not be before from');
    return require(`${__hooks}/lib_summary.js`).exportCsv(app, from, to);
  }),
);

/* -------------------------------------------------------------- recurring */

routerAdd('GET', '/api/ops/recurring/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ex = require(`${__hooks}/lib_expenses.js`);
    const rr = require(`${__hooks}/lib_recurring.js`);
    const ctx = ex.context(app);
    return { recurring: app.findRecordsByFilter('recurring', "id != ''", '-active,next_date', 0, 0).map((r) => rr.serialize(r, ctx)) };
  }),
);

routerAdd('POST', '/api/ops/recurring/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const rr = require(`${__hooks}/lib_recurring.js`);
    const note = u.squash(u.req(p, 'note')).slice(0, 200);
    const amount = money.amountParam(p, 'amount', ex.homeCurrency(app), true);
    if (amount <= 0) throw u.fail(400, 'amount must be more than zero');
    const cadence = u.oneOf(p, 'cadence', rr.CADENCES, '');
    if (cadence === '') throw u.fail(400, 'cadence is required: ' + rr.CADENCES.join(', '));
    const start = u.day(p, 'start_date', u.today());
    const cat = ex.resolveCategory(app, u.str(p, 'category', ''));
    const rec = new Record(app.findCollectionByNameOrId('recurring'));
    rec.set('note', note);
    rec.set('amount', amount);
    rec.set('category', cat ? cat.id : '');
    rec.set('cadence', cadence);
    rec.set('start_date', start);
    rec.set('next_date', start);
    rec.set('count_added', 0);
    rec.set('active', true);
    app.save(rec);
    const added = rr.runOne(app, rec.id, u.today());
    return { recurring: rr.serialize(app.findRecordById('recurring', rec.id), ex.context(app)), added_now: added };
  }),
);

routerAdd('POST', '/api/ops/recurring/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const rr = require(`${__hooks}/lib_recurring.js`);
    const rec = u.byId(app, 'recurring', u.req(p, 'recurring_id'));
    if (rec === null) throw u.fail(404, 'No recurring expense with that id; see recurring.list');
    if (u.str(p, 'note', '') !== '') rec.set('note', u.squash(u.str(p, 'note', '')).slice(0, 200));
    if (u.str(p, 'amount', '') !== '') {
      const a = money.amountParam(p, 'amount', ex.homeCurrency(app), true);
      if (a <= 0) throw u.fail(400, 'amount must be more than zero');
      rec.set('amount', a);
    }
    if (u.has(p, 'category')) {
      const cat = ex.resolveCategory(app, u.str(p, 'category', ''));
      rec.set('category', cat ? cat.id : '');
    }
    // A new schedule starts at its next charge date; charges already added stay.
    const cadence = u.oneOf(p, 'cadence', rr.CADENCES, '');
    const start = u.day(p, 'start_date', '');
    if (cadence !== '' || start !== '') {
      const nextStart = start !== '' ? start : rec.getString('next_date');
      rec.set('cadence', cadence !== '' ? cadence : rec.getString('cadence'));
      rec.set('start_date', nextStart);
      rec.set('next_date', nextStart);
      rec.set('count_added', 0);
    }
    if (u.str(p, 'active', '') !== '') rec.set('active', u.bool(p, 'active', true));
    app.save(rec);
    const added = rec.getBool('active') ? rr.runOne(app, rec.id, u.today()) : 0;
    return { recurring: rr.serialize(app.findRecordById('recurring', rec.id), ex.context(app)), added_now: added };
  }),
);

routerAdd('POST', '/api/ops/recurring/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rec = u.byId(app, 'recurring', u.req(p, 'recurring_id'));
    if (rec === null) throw u.fail(404, 'No recurring expense with that id; see recurring.list');
    app.runInTransaction((tx) => {
      for (const r of tx.findRecordsByFilter('expenses', 'recurring = {:r}', '', 0, 0, { r: rec.id })) {
        r.set('recurring', '');
        tx.save(r);
      }
      tx.delete(tx.findRecordById('recurring', rec.id));
    });
    return { deleted: 1, note: 'Expenses it already added are kept.' };
  }),
);

routerAdd('POST', '/api/ops/recurring/run-due', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { added: require(`${__hooks}/lib_recurring.js`).runDue(app, u.today()) };
  }),
);

/* ---------------------------------------------------------- exchange rate */

routerAdd('GET', '/api/ops/fx/rate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ex = require(`${__hooks}/lib_expenses.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const from = u.req(p, 'from').toUpperCase();
    const to = (u.str(p, 'to', '') || ex.homeCurrency(app)).toUpperCase();
    if (!money.isCurrency(from) || !money.isCurrency(to)) throw u.fail(400, 'from and to must be 3-letter ISO codes');
    const day = u.day(p, 'date', u.today());
    const r = require(`${__hooks}/lib_fx.js`).rate(app, from, to, day);
    const out = { from: from, to: to, date: day, rate: r.rate, rate_date: r.rate_date, source: r.source };
    const amountText = u.str(p, 'amount', '');
    if (amountText !== '') {
      const minor = money.amountParam(p, 'amount', from, true);
      const conv = require(`${__hooks}/lib_fx.js`).convert(app, minor, from, to, day, r.rate);
      out.amount = money.toMajor(minor, money.exponent(from));
      out.converted = money.toMajor(conv.minor, money.exponent(to));
    }
    return out;
  }),
);
