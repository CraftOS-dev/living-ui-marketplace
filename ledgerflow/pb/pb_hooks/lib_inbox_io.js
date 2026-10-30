/// <reference path="../pb_data/types.d.ts" />
/**
 * Inbox op helpers: reading a statement from an upload, a stored file, a
 * local path (AI agent) or pasted text; turning params into a booking
 * decision; rules from params or from a booked line; the posting policy
 * gate for the AI agent's proposals.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** The statement text and file name from the request. */
function content(e, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const ups = u.uploads(e, 'file');
  const read = (f) => {
    const r = f.reader.open();
    try {
      return toString(r);
    } finally {
      r.close();
    }
  };
  if (ups.length > 0) return { text: read(ups[0]), name: ups[0].originalName || ups[0].name || 'statement' };
  if (u.str(p, 'file_id', '')) {
    const files = require(`${__hooks}/lib_files.js`);
    const rec = files.mustGet(e.app, u.str(p, 'file_id', ''));
    const fsys = e.app.newFilesystem();
    try {
      const r = fsys.getReader(rec.baseFilesPath() + '/' + rec.getString('file'));
      try {
        return { text: toString(r), name: rec.getString('name') };
      } finally {
        r.close();
      }
    } finally {
      fsys.close();
    }
  }
  if (u.str(p, 'path', '')) {
    if (!u.fromAgent(e)) throw fail(403, 'Upload the file instead of giving a path');
    const f = require(`${__hooks}/lib_files.js`).localFile(u.str(p, 'path', ''));
    return { text: read(f), name: $filepath.base(u.str(p, 'path', '')) };
  }
  const raw = p.content;
  const text = raw === undefined || raw === null ? '' : String(Array.isArray(raw) ? raw[0] : raw);
  if (text.trim() !== '') return { text: text, name: u.str(p, 'file_name', '') || 'pasted.csv' };
  throw fail(400, 'Give the statement: upload it (field "file"), --path "<absolute path>" (AI agent), --file_id of a stored file, or --content with the text');
}

/** A booking decision from params, or null to take the line's suggestion. */
function decision(app, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const d = {};
  if (u.str(p, 'account', '')) d.account = ledger.account(app, u.str(p, 'account', '')).id;
  const splits = u.list(p, 'splits');
  if (splits && splits.length > 0) {
    let total = 0;
    d.splits = splits.map((s, i) => {
      const pct = Number(s && s.percent);
      if (!(pct > 0)) throw fail(400, 'splits[' + i + '].percent must be above 0');
      total += pct;
      return { account: ledger.account(app, s.account).id, percent: String(pct) };
    });
    if (Math.abs(total - 100) > 0.001) throw fail(400, 'Split percents must add up to 100 (they add up to ' + total + ')');
  }
  if (u.str(p, 'transfer_account', '')) d.transfer_account = ledger.account(app, u.str(p, 'transfer_account', '')).id;
  if (u.has(p, 'match')) d.match = u.obj(p, 'match');
  if (Object.keys(d).length === 0) return null;
  if (u.str(p, 'contact', '')) d.contact = u.str(p, 'contact', '');
  if (u.str(p, 'tax_code', '')) d.tax_code = ledger.taxCode(app, u.str(p, 'tax_code', '')).id;
  if (u.has(p, 'narration')) d.narration = u.text(p, 'narration', '').slice(0, 500);
  if (u.has(p, 'memo')) d.memo = u.text(p, 'memo', '').slice(0, 300);
  if (u.has(p, 'tags')) d.tags = (u.list(p, 'tags', true) || []).map((t) => String(t).trim()).filter((t) => t !== '');
  if (u.has(p, 'amount_other')) d.amount_other = u.str(p, 'amount_other', '');
  return d;
}

function lineLabel(line) {
  const money = require(`${__hooks}/lib_money.js`);
  return '"' + (line.getString('payee') || line.getString('description')).slice(0, 60) + '" ' + money.format(line.getInt('amount'), line.getString('currency')) + ' on ' + line.getString('date');
}

