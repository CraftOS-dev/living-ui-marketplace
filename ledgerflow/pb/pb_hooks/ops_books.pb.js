/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: accounts, contacts, tax codes, transactions, registers,
 * budgets, exchange rates and recurring schedules.
 */

/* ---------------------------------------------------------------- accounts */

routerAdd('GET', '/api/ops/accounts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const to = u.str(p, 'to', '');
    const rows = ledger.accounts(app, { archived: u.bool(p, 'archived', false), to: to ? require(`${__hooks}/lib_dates.js`).parse(to, 'to') : undefined });
    const type = u.oneOf(p, 'type', ['asset', 'liability', 'equity', 'income', 'expense'], '');
    const counts = arrayOf(new DynamicModel({ account: '', n: 0 }));
    app.db().newQuery("SELECT account, COUNT(*) AS n FROM statement_lines WHERE status = 'new' OR status = 'proposed' GROUP BY account").all(counts);
    const inbox = {};
    for (const c of counts) inbox[c.account] = c.n;
    return { accounts: rows.filter((a) => !type || a.type === type).map((a) => Object.assign(a, { inbox: inbox[a.id] || 0 })), home_currency: ledger.home(app) };
  }),
);

routerAdd('GET', '/api/ops/accounts/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const recon = require(`${__hooks}/lib_recon.js`);
    const a = ledger.account(app, u.req(p, 'account'));
    const b = ledger.balanceOf(app, a.id);
    const out = ledger.serializeAccount(a, b.home);
    out.balance_ccy = b.amount;
    const last = recon.lastFinished(app, a.id);
    out.last_reconciled = last ? recon.serialize(last) : null;
    out.used = app.findRecordsByFilter('postings', 'account = {:a}', '', 1, 0, { a: a.id }).length > 0;
    return { account: out };
  }),
);

routerAdd('POST', '/api/ops/accounts/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'accounts.create', (t) => {
      const a = require(`${__hooks}/lib_accounts.js`).create(t, p, who);
      return { summary: 'Added the account ' + a.getString('code') + ' ' + a.getString('name'), type: 'account', id: a.id, result: { account: ledger.serializeAccount(a, ledger.balanceOf(t, a.id).home) } };
    });
  }),
);

routerAdd('POST', '/api/ops/accounts/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    return act.run(app, who, 'accounts.update', (t) => {
      const a = ledger.account(t, u.req(p, 'account'));
      const before = ledger.serializeAccount(a);
      require(`${__hooks}/lib_accounts.js`).update(t, a, p);
      const after = ledger.serializeAccount(a);
      return { summary: 'Edited the account ' + a.getString('code') + ' ' + a.getString('name'), type: 'account', id: a.id, changes: act.diff(before, after), merge: true, result: { account: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/accounts/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'accounts.archive', (t) => {
      const a = ledger.account(t, u.req(p, 'account'));
      const on = u.bool(p, 'archived', true);
      if (on && a.getString('system') !== '') throw u.fail(409, a.getString('name') + ' is a system account; it can be renamed but not archived');
      if (on && ledger.balanceOf(t, a.id).home !== 0) throw u.fail(409, a.getString('name') + ' still has a balance; move it to another account first');
      a.set('archived', on);
      t.save(a);
      return { summary: (on ? 'Archived' : 'Restored') + ' the account ' + a.getString('code') + ' ' + a.getString('name'), type: 'account', id: a.id, result: { account: ledger.serializeAccount(a) } };
    });
  }),
);

