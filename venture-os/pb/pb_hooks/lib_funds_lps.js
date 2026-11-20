/// <reference path="../pb_data/types.d.ts" />
/**
 * LPs, commitments, the firm's sealed wire details, the LP fund raise board
 * and LP questions.
 *
 * - LP data (records, commitments, capital accounts) is for people with LPs
 *   view and for your AI agent while settings.agent_sees_fund_data is on.
 *   Your AI agent proposes LP record changes (lps.upsert) and never touches
 *   commitments, tax ids or wire details.
 * - Wire details are one sealed block per entity (lib_seal): screens see the
 *   bank name and the last four digits; bank.view reveals them for five
 *   minutes with the PIN (audited); bank.change stores a pending block that
 *   a second member approves with their own PIN before notices use it.
 * - The fund raise is the lp_raise pipeline (kernel-records deals): each
 *   prospect is a deal on the LP's company with its target as the deal's
 *   check; a soft circle is a commitment with status soft (left out of every
 *   allocation until it is signed). lp_raise deals follow LP rights here.
 */

const LP_KINDS = ['individual', 'family_office', 'fund_of_funds', 'endowment', 'foundation', 'pension', 'sovereign', 'corporate', 'insurer', 'bank', 'gp', 'other'];
const SIDE_FLAGS = ['mfn', 'fee_discount', 'fee_waiver', 'co_invest', 'reporting', 'excuse', 'transfer', 'confidentiality', 'other'];
const CONTACT_KEYS = ['name', 'email', 'role', 'phone', 'primary', 'notices'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function F() {
  return L('lib_funds');
}

/* ------------------------------------------------------------------ LPs */

function lpRef(ctx, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'lp is required (id or name).', 'missing_param', { param: 'lp' });
  let rec = util.byId(ctx.app, 'lps', r);
  if (rec === null) {
    const rows = util.rows(ctx.app, "SELECT id FROM lps WHERE deleted_at = '' AND LOWER(name) = LOWER({:n}) LIMIT 2", { id: '' }, { n: r });
    if (rows.length > 1) throw util.fail(409, 'More than one LP is called "' + r + '". Use the id.', 'ambiguous');
    if (rows.length === 1) rec = ctx.app.findRecordById('lps', rows[0].id);
  }
  if (rec === null || rec.getString('deleted_at') !== '') {
    const close = util.closeNames(ctx.app, 'lps', 'name', r);
    throw util.fail(404, 'No LP "' + r + '".' + (close.length > 0 ? ' Did you mean ' + close.map((x) => '"' + x + '"').join(' or ') + '?' : '') + ' Run lps.list.', 'not_found', { ref: r, matches: close });
  }
  return rec;
}

function contactsOf(raw) {
  const util = u();
  if (raw === undefined) return undefined;
  let list = raw;
  if (typeof list === 'string') {
    const t = list.trim();
    if (t === '') return [];
    try {
      list = JSON.parse(t);
    } catch {
      throw util.fail(400, 'contacts is a JSON list of {"name","email","role","phone","primary","notices"}.', 'invalid_param', { param: 'contacts' });
    }
  }
  if (!Array.isArray(list)) throw util.fail(400, 'contacts is a JSON list.', 'invalid_param', { param: 'contacts' });
  if (list.length > 20) throw util.fail(400, 'At most 20 contacts.', 'invalid_param', { param: 'contacts' });
  return list.map((c, i) => {
    util.keysOnly(c, CONTACT_KEYS, 'contacts[' + i + ']');
    const email = String(c.email || '').trim().toLowerCase();
    if (email !== '' && !L('lib_norm').validEmail(email)) throw util.fail(400, 'contacts[' + i + '].email is not an email address.', 'invalid_param', { param: 'contacts' });
    const name = util.clip(util.squash(c.name || ''), 120);
    if (name === '' && email === '') throw util.fail(400, 'contacts[' + i + '] needs a name or an email.', 'invalid_param', { param: 'contacts' });
    return { name: name, email: email, role: util.clip(util.squash(c.role || ''), 80), phone: util.clip(util.squash(c.phone || ''), 40), primary: c.primary === true, notices: c.notices !== false };
  });
}

/** Where an LP's notices go: contacts with notices on (the primary first). */
function noticeEmails(lp) {
  const list = u().jsonOf(lp, 'contacts', []) || [];
  return list
    .filter((c) => c.email && c.notices !== false)
    .sort((a, b) => (b.primary === true ? 1 : 0) - (a.primary === true ? 1 : 0))
    .map((c) => c.email);
}