/** May the AI agent's proposal post now? (the person's posting policy) */
function mayAutoPost(app, line, prop, who) {
  const setup = require(`${__hooks}/lib_setup.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const s = setup.row(app);
  const pol = setup.policy(s);
  if (who.actor !== 'agent') return { ok: true, reason: '' };
  if (!pol.agent_auto_post) return { ok: false, reason: 'The person reviews your proposals (auto-posting is off in their policy)' };
  if (prop.confidence !== 'high') return { ok: false, reason: 'Only high-confidence proposals post on their own' };
  const ceiling = String(pol.ceiling || '').trim();
  if (ceiling !== '') {
    const home = ledger.home(app);
    const limit = money.parse(ceiling, home, 'ceiling');
    let amt = Math.abs(line.getInt('amount'));
    if (line.getString('currency') !== home) {
      const rate = ledger.rateFor(app, line.getString('currency'), line.getString('date'));
      if (!rate) return { ok: false, reason: 'No exchange rate to compare with the posting limit' };
      amt = Math.abs(money.toHome(amt, line.getString('currency'), home, rate));
    }
    if (amt > limit) return { ok: false, reason: 'Above the ' + money.format(limit, home) + ' limit the person set for you' };
  }
  const al = s.getString('agent_lock_date');
  if (al && line.getString('date') <= al) return { ok: false, reason: 'Dated on or before your lock date ' + al };
  return { ok: true, reason: '' };
}

/** Create or update a rule from params. The AI agent's rules wait for the person. */
function saveRule(app, rec, p, who) {
  const u = require(`${__hooks}/lib_util.js`);
  const rules = require(`${__hooks}/lib_rules.js`);
  const r = rec || new Record(app.findCollectionByNameOrId('rules'));
  const agent = who.actor === 'agent';
  if (!rec || u.has(p, 'conditions') || u.has(p, 'actions')) {
    const c = rules.clean(app, u.has(p, 'conditions') ? u.list(p, 'conditions') : u.json(r, 'conditions', []), u.has(p, 'actions') ? u.obj(p, 'actions') : u.json(r, 'actions', {}));
    r.set('conditions', c.conditions);
    r.set('actions', c.actions);
  }
  if (!rec || u.has(p, 'name')) {
    let name = u.squash(u.str(p, 'name', '')).slice(0, 120);
    if (name === '') {
      const c0 = (u.json(r, 'conditions', []) || [])[0];
      name = c0 ? c0.field + ' ' + c0.op.replace('_', ' ') + ' "' + c0.value + '"' : 'Rule';
    }
    r.set('name', name);
  }
  if (!rec || u.has(p, 'match')) r.set('match', u.oneOf(p, 'match', ['all', 'any'], 'all'));
  if (u.has(p, 'note')) r.set('note', u.text(p, 'note', '').slice(0, 1000));
  if (u.has(p, 'one_time')) r.set('one_time', u.bool(p, 'one_time', false));
  if (u.has(p, 'auto_post')) {
    if (agent && u.bool(p, 'auto_post', false)) throw fail(403, 'Only the person lets a rule post on its own');
    r.set('auto_post', u.bool(p, 'auto_post', false));
  }
  if (!rec) {
    r.set('added_by', agent ? 'agent' : 'user');
    r.set('run', who.run || '');
    r.set('status', agent ? 'proposed' : u.oneOf(p, 'status', ['active', 'disabled'], 'active'));
    let max = 0;
    for (const x of app.findRecordsByFilter('rules', 'id != ""', '', 0, 0)) max = Math.max(max, x.getInt('sort') + 10);
    r.set('sort', u.has(p, 'first') && u.bool(p, 'first', false) ? -10 : max);
    r.set('hits', 0);
  } else if (u.has(p, 'status')) {
    const st = u.oneOf(p, 'status', ['active', 'proposed', 'disabled'], 'active');
    if (agent && st === 'active' && r.getString('status') !== 'active') throw fail(403, 'The person turns your rules on');
    r.set('status', st);
  }
  if (agent && rec && r.getString('added_by') !== 'agent') throw fail(403, 'Propose a new rule instead of changing the person\'s');
  app.save(r);
  // A rule that is on applies to the lines waiting now.
  if (r.getString('status') === 'active' && !(u.has(p, 'apply') && !u.bool(p, 'apply', true))) {
    const inbox = require(`${__hooks}/lib_inbox.js`);
    const open = app.findRecordsByFilter('statement_lines', "status = 'new' || status = 'proposed'", 'date', 0, 0);
    const view = { conditions: u.json(r, 'conditions', []), match: r.getString('match') };
    const hit = open.filter((l) => rules.matches(view, inbox.lineView(l)));
    if (hit.length > 0) inbox.refresh(app, hit, who, false);
  }
  return r;
}

/** A rule that books lines like this one the same way. */
function ruleFromLine(app, line, d, who) {
  const u = require(`${__hooks}/lib_util.js`);
  const payee = line.getString('payee').trim();
  const value = payee !== '' ? payee : line.getString('description').split(/\s+/).slice(0, 3).join(' ');
  if (value === '') throw fail(400, 'This line has no payee or description to make a rule from');
  const fin = (u.json(line, 'suggestion', {}) || {}).final || {};
  const actions = {};
  if (d.splits) actions.splits = d.splits;
  else if (d.account || fin.account) actions.account = d.account || fin.account;
  if (d.tax_code || fin.tax_code) actions.tax_code = d.tax_code || fin.tax_code;
  if (d.contact) actions.contact = d.contact;
  if (!actions.account && !actions.splits) throw fail(400, 'A transfer or a match cannot become a rule');
  const p = { name: value, conditions: [{ field: 'payee', op: 'contains', value: value }, { field: 'direction', op: 'equals', value: line.getInt('amount') < 0 ? 'out' : 'in' }], actions: actions, apply: true };
  return saveRule(app, null, p, who);
}

module.exports = { content: content, decision: decision, lineLabel: lineLabel, mayAutoPost: mayAutoPost, saveRule: saveRule, ruleFromLine: ruleFromLine };
