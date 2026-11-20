/// <reference path="../pb_data/types.d.ts" />
/**
 * Tax profiles and tax declarations (payroll-core).
 *
 *   Tax profile: the employee and payroll edit the pack profile_fields (W-4,
 *   扶養控除等申告書 data, CPF residency, Indian regime, Malaysian TP1, UK tax
 *   code, AU TFN declaration) through a form built from the field
 *   definitions, effective dated in the kernel's tax_profiles. Payroll writes
 *   directly; a person's own change is a tax_declarations row of kind
 *   'profile' that payroll approves (approval kind tax_declaration) when the
 *   entity's settings say the fields need it.
 *
 *   Declarations (India first): investment declarations and proofs (80C,
 *   80CCD(1B), 80D, HRA, LTA, 24(b), 80E, 80G, 80TTA) and the regime choice;
 *   on approval they become the `in` pack's profile fields from that day.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/** Indian Chapter VI-A and exemption sections, mapped to the `in` pack's profile fields (cap: the statutory limit the pack expects us to apply). */
const SECTIONS = {
  IN: [
    { section: '80C', label: 'Section 80C (PPF, ELSS, life insurance, tuition fees, home loan principal, NSC, 5-year deposits)', field: 'in_80c_annual', cap: null, note: 'The pack adds employee PF and caps the total at 1,50,000.' },
    { section: '80CCD1B', label: 'NPS, section 80CCD(1B)', field: 'in_80ccd1b_annual', cap: 50000 },
    { section: '80D', label: 'Health insurance, section 80D (self, family and parents)', field: 'in_80d_annual', cap: 100000 },
    { section: 'HRA', label: 'Rent paid (house rent allowance)', field: 'in_rent_paid_annual', cap: null },
    { section: 'LTA', label: 'Leave travel allowance claimed', field: 'in_other_exemptions_annual', cap: null },
    { section: '24B', label: 'Home loan interest, self-occupied, section 24(b)', field: 'in_home_loan_interest_annual', cap: 200000 },
    { section: '80E', label: 'Education loan interest, section 80E', field: 'in_other_deductions_annual', cap: null },
    { section: '80G', label: 'Donations, section 80G (the allowed amount)', field: 'in_other_deductions_annual', cap: null },
    { section: '80TTA', label: 'Savings account interest, section 80TTA', field: 'in_other_deductions_annual', cap: 10000 },
    { section: 'PREV', label: 'Salary from a previous employer this year (Form 12B)', field: 'in_prev_employer_salary', cap: null },
    { section: 'PREV_TDS', label: 'TDS by a previous employer this year (Form 12B)', field: 'in_prev_employer_tds', cap: null },
  ],
};
const REGIMES = { IN: [{ value: 'new', label: 'New regime' }, { value: 'old', label: 'Old regime' }] };

function people() {
  return L('lib_people');
}

/** Who the caller is for this employment's tax data: 'payroll' (payroll edit in scope), 'self', 'view' or 'none'. */
function standing(ctx, m) {
  const auth = L('lib_auth');
  if (ctx.isAgent) return 'payroll';
  if (auth.can(ctx, 'payroll', 'edit') && auth.inScope(ctx, m.getString('entity'))) return 'payroll';
  if (auth.selfEmployee(ctx) === m.getString('employee')) return 'self';
  if (people().canSeePay(ctx, m)) return 'view';
  return 'none';
}

function fiscalYearOf(country, day) {
  const y = Number(day.slice(0, 4));
  if (country === 'IN') {
    const start = day.slice(5) >= '04-01' ? y : y - 1;
    return start + '-' + String((start + 1) % 100).padStart(2, '0');
  }
  return String(y);
}

function packsOf(app, m, taxRec) {
  const util = u();
  const ent = app.findRecordById('entities', m.getString('entity'));
  const own = taxRec ? util.jsonOf(taxRec, 'packs', []) || [] : [];
  return own.length > 0 ? own : util.jsonOf(ent, 'packs', []) || [];
}

/* --------------------------------------------------------- tax profile */