function lpOut(app, r) {
  const R = L('lib_records');
  return {
    id: r.id,
    name: r.getString('name'),
    kind: r.getString('kind'),
    company: R.mini(app, 'companies', r.getString('company')),
    person: R.mini(app, 'people', r.getString('person')),
    contacts: u().jsonOf(r, 'contacts', []) || [],
    country: r.getString('country'),
    tax_id: r.getString('tax_id_mask'),
    notes: r.getString('notes'),
    actor: r.getString('actor'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** lps.list: LPs (with a fund: their commitment, called, distributed, unfunded and NAV share in it). */
function list(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const q = util.str(p, 'q', '');
  const fundRef = util.str(p, 'fund', '');
  const pg = util.page(p, 100, 500);
  if (fundRef === '') {
    const rows = util.rows(app, "SELECT id FROM lps WHERE deleted_at = ''" + (q !== '' ? " AND name LIKE {:q} ESCAPE '\\'" : '') + ' ORDER BY name LIMIT {:l} OFFSET {:o}', { id: '' }, { q: util.like(q), l: pg.limit, o: pg.offset });
    const total = util.count(app, "SELECT COUNT(*) AS n FROM lps WHERE deleted_at = ''" + (q !== '' ? " AND name LIKE {:q} ESCAPE '\\'" : ''), { q: util.like(q) });
    const visible = {};
    for (const v of F().visibleFunds(ctx)) visible[v.id] = true;
    return {
      lps: rows.map((x) => {
        const r = app.findRecordById('lps', x.id);
        const out = lpOut(app, r);
        out.commitments = util
          .rows(app, 'SELECT c.fund, e.name AS fund_name, c.status, c.amount_minor, c.currency FROM commitments c JOIN entities e ON e.id = c.fund WHERE c.lp = {:l}', { fund: '', fund_name: '', status: '', amount_minor: 0, currency: '' }, { l: r.id })
          .filter((c) => visible[c.fund]);
        return out;
      }),
      total: total,
    };
  }
  const f = F().fundOf(ctx, fundRef);
  const day = util.today(app);
  const b = F().books(app, f, day);
  const all = F().commitmentsOf(app, f.id, '');
  const signed = all.filter((c) => c.status === 'signed');
  const accounts = F().accountsOf(b, signed, day);
  const nav = F().navAt(b.rows, day, b.marks, b.holdings);
  const shares = F().navShares(nav.nav_minor, signed);
  let rows = all.map((c) => {
    const a = accounts[c.lp] || null;
    return {
      id: c.lp,
      name: c.lp_name,
      status: c.status,
      commitment: c.id,
      commitment_minor: c.amount_minor,
      called_minor: a ? a.contributed_minor : 0,
      called_ppm: a ? a.contributed_ppm : null,
      distributed_minor: a ? a.distributed_minor : 0,
      unfunded_minor: a ? a.unfunded_minor : c.amount_minor,
      recallable_minor: a ? a.recallable_minor : 0,
      nav_share_minor: shares[c.lp] || 0,
      fee_paying: c.fee_paying,
      side_letter: c.side_letter,
      warnings: a ? a.warnings : [],
    };
  });
  if (q !== '') rows = rows.filter((r) => r.name.toLowerCase().indexOf(q.toLowerCase()) >= 0);
  const totals = { commitment_minor: 0, called_minor: 0, distributed_minor: 0, unfunded_minor: 0, nav_minor: nav.nav_minor };
  for (const r of rows) {
    if (r.status !== 'signed') continue;
    totals.commitment_minor += r.commitment_minor;
    totals.called_minor += r.called_minor;
    totals.distributed_minor += r.distributed_minor;
    totals.unfunded_minor += r.unfunded_minor;
  }
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, lps: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length, totals: totals, estimate: { nav_share: 'pro rata of signed commitments' } };
}

/** lps.get: one LP with contacts, its commitments and, per fund, its capital account, NAV share, notices and a quarterly series. */
function get(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const r = lpRef(ctx, util.req(p, 'lp'));
  const day = util.today(app);
  const funds = [];
  for (const v of F().visibleFunds(ctx)) {
    const commits = F().commitmentsOf(app, v.id, '');
    const mine = commits.filter((c) => c.lp === r.id)[0];
    if (mine === undefined) continue;
    const f = app.findRecordById('entities', v.id);
    const b = F().books(app, f, day);
    const signed = commits.filter((c) => c.status === 'signed');
    const rows = b.rows.filter((x) => x.lp === r.id);
    const account = F().accountFrom(mine.amount_minor, rows);
    const nav = F().navAt(b.rows, day, b.marks, b.holdings);
    const share = mine.status === 'signed' ? F().navShares(nav.nav_minor, signed)[r.id] || 0 : 0;
    // Cumulative contributed and distributed by quarter (the LP page's mini chart).
    const series = [];
    let cc = 0;
    let dd = 0;
    const byQ = {};
    for (const x of rows) {
      const k = F().qEnd(x.day);
      if (byQ[k] === undefined) byQ[k] = { c: 0, d: 0 };
      if (F().LP_CALL.indexOf(x.type) >= 0 || x.type === 'opening_contributed') byQ[k].c += x.amount_minor;
      else if (F().LP_DIST.indexOf(x.type) >= 0 || x.type === 'opening_distributed') byQ[k].d += x.amount_minor;
    }
    for (const k of Object.keys(byQ).sort()) {
      cc += byQ[k].c;
      dd += byQ[k].d;
      series.push({ quarter: F().qLabel(k), end: k, contributed_minor: cc, distributed_minor: dd });
    }
    const lines = F()
      .plainRows(
        app,
        "SELECT l.id, e.id AS event, e.number, e.kind, e.status, e.notice_day, e.due_day, l.total_minor, COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.line = l.id AND x.voided_at = ''), 0) AS paid FROM capital_lines l JOIN capital_events e ON e.id = l.event WHERE l.lp = {:l} AND e.fund = {:f} AND e.status IN ('issued','settled','void') ORDER BY e.notice_day DESC",
        { id: '', event: '', number: '', kind: '', status: '', notice_day: '', due_day: '', total_minor: 0, paid: 0 },
        { l: r.id, f: f.id },
      )
      .map((x) => Object.assign(x, { paid_ppm: x.total_minor > 0 ? Math.min(1000000, Math.round((x.paid * 1000000) / x.total_minor)) : null }));
    funds.push({ fund: { id: f.id, name: f.getString('name'), short_name: f.getString('short_name'), currency: f.getString('currency') }, commitment: mine, account: account, nav_share_minor: share, series: series, lines: lines });
  }
  return { lp: lpOut(app, r), funds: funds };
}

/** lps.upsert: add an LP (no --lp) or change one. Your AI agent's call is a proposal; tax ids are people only. */
function upsert(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'lp', '');
  const cur = ref !== '' ? lpRef(ctx, ref) : null;
  if (util.str(p, 'tax_id', '') !== '' && ctx.isAgent) throw util.fail(403, 'Tax ids are sealed; a person enters them.', 'agent_not_permitted', { param: 'tax_id' });
  const r = cur !== null ? cur : util.newRecord(app, 'lps');
  const before = cur !== null ? lpOut(app, cur) : null;
  if (cur === null || util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 200, ''));
    if (name === '') throw util.fail(400, 'name is required.', 'missing_param', { param: 'name' });
    const dup = util.rows(app, "SELECT id FROM lps WHERE deleted_at = '' AND LOWER(name) = LOWER({:n}) AND id != {:id} LIMIT 1", { id: '' }, { n: name, id: cur !== null ? cur.id : '' });
    if (dup.length > 0) throw util.fail(409, 'There is already an LP called ' + name + '.', 'duplicate', { lp: dup[0].id });
    r.set('name', name);
  }
  if (cur === null || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', LP_KINDS, cur !== null ? cur.getString('kind') : 'other'));
  if (util.has(p, 'company')) {
    const c = util.str(p, 'company', '');
    r.set('company', c === '' ? '' : L('lib_records').resolve(app, 'companies', c).id);
  }
  if (util.has(p, 'person')) {
    const c = util.str(p, 'person', '');
    r.set('person', c === '' ? '' : L('lib_records').resolve(app, 'people', c).id);
  }
  const contacts = contactsOf(p.contacts);
  if (contacts !== undefined) r.set('contacts', contacts);
  else if (cur === null) r.set('contacts', []);
  if (util.has(p, 'country')) {
    const c = util.str(p, 'country', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{2}$/.test(c)) throw util.fail(400, 'country is a two-letter code such as US.', 'invalid_param', { param: 'country' });
    r.set('country', c);
  }
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 4000, ''));
  if (util.has(p, 'tax_id')) {
    const t = util.text(p, 'tax_id', 60, '');
    r.set('tax_id_sealed', t === '' ? '' : L('lib_seal').seal(app, t));
    r.set('tax_id_mask', t === '' ? '' : L('lib_seal').mask(t, 'last4'));
  }
  if (cur === null) {
    r.set('deleted_at', '');
    r.set('prov', {});
  }
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.memberId || '');
  app.save(r);
  const after = lpOut(app, r);
  L('lib_audit').note(ctx, { collection: 'lps', record: r.id, summary: (cur === null ? 'Added LP ' : 'Changed LP ') + after.name, before: before === null ? undefined : before, after: after });
  return { lp: after, created: cur === null };
}