routerAdd('POST', '/api/ops/accounts/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'accounts.delete', (t) => {
      const a = ledger.account(t, u.req(p, 'account'));
      if (a.getString('system') !== '') throw u.fail(409, 'A system account cannot be deleted');
      const used =
        t.findRecordsByFilter('postings', 'account = {:a}', '', 1, 0, { a: a.id }).length +
        t.findRecordsByFilter('statement_lines', 'account = {:a}', '', 1, 0, { a: a.id }).length +
        t.findRecordsByFilter('doc_lines', 'account = {:a}', '', 1, 0, { a: a.id }).length +
        t.findRecordsByFilter('accounts', 'parent = {:a}', '', 1, 0, { a: a.id }).length;
      if (used > 0) throw u.fail(409, a.getString('name') + ' is used by entries, statement lines, documents or sub-accounts; archive it instead');
      for (const b of t.findRecordsByFilter('budgets', 'account = {:a}', '', 0, 0, { a: a.id })) t.delete(b);
      const label = a.getString('code') + ' ' + a.getString('name');
      t.delete(a);
      return { summary: 'Deleted the account ' + label, type: 'account', id: a.id, result: { deleted: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/accounts/opening', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    const date = require(`${__hooks}/lib_dates.js`).parse(u.req(p, 'date'), 'date');
    const items = u.list(p, 'balances') || [];
    if (items.length === 0) throw u.fail(400, 'balances must be a list like [{"account":"1000","amount":"2500.00"}] (cards and loans: what is owed, as a positive number)');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'accounts.opening', (t) => {
      const r = require(`${__hooks}/lib_accounts.js`).opening(t, date, items, who);
      return { summary: 'Recorded opening balances on ' + date + ' for ' + items.length + ' account' + (items.length === 1 ? '' : 's'), type: 'transaction', id: r.txn.id, result: { transaction: ledger.serializeTxn(r.txn, r.postings) } };
    });
  }),
);

/* ---------------------------------------------------------------- contacts */

routerAdd('GET', '/api/ops/contacts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_accounts.js`).contacts(app, { q: u.str(p, 'q', ''), kind: u.oneOf(p, 'kind', ['customer', 'vendor', 'both', 'other'], ''), archived: u.bool(p, 'archived', false), limit: u.int(p, 'limit', 500, 1, 5000) });
  }),
);

routerAdd('GET', '/api/ops/contacts/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_accounts.js`).contactDetail(app, u.req(p, 'contact'));
  }),
);

routerAdd('POST', '/api/ops/contacts/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'contacts.create', (t) => {
      const c = lib.saveContact(t, null, p);
      return { summary: 'Added the contact ' + c.getString('name'), type: 'contact', id: c.id, result: { contact: lib.serializeContact(c) } };
    });
  }),
);

routerAdd('POST', '/api/ops/contacts/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    return act.run(app, who, 'contacts.update', (t) => {
      const c = require(`${__hooks}/lib_ledger.js`).contact(t, u.req(p, 'contact'));
      const before = lib.serializeContact(c);
      lib.saveContact(t, c, p);
      const after = lib.serializeContact(c);
      return { summary: 'Edited the contact ' + c.getString('name'), type: 'contact', id: c.id, changes: act.diff(before, after), merge: true, result: { contact: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/contacts/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'contacts.archive', (t) => {
      const c = require(`${__hooks}/lib_ledger.js`).contact(t, u.req(p, 'contact'));
      const on = u.bool(p, 'archived', true);
      c.set('archived', on);
      t.save(c);
      return { summary: (on ? 'Archived' : 'Restored') + ' the contact ' + c.getString('name'), type: 'contact', id: c.id, result: { contact: lib.serializeContact(c) } };
    });
  }),
);

routerAdd('POST', '/api/ops/contacts/merge', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'contacts.merge', (t) => {
      const r = lib.merge(t, u.req(p, 'from'), u.req(p, 'into'));
      return { summary: 'Merged the contact ' + r.from + ' into ' + r.into.getString('name') + ' (' + r.moved + ' records moved)', type: 'contact', id: r.into.id, result: { contact: lib.serializeContact(r.into), moved: r.moved } };
    });
  }),
);

/* --------------------------------------------------------------- tax codes */