/** taxprofile.get: the tax profile form of an employment: field definitions, values in effect, history and requests. */
function profileGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const m = people().employmentRef(app, util.req(p, 'employment'));
  const who = standing(ctx, m);
  if (who === 'none') throw util.fail(403, 'You cannot see the tax profile of this person.', 'not_permitted');
  const ent = app.findRecordById('entities', m.getString('entity'));
  const today = util.today(app, ent.id);
  const day = util.day(p, 'as_of', today < m.getString('start_day') ? m.getString('start_day') : today);
  const rec = people().rowOn(app, 'tax_profiles', m.id, day);
  const codes = packsOf(app, m, rec);
  const defs = pr.fieldsOf(app, codes, 'employee', day);
  const values = rec ? util.jsonOf(rec, 'fields', {}) || {} : {};
  const missing = defs.filter((d) => d.required && (values[d.key] === undefined || values[d.key] === null || values[d.key] === '') && (d.default === null || d.default === undefined)).map((d) => d.key);
  const st = pr.settingsView(app, pr.ensureSettings(app, ent), ent);
  const history = util.findMany(app, 'tax_profiles', 'employment = {:e}', 'effective_from', 0, { e: m.id }).map((r, i, arr) => {
    const v = people().taxView(r);
    const next = arr[i + 1];
    v.state = r.getString('effective_from') > today ? 'scheduled' : next && next.getString('effective_from') <= today ? 'past' : 'current';
    return v;
  });
  const requests = util.findMany(app, 'tax_declarations', "employment = {:e} && kind = 'profile'", '-created', 50, { e: m.id }).map((r) => declarationView(app, r));
  return {
    employment: m.id,
    employee_name: people().displayName(app.findRecordById('employees', m.getString('employee'))),
    entity: ent.id,
    country: ent.getString('country'),
    as_of: day,
    record: rec ? people().taxView(rec) : null,
    packs: codes,
    fields: defs,
    values: values,
    missing: missing,
    history: history,
    requests: requests,
    approval_fields: st.tax_approval_fields,
    can: { edit: who === 'payroll', submit: who === 'self' || who === 'payroll', packs: who === 'payroll' && !ctx.isAgent },
  };
}

/** Write fields into the tax profile from a day: a new row (history kept) or the row of that day merged. */
function writeProfile(ctx, app, m, day, fields, packs, note) {
  const util = u();
  const pr = L('lib_payroll');
  const existing = util.findOne(app, 'tax_profiles', 'employment = {:e} && effective_from = {:d}', { e: m.id, d: day });
  const prev = existing || people().rowOn(app, 'tax_profiles', m.id, day);
  const merged = Object.assign({}, prev ? util.jsonOf(prev, 'fields', {}) || {} : {});
  for (const k of Object.keys(fields)) {
    if (fields[k] === null) delete merged[k];
    else merged[k] = fields[k];
  }
  const ent = app.findRecordById('entities', m.getString('entity'));
  const codes = packs || (prev ? util.jsonOf(prev, 'packs', []) || [] : util.jsonOf(ent, 'packs', []) || []);
  if (existing !== null) {
    const block = pr.onRecordEditing(ctx, { collection: 'tax_profiles', id: existing.id, employment: m.id, effective_from: day });
    if (block && block.block) throw util.fail(409, block.block + ' Make the change from a later day.', 'locked');
    existing.set('fields', merged);
    existing.set('packs', codes);
    if (note) existing.set('note', util.clip(note, 2000));
    app.save(existing);
    return existing;
  }
  return people().writeTax(app, m.id, day, ent.getString('country'), codes, merged, note || '');
}