function previewUpsert(ctx, params) {
  const util = u();
  const cur = params.lp ? util.byId(ctx.app, 'lps', String(params.lp)) : null;
  const fields = [];
  for (const k of ['name', 'kind', 'company', 'person', 'contacts', 'country', 'notes']) {
    if (params[k] === undefined) continue;
    const before = cur === null ? '' : k === 'contacts' ? JSON.stringify(util.jsonOf(cur, 'contacts', [])) : cur.getString(k);
    fields.push({ name: k, before: before, after: typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]) });
  }
  return { label: (cur === null ? 'Add LP ' + (params.name || '') : 'Change LP ' + cur.getString('name')).trim(), target: cur === null ? '' : 'lps:' + cur.id, fields: fields, risk: 'low' };
}

/* ---------------------------------------------------------- commitments */

function commitmentOut(app, c) {
  const lp = u().byId(app, 'lps', c.getString('lp'));
  return {
    id: c.id,
    fund: c.getString('fund'),
    lp: c.getString('lp'),
    lp_name: lp ? lp.getString('name') : '',
    status: c.getString('status'),
    amount_minor: c.getInt('amount_minor'),
    currency: c.getString('currency'),
    fee_paying: c.getBool('fee_paying'),
    fee_rate_ppm: c.getBool('fee_override') ? c.getInt('fee_rate_ppm') : null,
    waiver_ppm: c.getInt('waiver_ppm'),
    side_letter: u().jsonOf(c, 'side_letter', []) || [],
    closing_day: c.getString('closing_day'),
    deal: c.getString('deal'),
    notes: c.getString('notes'),
  };
}