routerAdd('GET', '/api/ops/tax/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const rows = app.findRecordsByFilter('tax_codes', u.bool(p, 'archived', false) ? 'id != ""' : 'archived = false', 'sort,code', 0, 0);
    return { tax_codes: rows.map(lib.serializeTax) };
  }),
);

routerAdd('POST', '/api/ops/tax/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'tax.create', (t) => {
      const r = lib.saveTax(t, null, p);
      return { summary: 'Added the tax code ' + r.getString('code') + ' (' + r.getString('rate') + '%)', type: 'tax_code', id: r.id, result: { tax_code: lib.serializeTax(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/tax/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_accounts.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    return act.run(app, who, 'tax.update', (t) => {
      const r = require(`${__hooks}/lib_ledger.js`).taxCode(t, u.req(p, 'tax_code'));
      const before = lib.serializeTax(r);
      lib.saveTax(t, r, p);
      const after = lib.serializeTax(r);
      return { summary: 'Edited the tax code ' + r.getString('code'), type: 'tax_code', id: r.id, changes: act.diff(before, after), merge: true, result: { tax_code: after } };
    });
  }),
);

/* ------------------------------------------------------------ transactions */

routerAdd('GET', '/api/ops/transactions/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const f = {
      from: u.str(p, 'from', '') ? dates.parse(u.str(p, 'from', ''), 'from') : '',
      to: u.str(p, 'to', '') ? dates.parse(u.str(p, 'to', ''), 'to') : '',
      account: u.str(p, 'account', ''),
      contact: u.str(p, 'contact', ''),
      q: u.str(p, 'q', ''),
      status: u.oneOf(p, 'status', ['posted', 'proposed', 'voided', 'all'], ''),
      kind: u.str(p, 'kind', ''),
      added_by: u.oneOf(p, 'added_by', ['user', 'agent', 'rule', 'import', 'recurring', 'system'], ''),
      run: u.str(p, 'run', ''),
      method: u.str(p, 'method', ''),
      dupes: u.bool(p, 'dupes', false),
      limit: u.int(p, 'limit', 200, 1, 2000),
      offset: u.int(p, 'offset', 0, 0, 10000000),
    };
    return require(`${__hooks}/lib_txns.js`).list(app, f);
  }),
);

routerAdd('GET', '/api/ops/transactions/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { transaction: require(`${__hooks}/lib_txns.js`).detail(app, u.req(p, 'txn')) };
  }),
);

routerAdd('POST', '/api/ops/transactions/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_txns.js`);
    const who = u.actor(e);
    const spec = lib.specFrom(app, p, who, null);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'transactions.create', (t) => {
      const r = require(`${__hooks}/lib_ledger.js`).create(t, spec, who);
      if (u.has(p, 'file')) require(`${__hooks}/lib_files.js`).link(t, require(`${__hooks}/lib_files.js`).mustGet(t, u.str(p, 'file', '')), 'transaction', r.txn.id);
      return { summary: (r.txn.getString('status') === 'proposed' ? 'Proposed' : 'Recorded') + ' ' + lib.describe(t, r.txn), type: 'transaction', id: r.txn.id, result: { transaction: lib.detail(t, r.txn.id) } };
    });
  }),
);

routerAdd('POST', '/api/ops/transactions/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_txns.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const txn = ledger.mustTxn(app, u.req(p, 'txn'));
    const spec = lib.specFrom(app, p, who, txn);
    return act.run(app, who, 'transactions.update', (t) => {
      const before = ledger.serializeTxn(txn, ledger.postingsOf(t, txn.id));
      const r = ledger.replace(t, txn.id, spec, who);
      const after = ledger.serializeTxn(r.txn, ledger.postingsOf(t, txn.id));
      const changes = act.diff({ date: before.date, narration: before.narration, contact: before.contact, total: before.total, reference: before.reference }, { date: after.date, narration: after.narration, contact: after.contact, total: after.total, reference: after.reference });
      return { summary: 'Edited ' + lib.describe(t, r.txn), type: 'transaction', id: txn.id, changes: changes, merge: true, result: { transaction: lib.detail(t, txn.id) } };
    });
  }),
);