/** taxprofile.submit: change tax profile fields from a day. Payroll writes at once; a person's own change goes to payroll for approval when the fields need it. */
function profileSubmit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = L('lib_payroll');
  const m = people().employmentRef(app, util.req(p, 'employment'));
  const who = standing(ctx, m);
  if (who !== 'payroll' && who !== 'self') throw util.fail(403, 'Only the person or payroll can change a tax profile.', 'not_permitted');
  const ent = app.findRecordById('entities', m.getString('entity'));
  const today = util.today(app, ent.id);
  const day = util.day(p, 'effective_from', today < m.getString('start_day') ? m.getString('start_day') : today);
  if (day < m.getString('start_day')) throw util.fail(400, 'effective_from is before the employment starts.', 'invalid_param');
  const rec = people().rowOn(app, 'tax_profiles', m.id, day);
  let packs = null;
  if (util.has(p, 'packs')) {
    if (who !== 'payroll' || ctx.isAgent) throw util.fail(403, 'Only payroll chooses which packs apply.', 'not_permitted');
    packs = (util.list(p, 'packs') || []).map(String);
    for (const c of packs) if (util.findOne(app, 'rule_packs', 'code = {:c}', { c: c }) === null) throw util.fail(400, 'Unknown pack ' + c + '.', 'invalid_param');
  }
  const codes = packs || packsOf(app, m, rec);
  const defs = pr.fieldsOf(app, codes, 'employee', day);
  const fields = pr.cleanFields(defs, util.obj(p, 'fields') || {}, true);
  if (Object.keys(fields).length === 0 && packs === null) throw util.fail(400, 'fields is required, e.g. --fields \'{"us_filing_status":"single"}\'', 'missing_param', { param: 'fields' });
  const note = util.text(p, 'note', 2000, '');
  const before = rec ? util.jsonOf(rec, 'fields', {}) || {} : {};
  const changed = Object.keys(fields).filter((k) => JSON.stringify(before[k] === undefined ? null : before[k]) !== JSON.stringify(fields[k]));
  if (who === 'payroll') {
    let out = null;
    app.runInTransaction((tx) => {
      out = writeProfile(ctx, tx, m, day, fields, packs, note);
    });
    L('lib_payroll_runs').staleFor(app, ctx, m.id, 'Tax profile changed.');
    L('lib_audit').note(ctx, { collection: 'tax_profiles', record: out.id, summary: 'Changed the tax profile of ' + people().displayName(app.findRecordById('employees', m.getString('employee'))) + ' from ' + day + ' (' + changed.join(', ') + ')', before: before, after: util.jsonOf(out, 'fields', {}) });
    L('lib_events').emit(ctx, 'employment.changed', { employment: m.id, kind: 'tax', record: out.id, effective_from: day });
    return { applied: true, record: people().taxView(out) };
  }
  const st = pr.settingsView(app, pr.ensureSettings(app, ent), ent);
  const rule = st.tax_approval_fields || ['*'];
  const needs = rule.indexOf('*') >= 0 ? changed.length > 0 : changed.some((k) => rule.indexOf(k) >= 0);
  if (!needs) {
    let out = null;
    app.runInTransaction((tx) => {
      out = writeProfile(ctx, tx, m, day, fields, null, note);
    });
    L('lib_payroll_runs').staleFor(app, ctx, m.id, 'Tax profile changed.');
    L('lib_audit').note(ctx, { collection: 'tax_profiles', record: out.id, summary: 'Changed my tax profile from ' + day, before: before, after: util.jsonOf(out, 'fields', {}) });
    L('lib_notify').toRole(app, 'payroll_admin', { kind: 'payroll', title: 'Tax profile changed by ' + people().displayName(app.findRecordById('employees', m.getString('employee'))), body: '', link: '#/payroll/tax/' + m.id });
    return { applied: true, record: people().taxView(out) };
  }
  let decl = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    decl = u().newRecord(tx, 'tax_declarations');
    decl.set('employment', m.id);
    decl.set('kind', 'profile');
    decl.set('fiscal_year', fiscalYearOf(ent.getString('country'), day));
    decl.set('country', ent.getString('country'));
    decl.set('effective_from', day);
    decl.set('fields', fields);
    decl.set('items', []);
    decl.set('proofs', []);
    decl.set('packs', codes);
    decl.set('status', 'submitted');
    decl.set('note', note);
    decl.set('submitted_at', util.nowIso());
    decl.set('created_by', ctx.memberId);
    tx.save(decl);
    approval = L('lib_approvals').open(t, {
      kind: 'tax_declaration',
      ref_collection: 'tax_declarations',
      ref_id: decl.id,
      employment: m.id,
      summary: 'Tax profile change from ' + day + ' (' + changed.length + ' field' + (changed.length === 1 ? '' : 's') + ')',
      facts: [{ type: 'state', key: 'kind', label: 'Change', value: 'profile' }, { type: 'day', key: 'effective_from', label: 'From', value: day }, { type: 'number', key: 'fields', label: 'Fields changed', value: changed.length, unit: changed.length === 1 ? 'field' : 'fields' }, { type: 'text', key: 'fiscal_year', label: 'Fiscal year', value: decl.getString('fiscal_year') }],
      payload: { kind: 'profile', effective_from: day, changes: changed.map((k) => ({ key: k, label: (defs.filter((d) => d.key === k)[0] || { label: k }).label, before: before[k] === undefined ? null : before[k], after: fields[k] })) },
    });
    const d2 = tx.findRecordById('tax_declarations', decl.id);
    if (d2.getString('status') === 'submitted') {
      d2.set('approval', approval.id);
      tx.save(d2);
    }
    L('lib_audit').write(t, { op: 'taxprofile.submit', collection: 'tax_declarations', record: decl.id, summary: 'Sent a tax profile change from ' + day + ' for approval' });
  });
  ctx.audited = true;
  return { applied: false, request: declarationView(app, app.findRecordById('tax_declarations', decl.id)), approval: approval };
}