function commitmentsList(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const out = [];
  const lpRefText = util.str(p, 'lp', '');
  const lp = lpRefText !== '' ? lpRef(ctx, lpRefText) : null;
  const fundRef = util.str(p, 'fund', '');
  const funds = fundRef !== '' ? [F().fundOf(ctx, fundRef).id] : F().visibleFunds(ctx).map((v) => v.id);
  for (const fid of funds) {
    for (const c of util.findMany(app, 'commitments', 'fund = {:f}' + (lp !== null ? ' && lp = {:l}' : ''), '-amount_minor', 0, { f: fid, l: lp !== null ? lp.id : '' })) out.push(commitmentOut(app, c));
  }
  return { commitments: out, total: out.length, side_letter_flags: SIDE_FLAGS };
}

/** commitments.save (people): one LP's commitment to a fund, created or changed. */
function commitmentsSave(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const lp = lpRef(ctx, util.req(p, 'lp'));
  const cur = util.findOne(app, 'commitments', 'fund = {:f} && lp = {:l}', { f: f.id, l: lp.id });
  const r = cur !== null ? cur : util.newRecord(app, 'commitments');
  const before = cur !== null ? commitmentOut(app, cur) : null;
  const currency = f.getString('currency');
  if (cur === null || util.has(p, 'amount')) {
    const amt = util.money(p, 'amount', currency, { required: cur === null });
    if (amt !== null) {
      if (amt < 0) throw util.fail(400, 'amount cannot be negative.', 'invalid_amount', { param: 'amount' });
      r.set('amount_minor', amt);
    }
  }
  r.set('fund', f.id);
  r.set('lp', lp.id);
  r.set('currency', currency);
  r.set('status', util.oneOf(p, 'status', ['soft', 'signed'], cur !== null ? cur.getString('status') : 'signed'));
  if (cur === null || util.has(p, 'fee_paying')) r.set('fee_paying', util.bool(p, 'fee_paying', cur !== null ? cur.getBool('fee_paying') : true));
  if (util.has(p, 'fee_rate')) {
    const v = util.str(p, 'fee_rate', '');
    if (v === '') {
      r.set('fee_override', false);
      r.set('fee_rate_ppm', 0);
    } else {
      r.set('fee_override', true);
      r.set('fee_rate_ppm', util.ppm(p, 'fee_rate', { min: 0, max: 100000 }));
    }
  }
  if (util.has(p, 'waiver')) r.set('waiver_ppm', util.ppm(p, 'waiver', { min: 0, max: 1000000 }) || 0);
  if (util.has(p, 'side_letter')) {
    const flags = util.list(p, 'side_letter') || [];
    for (const x of flags) if (SIDE_FLAGS.indexOf(String(x)) < 0) throw util.fail(400, 'side_letter takes: ' + SIDE_FLAGS.join(', ') + '.', 'invalid_param', { param: 'side_letter' });
    r.set('side_letter', flags.map(String));
  } else if (cur === null) r.set('side_letter', []);
  if (util.has(p, 'closing_day')) r.set('closing_day', util.day(p, 'closing_day', ''));
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 2000, ''));
  r.set('actor', 'person');
  r.set('member', ctx.memberId || '');
  app.save(r);
  const after = commitmentOut(app, r);
  L('lib_audit').note(ctx, { collection: 'commitments', record: r.id, summary: (cur === null ? 'Added ' : 'Changed ') + 'the commitment of ' + lp.getString('name') + ' to ' + f.getString('name') + ': ' + F().fmt(after.amount_minor, currency), before: before === null ? undefined : before, after: after });
  return { commitment: after };
}

/* ----------------------------------------------------------------- bank */

const BANK_FIELDS = ['account_name', 'account_number', 'routing', 'swift', 'iban', 'bank_address', 'reference'];

function blockOut(app, b) {
  const R = L('lib_records');
  const ent = u().byId(app, 'entities', b.getString('entity'));
  return {
    id: b.id,
    entity: b.getString('entity'),
    entity_name: ent ? ent.getString('short_name') || ent.getString('name') : '',
    status: b.getString('status'),
    bank_name: b.getString('bank_name'),
    last4: b.getString('last4'),
    currency: b.getString('currency'),
    changed_by: R.mini(app, 'members', b.getString('changed_by')),
    approved_by: R.mini(app, 'members', b.getString('approved_by')),
    approved_at: b.getString('approved_at'),
    created: b.getString('created'),
  };
}

