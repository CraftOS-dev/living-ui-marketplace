/// <reference path="../pb_data/types.d.ts" />
/**
 * The inbox: imported statement lines waiting to become bookkeeping.
 *
 * Every line gets a suggestion from one precedence chain, labelled with the
 * method that produced it and a three-level confidence (never a percent):
 *
 *   match     an entry already in the books with the same amount within a
 *             few days (typed by hand, or the other side of a transfer)
 *   document  an open invoice or bill for exactly this amount
 *   transfer  the opposite line in another of your own accounts
 *   rule      the first of your rules that applies
 *   memory    what you chose before for the same payee
 *   agent     a proposal from your AI agent (with its reason)
 *
 * A suggestion never posts by itself, except through a rule the person set
 * to post automatically, or an AI proposal the posting policy allows. The
 * AI agent never overwrites a choice made by the person or by a rule.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serializeLine(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    account: rec.getString('account'),
    import: rec.getString('import'),
    date: rec.getString('date'),
    amount: rec.getInt('amount'),
    currency: rec.getString('currency'),
    description: rec.getString('description'),
    payee: rec.getString('payee'),
    bank_id: rec.getString('bank_id'),
    status: rec.getString('status') || 'new',
    txn: rec.getString('txn'),
    suggestion: u.json(rec, 'suggestion', null),
    note: rec.getString('note'),
    agent_state: rec.getString('agent_state'),
    raw: rec.getString('raw'),
    created: rec.getString('created'),
  };
}

function lineView(rec) {
  return { payee: rec.getString('payee'), description: rec.getString('description'), amount: rec.getInt('amount'), account: rec.getString('account'), currency: rec.getString('currency') };
}

function mustLine(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'statement_lines', id);
  if (!rec) throw fail(404, 'No statement line ' + id + '; see inbox.list');
  return rec;
}

/* ---------------------------------------------------------------- context */