/* -------------------------------------------------------- declarations */

function declarationView(app, r) {
  const util = u();
  const m = util.byId(app, 'employments', r.getString('employment'));
  return {
    id: r.id,
    employment: r.getString('employment'),
    employee_name: m ? people().displayName(app.findRecordById('employees', m.getString('employee'))) : '',
    kind: r.getString('kind'),
    fiscal_year: r.getString('fiscal_year'),
    country: r.getString('country'),
    regime: r.getString('regime'),
    items: util.jsonOf(r, 'items', []) || [],
    proofs: util.jsonOf(r, 'proofs', []) || [],
    effective_from: r.getString('effective_from'),
    fields: util.jsonOf(r, 'fields', {}) || {},
    status: r.getString('status'),
    approval: r.getString('approval'),
    note: r.getString('note'),
    decided_note: r.getString('decided_note'),
    submitted_at: r.getString('submitted_at'),
    decided_at: r.getString('decided_at'),
    tax_profile: r.getString('tax_profile'),
    total_minor: (util.jsonOf(r, 'items', []) || []).reduce((a, x) => a + (Number(x.amount_minor) || 0), 0),
    created: r.getString('created'),
  };
}

function declRef(ctx, ref) {
  const util = u();
  const r = util.byId(ctx.app, 'tax_declarations', String(ref || ''));
  if (r === null) throw util.fail(404, 'No declaration ' + ref + '. Run declarations.list.', 'not_found');
  const m = ctx.app.findRecordById('employments', r.getString('employment'));
  return { rec: r, m: m, who: standing(ctx, m) };
}

/** declarations.types: the sections a country declares and its regimes. */
function types(ctx, p) {
  const util = u();
  let country = util.str(p, 'country', '').toUpperCase();
  if (country === '' && util.str(p, 'employment', '') !== '') {
    const m = people().employmentRef(ctx.app, util.str(p, 'employment', ''));
    country = ctx.app.findRecordById('entities', m.getString('entity')).getString('country');
  }
  return { country: country, sections: SECTIONS[country] || [], regimes: REGIMES[country] || [], fiscal_year: country !== '' ? fiscalYearOf(country, util.today(ctx.app)) : '' };
}

function declarationsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const er = util.str(p, 'employment', '');
  const kind = util.oneOf(p, 'kind', ['investment', 'profile', 'all'], 'investment');
  const kindWhere = kind === 'all' ? '' : ' && kind = {:k}';
  let rows;
  if (er !== '') {
    const m = people().employmentRef(app, er);
    if (standing(ctx, m) === 'none') throw util.fail(403, 'You cannot see these declarations.', 'not_permitted');
    rows = util.findMany(app, 'tax_declarations', 'employment = {:e}' + kindWhere, '-created', 200, { e: m.id, k: kind });
  } else if (ctx.isAgent || auth.can(ctx, 'payroll', 'view')) {
    const st = util.str(p, 'status', '');
    rows = util.findMany(app, 'tax_declarations', (st !== '' ? 'status = {:s}' : '1=1') + kindWhere, '-created', 1000, { s: st, k: kind }).filter((r) => {
      const m = util.byId(app, 'employments', r.getString('employment'));
      return m !== null && auth.inScope(ctx, m.getString('entity'));
    });
  } else {
    const self = auth.selfEmployee(ctx);
    rows = self === '' ? [] : util.rows(app, 'SELECT d.id AS id FROM tax_declarations d JOIN employments m ON m.id = d.employment WHERE m.employee = {:e}' + (kind === 'all' ? '' : ' AND d.kind = {:k}') + ' ORDER BY d.created DESC', { id: '' }, { e: self, k: kind }).map((x) => app.findRecordById('tax_declarations', x.id));
  }
  return { declarations: rows.map((r) => declarationView(app, r)) };
}

function declarationsGet(ctx, p) {
  const x = declRef(ctx, u().req(p, 'declaration'));
  if (x.who === 'none') throw u().fail(403, 'You cannot see this declaration.', 'not_permitted');
  const v = declarationView(ctx.app, x.rec);
  v.sections = SECTIONS[v.country] || [];
  v.regimes = REGIMES[v.country] || [];
  v.can = { edit: (x.who === 'self' || x.who === 'payroll') && (v.status === 'draft' || v.status === 'rejected'), submit: (x.who === 'self' || x.who === 'payroll') && (v.status === 'draft' || v.status === 'rejected') && !ctx.isAgent };
  return { declaration: v };
}

/** declarations.save: create or change a draft investment declaration (items by section, regime). */
function declarationsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  let rec;
  let m;
  const id = util.str(p, 'declaration', '');
  if (id !== '') {
    const x = declRef(ctx, id);
    if (x.who !== 'self' && x.who !== 'payroll') throw util.fail(403, 'Only the person or payroll can change this declaration.', 'not_permitted');
    if (['draft', 'rejected'].indexOf(x.rec.getString('status')) < 0) throw util.fail(409, 'A ' + x.rec.getString('status') + ' declaration cannot change. Start a new one.', 'conflict');
    rec = x.rec;
    m = x.m;
  } else {
    m = people().employmentRef(app, util.req(p, 'employment'));
    const who = standing(ctx, m);
    if (who !== 'self' && who !== 'payroll') throw util.fail(403, 'Only the person or payroll can declare.', 'not_permitted');
    const ent = app.findRecordById('entities', m.getString('entity'));
    rec = util.newRecord(app, 'tax_declarations');
    rec.set('employment', m.id);
    rec.set('kind', 'investment');
    rec.set('country', ent.getString('country'));
    rec.set('fiscal_year', util.str(p, 'fiscal_year', '') || fiscalYearOf(ent.getString('country'), util.today(app, ent.id)));
    rec.set('status', 'draft');
    rec.set('items', []);
    rec.set('proofs', []);
    rec.set('fields', {});
    rec.set('packs', []);
    rec.set('created_by', ctx.memberId);
  }
  const country = rec.getString('country');
  const cur = app.findRecordById('entities', m.getString('entity')).getString('currency');
  const secs = SECTIONS[country] || [];
  if (util.has(p, 'regime')) {
    const regs = (REGIMES[country] || []).map((x) => x.value);
    rec.set('regime', util.oneOf(p, 'regime', regs, ''));
  }
  if (util.has(p, 'items')) {
    const raw = util.list(p, 'items') || [];
    const items = raw.map((it, i) => {
      util.keysOnly(it, ['section', 'amount', 'description', 'metro', 'landlord_pan'], 'items[' + i + ']');
      const sec = secs.filter((s) => s.section === String(it.section || ''))[0];
      if (!sec) throw util.fail(400, 'items[' + i + '].section is one of: ' + secs.map((s) => s.section).join(', '), 'invalid_param');
      const amt = L('lib_money').toMinor(String(it.amount === undefined ? '' : it.amount), cur, false);
      if (amt === null || amt < 0) throw util.fail(400, 'items[' + i + '].amount is a ' + cur + ' amount, e.g. 150000.00', 'invalid_param');
      return { section: sec.section, amount_minor: amt, description: util.clip(String(it.description || ''), 300), metro: it.metro === true || it.metro === 'true', landlord_pan: util.clip(String(it.landlord_pan || ''), 20) };
    });
    rec.set('items', items);
  }
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  if (rec.getString('status') === 'rejected') rec.set('status', 'draft');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'tax_declarations', record: rec.id, summary: (id === '' ? 'Started' : 'Changed') + ' the tax declaration ' + rec.getString('fiscal_year') });
  return declarationsGet(ctx, { declaration: rec.id });
}