function entityFor(ctx, ref) {
  const r = L('lib_entities').ref(ctx.app, ref);
  if (!L('lib_entities').canSee(ctx, r)) throw u().fail(404, 'No entity "' + ref + '" you can see.', 'not_found');
  return r;
}

function bankList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'entity', '');
  const ents = ref !== '' ? [entityFor(ctx, ref).id] : L('lib_entities').visible(ctx, {}).map((v) => v.id);
  const out = [];
  for (const id of ents) for (const b of util.findMany(app, 'bank_blocks', "entity = {:e} && (status = 'active' || status = 'pending')", '-created', 10, { e: id })) out.push(blockOut(app, b));
  return { blocks: out };
}

/** The active wire block of an entity (record) or null. */
function activeBlock(app, entityId) {
  return u().findOne(app, 'bank_blocks', "entity = {:e} && status = 'active'", { e: entityId });
}

/** The unsealed wire details of a block (for a notice the PIN-holder issues): { bank_name, account_name, ... }. */
function detailsOf(app, b) {
  const plain = L('lib_seal').unseal(app, b.getString('details_sealed'));
  const d = JSON.parse(plain || '{}') || {};
  d.bank_name = b.getString('bank_name');
  d.currency = b.getString('currency');
  return d;
}

/** bank.view (PIN): the wire details for five minutes. */
function bankView(ctx, p) {
  const util = u();
  const app = ctx.app;
  let b;
  if (util.str(p, 'block', '') !== '') b = util.byId(app, 'bank_blocks', util.str(p, 'block', ''));
  else b = activeBlock(app, entityFor(ctx, util.req(p, 'entity')).id);
  if (b === null || b === undefined) throw util.fail(404, 'No wire details saved for this entity.', 'not_found');
  entityFor(ctx, b.getString('entity'));
  const rev = L('lib_seal').reveal(ctx, b.getString('details_sealed'), 'the wire details of ' + blockOut(app, b).entity_name);
  const d = JSON.parse(rev.value || '{}') || {};
  return { block: blockOut(app, b), details: Object.assign({ bank_name: b.getString('bank_name') }, d), visible_until: rev.visible_until, minutes: rev.minutes };
}

/** bank.change (PIN): new wire details wait for a second member's approval. */
function bankChange(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ent = entityFor(ctx, util.req(p, 'entity'));
  const bankName = util.squash(util.text(p, 'bank_name', 200, ''));
  if (bankName === '') throw util.fail(400, 'bank_name is required.', 'missing_param', { param: 'bank_name' });
  const d = {};
  for (const k of BANK_FIELDS) d[k] = util.squash(util.text(p, k, 300, ''));
  if (d.account_number === '' && d.iban === '') throw util.fail(400, 'Give account_number or iban.', 'missing_param', { param: 'account_number' });
  const key = (d.iban !== '' ? d.iban : d.account_number).replace(/\s+/g, '');
  for (const old of util.findMany(app, 'bank_blocks', "entity = {:e} && status = 'pending'", '', 0, { e: ent.id })) {
    old.set('status', 'rejected');
    app.save(old);
  }
  const b = util.newRecord(app, 'bank_blocks');
  b.set('entity', ent.id);
  b.set('status', 'pending');
  b.set('bank_name', bankName);
  b.set('details_sealed', L('lib_seal').seal(app, JSON.stringify(d)));
  b.set('last4', L('lib_seal').mask(key, 'last4'));
  b.set('currency', (util.str(p, 'currency', '') || ent.getString('currency')).toUpperCase());
  b.set('changed_by', ctx.memberId);
  b.set('actor', 'person');
  b.set('member', ctx.memberId);
  app.save(b);
  L('lib_audit').note(ctx, { collection: 'bank_blocks', record: b.id, summary: 'Changed the wire details of ' + ent.getString('name') + ' (waits for a second approval)', after: blockOut(app, b) });
  L('lib_notify').toLevel(app, 'funds', 'full', { kind: 'bank', title: 'Wire details wait for your approval', body: ctx.name + ' changed the wire details of ' + ent.getString('name') + '. A second member approves them with their PIN.', link: '#/settings/funds', ref: 'funds:bank:' + b.id });
  return { block: blockOut(app, b) };
}