/** Everything suggestions need, loaded once per batch. */
function context(app) {
  const rules = require(`${__hooks}/lib_rules.js`);
  const imp = require(`${__hooks}/lib_import.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const accounts = {};
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', '', 0, 0)) accounts[a.id] = a;
  // Memory: the account chosen for each payee in lines already booked.
  const memory = {};
  for (const l of app.findRecordsByFilter('statement_lines', "status = 'posted' || status = 'matched'", '-date', 3000, 0)) {
    const s = u.json(l, 'suggestion', null);
    const fin = s && s.final;
    if (!fin || !fin.account) continue;
    const key = imp.norm(l.getString('payee'));
    if (key === '') continue;
    const m = (memory[key] = memory[key] || { total: 0, accounts: {}, last: [] });
    m.total++;
    m.accounts[fin.account] = (m.accounts[fin.account] || 0) + 1;
    if (fin.contact && !m.contact) m.contact = fin.contact;
    if (fin.tax_code && !m.tax_code) m.tax_code = fin.tax_code;
    if (m.last.length < 5) m.last.push({ line: l.id, txn: l.getString('txn'), date: l.getString('date'), amount: l.getInt('amount'), account: fin.account });
  }
  const docs = app
    .findRecordsByFilter('documents', "status = 'approved'", 'due_date', 0, 0)
    .filter((d) => d.getInt('total') - d.getInt('allocated') > 0)
    .map((d) => ({ rec: d, open: d.getInt('total') - d.getInt('allocated') }));
  const contactNames = {};
  for (const c of app.findRecordsByFilter('contacts', 'archived = false', '', 0, 0)) contactNames[c.id] = c;
  return { rules: rules.active(app), memory: memory, docs: docs, accounts: accounts, contacts: contactNames };
}

function cashLike(acc) {
  const st = acc ? acc.getString('subtype') : '';
  return st === 'bank' || st === 'cash' || st === 'card';
}

/* -------------------------------------------------------------- suggestion */

function suggest(app, line, ctx) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const imp = require(`${__hooks}/lib_import.js`);
  const amount = line.getInt('amount');
  const date = line.getString('date');
  const acct = line.getString('account');
  const from = dates.addDays(date, -5);
  const to = dates.addDays(date, 5);

  // 1. An entry already in the books on this account (typed by hand, or a
  // transfer booked from the other side).
  const posts = app.findRecordsByFilter('postings', "account = {:a} && amount = {:m} && status = 'posted' && statement_line = '' && date >= {:f} && date <= {:t}", 'date', 5, 0, {
    a: acct,
    m: amount,
    f: from,
    t: to,
  });
  if (posts.length > 0) {
    posts.sort((x, y) => Math.abs(dates.daysBetween(x.getString('date'), date)) - Math.abs(dates.daysBetween(y.getString('date'), date)));
    const p = posts[0];
    const gap = Math.abs(dates.daysBetween(p.getString('date'), date));
    let label = '';
    try {
      label = app.findRecordById('transactions', p.getString('txn')).getString('narration');
    } catch {
      label = '';
    }
    return {
      method: 'match',
      confidence: gap <= 1 ? 'high' : 'medium',
      match: { type: 'posting', id: p.id, txn: p.getString('txn'), date: p.getString('date'), label: label },
      reason: 'Same amount ' + (gap === 0 ? 'on the same day' : gap + ' day' + (gap === 1 ? '' : 's') + ' apart') + ' as an entry already in the books',
      alternatives: posts.slice(1, 3).map((q) => ({ type: 'posting', id: q.id, txn: q.getString('txn'), date: q.getString('date') })),
      by: 'system',
    };
  }

  // 2. An open invoice (money in) or bill (money out) for exactly this amount.
  const kinds = amount > 0 ? ['invoice', 'vendor_credit'] : ['bill', 'credit_note'];
  const desc = imp.norm(line.getString('description') + ' ' + line.getString('payee'));
  // A payment comes after its document (a few days of slack for early payers).
  const earliest = dates.addDays(date, 3);
  const docs = ctx.docs
    .filter((d) => kinds.indexOf(d.rec.getString('kind')) >= 0 && d.open === Math.abs(amount) && d.rec.getString('currency') === line.getString('currency') && d.rec.getString('issue_date') <= earliest)
    .sort((a, b) => Math.abs(dates.daysBetween(a.rec.getString('due_date') || a.rec.getString('issue_date'), date)) - Math.abs(dates.daysBetween(b.rec.getString('due_date') || b.rec.getString('issue_date'), date)));
  if (docs.length > 0) {
    const named = docs.filter((d) => {
      const c = ctx.contacts[d.rec.getString('contact')];
      const n = c ? imp.norm(c.getString('name')) : '';
      return (n !== '' && desc.indexOf(n.split(' ')[0]) >= 0) || (d.rec.getString('number') !== '' && desc.indexOf(imp.norm(d.rec.getString('number'))) >= 0);
    });
    const d = (named[0] || docs[0]).rec;
    const c = ctx.contacts[d.getString('contact')];
    return {
      method: 'document',
      confidence: named.length > 0 ? 'high' : docs.length === 1 ? 'medium' : 'low',
      match: { type: 'document', id: d.id, number: d.getString('number'), kind: d.getString('kind'), label: (c ? c.getString('name') : '') + ' ' + d.getString('number') },
      contact: d.getString('contact'),
      reason: 'Pays ' + d.getString('kind').replace('_', ' ') + ' ' + (d.getString('number') || '(draft)') + (c ? ' from ' + c.getString('name') : '') + ', open for exactly this amount' + (named.length > 0 ? ' and named in the description' : ''),
      alternatives: docs
        .filter((x) => x.rec.id !== d.id)
        .slice(0, 3)
        .map((x) => ({ type: 'document', id: x.rec.id, number: x.rec.getString('number') })),
      by: 'system',
    };
  }

  // 3. The opposite line in another of your own accounts.
  const others = app.findRecordsByFilter("statement_lines", "account != {:a} && amount = {:m} && (status = 'new' || status = 'proposed') && date >= {:f} && date <= {:t}", 'date', 5, 0, {
    a: acct,
    m: -amount,
    f: dates.addDays(date, -4),
    t: dates.addDays(date, 4),
  });
  const own = others.filter((o) => cashLike(ctx.accounts[o.getString('account')]));
  if (own.length > 0) {
    const o = own[0];
    const gap = Math.abs(dates.daysBetween(o.getString('date'), date));
    const oa = ctx.accounts[o.getString('account')];
    return {
      method: 'transfer',
      confidence: gap <= 1 ? 'high' : 'medium',
      transfer_account: o.getString('account'),
      match: { type: 'line', id: o.id, date: o.getString('date'), label: oa ? oa.getString('name') : '' },
      reason: 'The opposite amount appears in ' + (oa ? oa.getString('name') : 'another account') + (gap === 0 ? ' the same day' : ' ' + gap + ' day' + (gap === 1 ? '' : 's') + ' apart'),
      by: 'system',
    };
  }

  // 4. Rules.
  const view = lineView(line);
  for (const r of ctx.rules) {
    if (!require(`${__hooks}/lib_rules.js`).matches(r, view)) continue;
    return {
      method: 'rule',
      confidence: 'high',
      account: r.actions.account || '',
      splits: r.actions.splits || null,
      contact_name: r.actions.contact || '',
      tax_code: r.actions.tax_code || '',
      payee: r.actions.payee || '',
      memo: r.actions.memo || '',
      tags: r.actions.tags || [],
      rule: r.id,
      rule_name: r.name,
      auto_post: r.auto_post,
      reason: 'Rule "' + (r.name || 'unnamed') + '"',
      by: 'rule',
    };
  }

  // 5. Memory of earlier choices for this payee.
  const key = imp.norm(line.getString('payee'));
  const mem = key !== '' ? ctx.memory[key] : null;
  if (mem) {
    let bestAcc = '';
    let bestN = 0;
    for (const k of Object.keys(mem.accounts)) {
      if (mem.accounts[k] > bestN) {
        bestN = mem.accounts[k];
        bestAcc = k;
      }
    }
    const share = bestN / mem.total;
    const acc = ctx.accounts[bestAcc];
    if (acc && !acc.getBool('archived')) {
      return {
        method: 'memory',
        confidence: mem.total >= 3 && share >= 0.8 ? 'high' : share >= 0.6 ? 'medium' : 'low',
        account: bestAcc,
        contact: mem.contact || '',
        tax_code: mem.tax_code || '',
        reason: 'You booked ' + line.getString('payee') + ' to ' + acc.getString('name') + ' ' + bestN + ' of ' + mem.total + ' time' + (mem.total === 1 ? '' : 's'),
        similar: mem.last,
        by: 'system',
      };
    }
  }
  return null;
}

/**
 * Compute suggestions for lines (new, or proposed by the system). Lines the
 * AI agent proposed or the person edited keep their suggestion unless
 * `force`. Lines whose rule posts automatically are posted.
 */
function refresh(app, lines, who, force) {
  const ctx = context(app);
  const policy = require(`${__hooks}/lib_setup.js`).policy(require(`${__hooks}/lib_setup.js`).row(app));
  const autoMethods = Array.isArray(policy.auto_methods) ? policy.auto_methods : [];
  const out = { suggested: 0, auto_posted: 0, open: 0 };
  for (const line of lines) {
    const st = line.getString('status') || 'new';
    if (st !== 'new' && st !== 'proposed') continue;
    const u = require(`${__hooks}/lib_util.js`);
    const cur = u.json(line, 'suggestion', null);
    if (!force && cur && (cur.by === 'agent' || cur.by === 'user')) {
      out.open++;
      continue;
    }
    const s = suggest(app, line, ctx);
    line.set('suggestion', s);
    line.set('status', s ? 'proposed' : 'new');
    // The AI agent is not needed once the system is sure.
    if (s && (s.confidence === 'high' || s.method === 'rule') && line.getString('agent_state') === 'waiting') line.set('agent_state', '');
    app.save(line);
    if (s) out.suggested++;
    // The other side of a transfer gets the mirror suggestion (unless someone chose for it).
    if (s && s.method === 'transfer' && s.match && s.match.type === 'line') {
      try {
        const other = app.findRecordById('statement_lines', s.match.id);
        const os = u.json(other, 'suggestion', null);
        const ost = other.getString('status') || 'new';
        if ((ost === 'new' || ost === 'proposed') && (!os || os.by === 'system')) {
          const acc = ctx.accounts[line.getString('account')];
          other.set('suggestion', {
            method: 'transfer',
            confidence: s.confidence,
            transfer_account: line.getString('account'),
            match: { type: 'line', id: line.id, date: line.getString('date'), label: acc ? acc.getString('name') : '' },
            reason: 'The opposite amount appears in ' + (acc ? acc.getString('name') : 'another account'),
            by: 'system',
          });
          other.set('status', 'proposed');
          if (s.confidence === 'high' && other.getString('agent_state') === 'waiting') other.set('agent_state', '');
          app.save(other);
        }
      } catch {
        /* the other line is gone */
      }
    }
    const autoRule = s && s.method === 'rule' && s.auto_post;
    const autoSystem = s && s.method !== 'rule' && s.confidence === 'high' && autoMethods.indexOf(s.method) >= 0;
    if (autoRule || autoSystem) {
      try {
        accept(app, line, null, { actor: autoRule ? 'rule' : 'import', run: '' });
        out.auto_posted++;
        continue;
      } catch (err) {
        console.warn('[ledgerflow] auto-post by rule failed:', line.id, err);
      }
    }
    out.open++;
  }
  return out;
}

/* ------------------------------------------------------------------ accept */

/**
 * Book a line. `decision` overrides the suggestion: { account, splits,
 * contact, tax_code, narration, memo, tags, transfer_account,
 * match: {type, id} }. Returns the transaction.
 */
function accept(app, line, decision, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const st = line.getString('status') || 'new';
  if (st === 'posted' || st === 'matched') throw fail(409, 'This line is already booked; unmatch it first to change it');
  if (st === 'excluded') throw fail(409, 'This line is excluded; restore it first');
  const sug = u.json(line, 'suggestion', null) || {};
  const d = decision && Object.keys(decision).length > 0 ? decision : sug;
  const amount = line.getInt('amount');
  const date = line.getString('date');
  const acct = line.getString('account');
  const ccy = line.getString('currency');
  const method = decision && Object.keys(decision).length > 0 ? (who.actor === 'agent' ? 'agent' : 'manual') : sug.method || 'manual';
  const addedBy = ['rule', 'agent', 'import'].indexOf(who.actor) >= 0 ? who.actor : 'user';
  const bankPosting = { account: acct, amount: amount, currency: ccy, statement_line: line.id, recon_state: 'cleared', memo: line.getString('description').slice(0, 300) };
  const stale = [];
  let result = null;
  let contactId = '';
  const resolveContact = () => {
    const c = d.contact || d.contact_name || '';
    if (!c) return '';
    const rec = ledger.contact(app, c, amount < 0 ? 'vendor' : 'customer');
    return rec ? rec.id : '';
  };

  if (d.match && d.match.type === 'posting') {
    const p = app.findRecordById('postings', d.match.id);
    if (p.getString('account') !== acct || p.getInt('amount') !== amount) throw fail(409, 'That entry is for a different account or amount');
    if (p.getString('statement_line') !== '') throw fail(409, 'That entry is already matched to another statement line');
    p.set('statement_line', line.id);
    if (p.getString('recon_state') === '') p.set('recon_state', 'cleared');
    app.save(p);
    line.set('status', 'matched');
    line.set('txn', p.getString('txn'));
    const txn = app.findRecordById('transactions', p.getString('txn'));
    result = txn;
    contactId = txn.getString('contact');
  } else if (d.match && d.match.type === 'document') {
    const docs = require(`${__hooks}/lib_docs.js`);
    const doc = docs.mustGet(app, d.match.id);
    const r = docs.recordPayment(app, { documents: [doc], account: acct, amount: Math.abs(amount), date: date, statement_line: line.id, method: method, line_amount: amount }, who);
    result = r.txn;
    line.set('status', 'posted');
    line.set('txn', r.txn.id);
    contactId = doc.getString('contact');
    stale.push(doc.id);
  } else if (d.transfer_account || (d.match && d.match.type === 'line')) {
    const otherLine = d.match && d.match.type === 'line' ? mustLine(app, d.match.id) : null;
    const otherAcc = ledger.account(app, otherLine ? otherLine.getString('account') : d.transfer_account);
    if (otherAcc.id === acct) throw fail(400, 'A transfer needs another account');
    const otherCcy = otherAcc.getString('currency') || ledger.home(app);
    let otherAmount = -amount;
    if (otherLine) otherAmount = otherLine.getInt('amount');
    else if (otherCcy !== ccy) {
      if (d.amount_other === undefined) throw fail(400, 'The other account uses ' + otherCcy + '; give amount_other');
      otherAmount = -Math.sign(amount) * Math.abs(money.amount(d.amount_other, otherCcy, 'amount_other'));
    }
    const postings = [bankPosting, { account: otherAcc, amount: otherAmount, currency: otherCcy, statement_line: otherLine ? otherLine.id : '', recon_state: otherLine ? 'cleared' : '', memo: otherLine ? otherLine.getString('description').slice(0, 300) : '' }];
    // Different currencies: a home-currency side fixes the value of the other
    // (the implied rate). Between two foreign currencies each side is valued
    // at its rate and the difference is an exchange gain or loss.
    if (otherCcy !== ccy) {
      const homeCcy = ledger.home(app);
      if (ccy === homeCcy) postings[1].home_amount = -amount;
      else if (otherCcy === homeCcy) postings[0].home_amount = -otherAmount;
      else {
        const r1 = ledger.rateFor(app, ccy, date);
        const r2 = ledger.rateFor(app, otherCcy, date);
        if (!r1 || !r2) throw fail(409, 'Add ' + ccy + ' and ' + otherCcy + ' rates for ' + date + ' first');
        const h1 = money.toHome(amount, ccy, homeCcy, r1);
        const h2 = money.toHome(otherAmount, otherCcy, homeCcy, r2);
        postings[0].home_amount = h1;
        postings[1].home_amount = h2;
        if (h1 + h2 !== 0) postings.push({ account: ledger.sys(app, 'fx'), amount: -(h1 + h2), currency: homeCcy, home_amount: -(h1 + h2), memo: 'Exchange difference on transfer' });
      }
    }
    const r = ledger.create(
      app,
      {
        date: date,
        narration: d.narration || 'Transfer ' + (amount < 0 ? 'to ' : 'from ') + otherAcc.getString('name'),
        kind: 'transfer',
        postings: postings,
        source_line: line.id,
        method: method === 'manual' ? 'transfer' : method,
        confidence: sug.confidence || '',
        reason: sug.reason || '',
        added_by: addedBy,
      },
      who,
    );
    result = r.txn;
    line.set('status', 'posted');
    line.set('txn', r.txn.id);
    if (otherLine) {
      otherLine.set('status', 'posted');
      otherLine.set('txn', r.txn.id);
      const os = u.json(otherLine, 'suggestion', null) || {};
      os.final = { account: acct };
      otherLine.set('suggestion', os);
      app.save(otherLine);
    }
  } else {
    // Categorize: the bank side and one or more category lines.
    contactId = resolveContact();
    const counter = -amount;
    const rows = [bankPosting];
    const tc = d.tax_code ? ledger.taxCode(app, d.tax_code) : null;
    const memo = d.memo || '';
    const addCategory = (accountRef, value) => {
      if (tc) {
        const rate = tc.getString('rate') || '0';
        const taxAcc = tc.getString('account') || ledger.sys(app, 'tax').id;
        if (tc.getString('group') === 'reverse') {
          const t = money.tax(Math.abs(value), rate, false) * Math.sign(value);
          rows.push({ account: accountRef, amount: value, currency: ccy, tax_code: tc.id, tax_role: 'base', contact: contactId, memo: memo });
          rows.push({ account: taxAcc, amount: t, currency: ccy, tax_code: tc.id, tax_role: 'tax', contact: contactId, memo: 'Reverse charge input' });
          rows.push({ account: taxAcc, amount: -t, currency: ccy, tax_code: tc.id, tax_role: 'tax', contact: contactId, memo: 'Reverse charge output' });
          return;
        }
        const t = money.tax(Math.abs(value), rate, true) * Math.sign(value);
        rows.push({ account: accountRef, amount: value - t, currency: ccy, tax_code: tc.id, tax_role: 'base', contact: contactId, memo: memo });
        if (t !== 0) rows.push({ account: taxAcc, amount: t, currency: ccy, tax_code: tc.id, tax_role: 'tax', contact: contactId, memo: memo });
      } else rows.push({ account: accountRef, amount: value, currency: ccy, contact: contactId, memo: memo });
    };
    if (Array.isArray(d.splits) && d.splits.length > 0) {
      const parts = money.split(Math.abs(counter), d.splits.map((s) => Number(s.percent || s.amount || 0)));
      d.splits.forEach((s, i) => addCategory(s.account, Math.sign(counter) * parts[i]));
    } else {
      if (!d.account) throw fail(400, 'Say where it goes: an account (category), a split, a transfer account or a match');
      addCategory(d.account, counter);
    }
    const r = ledger.create(
      app,
      {
        date: date,
        narration: d.narration || d.payee || line.getString('payee') || line.getString('description').slice(0, 120),
        contact: contactId,
        kind: amount < 0 ? 'expense' : 'income',
        tags: d.tags || [],
        postings: rows,
        source_line: line.id,
        method: method,
        confidence: sug.confidence || d.confidence || '',
        reason: d.reason || sug.reason || '',
        evidence: sug.similar || sug.rule ? { similar: sug.similar || [], rule: sug.rule || '' } : null,
        added_by: addedBy,
      },
      who,
    );
    result = r.txn;
    line.set('status', 'posted');
    line.set('txn', r.txn.id);
  }

  const final = Object.assign({}, sug, { final: { account: d.account || (d.splits && d.splits[0] && d.splits[0].account) || d.transfer_account || '', contact: contactId, tax_code: d.tax_code || '' } });
  if (decision && Object.keys(decision).length > 0 && who.actor === 'user') final.by = 'user';
  line.set('suggestion', final);
  app.save(line);
  // Other lines that pointed at a document this line just paid get a fresh suggestion.
  for (const docId of stale) {
    const others = app.findRecordsByFilter('statement_lines', "status = 'proposed' && id != {:id} && suggestion ~ {:d}", '', 50, 0, { id: line.id, d: docId });
    if (others.length > 0) refresh(app, others, who, false);
  }
  // Count the rule's hits; one-time rules retire after their match.
  if (sug.rule && (!decision || Object.keys(decision).length === 0)) {
    try {
      const r = app.findRecordById('rules', sug.rule);
      r.set('hits', r.getInt('hits') + 1);
      if (date > r.getString('last_hit')) r.set('last_hit', date);
      if (r.getBool('one_time')) r.set('status', 'disabled');
      app.save(r);
    } catch {
      /* rule removed meanwhile */
    }
  }
  return result;
}

/** Store the AI agent's proposal for a line (does not post). */
function propose(app, line, p, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const st = line.getString('status') || 'new';
  if (st === 'posted' || st === 'matched' || st === 'excluded') throw fail(409, 'This line is already ' + st);
  const cur = u.json(line, 'suggestion', null);
  if (cur && cur.by === 'user') throw fail(409, 'The person already chose for this line; leave it to them');
  if (cur && cur.method === 'rule') throw fail(409, 'A rule already decides this line ("' + (cur.rule_name || '') + '"); propose a rule change instead');
  const s = { method: 'agent', by: 'agent', confidence: ['high', 'medium', 'low'].indexOf(p.confidence) >= 0 ? p.confidence : 'medium', reason: String(p.reason || '').slice(0, 500), run: who.run };
  if (p.account) s.account = ledger.account(app, p.account).id;
  if (p.splits) s.splits = p.splits.map((x) => ({ account: ledger.account(app, x.account).id, percent: String(x.percent) }));
  if (p.transfer_account) s.transfer_account = ledger.account(app, p.transfer_account).id;
  if (p.contact) s.contact_name = String(p.contact).slice(0, 160);
  if (p.tax_code) s.tax_code = ledger.taxCode(app, p.tax_code).id;
  if (p.narration) s.narration = String(p.narration).slice(0, 200);
  if (p.match) s.match = p.match;
  if (!s.account && !s.splits && !s.transfer_account && !s.match) throw fail(400, 'A proposal needs an account, splits, transfer_account or match');
  if (Array.isArray(p.similar)) s.similar = p.similar.slice(0, 5);
  line.set('suggestion', s);
  line.set('status', 'proposed');
  line.set('agent_state', 'done');
  app.save(line);
  return s;
}

/** Put a booked line back in the inbox (voids the transaction it created, or unlinks a match). */
function unmatch(app, line, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const st = line.getString('status');
  const txnId = line.getString('txn');
  if (st !== 'posted' && st !== 'matched') throw fail(409, 'This line is not booked');
  if (st === 'matched') {
    const ps = app.findRecordsByFilter('postings', 'statement_line = {:l}', '', 0, 0, { l: line.id });
    for (const p of ps) {
      if (p.getString('recon_state') === 'reconciled') throw fail(409, 'Its entry is reconciled; undo that reconciliation first');
      ledger.checkLock(app, p.getString('date'), who);
      p.set('statement_line', '');
      p.set('recon_state', '');
      app.save(p);
    }
    line.set('status', 'new');
    line.set('txn', '');
    app.save(line);
    return null;
  }
  const txn = ledger.mustTxn(app, txnId);
  ledger.voidTxn(app, txn.id, 'Unmatched from the bank statement', who, false);
  const fresh = app.findRecordById('statement_lines', line.id);
  fresh.set('status', 'new');
  fresh.set('txn', '');
  app.save(fresh);
  return txn;
}

/* ------------------------------------------------------------------ import */

function serializeImport(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    account: rec.getString('account'),
    file_name: rec.getString('file_name'),
    format: rec.getString('format'),
    period_from: rec.getString('period_from'),
    period_to: rec.getString('period_to'),
    balances: u.json(rec, 'balances', {}) || {},
    line_count: rec.getInt('line_count'),
    new_count: rec.getInt('new_count'),
    dup_count: rec.getInt('dup_count'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    status: rec.getString('status') || 'done',
    created: rec.getString('created'),
  };
}

function statementAccount(app, ref) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const acc = ledger.account(app, ref);
  if (!cashLike(acc)) throw fail(400, 'Statements import into a bank, card or cash account; ' + acc.getString('name') + ' is ' + (acc.getString('subtype') || acc.getString('type')));
  if (acc.getBool('archived')) throw fail(409, acc.getString('name') + ' is archived');
  return acc;
}

/** Split parsed lines into new and duplicate against what the account already holds. */
function dedupe(app, acc, lines) {
  const imp = require(`${__hooks}/lib_import.js`);
  imp.fingerprints(lines);
  const ds = lines.map((l) => l.date).sort();
  const known = {};
  const keys = {};
  if (ds.length > 0) {
    const have = app.findRecordsByFilter('statement_lines', 'account = {:a} && date >= {:f} && date <= {:t}', '', 0, 0, { a: acc.id, f: ds[0], t: ds[ds.length - 1] });
    for (const h of have) {
      known[h.getString('fingerprint')] = true;
      const k = h.getString('date') + '|' + h.getInt('amount') + '|' + imp.norm(h.getString('description'));
      keys[k] = (keys[k] || 0) + 1;
    }
  }
  const fresh = [];
  const dups = [];
  const used = {};
  for (const l of lines) {
    const k = l.date + '|' + l.amount + '|' + imp.norm(l.description);
    used[k] = (used[k] || 0) + 1;
    // Same fingerprint, or the same date, amount and text seen as often in an
    // earlier file (another format of the same statement).
    if (known[l.fingerprint] || (keys[k] || 0) >= used[k]) dups.push(l);
    else fresh.push(l);
  }
  return { fresh: fresh, dups: dups };
}

function signature(header) {
  return (header || [])
    .map((h) => String(h).trim().toLowerCase())
    .join('|')
    .slice(0, 400);
}

/**
 * Read a statement file. opts: { format, mapping, date_order }. A CSV the
 * app cannot read on its own comes back with needs_mapping, its header and
 * sample rows. A saved column layout for the same header is applied.
 */
function readFile(app, accountRef, content, fileName, opts) {
  const imp = require(`${__hooks}/lib_import.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const o = opts || {};
  const acc = statementAccount(app, accountRef);
  const ccy = acc.getString('currency') || ledger.home(app);
  const text = String(content || '');
  if (text.trim() === '') throw fail(400, 'The file is empty');
  if (text.length > 8000000) throw fail(413, 'The file is larger than 8 MB; split it by date');
  let parsed = imp.parse(text, fileName || '', ccy, { format: o.format, mapping: o.mapping, prefer: o.date_order });
  let profile = null;
  if (parsed.format === 'csv' && parsed.header) {
    const sig = signature(parsed.header);
    const rows = app.findRecordsByFilter('csv_profiles', 'signature = {:s}', '-updated', 5, 0, { s: sig });
    profile = rows.find((r) => r.getString('account') === acc.id) || rows[0] || null;
    if (profile && !o.mapping) parsed = imp.parse(text, fileName || '', ccy, { format: 'csv', mapping: u.json(profile, 'mapping', {}) || {} });
  }
  const out = { account: acc, currency: ccy, parsed: parsed, profile: profile, hash: $security.sha256(text) };
  if (parsed.format === 'csv') {
    const m = parsed.mapping || {};
    out.sample = imp.splitCsv(text.replace(/^﻿/, ''), m.delimiter || ',').slice(m.skip || 0, (m.skip || 0) + 6);
  }
  return out;
}

function previewOf(app, r) {
  const p = r.parsed;
  const lines = p.lines.map((l) => Object.assign({}, l));
  const d = p.needs_mapping ? { fresh: [], dups: [] } : dedupe(app, r.account, lines);
  const seen = app.findRecordsByFilter('statement_imports', "account = {:a} && file_hash = {:h} && status = 'done'", '-created', 1, 0, { a: r.account.id, h: r.hash });
  const m = p.mapping || {};
  return {
    account: r.account.id,
    format: p.format,
    currency: r.currency,
    needs_mapping: !!p.needs_mapping,
    header: p.header || null,
    mapping: p.mapping || null,
    sample: r.sample || null,
    profile: r.profile ? r.profile.getString('name') || 'Saved layout' : '',
    date_order_used: m.date_order_used || p.date_order_used || '',
    date_order_ambiguous: !!(m.date_order_ambiguous || p.date_order_ambiguous),
    period_from: p.period_from || '',
    period_to: p.period_to || '',
    balances: p.balances || {},
    count: lines.length,
    new_count: d.fresh.length,
    dup_count: d.dups.length,
    already_imported: seen.length > 0 ? { id: seen[0].id, date: seen[0].getString('created').slice(0, 10), file_name: seen[0].getString('file_name') } : null,
    lines: lines.slice(0, 60).map((l) => ({ date: l.date, amount: l.amount, description: l.description, payee: l.payee, duplicate: d.dups.indexOf(l) >= 0 })),
  };
}

/** Write lines into the inbox; returns { import, lines (new records), dup_count }. */
function writeLines(app, acc, lines, meta, who) {
  const d = dedupe(app, acc, lines);
  const imp = new Record(app.findCollectionByNameOrId('statement_imports'));
  imp.set('account', acc.id);
  imp.set('file_name', String(meta.file_name || '').slice(0, 255));
  imp.set('file_hash', meta.hash || '');
  imp.set('format', meta.format || 'csv');
  imp.set('period_from', meta.period_from || '');
  imp.set('period_to', meta.period_to || '');
  imp.set('balances', meta.balances || {});
  imp.set('line_count', lines.length);
  imp.set('new_count', d.fresh.length);
  imp.set('dup_count', d.dups.length);
  imp.set('added_by', who.actor === 'agent' ? 'agent' : 'user');
  imp.set('run', who.run || '');
  imp.set('status', 'done');
  app.save(imp);
  const col = app.findCollectionByNameOrId('statement_lines');
  const recs = [];
  for (const l of d.fresh) {
    const r = new Record(col);
    r.set('account', acc.id);
    r.set('import', imp.id);
    r.set('date', l.date);
    r.set('amount', l.amount);
    r.set('currency', meta.currency);
    r.set('description', String(l.description || '').slice(0, 500));
    r.set('payee', String(l.payee || '').slice(0, 160));
    r.set('bank_id', String(l.bank_id || '').slice(0, 120));
    r.set('fingerprint', l.fingerprint);
    r.set('raw', String(l.raw || '').slice(0, 4000));
    r.set('status', 'new');
    app.save(r);
    recs.push(r);
  }
  return { import: imp, lines: recs, dup_count: d.dups.length };
}

/**
 * Import a file read by readFile. opts: { force, file_name, save_profile,
 * profile_name }. Returns counts; new lines get suggestions, and lines whose
 * rule posts automatically are booked.
 */
function importRead(app, r, opts, who) {
  const o = opts || {};
  const p = r.parsed;
  if (p.needs_mapping) throw fail(400, 'Map the columns first: which column holds the date, the amount (or debit and credit) and the description');
  if (p.lines.length === 0) throw fail(400, 'No transactions found in the file');
  if (!o.force) {
    const seen = app.findRecordsByFilter('statement_imports', "account = {:a} && file_hash = {:h} && status = 'done'", '-created', 1, 0, { a: r.account.id, h: r.hash });
    if (seen.length > 0) throw fail(409, 'This file was already imported on ' + seen[0].getString('created').slice(0, 10) + '. Undo that import first, or import anyway with force (only lines not seen before are added).');
  }
  if (p.format === 'csv' && p.mapping && p.header && (o.save_profile || r.profile)) {
    const prof = r.profile || new Record(app.findCollectionByNameOrId('csv_profiles'));
    prof.set('name', String(o.profile_name || prof.getString('name') || r.account.getString('name') + ' CSV').slice(0, 80));
    prof.set('account', r.account.id);
    prof.set('signature', signature(p.header));
    const m = Object.assign({}, p.mapping);
    delete m.date_order_used;
    delete m.date_order_ambiguous;
    prof.set('mapping', m);
    app.save(prof);
  }
  const w = writeLines(app, r.account, p.lines, { file_name: o.file_name, hash: r.hash, format: p.format, period_from: p.period_from, period_to: p.period_to, balances: p.balances, currency: r.currency }, who);
  const res = refresh(app, w.lines, who, false);
  return { import: w.import, lines: w.lines, new_count: w.lines.length, dup_count: w.dup_count, auto_posted: res.auto_posted, suggested: res.suggested, open: res.open };
}

/** Lines given directly (the AI agent reading a PDF statement, or typed in). */
function addLines(app, accountRef, items, fileName, who) {
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const imp = require(`${__hooks}/lib_import.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const acc = statementAccount(app, accountRef);
  const ccy = acc.getString('currency') || ledger.home(app);
  if (!Array.isArray(items) || items.length === 0) throw fail(400, 'lines must be a list of { date, amount, description }');
  if (items.length > 2000) throw fail(400, 'At most 2000 lines at a time');
  const lines = items.map((it, i) => {
    const desc = String((it && (it.description || it.payee)) || '').trim();
    if (desc === '') throw fail(400, 'Line ' + (i + 1) + ' needs a description');
    return {
      date: dates.parse(it.date, 'lines[' + i + '].date'),
      amount: money.amount(it.amount, ccy, 'lines[' + i + '].amount (money in positive, money out negative)'),
      description: desc.slice(0, 500),
      payee: String(it.payee || imp.payeeOf(desc)).slice(0, 160),
      bank_id: String(it.bank_id || ''),
      raw: '',
    };
  });
  const ds = lines.map((l) => l.date).sort();
  const w = writeLines(app, acc, lines, { file_name: fileName || 'Added lines', hash: '', format: 'csv', period_from: ds[0], period_to: ds[ds.length - 1], balances: {}, currency: ccy }, who);
  const res = refresh(app, w.lines, who, false);
  return { import: w.import, lines: w.lines, new_count: w.lines.length, dup_count: w.dup_count, auto_posted: res.auto_posted, suggested: res.suggested, open: res.open };
}

/** Undo an import: entries it booked are voided and its lines leave the inbox. */
function undoImport(app, importId, who) {
  const u = require(`${__hooks}/lib_util.js`);
  const imp = u.byId(app, 'statement_imports', importId);
  if (!imp) throw fail(404, 'No import ' + importId + '; see inbox.imports');
  if (imp.getString('status') === 'undone') throw fail(409, 'This import was already undone');
  const lines = app.findRecordsByFilter('statement_lines', 'import = {:i}', '', 0, 0, { i: imp.id });
  let unbooked = 0;
  for (const l of lines) {
    const st = l.getString('status');
    if (st === 'posted' || st === 'matched') {
      unmatch(app, l, who);
      unbooked++;
    }
  }
  for (const l of app.findRecordsByFilter('statement_lines', 'import = {:i}', '', 0, 0, { i: imp.id })) app.delete(l);
  imp.set('status', 'undone');
  app.save(imp);
  return { import: imp, removed: lines.length, unbooked: unbooked };
}

module.exports = {
  serializeLine: serializeLine,
  serializeImport: serializeImport,
  lineView: lineView,
  mustLine: mustLine,
  cashLike: cashLike,
  context: context,
  suggest: suggest,
  refresh: refresh,
  accept: accept,
  propose: propose,
  unmatch: unmatch,
  readFile: readFile,
  previewOf: previewOf,
  importRead: importRead,
  addLines: addLines,
  undoImport: undoImport,
};