routerAdd('POST', '/api/ops/transactions/void', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_txns.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'transactions.void', (t) => {
      const txn = require(`${__hooks}/lib_ledger.js`).voidTxn(t, u.req(p, 'txn'), u.text(p, 'reason', ''), who, false);
      return { summary: 'Voided ' + lib.describe(t, txn), type: 'transaction', id: txn.id, result: { transaction: lib.detail(t, txn.id) } };
    });
  }),
);

routerAdd('POST', '/api/ops/transactions/approve', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'txns') ? u.list(p, 'txns') : [u.req(p, 'txn')];
    if (who.actor === 'agent') throw u.fail(403, 'The person approves proposed entries');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'transactions.approve', (t) => {
      const ledger = require(`${__hooks}/lib_ledger.js`);
      for (const id of ids) ledger.post(t, id, who);
      return { summary: 'Approved ' + ids.length + ' proposed entr' + (ids.length === 1 ? 'y' : 'ies'), type: 'transaction', id: ids.length === 1 ? ids[0] : '', result: { approved: ids.length } };
    });
  }),
);

routerAdd('POST', '/api/ops/transactions/reject', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'txns') ? u.list(p, 'txns') : [u.req(p, 'txn')];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'transactions.reject', (t) => {
      const ledger = require(`${__hooks}/lib_ledger.js`);
      for (const id of ids) {
        const txn = ledger.mustTxn(t, id);
        if (txn.getString('status') !== 'proposed') throw u.fail(409, 'Only proposed entries can be rejected; void a posted one');
        for (const ps of ledger.postingsOf(t, txn.id)) t.delete(ps);
        t.delete(txn);
      }
      return { summary: 'Rejected ' + ids.length + ' proposed entr' + (ids.length === 1 ? 'y' : 'ies'), type: 'transaction', id: ids.length === 1 ? ids[0] : '', result: { rejected: ids.length } };
    });
  }),
);