/** bank.approve (PIN): a second member approves (or rejects) pending wire details. */
function bankApprove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = util.byId(app, 'bank_blocks', util.req(p, 'block'));
  if (b === null) throw util.fail(404, 'No such wire details.', 'not_found');
  entityFor(ctx, b.getString('entity'));
  if (b.getString('status') !== 'pending') throw util.fail(409, 'These wire details are ' + b.getString('status') + '.', 'conflict');
  if (b.getString('changed_by') === ctx.memberId) throw util.fail(403, 'A second member approves wire details; you changed them.', 'second_member_required');
  const decision = util.oneOf(p, 'decision', ['approve', 'reject'], 'approve');
  if (decision === 'reject') {
    b.set('status', 'rejected');
    app.save(b);
    L('lib_audit').note(ctx, { collection: 'bank_blocks', record: b.id, summary: 'Rejected changed wire details' });
    return { block: blockOut(app, b) };
  }
  for (const old of util.findMany(app, 'bank_blocks', "entity = {:e} && status = 'active'", '', 0, { e: b.getString('entity') })) {
    old.set('status', 'replaced');
    app.save(old);
  }
  b.set('status', 'active');
  b.set('approved_by', ctx.memberId);
  b.set('approved_at', util.nowIso());
  app.save(b);
  L('lib_audit').note(ctx, { collection: 'bank_blocks', record: b.id, summary: 'Approved the wire details of ' + blockOut(app, b).entity_name });
  return { block: blockOut(app, b) };
}

/* ----------------------------------------------------------------- raise */

/** lp_raise deals follow LP rights: a context that may see them (kernel scope and restriction still apply). */
function raiseCtx(ctx) {
  if (ctx.isAgent || L('lib_auth').can(ctx, 'pipeline', 'view')) return ctx;
  const levels = Object.assign({}, ctx.levels, { pipeline: 'view' });
  return Object.assign({}, ctx, { levels: levels });
}

function raiseDeal(ctx, ref) {
  const util = u();
  const d = L('lib_deals').ref(ctx.app, ref);
  const pl = util.byId(ctx.app, 'pipelines', d.getString('pipeline'));
  if (pl === null || pl.getString('kind') !== 'lp_raise') throw util.fail(400, d.getString('number') + ' is not on the fund raise.', 'invalid_param', { param: 'deal' });
  L('lib_deals').guard(raiseCtx(ctx), d);
  return d;
}

/** raise.board: prospects by stage with target and soft-circled amounts, and the total against the fund's target. */
function raiseBoard(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const D = L('lib_deals');
  const pl = D.pipelineOf(app, 'lp_raise');
  const stages = D.stagesOf(pl);
  const rc = raiseCtx(ctx);
  const zone = util.zoneOf(app);
  const deals = util.findMany(app, 'deals', "pipeline = {:p} && fund = {:f} && deleted_at = '' && (status = 'open' || status = 'invested')", 'stage_entered_at', 500, { p: pl.id, f: f.id }).filter((d) => D.visible(rc, d));
  const soft = {};
  for (const c of F().commitmentsOf(app, f.id, '')) if (c.deal !== '') soft[c.deal] = c;
  const cols = stages.map((s) => ({ key: s.key, label: s.label, prospects: [], target_minor: 0, soft_minor: 0 }));
  const byKey = {};
  for (const c of cols) byKey[c.key] = c;
  let pipeline = 0;
  for (const d of deals) {
    const card = D.cardOut(app, d, zone);
    const c = soft[d.id];
    card.target_minor = d.getInt('check_minor');
    card.soft_minor = c ? c.amount_minor : 0;
    card.commitment_status = c ? c.status : '';
    const col = byKey[d.getString('stage')] || cols[0];
    col.prospects.push(card);
    col.target_minor += card.target_minor;
    col.soft_minor += card.soft_minor;
    pipeline += card.target_minor;
  }
  const commits = F().commitmentsOf(app, f.id, '');
  let signed = 0;
  let softSum = 0;
  for (const c of commits) {
    if (c.status === 'signed') signed += c.amount_minor;
    else softSum += c.amount_minor;
  }
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, pipeline: { id: pl.id, key: 'lp_raise', name: pl.getString('name') }, stages: cols, totals: { target_minor: f.getInt('target_minor') || f.getInt('size_minor'), signed_minor: signed, soft_minor: softSum, pipeline_minor: pipeline }, hidden: 0 };
}

/** raise.add: a prospect on the fund raise (its company found or added) with a target commitment. */
function raiseAdd(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const target = util.money(p, 'target', f.getString('currency'), {}) || 0;
  const d = L('lib_deals').create(raiseCtx(ctx), { company: util.req(p, 'company'), pipeline: 'lp_raise', stage: util.str(p, 'stage', '') || undefined, check_minor: target, currency: f.getString('currency'), fund: f.id });
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: 'Added ' + d.title + ' to the ' + f.getString('name') + ' raise' });
  return { deal: d };
}

/** raise.move: a prospect to another stage of the raise. */
function raiseMove(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const d = raiseDeal(ctx, util.req(p, 'deal'));
  return { deal: L('lib_deals').move(raiseCtx(ctx), d.id, util.req(p, 'stage'), util.text(p, 'note', 600, '')) };
}

