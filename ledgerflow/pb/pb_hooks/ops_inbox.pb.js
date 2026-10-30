/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: the inbox (bank statement import and review), categorization
 * rules, saved CSV layouts, and receipts and documents.
 */

/* ------------------------------------------------------------------ inbox */

routerAdd('GET', '/api/ops/inbox/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const status = u.oneOf(p, 'status', ['open', 'new', 'proposed', 'posted', 'matched', 'excluded', 'done', 'all'], 'open');
    const parts = [];
    const prm = {};
    if (status === 'open') parts.push("(status = 'new' || status = 'proposed')");
    else if (status === 'done') parts.push("(status = 'posted' || status = 'matched')");
    else if (status !== 'all') {
      parts.push('status = {:s}');
      prm.s = status;
    }
    if (u.str(p, 'account', '')) {
      parts.push('account = {:a}');
      prm.a = require(`${__hooks}/lib_ledger.js`).account(app, u.str(p, 'account', '')).id;
    }
    if (u.str(p, 'import', '')) {
      parts.push('import = {:i}');
      prm.i = u.str(p, 'import', '');
    }
    const agent = u.oneOf(p, 'agent', ['waiting', 'working', 'done'], '');
    if (agent) {
      parts.push('agent_state = {:ag}');
      prm.ag = agent;
    }
    for (const k of ['from', 'to']) {
      if (!u.str(p, k, '')) continue;
      parts.push('date ' + (k === 'from' ? '>=' : '<=') + ' {:' + k + '}');
      prm[k] = require(`${__hooks}/lib_dates.js`).parse(u.str(p, k, ''), k);
    }
    let rows = app.findRecordsByFilter('statement_lines', parts.join(' && ') || 'id != ""', u.str(p, 'sort', '') === 'oldest' ? 'date,created' : '-date,-created', 0, 0, prm);
    const q = u.str(p, 'q', '').toLowerCase();
    if (q) rows = rows.filter((l) => (l.getString('description') + ' ' + l.getString('payee')).toLowerCase().indexOf(q) >= 0 || String(Math.abs(l.getInt('amount'))).indexOf(q.replace(/[.,]/g, '')) === 0);
    const by = u.oneOf(p, 'suggestion', ['any', 'none', 'high', 'agent', 'rule', 'match'], 'any');
    if (by !== 'any') {
      rows = rows.filter((l) => {
        const s = u.json(l, 'suggestion', null);
        if (by === 'none') return !s;
        if (!s) return false;
        if (by === 'high') return s.confidence === 'high';
        if (by === 'agent') return s.method === 'agent';
        if (by === 'rule') return s.method === 'rule';
        return s.method === 'match' || s.method === 'document' || s.method === 'transfer';
      });
    }
    const total = rows.length;
    const off = u.int(p, 'offset', 0, 0, 10000000);
    const lim = u.int(p, 'limit', 300, 1, 2000);
    const counts = arrayOf(new DynamicModel({ status: '', n: 0 }));
    app.db().newQuery('SELECT status, COUNT(*) AS n FROM statement_lines GROUP BY status').all(counts);
    const c = {};
    for (const x of counts) c[x.status || 'new'] = x.n;
    return { total: total, counts: c, lines: rows.slice(off, off + lim).map(inbox.serializeLine) };
  }),
);

routerAdd('GET', '/api/ops/inbox/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const imp = require(`${__hooks}/lib_import.js`);
    const l = inbox.mustLine(app, u.req(p, 'line'));
    const out = inbox.serializeLine(l);
    // Earlier lines of the same payee and how they were booked.
    const key = imp.norm(l.getString('payee'));
    const similar = [];
    if (key !== '') {
      for (const s of app.findRecordsByFilter('statement_lines', "id != {:id} && payee = {:p} && (status = 'posted' || status = 'matched')", '-date', 8, 0, { id: l.id, p: l.getString('payee') })) {
        const sug = u.json(s, 'suggestion', null);
        similar.push({ id: s.id, date: s.getString('date'), amount: s.getInt('amount'), description: s.getString('description'), txn: s.getString('txn'), account: sug && sug.final ? sug.final.account : '' });
      }
    }
    out.similar = similar;
    if (l.getString('txn')) {
      try {
        out.transaction = require(`${__hooks}/lib_txns.js`).detail(app, l.getString('txn'));
      } catch {
        out.transaction = null;
      }
    }
    out.files = require(`${__hooks}/lib_files.js`).linkedTo(app, 'line', l.id);
    return { line: out };
  }),
);

