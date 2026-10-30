/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: invoices, bills, credit notes and vendor credits, their
 * payments, credits, write-offs and reminders.
 */

routerAdd('GET', '/api/ops/docs/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const dates = require(`${__hooks}/lib_dates.js`);
    const contact = u.str(p, 'contact', '');
    return require(`${__hooks}/lib_docs.js`).list(app, {
      kind: u.oneOf(p, 'kind', ['invoice', 'bill', 'credit_note', 'vendor_credit'], ''),
      side: u.oneOf(p, 'side', ['sales', 'purchases'], ''),
      state: u.oneOf(p, 'state', ['draft', 'open', 'overdue', 'partial', 'paid', 'applied', 'unpaid', 'void', 'all'], ''),
      contact: contact ? require(`${__hooks}/lib_ledger.js`).contact(app, contact).id : '',
      q: u.str(p, 'q', ''),
      from: u.str(p, 'from', '') ? dates.parse(u.str(p, 'from', ''), 'from') : '',
      to: u.str(p, 'to', '') ? dates.parse(u.str(p, 'to', ''), 'to') : '',
      limit: u.int(p, 'limit', 300, 1, 2000),
      offset: u.int(p, 'offset', 0, 0, 10000000),
    });
  }),
);

routerAdd('GET', '/api/ops/docs/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const d = docs.mustGet(app, u.req(p, 'doc'));
    const out = docs.serialize(app, d, true);
    out.files = require(`${__hooks}/lib_files.js`).linkedTo(app, 'document', d.id);
    out.history = require(`${__hooks}/lib_activity.js`).list(app, { target: d.id, limit: 30 });
    out.warnings = docs.warnings(app, d);
    try {
      out.contact_info = require(`${__hooks}/lib_accounts.js`).serializeContact(app.findRecordById('contacts', d.getString('contact')));
    } catch {
      out.contact_info = null;
    }
    return { document: out };
  }),
);

routerAdd('GET', '/api/ops/docs/summary', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const docs = require(`${__hooks}/lib_docs.js`);
    return { sales: docs.summary(app, 'sales'), purchases: docs.summary(app, 'purchases'), currency: require(`${__hooks}/lib_ledger.js`).home(app) };
  }),
);