/** raise.soft: a prospect's soft circle (a soft commitment, left out of allocations until signed). */
function raiseSoft(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const d = raiseDeal(ctx, util.req(p, 'deal'));
  const fid = d.getString('fund');
  if (fid === '') throw util.fail(400, 'This prospect has no fund.', 'invalid_param', { param: 'deal' });
  const f = F().fundOf(ctx, fid);
  const amount = util.money(p, 'amount', f.getString('currency'), { required: true, positive: true });
  let lp = util.findOne(app, 'lps', "company = {:c} && deleted_at = ''", { c: d.getString('company') });
  const co = L('lib_records').mini(app, 'companies', d.getString('company'));
  if (lp === null && co !== null) {
    const same = util.rows(app, "SELECT id FROM lps WHERE deleted_at = '' AND company = '' AND LOWER(name) = LOWER({:n}) LIMIT 2", { id: '' }, { n: co.name });
    if (same.length === 1) {
      lp = app.findRecordById('lps', same[0].id);
      lp.set('company', d.getString('company'));
      app.save(lp);
    }
  }
  if (lp === null) {
    lp = util.newRecord(app, 'lps');
    lp.set('name', co ? co.name : d.getString('number'));
    lp.set('kind', util.oneOf(p, 'kind', LP_KINDS, 'other'));
    lp.set('company', d.getString('company'));
    lp.set('contacts', []);
    lp.set('prov', {});
    lp.set('deleted_at', '');
    lp.set('actor', 'person');
    lp.set('member', ctx.memberId || '');
    app.save(lp);
  }
  let c = util.findOne(app, 'commitments', 'fund = {:f} && lp = {:l}', { f: f.id, l: lp.id });
  if (c !== null && c.getString('status') === 'signed') throw util.fail(409, lp.getString('name') + ' has already signed: change the commitment instead.', 'conflict');
  if (c === null) {
    c = util.newRecord(app, 'commitments');
    c.set('fund', f.id);
    c.set('lp', lp.id);
    c.set('fee_paying', true);
    c.set('side_letter', []);
  }
  c.set('status', 'soft');
  c.set('amount_minor', amount);
  c.set('currency', f.getString('currency'));
  c.set('deal', d.id);
  c.set('actor', 'person');
  c.set('member', ctx.memberId || '');
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'commitments', record: c.id, summary: lp.getString('name') + ' soft-circled ' + F().fmt(amount, f.getString('currency')) + ' for ' + f.getString('name') });
  return { commitment: commitmentOut(app, c), lp: lpOut(app, lp) };
}

/* ---------------------------------------------------------- LP questions */

function lpqOut(app, r) {
  const util = u();
  const lp = util.byId(app, 'lps', r.getString('lp'));
  const f = r.getString('fund') !== '' ? util.byId(app, 'entities', r.getString('fund')) : null;
  const drafts = util.findMany(app, 'outbound', "ref_collection = 'lp_questions' && ref_id = {:q}", '-created', 3, { q: r.id }).map((o) => ({ id: o.id, subject: o.getString('subject'), status: o.getString('status') }));
  return { id: r.id, lp: r.getString('lp'), lp_name: lp !== null ? lp.getString('name') : '', to: lp !== null ? noticeEmails(lp) : [], fund: r.getString('fund'), fund_name: f !== null ? f.getString('name') : '', question: r.getString('question'), asked_by: r.getString('asked_by'), created: r.getString('created'), drafts: drafts, agent: L('lib_agent').view(r, ['lp_answer']) };
}

/** lpq.log: an LP's question; a person's log asks your AI agent to draft an answer from the fund's documents (trigger lp_answer), never sent. */
function lpqLog(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const lp = lpRef(ctx, util.req(p, 'lp'));
  const question = util.text(p, 'question', 8000, '');
  if (util.squash(question) === '') throw util.fail(400, 'question is required.', 'missing_param', { param: 'question' });
  const fundRef = util.str(p, 'fund', '');
  const f = fundRef !== '' ? F().fundOf(ctx, fundRef) : null;
  const r = util.newRecord(app, 'lp_questions');
  r.set('lp', lp.id);
  r.set('fund', f !== null ? f.id : '');
  r.set('question', question);
  r.set('asked_by', ctx.isAgent ? '' : ctx.memberId || '');
  app.save(r);
  const asked = ctx.isAgent || ctx.dryRun ? '' : L('lib_agent').ask(app, 'lp_answer', r, {}, { by: ctx.memberId || '' });
  L('lib_audit').note(ctx, { collection: 'lp_questions', record: r.id, summary: 'Logged a question from ' + lp.getString('name') });
  return { question: lpqOut(app, app.findRecordById('lp_questions', r.id)), request: asked };
}

function lpqList(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const lpRef0 = util.str(p, 'lp', '');
  const where = lpRef0 !== '' ? 'lp = {:l}' : '1=1';
  const rows = util.findMany(app, 'lp_questions', where, '-created', util.int(p, 'limit', 30, 1, 200), { l: lpRef0 !== '' ? lpRef(ctx, lpRef0).id : '' });
  return { questions: rows.map((r) => lpqOut(app, r)) };
}