routerAdd('POST', '/api/ops/inbox/preview', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const src = require(`${__hooks}/lib_inbox_io.js`).content(ev, p);
    const r = inbox.readFile(app, u.req(p, 'account'), src.text, src.name, { format: u.str(p, 'format', '') || undefined, mapping: u.obj(p, 'mapping'), date_order: u.oneOf(p, 'date_order', ['dmy', 'mdy'], undefined) });
    return { preview: inbox.previewOf(app, r) };
  }),
);

routerAdd('POST', '/api/ops/inbox/import', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const who = u.actor(e);
    const src = require(`${__hooks}/lib_inbox_io.js`).content(ev, p);
    const out = require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.import', (t) => {
      const r = inbox.readFile(t, u.req(p, 'account'), src.text, src.name, { format: u.str(p, 'format', '') || undefined, mapping: u.obj(p, 'mapping'), date_order: u.oneOf(p, 'date_order', ['dmy', 'mdy'], undefined) });
      const res = inbox.importRead(t, r, { force: u.bool(p, 'force', false), file_name: src.name, save_profile: u.bool(p, 'save_profile', false), profile_name: u.str(p, 'profile_name', '') }, who);
      const waiting = require(`${__hooks}/lib_agent.js`).queueLines(t, res.lines);
      const acc = r.account.getString('name');
      return {
        summary: 'Imported ' + res.new_count + ' line' + (res.new_count === 1 ? '' : 's') + ' into ' + acc + (res.dup_count ? ' (' + res.dup_count + ' already there)' : '') + (res.auto_posted ? ', ' + res.auto_posted + ' booked by rules' : ''),
        type: 'import',
        id: res.import.id,
        undoable: false,
        result: { import: inbox.serializeImport(res.import), new_count: res.new_count, dup_count: res.dup_count, auto_posted: res.auto_posted, suggested: res.suggested, open: res.open, agent_waiting: waiting },
      };
    });
    if (out.agent_waiting > 0) out.agent = require(`${__hooks}/lib_agent.js`).nudge(app, 'lines');
    return out;
  }),
);

routerAdd('POST', '/api/ops/inbox/add_lines', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const who = u.actor(e);
    const items = u.list(p, 'lines') || [];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.add_lines', (t) => {
      const res = inbox.addLines(t, u.req(p, 'account'), items, u.str(p, 'file_name', ''), who);
      if (u.str(p, 'file', '')) require(`${__hooks}/lib_files.js`).link(t, require(`${__hooks}/lib_files.js`).mustGet(t, u.str(p, 'file', '')), 'line', res.lines.length > 0 ? res.lines[0].id : '');
      return { summary: 'Added ' + res.new_count + ' statement line' + (res.new_count === 1 ? '' : 's') + (res.dup_count ? ' (' + res.dup_count + ' already there)' : ''), type: 'import', id: res.import.id, undoable: false, result: { import: inbox.serializeImport(res.import), new_count: res.new_count, dup_count: res.dup_count, auto_posted: res.auto_posted, lines: res.lines.map(inbox.serializeLine) } };
    });
  }),
);

routerAdd('GET', '/api/ops/inbox/imports', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const acc = u.str(p, 'account', '');
    const rows = app.findRecordsByFilter('statement_imports', acc ? 'account = {:a}' : 'id != ""', '-created', u.int(p, 'limit', 50, 1, 500), 0, { a: acc ? require(`${__hooks}/lib_ledger.js`).account(app, acc).id : '' });
    return { imports: rows.map(require(`${__hooks}/lib_inbox.js`).serializeImport) };
  }),
);