/** declarations.proof: attach a proof file (receipt, certificate, rent receipt) to a declaration section. */
function proofAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = declRef(ctx, util.req(p, 'declaration'));
  if (x.who !== 'self' && x.who !== 'payroll') throw util.fail(403, 'Only the person or payroll adds proofs.', 'not_permitted');
  if (['draft', 'rejected', 'submitted'].indexOf(x.rec.getString('status')) < 0) throw util.fail(409, 'This declaration is ' + x.rec.getString('status') + '.', 'conflict');
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f === null) throw util.fail(400, 'Upload the proof file (or your AI agent gives --path).', 'missing_param', { param: 'file' });
  const section = util.str(p, 'section', '');
  const before = x.rec.getStringSlice('files');
  x.rec.set('files+', f);
  app.save(x.rec);
  const after = app.findRecordById('tax_declarations', x.rec.id);
  const names = after.getStringSlice('files');
  const added = names.filter((n) => before.indexOf(n) < 0)[0] || names[names.length - 1];
  const proofs = util.jsonOf(after, 'proofs', []) || [];
  proofs.push({ file: added, section: section, name: util.clip(util.str(p, 'name', '') || added, 200), uploaded_at: util.nowIso(), by: ctx.memberId });
  after.set('proofs', proofs);
  app.save(after);
  L('lib_audit').note(ctx, { collection: 'tax_declarations', record: after.id, summary: 'Added a proof to the tax declaration ' + after.getString('fiscal_year') + (section ? ' (' + section + ')' : '') });
  return declarationsGet(ctx, { declaration: after.id });
}

function proofFile(ctx, p) {
  const util = u();
  const x = declRef(ctx, util.req(p, 'declaration'));
  if (x.who === 'none') throw util.fail(403, 'You cannot see this declaration.', 'not_permitted');
  const name = util.req(p, 'file');
  if (x.rec.getStringSlice('files').indexOf(name) < 0) throw util.fail(404, 'No such proof.', 'not_found');
  // Serve one file of the multi-file field: point a view at it.
  const view = { getString: (k) => (k === 'files' ? name : x.rec.getString(k)), baseFilesPath: () => x.rec.baseFilesPath() };
  return L('lib_files').serve(ctx, view, 'files', name, util.bool(p, 'download', false));
}