/** agent.ask --trigger lp_answer --record <question>: LP data is visible to the person asking. */
function lpqCheck(ctx) {
  F().needLpData(ctx);
  return {};
}

/* --------------------------------------------------------------- imports */

/**
 * Import row (kernel importer target lp_commitments): an LP by exact name
 * (added when new, with its contact) and, with a fund and an amount, its
 * signed commitment. Checks before it writes.
 */
function importRow(ctx, row) {
  const util = u();
  const app = ctx.app;
  F().needLpData(ctx);
  const name = util.squash(String(row.name || ''));
  if (name === '') throw util.fail(400, 'The LP name is empty.', 'missing_param');
  const kind = row.kind ? String(row.kind).toLowerCase().replace(/[^a-z]+/g, '_') : 'other';
  if (LP_KINDS.indexOf(kind) < 0) throw util.fail(400, 'kind must be one of: ' + LP_KINDS.join(', '), 'invalid_param');
  let f = null;
  if (row.fund) f = F().fundOf(ctx, String(row.fund));
  const amount = f !== null && row.amount !== undefined && row.amount !== null && row.amount !== '' ? L('lib_money').toMinor(String(row.amount), f.getString('currency'), false) : null;
  if (f !== null && row.amount !== undefined && row.amount !== null && row.amount !== '' && amount === null) throw util.fail(400, 'amount is not an amount in ' + f.getString('currency') + '.', 'invalid_amount');
  const email = String(row.email || '').trim().toLowerCase();
  if (email !== '' && !L('lib_norm').validEmail(email)) throw util.fail(400, email + ' is not an email address.', 'invalid_param');
  const found = util.rows(app, "SELECT id FROM lps WHERE deleted_at = '' AND LOWER(name) = LOWER({:n}) LIMIT 1", { id: '' }, { n: name });
  let lp;
  let action = 'updated';
  if (found.length === 0) {
    lp = util.newRecord(app, 'lps');
    lp.set('name', name);
    lp.set('kind', kind);
    lp.set('contacts', email !== '' ? [{ name: util.squash(row.contact || ''), email: email, role: '', phone: '', primary: true, notices: true }] : []);
    lp.set('country', /^[A-Za-z]{2}$/.test(String(row.country || '')) ? String(row.country).toUpperCase() : '');
    lp.set('prov', {});
    lp.set('deleted_at', '');
    lp.set('actor', ctx.isAgent ? 'agent' : 'person');
    lp.set('member', ctx.memberId || '');
    app.save(lp);
    action = 'created';
  } else lp = app.findRecordById('lps', found[0].id);
  if (f !== null && amount !== null) {
    let c = util.findOne(app, 'commitments', 'fund = {:f} && lp = {:l}', { f: f.id, l: lp.id });
    if (c === null) {
      c = util.newRecord(app, 'commitments');
      c.set('fund', f.id);
      c.set('lp', lp.id);
      c.set('side_letter', []);
    }
    c.set('status', 'signed');
    c.set('amount_minor', amount);
    c.set('currency', f.getString('currency'));
    c.set('fee_paying', row.fee_paying !== false);
    if (util.isDay(String(row.closing_day || ''))) c.set('closing_day', String(row.closing_day));
    c.set('actor', ctx.isAgent ? 'agent' : 'person');
    c.set('member', ctx.memberId || '');
    app.save(c);
  } else if (action === 'updated') action = 'skipped';
  return { action: action, id: lp.id, message: name };
}

/** record.merged: LPs that pointed at the dropped company or person point at the kept one. */
function onMerged(ctx, payload) {
  const util = u();
  if (!payload || !payload.keep || !payload.drop) return null;
  const field = payload.kind === 'companies' ? 'company' : payload.kind === 'people' ? 'person' : '';
  if (field === '') return null;
  for (const r of util.findMany(ctx.app, 'lps', field + ' = {:d}', '', 0, { d: payload.drop })) {
    r.set(field, payload.keep);
    ctx.app.save(r);
  }
  return null;
}

module.exports = {
  importRow: importRow,
  onMerged: onMerged,
  LP_KINDS: LP_KINDS,
  SIDE_FLAGS: SIDE_FLAGS,
  lpRef: lpRef,
  lpOut: lpOut,
  noticeEmails: noticeEmails,
  list: list,
  get: get,
  upsert: upsert,
  previewUpsert: previewUpsert,
  commitmentOut: commitmentOut,
  commitmentsList: commitmentsList,
  commitmentsSave: commitmentsSave,
  activeBlock: activeBlock,
  detailsOf: detailsOf,
  bankList: bankList,
  bankView: bankView,
  bankChange: bankChange,
  bankApprove: bankApprove,
  raiseBoard: raiseBoard,
  raiseAdd: raiseAdd,
  raiseMove: raiseMove,
  raiseSoft: raiseSoft,
  lpqLog: lpqLog,
  lpqCheck: lpqCheck,
  lpqList: lpqList,
};