routerAdd('POST', '/api/ops/inbox/undo_import', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.undo_import', (t) => {
      const r = inbox.undoImport(t, u.req(p, 'import'), who);
      return { summary: 'Undid the import of ' + (r.import.getString('file_name') || 'statement lines') + ': ' + r.removed + ' line' + (r.removed === 1 ? '' : 's') + ' removed' + (r.unbooked ? ', ' + r.unbooked + ' entr' + (r.unbooked === 1 ? 'y' : 'ies') + ' voided' : ''), type: 'import', id: r.import.id, undoable: false, result: { import: inbox.serializeImport(r.import), removed: r.removed, unbooked: r.unbooked } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/accept', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const io = require(`${__hooks}/lib_inbox_io.js`);
    const who = u.actor(e);
    const decision = io.decision(app, p);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.accept', (t) => {
      const line = inbox.mustLine(t, u.req(p, 'line'));
      const txn = inbox.accept(t, line, decision, who);
      if (u.bool(p, 'make_rule', false)) io.ruleFromLine(t, line, decision || {}, who);
      return { summary: 'Booked ' + io.lineLabel(line) + (txn ? ' as ' + require(`${__hooks}/lib_txns.js`).describe(t, txn) : ''), type: 'line', id: line.id, result: { line: inbox.serializeLine(t.findRecordById('statement_lines', line.id)), transaction: txn ? txn.id : '' } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/accept_many', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const io = require(`${__hooks}/lib_inbox_io.js`);
    const who = u.actor(e);
    const ids = u.list(p, 'lines') || [];
    if (ids.length === 0) throw u.fail(400, 'lines must be a JSON list of line ids');
    const decision = io.decision(app, p);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.accept_many', (t) => {
      let n = 0;
      const skipped = [];
      for (const id of ids) {
        const line = inbox.mustLine(t, id);
        const sug = u.json(line, 'suggestion', null);
        if (!decision && !sug) {
          skipped.push({ line: id, reason: 'No suggestion; choose a category' });
          continue;
        }
        inbox.accept(t, line, decision, who);
        n++;
      }
      return { summary: 'Booked ' + n + ' bank line' + (n === 1 ? '' : 's'), type: 'line', id: '', result: { booked: n, skipped: skipped } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/propose', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const io = require(`${__hooks}/lib_inbox_io.js`);
    const who = u.actor(e);
    const prop = {
      account: u.str(p, 'account', ''),
      splits: u.list(p, 'splits'),
      transfer_account: u.str(p, 'transfer_account', ''),
      contact: u.str(p, 'contact', ''),
      tax_code: u.str(p, 'tax_code', ''),
      narration: u.text(p, 'narration', ''),
      reason: u.text(p, 'reason', ''),
      confidence: u.oneOf(p, 'confidence', ['high', 'medium', 'low'], 'medium'),
      similar: u.list(p, 'similar'),
    };
    if (u.has(p, 'match')) prop.match = u.obj(p, 'match');
    if (prop.reason === '') throw u.fail(400, 'reason is required: one line on why (the person sees it)');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.propose', (t) => {
      const line = inbox.mustLine(t, u.req(p, 'line'));
      inbox.propose(t, line, prop, who);
      let posted = false;
      let why = '';
      if (u.bool(p, 'post', false)) {
        const gate = io.mayAutoPost(t, line, prop, who);
        if (gate.ok) {
          inbox.accept(t, t.findRecordById('statement_lines', line.id), null, who);
          posted = true;
        } else why = gate.reason;
      }
      return { summary: (posted ? 'Booked ' : 'Proposed a category for ') + io.lineLabel(line), type: 'line', id: line.id, result: { line: inbox.serializeLine(t.findRecordById('statement_lines', line.id)), posted: posted, not_posted_because: why } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/queue', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const agent = require(`${__hooks}/lib_agent.js`);
    const lim = u.int(p, 'limit', 40, 1, 200);
    let rows = app.findRecordsByFilter('statement_lines', "(agent_state = 'waiting' || agent_state = 'working') && (status = 'new' || status = 'proposed')", 'date', lim, 0);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const sure = (r) => {
      const s = u.json(r, 'suggestion', null);
      return s !== null && (s.method === 'rule' || (s.confidence === 'high' && s.by === 'system'));
    };
    app.runInTransaction((tx) => {
      for (const r of rows) {
        const l = tx.findRecordById('statement_lines', r.id);
        // A line a rule or a sure match already decides goes back to the person.
        if (sure(l)) {
          l.set('agent_state', '');
          tx.save(l);
          continue;
        }
        if (l.getString('agent_state') === 'waiting') require(`${__hooks}/lib_agent.js`).start(tx, 'lines', l);
      }
    });
    rows = rows.filter((r) => !sure(r));
    const imp = require(`${__hooks}/lib_import.js`);
    const lines = rows.map((r) => {
      const l = inbox.serializeLine(app.findRecordById('statement_lines', r.id));
      const similar = [];
      if (imp.norm(r.getString('payee')) !== '') {
        for (const s of app.findRecordsByFilter('statement_lines', "payee = {:p} && (status = 'posted' || status = 'matched')", '-date', 5, 0, { p: r.getString('payee') })) {
          const sug = u.json(s, 'suggestion', null);
          similar.push({ date: s.getString('date'), amount: s.getInt('amount'), description: s.getString('description'), account: sug && sug.final ? sug.final.account : '' });
        }
      }
      l.similar = similar;
      return l;
    });
    const left = app.findRecordsByFilter('statement_lines', "agent_state = 'waiting'", '', 0, 0).length;
    const accts = ledger.accounts(app, {}).filter((a) => ['income', 'expense', 'asset', 'liability', 'equity'].indexOf(a.type) >= 0 && ['ar', 'ap', 'retained', 'opening', 'rounding'].indexOf(a.system) < 0);
    const s = require(`${__hooks}/lib_setup.js`).row(app);
    return {
      lines: lines,
      remaining_after: left,
      accounts: accts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, use_when: a.description })),
      house_rules: require(`${__hooks}/lib_setup.js`).policy(s).house_rules || '',
      policy: require(`${__hooks}/lib_setup.js`).policy(s),
      note: 'Amounts are minor units (1250 = 12.50); money out is negative. Propose each with inbox.propose; lines you cannot place: inbox.propose with your best low-confidence guess and say what is missing in reason.',
    };
  }),
);