routerAdd('POST', '/api/ops/transactions/reverse', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_txns.js`);
    const who = u.actor(e);
    const date = require(`${__hooks}/lib_dates.js`).parse(u.str(p, 'date', '') || require(`${__hooks}/lib_dates.js`).today(), 'date');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'transactions.reverse', (t) => {
      const r = require(`${__hooks}/lib_ledger.js`).reverse(t, u.req(p, 'txn'), date, who);
      return { summary: 'Reversed an entry on ' + date, type: 'transaction', id: r.txn.id, result: { transaction: lib.detail(t, r.txn.id) } };
    });
  }),
);

routerAdd('GET', '/api/ops/ledger/register', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const a = ledger.account(app, u.req(p, 'account'));
    const r = ledger.register(app, a.id, {
      from: u.str(p, 'from', '') ? dates.parse(u.str(p, 'from', ''), 'from') : undefined,
      to: u.str(p, 'to', '') ? dates.parse(u.str(p, 'to', ''), 'to') : undefined,
      q: u.str(p, 'q', ''),
      recon: u.oneOf(p, 'recon', ['uncleared', 'cleared', 'reconciled'], ''),
      include_proposed: u.bool(p, 'include_proposed', true),
      limit: u.int(p, 'limit', 500, 1, 5000),
      offset: u.int(p, 'offset', 0, 0, 10000000),
    });
    const names = {};
    for (const c of app.findRecordsByFilter('contacts', 'id != ""', '', 0, 0)) names[c.id] = c.getString('name');
    for (const row of r.rows) row.contact_name = names[row.contact] || '';
    return Object.assign({ account: ledger.serializeAccount(a) }, r);
  }),
);

/* ----------------------------------------------------------------- budgets */

routerAdd('GET', '/api/ops/budgets/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).budget(app, { year: u.str(p, 'year', '') });
  }),
);

routerAdd('POST', '/api/ops/budgets/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    const year = u.int(p, 'year', 0, 1900, 3000);
    if (!year) throw u.fail(400, 'year is required (the year the fiscal year starts in)');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'budgets.set', (t) => {
      const a = ledger.account(t, u.req(p, 'account'));
      if (a.getString('type') !== 'income' && a.getString('type') !== 'expense') throw u.fail(400, 'Budgets are for income and expense accounts');
      const home = ledger.home(t);
      let months;
      if (u.has(p, 'months')) {
        months = (u.list(p, 'months') || []).map((v, i) => Math.abs(money.amount(v === '' || v === null ? '0' : v, home, 'months[' + i + ']')));
        if (months.length !== 12) throw u.fail(400, 'months must list 12 amounts, one per month of the fiscal year');
      } else if (u.has(p, 'monthly')) {
        const m = Math.abs(money.amount(u.str(p, 'monthly', '0'), home, 'monthly'));
        months = [];
        for (let i = 0; i < 12; i++) months.push(m);
      } else if (u.has(p, 'annual')) months = money.split(Math.abs(money.amount(u.str(p, 'annual', '0'), home, 'annual')), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      else throw u.fail(400, 'Give months (12 amounts), monthly or annual');
      const rows = t.findRecordsByFilter('budgets', 'account = {:a} && year = {:y}', '', 1, 0, { a: a.id, y: year });
      const clear = months.every((m) => m === 0);
      if (clear && rows.length > 0) t.delete(rows[0]);
      else if (!clear) {
        const r = rows.length > 0 ? rows[0] : new Record(t.findCollectionByNameOrId('budgets'));
        r.set('account', a.id);
        r.set('year', year);
        r.set('months', months);
        t.save(r);
      }
      const total = months.reduce((x, y) => x + y, 0);
      return { summary: 'Budget ' + year + ' for ' + a.getString('name') + ': ' + money.format(total, home), type: 'account', id: a.id, merge: true, result: { account: a.id, year: year, months: months } };
    });
  }),
);

/* ---------------------------------------------------------- exchange rates */

routerAdd('GET', '/api/ops/fx/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    return { home_currency: require(`${__hooks}/lib_ledger.js`).home(app), in_use: fx.inUse(app), rates: fx.list(app, u.str(p, 'currency', ''), u.int(p, 'limit', 300, 1, 5000)) };
  }),
);

routerAdd('POST', '/api/ops/fx/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const fx = require(`${__hooks}/lib_fx.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.set', (t) => {
      const r = fx.set(t, u.req(p, 'currency'), u.str(p, 'date', ''), u.req(p, 'rate'), 'manual');
      return { summary: 'Rate ' + r.getString('currency') + ' on ' + r.getString('date') + ': ' + r.getString('rate'), type: 'fx_rate', id: r.id, result: { rate: fx.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/fx/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.delete', (t) => {
      const r = u.byId(t, 'fx_rates', u.req(p, 'rate'));
      if (!r) throw u.fail(404, 'No rate ' + u.str(p, 'rate', ''));
      const label = r.getString('currency') + ' ' + r.getString('date');
      t.delete(r);
      return { summary: 'Deleted the rate ' + label, type: 'fx_rate', id: r.id, result: { deleted: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/fx/fetch', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const list = u.list(p, 'currencies', true);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.fetch', (t) => {
      const r = require(`${__hooks}/lib_fx.js`).fetchEcb(t, list, u.int(p, 'days', 1, 1, 90));
      return { summary: r.stored > 0 ? 'Fetched ' + r.stored + ' rate' + (r.stored === 1 ? '' : 's') + ' from the European Central Bank' : '', type: 'fx_rate', result: r };
    });
  }),
);

routerAdd('POST', '/api/ops/fx/revalue', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'fx.revalue', (t) => {
      const r = require(`${__hooks}/lib_fx.js`).revalue(t, u.req(p, 'date'), who);
      return { summary: r.txn ? 'Revalued ' + r.detail.length + ' foreign-currency account' + (r.detail.length === 1 ? '' : 's') + ' at ' + r.txn.getString('date') : '', type: 'transaction', id: r.txn ? r.txn.id : '', result: { transaction: r.txn ? r.txn.id : null, detail: r.detail } };
    });
  }),
);