/** declarations.submit: send a declaration to payroll for approval (approval kind tax_declaration). */
function declarationsSubmit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = declRef(ctx, util.req(p, 'declaration'));
  if (x.who !== 'self' && x.who !== 'payroll') throw util.fail(403, 'Only the person or payroll submits a declaration.', 'not_permitted');
  if (['draft', 'rejected'].indexOf(x.rec.getString('status')) < 0) throw util.fail(409, 'This declaration is ' + x.rec.getString('status') + '.', 'conflict');
  const v = declarationView(app, x.rec);
  if (v.items.length === 0 && v.regime === '') throw util.fail(400, 'Declare at least one section or choose a regime first.', 'empty');
  let approval = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('tax_declarations', x.rec.id);
    r.set('status', 'submitted');
    r.set('submitted_at', util.nowIso());
    tx.save(r);
    approval = L('lib_approvals').open(t, {
      kind: 'tax_declaration',
      ref_collection: 'tax_declarations',
      ref_id: r.id,
      employment: x.m.id,
      summary: 'Tax declaration ' + r.getString('fiscal_year') + (v.regime ? ' (' + v.regime + ' regime)' : ''),
      amount_minor: v.total_minor,
      currency: tx.findRecordById('entities', x.m.getString('entity')).getString('currency'),
      facts: [{ type: 'state', key: 'kind', label: 'Declaration', value: 'investment' }, { type: 'text', key: 'fiscal_year', label: 'Fiscal year', value: r.getString('fiscal_year') }]
        .concat(v.regime ? [{ type: 'state', key: 'regime', label: 'Regime', value: v.regime }] : [])
        .concat(v.total_minor > 0 ? [{ type: 'money', key: 'declared', label: 'Declared', amount_minor: v.total_minor, currency: tx.findRecordById('entities', x.m.getString('entity')).getString('currency') }] : []),
      payload: { kind: 'investment', fiscal_year: v.fiscal_year, regime: v.regime, items: v.items, proofs: v.proofs.length },
    });
    const r2 = tx.findRecordById('tax_declarations', r.id);
    if (r2.getString('status') === 'submitted') {
      r2.set('approval', approval.id);
      tx.save(r2);
    }
    L('lib_audit').write(t, { op: 'declarations.submit', collection: 'tax_declarations', record: r.id, summary: 'Submitted the tax declaration ' + r.getString('fiscal_year') });
  });
  ctx.audited = true;
  return { declaration: declarationView(app, app.findRecordById('tax_declarations', x.rec.id)), approval: approval };
}

/** The pack profile fields an approved investment declaration sets. */
function fieldsFromItems(country, cur, items, regime) {
  const money = L('lib_money');
  const out = {};
  const secs = SECTIONS[country] || [];
  const sums = {};
  let metro = null;
  for (const it of items) {
    const sec = secs.filter((s) => s.section === it.section)[0];
    if (!sec) continue;
    sums[sec.section] = (sums[sec.section] || 0) + (Number(it.amount_minor) || 0);
    if (sec.section === 'HRA') metro = it.metro === true;
  }
  const byField = {};
  for (const sec of secs) {
    if (sums[sec.section] === undefined) continue;
    let v = money.toMajor(sums[sec.section], cur);
    if (sec.cap !== null && v > sec.cap) v = sec.cap;
    byField[sec.field] = (byField[sec.field] || 0) + v;
  }
  for (const k of Object.keys(byField)) out[k] = Math.round(byField[k] * 100) / 100;
  if (metro !== null) out.in_metro = metro;
  if (regime) out.in_regime = regime;
  return out;
}

/** Approval subscriber (kind tax_declaration): approved -> the tax profile fields from the day. */
function onDeclarationDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'tax_declarations', approval.ref_id);
  if (rec === null) return;
  rec.set('decided_at', util.nowIso());
  rec.set('decided_note', util.clip(note || '', 2000));
  if (decision !== 'approved') {
    rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
    app.save(rec);
    return;
  }
  const m = app.findRecordById('employments', rec.getString('employment'));
  const ent = app.findRecordById('entities', m.getString('entity'));
  let fields;
  let day;
  if (rec.getString('kind') === 'profile') {
    fields = util.jsonOf(rec, 'fields', {}) || {};
    day = rec.getString('effective_from') || util.today(app, ent.id);
  } else {
    fields = fieldsFromItems(rec.getString('country'), ent.getString('currency'), util.jsonOf(rec, 'items', []) || [], rec.getString('regime'));
    day = util.today(app, ent.id);
    if (day < m.getString('start_day')) day = m.getString('start_day');
  }
  const prof = writeProfile(ctx, app, m, day, fields, null, 'From the ' + (rec.getString('kind') === 'profile' ? 'tax profile change' : 'tax declaration ' + rec.getString('fiscal_year')) + ' approved');
  rec.set('status', 'approved');
  rec.set('tax_profile', prof.id);
  app.save(rec);
  L('lib_payroll_runs').staleFor(app, ctx, m.id, 'Tax profile changed.');
  L('lib_events').emit(ctx, 'employment.changed', { employment: m.id, kind: 'tax', record: prof.id, effective_from: day });
}