routerAdd('POST', '/api/ops/inbox/exclude', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const who = u.actor(e);
    const ids = u.has(p, 'lines') ? u.list(p, 'lines') : [u.req(p, 'line')];
    const restore = u.bool(p, 'restore', false);
    return require(`${__hooks}/lib_activity.js`).run(app, who, restore ? 'inbox.restore' : 'inbox.exclude', (t) => {
      for (const id of ids) {
        const l = inbox.mustLine(t, id);
        const st = l.getString('status');
        if (restore) {
          if (st !== 'excluded') continue;
          l.set('status', u.json(l, 'suggestion', null) ? 'proposed' : 'new');
        } else {
          if (st === 'posted' || st === 'matched') throw u.fail(409, 'A booked line cannot be excluded; unmatch it first');
          l.set('status', 'excluded');
          l.set('agent_state', '');
          l.set('note', u.text(p, 'reason', l.getString('note')).slice(0, 1000));
        }
        t.save(l);
      }
      return { summary: (restore ? 'Restored ' : 'Excluded ') + ids.length + ' bank line' + (ids.length === 1 ? '' : 's') + (restore ? '' : ' (duplicates or not for the books)'), type: 'line', id: ids.length === 1 ? ids[0] : '', result: { count: ids.length } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/unmatch', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const io = require(`${__hooks}/lib_inbox_io.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.unmatch', (t) => {
      const line = inbox.mustLine(t, u.req(p, 'line'));
      inbox.unmatch(t, line, who);
      return { summary: 'Put ' + io.lineLabel(line) + ' back in the inbox', type: 'line', id: line.id, result: { line: inbox.serializeLine(t.findRecordById('statement_lines', line.id)) } };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/refresh', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const who = u.actor(e);
    const ids = u.list(p, 'lines');
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'inbox.refresh', (t) => {
      const rows = ids && ids.length > 0 ? ids.map((id) => inbox.mustLine(t, id)) : t.findRecordsByFilter('statement_lines', "status = 'new' || status = 'proposed'", 'date', 0, 0);
      const res = inbox.refresh(t, rows, who, u.bool(p, 'force', false));
      return { summary: res.auto_posted > 0 ? 'Rechecked the inbox: ' + res.auto_posted + ' booked by rules' : 'Rechecked ' + rows.length + ' inbox line' + (rows.length === 1 ? '' : 's'), type: 'line', id: '', result: res };
    });
  }),
);

routerAdd('POST', '/api/ops/inbox/ask_agent', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'lines');
    let n = 0;
    app.runInTransaction((tx) => {
      const rows = ids && ids.length > 0 ? ids.map((id) => require(`${__hooks}/lib_inbox.js`).mustLine(tx, id)) : tx.findRecordsByFilter('statement_lines', "(status = 'new' || status = 'proposed') && agent_state != 'waiting' && agent_state != 'working'", 'date', 500, 0);
      for (const l of rows) {
        const st = l.getString('status');
        if (st !== 'new' && st !== 'proposed') continue;
        const sug = u.json(l, 'suggestion', null);
        if (sug && sug.by === 'user') continue;
        if (!(ids && ids.length > 0) && sug && (sug.method === 'rule' || sug.confidence === 'high' || sug.by === 'agent')) continue;
        l.set('agent_state', 'waiting');
        tx.save(l);
        n++;
      }
    });
    const waiting = app.findRecordsByFilter('statement_lines', "agent_state = 'waiting' || agent_state = 'working'", '', 0, 0).length;
    if (waiting === 0) throw u.fail(409, 'Nothing for your AI agent to look at');
    const fired = require(`${__hooks}/lib_agent.js`).nudge(app, 'lines');
    return { waiting: waiting, added: n, asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);

/* ------------------------------------------------------------------- rules */

routerAdd('GET', '/api/ops/rules/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const rules = require(`${__hooks}/lib_rules.js`);
    return { rules: app.findRecordsByFilter('rules', 'id != ""', 'sort,created', 0, 0).map(rules.serialize), fields: rules.FIELDS, ops: rules.OPS };
  }),
);