/* --------------------------------------------------------------- recurring */

routerAdd('GET', '/api/ops/recurring/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const lib = require(`${__hooks}/lib_recurring.js`);
    return { schedules: app.findRecordsByFilter('recurring', 'id != ""', 'next_date,name', 0, 0).map(lib.serialize) };
  }),
);

routerAdd('POST', '/api/ops/recurring/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_recurring.js`);
    const who = u.actor(e);
    const spec = { name: u.str(p, 'name', ''), kind: u.oneOf(p, 'kind', ['transaction', 'invoice', 'bill'], 'transaction'), template: u.obj(p, 'template'), frequency: u.str(p, 'frequency', 'monthly'), interval: u.str(p, 'interval', '1'), next_date: u.req(p, 'next_date'), end_date: u.str(p, 'end_date', ''), auto: u.bool(p, 'auto', false) };
    if (who.actor === 'agent' && spec.auto) throw u.fail(403, 'Schedules you create are not automatic; the person can turn auto on');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'recurring.create', (t) => {
      const r = lib.save(t, null, spec, who);
      return { summary: 'Added the schedule "' + r.getString('name') + '" (' + r.getString('frequency') + ' from ' + r.getString('next_date') + ')', type: 'recurring', id: r.id, result: { schedule: lib.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/recurring/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_recurring.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const spec = {};
    for (const k of ['name', 'frequency', 'interval', 'next_date', 'end_date']) if (u.has(p, k)) spec[k] = u.str(p, k, '');
    if (u.has(p, 'template')) spec.template = u.obj(p, 'template');
    if (u.has(p, 'auto')) spec.auto = u.bool(p, 'auto', false);
    if (u.has(p, 'active')) spec.active = u.bool(p, 'active', true);
    if (who.actor === 'agent' && spec.auto) throw u.fail(403, 'Only the person makes a schedule automatic');
    return act.run(app, who, 'recurring.update', (t) => {
      const r = lib.mustGet(t, u.req(p, 'schedule'));
      const before = lib.serialize(r);
      lib.save(t, r, spec, who);
      const after = lib.serialize(r);
      return { summary: 'Edited the schedule "' + r.getString('name') + '"', type: 'recurring', id: r.id, changes: act.diff(before, after), merge: true, result: { schedule: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/recurring/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_recurring.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'recurring.delete', (t) => {
      const r = lib.mustGet(t, u.req(p, 'schedule'));
      const name = r.getString('name');
      t.delete(r);
      return { summary: 'Deleted the schedule "' + name + '"', type: 'recurring', id: r.id, result: { deleted: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/recurring/run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_recurring.js`);
    const who = u.actor(e);
    const only = u.str(p, 'schedule', '');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'recurring.run', (t) => {
      let res;
      if (only) {
        const r = lib.mustGet(t, only);
        const day = r.getString('next_date');
        res = lib.runDue(t, day > require(`${__hooks}/lib_dates.js`).today() ? day : require(`${__hooks}/lib_dates.js`).today(), { actor: who.actor, run: who.run }, r.id);
      } else res = lib.runDue(t, '', { actor: who.actor, run: who.run });
      return { summary: res.made.length > 0 ? 'Created ' + res.made.length + ' recurring item' + (res.made.length === 1 ? '' : 's') : '', type: 'recurring', id: only, result: res };
    });
  }),
);

routerAdd('GET', '/api/ops/recurring/from', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_recurring.js`).templateFrom(app, u.oneOf(p, 'type', ['transaction', 'document'], 'transaction'), u.req(p, 'id'));
  }),
);