routerAdd('POST', '/api/ops/docs/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    const spec = require(`${__hooks}/lib_docs_io.js`).spec(p, true);
    const approve = u.bool(p, 'approve', false);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.create', (t) => {
      const r = docs.save(t, null, spec, who);
      if (spec.file) require(`${__hooks}/lib_files.js`).link(t, require(`${__hooks}/lib_files.js`).mustGet(t, spec.file), 'document', r.doc.id);
      if (approve) docs.approve(t, r.doc, who);
      const label = docs.LABEL[r.doc.getString('kind')];
      return { summary: (approve ? 'Approved ' : 'Drafted ') + label.toLowerCase() + ' ' + (r.doc.getString('number') || '') + ' for ' + require(`${__hooks}/lib_docs_io.js`).who(t, r.doc), type: 'document', id: r.doc.id, result: { document: docs.serialize(t, r.doc, true), warnings: r.warnings } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    const spec = require(`${__hooks}/lib_docs_io.js`).spec(p, false);
    return act.run(app, who, 'docs.update', (t) => {
      const d = docs.mustGet(t, u.req(p, 'doc'));
      const before = docs.serialize(t, d, false);
      const r = docs.save(t, d, spec, who);
      if (spec.file) require(`${__hooks}/lib_files.js`).link(t, require(`${__hooks}/lib_files.js`).mustGet(t, spec.file), 'document', d.id);
      const after = docs.serialize(t, r.doc, false);
      const keys = ['contact_name', 'issue_date', 'due_date', 'currency', 'total', 'number', 'reference', 'notes'];
      const pick = (o) => keys.reduce((m, k) => ((m[k] = o[k]), m), {});
      return { summary: 'Edited ' + docs.LABEL[d.getString('kind')].toLowerCase() + ' ' + (d.getString('number') || '(draft)'), type: 'document', id: d.id, changes: act.diff(pick(before), pick(after)), merge: true, result: { document: docs.serialize(t, r.doc, true), warnings: r.warnings } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/approve', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'docs') ? u.list(p, 'docs') : [u.req(p, 'doc')];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.approve', (t) => {
      const done = [];
      for (const id of ids) {
        const d = docs.approve(t, docs.mustGet(t, id), who);
        done.push(d);
      }
      return { summary: 'Approved ' + done.map((d) => docs.LABEL[d.getString('kind')].toLowerCase() + ' ' + d.getString('number')).join(', '), type: 'document', id: done.length === 1 ? done[0].id : '', result: { documents: done.map((d) => docs.serialize(t, d, false)) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/void', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.void', (t) => {
      const d = docs.mustGet(t, u.req(p, 'doc'));
      const wasDraft = d.getString('status') === 'draft';
      docs.voidDoc(t, d, u.text(p, 'reason', ''), who);
      return { summary: (wasDraft ? 'Discarded the draft ' : 'Voided ') + docs.LABEL[d.getString('kind')].toLowerCase() + ' ' + (d.getString('number') || ''), type: 'document', id: d.id, result: { document: docs.serialize(t, d, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/pay', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'docs') ? u.list(p, 'docs') : [u.req(p, 'doc')];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.pay', (t) => {
      const list = ids.map((id) => docs.mustGet(t, id));
      const bank = ledger.account(t, u.req(p, 'account'));
      const bankCcy = bank.getString('currency') || ledger.home(t);
      const docCcy = list[0].getString('currency');
      let amount;
      if (u.str(p, 'amount', '') !== '') amount = Math.abs(money.amount(u.str(p, 'amount', ''), bankCcy, 'amount'));
      else {
        if (bankCcy !== docCcy) throw u.fail(400, 'Give amount: what reached ' + bank.getString('name') + ' in ' + bankCcy);
        amount = list.reduce((s, d) => s + d.getInt('total') - d.getInt('allocated'), 0);
      }
      const spec = { documents: list, account: bank, amount: amount, date: u.str(p, 'date', ''), rate: u.str(p, 'rate', ''), memo: u.text(p, 'memo', ''), method: 'manual' };
      if (u.str(p, 'doc_amount', '') !== '') spec.doc_amount = Math.abs(money.amount(u.str(p, 'doc_amount', ''), docCcy, 'doc_amount'));
      if (u.has(p, 'amounts')) spec.amounts = (u.list(p, 'amounts') || []).map((a, i) => Math.abs(money.amount(a, docCcy, 'amounts[' + i + ']')));
      const r = docs.recordPayment(t, spec, who);
      return { summary: 'Recorded a payment of ' + money.format(amount, bankCcy) + ' for ' + list.map((d) => d.getString('number') || docs.LABEL[d.getString('kind')]).join(', '), type: 'transaction', id: r.txn.id, result: { transaction: r.txn.id, applied: r.applied, fx_diff: r.fx_diff, documents: list.map((d) => docs.serialize(t, t.findRecordById('documents', d.id), false)) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/apply_credit', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.apply_credit', (t) => {
      const credit = docs.mustGet(t, u.req(p, 'credit'));
      const target = docs.mustGet(t, u.req(p, 'doc'));
      const a = docs.applyCredit(t, credit, target, u.str(p, 'amount', ''), u.str(p, 'date', ''), who);
      return { summary: 'Applied ' + (credit.getString('number') || 'a credit') + ' to ' + (target.getString('number') || 'a document'), type: 'document', id: target.id, result: { allocation: a.id, document: docs.serialize(t, target, false), credit: docs.serialize(t, credit, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/write_off', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const money = require(`${__hooks}/lib_money.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Writing off a debt is the person\'s decision; suggest it instead');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.write_off', (t) => {
      const d = docs.mustGet(t, u.req(p, 'doc'));
      const r = docs.writeOff(t, d, u.str(p, 'date', ''), u.text(p, 'reason', ''), who);
      return { summary: 'Wrote off ' + money.format(r.amount, d.getString('currency')) + ' of invoice ' + d.getString('number'), type: 'document', id: d.id, result: { transaction: r.txn.id, document: docs.serialize(t, d, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/remove_allocation', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.remove_allocation', (t) => {
      const a = u.byId(t, 'allocations', u.req(p, 'allocation'));
      if (!a) throw u.fail(404, 'No allocation ' + u.str(p, 'allocation', ''));
      const docId = a.getString('document');
      const kind = a.getString('kind');
      docs.removeAllocation(t, a.id, who);
      return { summary: kind === 'credit' ? 'Unapplied a credit' : kind === 'writeoff' ? 'Removed a write-off' : 'Removed a payment', type: 'document', id: docId, result: { document: docs.serialize(t, t.findRecordById('documents', docId), true) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/duplicate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.duplicate', (t) => {
      const src = docs.mustGet(t, u.req(p, 'doc'));
      const tpl = require(`${__hooks}/lib_recurring.js`).templateFrom(t, 'document', src.id).template;
      const kind = u.oneOf(p, 'kind', ['invoice', 'bill', 'credit_note', 'vendor_credit'], src.getString('kind'));
      const spec = Object.assign({}, tpl, { kind: kind, issue_date: require(`${__hooks}/lib_dates.js`).today() });
      if (kind !== src.getString('kind')) spec.reference = src.getString('number');
      const r = docs.save(t, null, spec, who);
      return { summary: 'Drafted ' + docs.LABEL[kind].toLowerCase() + ' from ' + (src.getString('number') || 'a draft'), type: 'document', id: r.doc.id, result: { document: docs.serialize(t, r.doc, true) } };
    });
  }),
);

routerAdd('POST', '/api/ops/docs/remind', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const who = u.actor(e);
    const d = docs.mustGet(app, u.req(p, 'doc'));
    if (d.getString('kind') !== 'invoice' || d.getString('status') !== 'approved') throw u.fail(409, 'Reminders are for approved invoices');
    // The AI agent writes the reminder itself; the person asks the agent for one.
    if (who.actor === 'agent') {
      const text = u.text(p, 'text', '');
      if (text === '') throw u.fail(400, 'text is required: the reminder you wrote');
      return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.remind', (t) => {
        const x = docs.mustGet(t, d.id);
        x.set('reminder', text.slice(0, 4000));
        x.set('reminded_at', require(`${__hooks}/lib_dates.js`).today());
        t.save(x);
        return { summary: 'Drafted a payment reminder for invoice ' + x.getString('number'), type: 'document', id: x.id, merge: true, result: { document: docs.serialize(t, x, false) } };
      });
    }
    let rec = null;
    app.runInTransaction((tx) => {
      rec = agent.ask(tx, 'reminder', u.text(p, 'note', '') || 'Draft a polite payment reminder for invoice ' + d.getString('number'), { document: docs.serialize(tx, d, true) });
    });
    const fired = agent.nudge(app, 'asks');
    return { ask: agent.serializeAsk(rec), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);

routerAdd('POST', '/api/ops/docs/mark_sent', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'docs.mark_sent', (t) => {
      const d = docs.mustGet(t, u.req(p, 'doc'));
      const on = u.bool(p, 'sent', true);
      d.set('sent_at', on ? require(`${__hooks}/lib_dates.js`).parse(u.str(p, 'date', '') || require(`${__hooks}/lib_dates.js`).today(), 'date') : '');
      t.save(d);
      return { summary: (on ? 'Marked as sent: ' : 'Marked as not sent: ') + docs.LABEL[d.getString('kind')].toLowerCase() + ' ' + d.getString('number'), type: 'document', id: d.id, result: { document: docs.serialize(t, d, false) } };
    });
  }),
);