routerAdd('POST', '/api/ops/rules/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rules = require(`${__hooks}/lib_rules.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'rules.create', (t) => {
      const r = require(`${__hooks}/lib_inbox_io.js`).saveRule(t, null, p, who);
      return { summary: (r.getString('status') === 'proposed' ? 'Proposed' : 'Added') + ' the rule "' + r.getString('name') + '"', type: 'rule', id: r.id, result: { rule: rules.serialize(r) } };
    });
  }),
);

routerAdd('POST', '/api/ops/rules/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rules = require(`${__hooks}/lib_rules.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    return act.run(app, who, 'rules.update', (t) => {
      const r = rules.mustGet(t, u.req(p, 'rule'));
      const before = rules.serialize(r);
      require(`${__hooks}/lib_inbox_io.js`).saveRule(t, r, p, who);
      const after = rules.serialize(r);
      return { summary: 'Edited the rule "' + r.getString('name') + '"', type: 'rule', id: r.id, changes: act.diff(before, after), merge: true, result: { rule: after } };
    });
  }),
);

routerAdd('POST', '/api/ops/rules/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rules = require(`${__hooks}/lib_rules.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'rules.delete', (t) => {
      const r = rules.mustGet(t, u.req(p, 'rule'));
      const name = r.getString('name');
      t.delete(r);
      return { summary: 'Deleted the rule "' + name + '"', type: 'rule', id: r.id, result: { deleted: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/rules/reorder', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    const order = u.list(p, 'order') || [];
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'rules.reorder', (t) => {
      order.forEach((id, i) => {
        const r = require(`${__hooks}/lib_rules.js`).mustGet(t, id);
        if (r.getInt('sort') !== i * 10) {
          r.set('sort', i * 10);
          t.save(r);
        }
      });
      return { summary: 'Reordered the rules', type: 'rule', id: '', merge: true, result: { ok: true } };
    });
  }),
);

routerAdd('POST', '/api/ops/rules/test', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rules = require(`${__hooks}/lib_rules.js`);
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const c = rules.clean(app, u.list(p, 'conditions') || [], u.obj(p, 'actions') || { payee: 'test' });
    const rule = { conditions: c.conditions, match: u.oneOf(p, 'match', ['all', 'any'], 'all') };
    const rows = app.findRecordsByFilter('statement_lines', "status != 'excluded'", '-date', 3000, 0);
    const hits = rows.filter((l) => rules.matches(rule, inbox.lineView(l)));
    return { count: hits.length, open: hits.filter((l) => l.getString('status') === 'new' || l.getString('status') === 'proposed').length, lines: hits.slice(0, 30).map(inbox.serializeLine) };
  }),
);

/* -------------------------------------------------------- saved CSV layouts */

routerAdd('GET', '/api/ops/profiles/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { profiles: app.findRecordsByFilter('csv_profiles', 'id != ""', 'name', 0, 0).map((r) => ({ id: r.id, name: r.getString('name'), account: r.getString('account'), signature: r.getString('signature'), mapping: u.json(r, 'mapping', {}), updated: r.getString('updated') })) };
  }),
);