/* ----------------------------------------------- personal fields payroll needs */

/**
 * The personal fields rule packs read from the person record (the birth date
 * for age bands, nationality and gender). Payroll may fill these itself
 * (payroll.person-set); every other personal field stays with HR.
 */
const PERSON_FIELDS = ['birth_date', 'nationality', 'gender'];

/**
 * payroll.person-set: payroll sets only the personal fields packs need, for a
 * person in its payroll scope (payroll:edit); audited, and the person's open
 * runs calculate again.
 */
function personSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const emp = people.employeeRef(app, util.req(p, 'employee'));
  const ems = util.findMany(app, 'employments', 'employee = {:e}', '-start_day', 0, { e: emp.id });
  if (!ems.some((m) => L('lib_payroll').canPayroll(ctx, 'edit', m.getString('entity')))) throw util.fail(403, 'You do not run payroll for ' + people.displayName(emp) + '.', 'not_permitted');
  const q = {};
  for (const k of Object.keys(p)) {
    if (k === 'employee' || k === 'why' || k === 'confirm') continue;
    if (PERSON_FIELDS.indexOf(k) < 0) throw util.fail(403, 'Payroll sets only the birth date, nationality and gender. Ask HR for other details (payruns.ask-fix).', 'not_permitted', { param: k, fields: PERSON_FIELDS });
    q[k] = p[k];
  }
  if (Object.keys(q).length === 0) throw util.fail(400, 'Give a birth date, nationality or gender.', 'missing_param', { param: 'birth_date' });
  if (q.birth_date !== undefined && String(q.birth_date) !== '') {
    const d = util.day(q, 'birth_date', '');
    if (d > util.today(app)) throw util.fail(400, 'A birth date cannot be in the future.', 'invalid_param', { param: 'birth_date' });
  }
  const before = {};
  for (const k of Object.keys(q)) before[k] = emp.getString(k);
  people.personFields(ctx, emp, q, PERSON_FIELDS);
  app.save(emp);
  const after = {};
  for (const k of Object.keys(q)) after[k] = emp.getString(k);
  for (const m of ems) L('lib_payroll_runs').staleFor(app, ctx, m.id, 'Personal details changed.', '');
  L('lib_audit').note(ctx, { collection: 'employees', record: emp.id, summary: 'Payroll set ' + Object.keys(q).map((k) => k.replace(/_/g, ' ')).join(', ') + ' of ' + people.displayName(emp), before: before, after: after });
  L('lib_events').emit(ctx, 'employee.updated', { employee: emp.id, fields: Object.keys(q) });
  return { employee: { id: emp.id, number: emp.getString('number'), name: people.displayName(emp), birth_date: emp.getString('birth_date'), nationality: emp.getString('nationality'), gender: emp.getString('gender') } };
}

module.exports = {
  SECTIONS: SECTIONS,
  PERSON_FIELDS: PERSON_FIELDS,
  personSet: personSet,
  REGIMES: REGIMES,
  standing: standing,
  fiscalYearOf: fiscalYearOf,
  profileGet: profileGet,
  profileSubmit: profileSubmit,
  writeProfile: writeProfile,
  declarationView: declarationView,
  types: types,
  declarationsList: declarationsList,
  declarationsGet: declarationsGet,
  declarationsSave: declarationsSave,
  proofAdd: proofAdd,
  proofFile: proofFile,
  declarationsSubmit: declarationsSubmit,
  fieldsFromItems: fieldsFromItems,
  onDeclarationDecision: onDeclarationDecision,
};