routerAdd('POST', '/api/ops/profiles/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'profiles.delete', (t) => {
      const r = u.byId(t, 'csv_profiles', u.req(p, 'profile'));
      if (!r) throw u.fail(404, 'No saved layout ' + u.str(p, 'profile', ''));
      const name = r.getString('name');
      t.delete(r);
      return { summary: 'Deleted the saved CSV layout "' + name + '"', type: 'profile', id: r.id, result: { deleted: true } };
    });
  }),
);

/* ------------------------------------------------------------------- files */

routerAdd('GET', '/api/ops/files/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const parts = [];
    const prm = {};
    const st = u.oneOf(p, 'status', ['inbox', 'reading', 'linked', 'archived', 'open', 'all'], 'open');
    if (st === 'open') parts.push("(status = 'inbox' || status = 'reading')");
    else if (st !== 'all') {
      parts.push('status = {:s}');
      prm.s = st;
    }
    const ag = u.oneOf(p, 'agent', ['waiting', 'working', 'done', 'failed'], '');
    if (ag) {
      parts.push('agent_state = {:a}');
      prm.a = ag;
    }
    const agent = u.fromAgent(e);
    return { files: app.findRecordsByFilter('files', parts.join(' && ') || 'id != ""', '-created', u.int(p, 'limit', 200, 1, 1000), 0, prm).map((r) => files.serialize(app, r, agent)) };
  }),
);

routerAdd('GET', '/api/ops/files/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    const out = files.serialize(app, r, u.fromAgent(e));
    out.candidates = files.candidates(app, r);
    return { file: out };
  }),
);

routerAdd('GET', '/api/ops/files/download', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    if (!r.getString('file')) throw u.fail(404, 'This record has no file');
    const fsys = app.newFilesystem();
    try {
      const reader = fsys.getReader(r.baseFilesPath() + '/' + r.getString('file'));
      try {
        const safe = String(r.getString('name') || 'file').replace(/["\\\r\n]/g, '_');
        ev.response.header().set('Content-Disposition', (u.bool(p, 'download', false) ? 'attachment' : 'inline') + '; filename="' + safe + '"');
        ev.response.header().set('Cache-Control', 'private, max-age=300');
        ev.stream(200, r.getString('mime') || 'application/octet-stream', reader);
      } finally {
        reader.close();
      }
    } finally {
      fsys.close();
    }
    return { __streamed: true };
  }),
);

routerAdd('POST', '/api/ops/files/upload', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const who = u.actor(e);
    let list = u.uploads(ev, 'file');
    if (list.length === 0 && u.str(p, 'path', '')) {
      if (who.actor !== 'agent') throw u.fail(403, 'Upload the file instead of giving a path');
      list = [files.localFile(u.str(p, 'path', ''))];
    }
    if (list.length === 0) throw u.fail(400, 'Upload a file (field "file"), or give --path "<absolute path>"');
    const linkType = u.oneOf(p, 'link_type', ['transaction', 'document', 'line'], '');
    const out = require(`${__hooks}/lib_activity.js`).run(app, who, 'files.upload', (t) => {
      const recs = files.add(t, list, { kind: u.str(p, 'kind', ''), note: u.text(p, 'note', ''), agent: u.bool(p, 'agent', true) }, who);
      if (linkType) for (const r of recs) files.link(t, r, linkType, u.req(p, 'link_id'));
      return { summary: 'Added ' + recs.map((r) => r.getString('name')).join(', '), type: 'file', id: recs.length === 1 ? recs[0].id : '', result: { files: recs.map((r) => files.serialize(t, t.findRecordById('files', r.id), who.actor === 'agent')) } };
    });
    if (out.files.some((f) => f.agent_state === 'waiting')) out.agent = require(`${__hooks}/lib_agent.js`).nudge(app, 'files');
    return out;
  }),
);

routerAdd('POST', '/api/ops/files/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'files.update', (t) => {
      const r = files.mustGet(t, u.req(p, 'file'));
      if (u.has(p, 'extracted')) r.set('extracted', u.obj(p, 'extracted'));
      if (u.has(p, 'kind')) r.set('kind', u.oneOf(p, 'kind', ['receipt', 'invoice', 'statement', 'other'], 'receipt'));
      if (u.has(p, 'note')) r.set('note', u.text(p, 'note', '').slice(0, 1000));
      if (u.has(p, 'name')) r.set('name', u.str(p, 'name', '').slice(0, 255) || r.getString('name'));
      t.save(r);
      return { summary: 'Updated the file ' + r.getString('name'), type: 'file', id: r.id, merge: true, result: { file: files.serialize(t, r, who.actor === 'agent') } };
    });
  }),
);

routerAdd('POST', '/api/ops/files/link', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'files.link', (t) => {
      const r = files.mustGet(t, u.req(p, 'file'));
      const type = u.oneOf(p, 'type', ['transaction', 'document', 'line', 'none'], '');
      files.link(t, r, type === 'none' ? '' : type, u.str(p, 'id', ''));
      return { summary: type === 'none' ? 'Unlinked ' + r.getString('name') : 'Attached ' + r.getString('name') + ' to a ' + type, type: 'file', id: r.id, result: { file: files.serialize(t, r, who.actor === 'agent') } };
    });
  }),
);

routerAdd('POST', '/api/ops/files/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const who = u.actor(e);
    return require(`${__hooks}/lib_activity.js`).run(app, who, 'files.archive', (t) => {
      const r = files.mustGet(t, u.req(p, 'file'));
      const on = u.bool(p, 'archived', true);
      r.set('status', on ? 'archived' : r.getString('linked_type') ? 'linked' : 'inbox');
      if (on && (r.getString('agent_state') === 'waiting' || r.getString('agent_state') === 'working')) r.set('agent_state', '');
      t.save(r);
      return { summary: (on ? 'Archived ' : 'Restored ') + r.getString('name'), type: 'file', id: r.id, result: { file: files.serialize(t, r, false) } };
    });
  }),
);

routerAdd('POST', '/api/ops/files/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const who = u.actor(e);
    if (who.actor === 'agent') throw u.fail(403, 'Archive files instead; only the person deletes them');
    const r = files.mustGet(app, u.req(p, 'file'));
    const name = r.getString('name');
    app.runInTransaction((tx) => {
      for (const d of tx.findRecordsByFilter('documents', 'file = {:f}', '', 0, 0, { f: r.id })) {
        d.set('file', '');
        tx.save(d);
      }
      tx.delete(tx.findRecordById('files', r.id));
      require(`${__hooks}/lib_activity.js`).record(tx, { who: who, op: 'files.delete', summary: 'Deleted the file ' + name, type: 'file', id: r.id });
    });
    return { deleted: true };
  }),
);

routerAdd('GET', '/api/ops/files/candidates', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    return { candidates: files.candidates(app, files.mustGet(app, u.req(p, 'file'))) };
  }),
);

routerAdd('POST', '/api/ops/files/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    require(`${__hooks}/lib_agent.js`).start(app, 'files', r);
    r.set('status', r.getString('status') === 'inbox' ? 'reading' : r.getString('status'));
    app.save(r);
    return { file: files.serialize(app, r, true) };
  }),
);

routerAdd('POST', '/api/ops/files/done', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    r.set('agent_state', 'done');
    r.set('agent_at', new Date().toISOString());
    if (r.getString('status') === 'reading') r.set('status', r.getString('linked_type') ? 'linked' : 'inbox');
    if (u.has(p, 'note')) r.set('note', u.text(p, 'note', '').slice(0, 1000));
    app.save(r);
    return { file: files.serialize(app, r, true) };
  }),
);

routerAdd('POST', '/api/ops/files/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    r.set('agent_state', 'failed');
    r.set('agent_at', new Date().toISOString());
    if (r.getString('status') === 'reading') r.set('status', 'inbox');
    r.set('note', u.text(p, 'reason', 'Could not read it').slice(0, 1000));
    app.save(r);
    return { file: files.serialize(app, r, true) };
  }),
);

routerAdd('POST', '/api/ops/files/ask_agent', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const files = require(`${__hooks}/lib_files.js`);
    const r = files.mustGet(app, u.req(p, 'file'));
    r.set('agent_state', 'waiting');
    r.set('agent_at', new Date().toISOString());
    if (u.has(p, 'note')) r.set('note', u.text(p, 'note', '').slice(0, 1000));
    app.save(r);
    const fired = require(`${__hooks}/lib_agent.js`).nudge(app, 'files');
    return { file: files.serialize(app, r, false), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
  }),
);
