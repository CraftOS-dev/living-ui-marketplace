/// <reference path="../pb_data/types.d.ts" />
/**
 * Letters: templates by kind (offer, appointment, confirmation, experience,
 * salary certificate, warning, relieving, custom) in markdown with
 * {{placeholders}}, drafts for a person, and issued letters.
 *
 * A placeholder is one of PLACEHOLDERS or letter.<key> (a value given with
 * the draft, e.g. {{letter.purpose}}). Values come from the records in
 * effect on the letter day; days are written in the entity's format; pay
 * placeholders fill only for someone who may see that person's pay.
 * Issuing freezes the text, stores it as a document of the person (source
 * letter, a plain-text copy as the file) and tells them; the person
 * acknowledges it (the document's acknowledgement is the one record of it).
 * Your AI agent drafts (a proposal unless the owner set people changes to
 * automatic) and never issues.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lc() {
  return L('lib_lifecycle');
}

const KINDS = ['offer', 'appointment', 'confirmation', 'experience', 'salary_certificate', 'warning', 'relieving', 'custom'];
const KIND_LABEL = { offer: 'Offer', appointment: 'Appointment', confirmation: 'Confirmation', experience: 'Experience', salary_certificate: 'Salary certificate', warning: 'Warning', relieving: 'Relieving', custom: 'Custom' };

const PLACEHOLDERS = [
  { key: 'employee.name', label: 'Name' },
  { key: 'employee.legal_name', label: 'Legal name' },
  { key: 'employee.given_name', label: 'Given name' },
  { key: 'employee.family_name', label: 'Family name' },
  { key: 'employee.number', label: 'Employee number' },
  { key: 'job.title', label: 'Job title' },
  { key: 'job.department', label: 'Department' },
  { key: 'job.location', label: 'Location' },
  { key: 'job.manager', label: 'Manager' },
  { key: 'employment.start_day', label: 'First day' },
  { key: 'employment.end_day', label: 'Last day of employment' },
  { key: 'employment.probation_end', label: 'Probation end' },
  { key: 'employment.number', label: 'Employment number' },
  { key: 'pay.amount', label: 'Pay', pay: true },
  { key: 'pay.per', label: 'Pay period (month, year, hour)', pay: true },
  { key: 'pay.basis', label: 'Pay basis', pay: true },
  { key: 'entity.name', label: 'Entity' },
  { key: 'entity.legal_name', label: 'Legal name of the entity' },
  { key: 'entity.address', label: 'Entity address', optional: true },
  { key: 'company.name', label: 'Company' },
  { key: 'separation.last_day', label: 'Last day (separation)' },
  { key: 'separation.notice_day', label: 'Notice given on' },
  { key: 'separation.kind', label: 'Kind of separation' },
  { key: 'separation.reason_label', label: 'Reason for leaving' },
  { key: 'signer.name', label: 'Signed by', signer: true },
  { key: 'signer.title', label: 'Title of the signer', signer: true, optional: true },
  { key: 'letter.date', label: 'Letter date' },
  { key: 'letter.number', label: 'Letter number' },
];
const KNOWN = {};
for (const x of PLACEHOLDERS) KNOWN[x.key] = x;

const SEPARATION_LABEL = {
  en: { resignation: 'Resignation', termination: 'Termination by the employer', retirement: 'Retirement', end_of_contract: 'End of contract', death: 'Death', other: 'Other' },
  ja: { resignation: '自己都合による退職', termination: '解雇', retirement: '定年退職', end_of_contract: '契約期間満了', death: '死亡', other: 'その他' },
};

const TOKEN = /\{\{\s*([a-z_]+\.[a-z0-9_]+)\s*\}\}/g;

/** The placeholder keys a body uses, in order of first use. */
function placeholders(body) {
  const out = [];
  const re = new RegExp(TOKEN.source, 'g');
  let m;
  while ((m = re.exec(String(body || ''))) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

/** Refuse unknown placeholders (letter.<key> is always allowed). */
function checkBody(body) {
  const util = u();
  for (const k of placeholders(body)) {
    if (KNOWN[k] || /^letter\.[a-z0-9_]+$/.test(k)) continue;
    const near = util.nearest(k, Object.keys(KNOWN));
    throw util.fail(400, 'Unknown placeholder {{' + k + '}}' + (near !== '' ? ' (did you mean {{' + near + '}}?)' : '') + '. Use one of the listed placeholders, or {{letter.<word>}} for a value you give with the letter.', 'unknown_placeholder', { placeholder: k });
  }
}

/** The custom values a body asks for: letter.<key> other than date and number. */
function customKeys(body) {
  return placeholders(body)
    .filter((k) => k.indexOf('letter.') === 0 && k !== 'letter.date' && k !== 'letter.number')
    .map((k) => k.slice(7));
}

/* ------------------------------------------------------------ templates */

function templateView(app, r) {
  return {
    id: r.id,
    kind: r.getString('kind'),
    kind_label: KIND_LABEL[r.getString('kind')] || r.getString('kind'),
    name: r.getString('name'),
    country: r.getString('country'),
    entity: r.getString('entity'),
    entity_name: lc().entityName(app, r.getString('entity')),
    language: r.getString('language') || 'en',
    description: r.getString('description'),
    body: r.getString('body'),
    placeholders: placeholders(r.getString('body')),
    custom: customKeys(r.getString('body')),
    uses_pay: placeholders(r.getString('body')).some((k) => KNOWN[k] && KNOWN[k].pay),
    needs_ack: r.getBool('needs_ack'),
    builtin: r.getBool('builtin'),
    archived: r.getBool('archived'),
    used: u().count(app, 'SELECT COUNT(*) AS n FROM letters WHERE template = {:t}', { t: r.id }),
    updated: r.getString('updated'),
  };
}

function templateRef(app, ref) {
  return u().byIdOrName(app, 'letter_templates', ref, 'name', 'letter-templates.list');
}

function templatesList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const country = util.str(p, 'country', '').toUpperCase();
  if (country !== '') {
    where.push("(country = {:c} || country = '')");
    bind.c = country;
  }
  if (!util.bool(p, 'archived', false)) where.push('archived = false');
  const rows = util.findMany(app, 'letter_templates', where.length > 0 ? where.join(' && ') : '1=1', 'kind,name', 500, bind).filter((r) => r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')));
  return { templates: rows.map((r) => templateView(app, r)), placeholders: PLACEHOLDERS, kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) };
}

function templatesGet(ctx, p) {
  return { template: templateView(ctx.app, templateRef(ctx.app, u().req(p, 'template'))), placeholders: PLACEHOLDERS };
}

function templatesSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'template', '');
  const rec = ref !== '' ? templateRef(app, ref) : util.newRecord(app, 'letter_templates');
  const before = ref !== '' ? templateView(app, rec) : null;
  if (ref === '' || util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, ref === '' ? 'custom' : rec.getString('kind')));
  if (ref === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "Visa support letter"', 'missing_param', { param: 'name' });
    rec.set('name', n);
  }
  if (util.has(p, 'country')) {
    const c = util.str(p, 'country', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{2}$/.test(c)) throw util.fail(400, 'country is a two-letter code (empty for every country).', 'invalid_param', { param: 'country' });
    rec.set('country', c);
  }
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  lc().needHr(ctx, rec.getString('entity'), 'edit', 'change letter templates');
  if (util.has(p, 'language')) rec.set('language', util.oneOf(p, 'language', ['en', 'ja'], 'en'));
  else if (ref === '') rec.set('language', 'en');
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 400, ''));
  if (ref === '' || util.has(p, 'body')) {
    const body = util.text(p, 'body', 30000, '');
    if (body.trim() === '') throw util.fail(400, 'body is required: the letter in markdown with {{placeholders}}.', 'missing_param', { param: 'body' });
    checkBody(body);
    rec.set('body', body);
  }
  if (util.has(p, 'needs_ack')) rec.set('needs_ack', util.bool(p, 'needs_ack', false));
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  if (ref === '') rec.set('builtin', false);
  app.save(rec);
  const after = templateView(app, rec);
  L('lib_audit').note(ctx, { collection: 'letter_templates', record: rec.id, summary: (ref === '' ? 'Added' : 'Changed') + ' the letter template ' + after.name, before: before, after: after });
  return { template: after };
}

function templatesDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = templateRef(app, util.req(p, 'template'));
  lc().needHr(ctx, r.getString('entity'), 'full', 'delete letter templates');
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM letters WHERE template = {:t}', { t: r.id });
  if (used > 0) throw util.fail(409, used + (used === 1 ? ' letter was' : ' letters were') + ' written from this template. Archive it instead (letter-templates.save --archived true).', 'in_use');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'letter_templates', record: r.id, summary: 'Deleted the letter template ' + r.getString('name') });
  return { deleted: true };
}

/* -------------------------------------------------------------- values */

function addressText(a) {
  if (!a || typeof a !== 'object') return '';
  return ['line1', 'line2', 'city', 'region', 'postcode']
    .map((k) => String(a[k] || '').trim())
    .filter((x) => x !== '')
    .join(', ');
}

/**
 * The values of every placeholder for a letter: o = { employee (record),
 * employment (record or null), day, values (custom), signer (member record
 * or null), number, language }. Returns { values, hidden: [keys] }.
 */
function valuesFor(ctx, o) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const e = o.employee;
  const m = o.employment;
  const day = o.day;
  const ent = m !== null ? app.findRecordById('entities', m.getString('entity')) : null;
  const v = {};
  v['employee.name'] = people.displayName(e);
  v['employee.legal_name'] = e.getString('legal_name');
  v['employee.given_name'] = e.getString('given_name');
  v['employee.family_name'] = e.getString('family_name');
  v['employee.number'] = e.getString('number');
  const hidden = [];
  if (m !== null) {
    const at = day < m.getString('start_day') ? m.getString('start_day') : m.getString('end_day') !== '' && day > m.getString('end_day') ? m.getString('end_day') : day;
    const job = people.rowOn(app, 'job_records', m.id, at);
    const name = (col, id) => {
      const r = util.byId(app, col, id || '');
      return r === null ? '' : col === 'employees' ? people.displayName(r) : r.getString('name');
    };
    v['job.title'] = job !== null ? job.getString('title') || name('job_titles', job.getString('job_title')) : '';
    v['job.department'] = job !== null ? name('departments', job.getString('department')) : '';
    v['job.location'] = job !== null ? name('locations', job.getString('location')) : '';
    v['job.manager'] = job !== null ? name('employees', job.getString('manager')) : '';
    v['employment.start_day'] = lc().dayIn(app, ent.id, m.getString('start_day'));
    v['employment.end_day'] = lc().dayIn(app, ent.id, m.getString('end_day'));
    v['employment.probation_end'] = lc().dayIn(app, ent.id, m.getString('probation_end'));
    v['employment.number'] = m.getString('number');
    if (people.canSeePay(ctx, m)) {
      const pay = people.rowOn(app, 'pay_records', m.id, at);
      v['pay.amount'] = pay !== null ? L('lib_money').format(pay.getInt('amount_minor'), pay.getString('currency')) : '';
      v['pay.per'] = pay !== null ? pay.getString('per') : '';
      v['pay.basis'] = pay !== null ? pay.getString('basis') : '';
    } else {
      for (const k of ['pay.amount', 'pay.per', 'pay.basis']) {
        v[k] = '';
        hidden.push(k);
      }
    }
    v['entity.name'] = ent.getString('name');
    v['entity.legal_name'] = ent.getString('legal_name') || ent.getString('name');
    v['entity.address'] = addressText(util.jsonOf(ent, 'address', {}));
    const sep = util.findMany(app, 'separations', "employment = {:m} && status != 'withdrawn' && status != 'rejected'", '-created', 1, { m: m.id })[0] || null;
    const labels = SEPARATION_LABEL[o.language === 'ja' ? 'ja' : 'en'];
    v['separation.last_day'] = sep !== null ? lc().dayIn(app, ent.id, sep.getString('last_day')) : '';
    v['separation.notice_day'] = sep !== null ? lc().dayIn(app, ent.id, sep.getString('notice_day')) : '';
    v['separation.kind'] = sep !== null ? labels[sep.getString('kind')] || sep.getString('kind') : '';
    v['separation.reason_label'] = v['separation.kind'];
  }
  v['company.name'] = L('lib_settings').row(app).getString('company_name');
  v['signer.name'] = o.signer ? o.signer.getString('name') : '';
  v['signer.title'] = o.signer ? o.signer.getString('title') : '';
  v['letter.date'] = ent !== null ? lc().dayIn(app, ent.id, day) : day;
  v['letter.number'] = o.number || '';
  const custom = o.values || {};
  for (const k of Object.keys(custom)) if (/^[a-z0-9_]+$/.test(k) && k !== 'date' && k !== 'number') v['letter.' + k] = String(custom[k] === undefined || custom[k] === null ? '' : custom[k]);
  return { values: v, hidden: hidden };
}

/**
 * Fill a body: { text, missing, hidden, at_issue }. A line that is only an
 * optional placeholder with no value is dropped; signer values not known
 * yet (a draft) are filled when a person issues the letter.
 */
function render(body, vals, signerKnown) {
  const v = vals.values;
  const missing = [];
  const atIssue = [];
  const lines = String(body || '').split('\n');
  const out = [];
  for (const line of lines) {
    const keys = placeholders(line);
    const only = keys.length === 1 && line.replace(TOKEN, '').trim() === '';
    let empty = false;
    const text = line.replace(new RegExp(TOKEN.source, 'g'), (all, k) => {
      const meta = KNOWN[k];
      let val = v[k];
      if (val === undefined) val = '';
      if (val === '') {
        if (meta && meta.signer && !signerKnown) {
          if (atIssue.indexOf(k) < 0) atIssue.push(k);
          return '[' + meta.label + ']';
        }
        if (vals.hidden.indexOf(k) >= 0) return '[hidden]';
        if (meta && meta.optional) {
          empty = true;
          return '';
        }
        if (missing.indexOf(k) < 0) missing.push(k);
        return '[' + (meta ? meta.label : k.slice(7).replace(/_/g, ' ')) + ']';
      }
      return val;
    });
    if (only && empty) continue;
    out.push(text);
  }
  return { text: out.join('\n'), missing: missing, hidden: vals.hidden.filter((k) => placeholders(body).indexOf(k) >= 0), at_issue: atIssue };
}

/** Markdown to plain text for the stored copy. */
function plain(md) {
  return String(md || '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\s+$/, ''),
    )
    .join('\r\n');
}

/* -------------------------------------------------------------- letters */

function letterRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'letters', r) || util.findOne(app, 'letters', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No letter ' + r + '. Run letters.list.', 'not_found');
  return rec;
}

function draftValues(r) {
  const f = u().jsonOf(r, 'fields', {}) || {};
  return f.values || {};
}

function letterView(app, r, full, ctx) {
  const util = u();
  const doc = util.byId(app, 'documents', r.getString('document'));
  const tpl = util.byId(app, 'letter_templates', r.getString('template'));
  const v = {
    id: r.id,
    number: r.getString('number'),
    employee: r.getString('employee'),
    employee_name: lc().employeeName(app, r.getString('employee')),
    employee_number: (util.byId(app, 'employees', r.getString('employee')) || { getString: () => '' }).getString('number'),
    employment: r.getString('employment'),
    entity: r.getString('entity'),
    entity_name: lc().entityName(app, r.getString('entity')),
    template: r.getString('template'),
    template_name: tpl !== null ? tpl.getString('name') : '',
    language: tpl !== null ? tpl.getString('language') || 'en' : 'en',
    kind: r.getString('kind'),
    kind_label: KIND_LABEL[r.getString('kind')] || r.getString('kind'),
    title: r.getString('title'),
    status: r.getString('status'),
    letter_day: r.getString('letter_day'),
    letter_day_shown: lc().dayIn(app, r.getString('entity'), r.getString('letter_day')),
    needs_ack: r.getBool('needs_ack'),
    acked_at: doc !== null ? doc.getString('acked_at') : '',
    document: doc !== null ? doc.id : '',
    issued_at: r.getString('issued_at'),
    issued_by_name: lc().memberName(app, r.getString('issued_by')),
    drafted_actor: r.getString('drafted_actor'),
    drafted_by_name: r.getString('drafted_actor') === 'agent' ? 'Your AI agent' : lc().memberName(app, r.getString('drafted_by')),
    void_reason: r.getString('void_reason'),
    note: r.getString('note'),
    values: draftValues(r),
    agent_drafting: r.getString('status') === 'draft' && L('lib_agent').isOpen(L('lib_agent').stateOf(r, 'letter_draft')),
    agent: L('lib_agent').view(r, 'letter_draft'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
  if (full && ctx) {
    if (r.getString('status') === 'draft') {
      const e = app.findRecordById('employees', r.getString('employee'));
      const m = util.byId(app, 'employments', r.getString('employment'));
      const signer = ctx.member !== null ? ctx.member : null;
      const vals = valuesFor(ctx, { employee: e, employment: m, day: r.getString('letter_day') || util.today(app, r.getString('entity')), values: draftValues(r), signer: signer, number: r.getString('number'), language: v.language });
      const out = render(r.getString('body'), vals, signer !== null);
      v.body = r.getString('body');
      v.rendered = out.text;
      v.missing = out.missing;
      v.hidden = out.hidden;
      v.at_issue = out.at_issue;
      v.custom = customKeys(r.getString('body'));
    } else {
      v.rendered = r.getString('issued_body');
      v.missing = [];
      v.hidden = [];
      v.at_issue = [];
      v.custom = [];
    }
    const ent = util.byId(app, 'entities', r.getString('entity'));
    v.print = ent === null ? null : { entity_name: ent.getString('name'), legal_name: ent.getString('legal_name') || ent.getString('name'), address: addressText(util.jsonOf(ent, 'address', {})), country: ent.getString('country') };
  }
  return v;
}

/** What the caller may do with a letter: 'hr' | 'own' (their issued letter) | ''. */
function seeLetter(ctx, r) {
  if (ctx.isAgent || ctx.actor === 'system') return 'hr';
  if (lc().hrCan(ctx, r.getString('entity'), 'view')) return 'hr';
  if (L('lib_auth').selfEmployee(ctx) === r.getString('employee') && r.getString('status') === 'issued') return 'own';
  return '';
}

function listLetters(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 300);
  const where = [];
  const bind = {};
  const hr = lc().hrCan(ctx, '', 'view');
  if (hr) where.push(lc().scopeSql(ctx, 'l', bind));
  else {
    where.push("l.employee = {:self} AND l.status = 'issued'");
    bind.self = ctx.employeeId || '-';
  }
  const status = util.oneOf(p, 'status', ['draft', 'issued', 'void', 'all'], 'all');
  if (status !== 'all') {
    where.push('l.status = {:st}');
    bind.st = status;
  } else if (hr) where.push("l.status != 'void'");
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('l.kind = {:k}');
    bind.k = kind;
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    where.push('l.employee = {:e}');
    bind.e = L('lib_people').employeeRef(app, empRef).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(l.title LIKE {:q} ESCAPE '\\' OR l.number LIKE {:q} ESCAPE '\\' OR e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const w = where.join(' AND ');
  const from = ' FROM letters l JOIN employees e ON e.id = l.employee WHERE ' + w;
  const total = util.count(app, 'SELECT COUNT(*) AS n' + from, bind);
  const rows = util.rows(app, "SELECT l.id AS id" + from + " ORDER BY l.status = 'draft' DESC, l.created DESC LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const counts = {};
  if (hr) {
    const b2 = {};
    for (const r of util.rows(app, 'SELECT l.status AS status, COUNT(*) AS n FROM letters l WHERE ' + lc().scopeSql(ctx, 'l', b2) + ' GROUP BY l.status', { status: '', n: 0 }, b2)) counts[r.status] = r.n;
  }
  return { letters: rows.map((r) => letterView(app, app.findRecordById('letters', r.id), false)), total: total, counts: counts, limit: pg.limit, offset: pg.offset };
}

function lettersGet(ctx, p) {
  const util = u();
  const r = letterRef(ctx.app, util.req(p, 'letter'));
  const see = seeLetter(ctx, r);
  if (see === '') throw util.fail(403, 'You cannot see this letter.', 'not_permitted');
  const v = letterView(ctx.app, r, true, ctx);
  v.can = { edit: see === 'hr' && !ctx.isAgent && r.getString('status') === 'draft' && lc().hrCan(ctx, r.getString('entity'), 'edit'), issue: see === 'hr' && !ctx.isAgent && r.getString('status') === 'draft' && lc().hrCan(ctx, r.getString('entity'), 'edit'), acknowledge: see === 'own' && v.needs_ack && v.acked_at === '' };
  return { letter: v, placeholders: see === 'hr' ? PLACEHOLDERS : [] };
}

function readValues(p) {
  const util = u();
  const raw = util.obj(p, 'values');
  if (raw === undefined) return undefined;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) throw util.fail(400, 'values keys are lower case words with _ (e.g. {"purpose":"a bank loan"}).', 'invalid_param', { param: 'values' });
    const s = String(raw[k] === undefined || raw[k] === null ? '' : raw[k]);
    if (s.length > 4000) throw util.fail(400, 'values.' + k + ' is too long.', 'invalid_param', { param: 'values' });
    out[k] = s;
  }
  return out;
}

/** The person and employment a letter is for. */
function subjectOf(app, p) {
  const util = u();
  const people = L('lib_people');
  const ref = util.str(p, 'employment', '') || util.req(p, 'employee', 'E0001');
  const m = people.employmentRef(app, ref);
  const e = app.findRecordById('employees', m.getString('employee'));
  return { m: m, e: e };
}

/** letters.preview: fill a template (or a body) for a person without saving. */
function lettersPreview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = subjectOf(app, p);
  lc().needHr(ctx, s.m.getString('entity'), 'view', 'see letters');
  const tplRef = util.str(p, 'template', '');
  const tpl = tplRef !== '' ? templateRef(app, tplRef) : null;
  const body = util.has(p, 'body') ? util.text(p, 'body', 30000, '') : tpl !== null ? tpl.getString('body') : '';
  checkBody(body);
  const day = util.day(p, 'letter_day', util.today(app, s.m.getString('entity')));
  const vals = valuesFor(ctx, { employee: s.e, employment: s.m, day: day, values: readValues(p) || {}, signer: ctx.member, number: '', language: tpl !== null ? tpl.getString('language') : 'en' });
  const out = render(body, vals, ctx.member !== null);
  return { rendered: out.text, missing: out.missing, hidden: out.hidden, at_issue: out.at_issue, custom: customKeys(body) };
}

/**
 * The template a draft uses: --template; else, without your own --body, the
 * --kind's template for the person's entity, then its country, then the
 * whole company (a built-in one first). Refuses (400, listing what exists)
 * when the kind has none there, and when nothing would give the letter text.
 */
function draftTemplate(app, p, m) {
  const util = u();
  const ref = util.str(p, 'template', '');
  if (ref !== '') return templateRef(app, ref);
  if (util.str(p, 'body', '') !== '') return null;
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind === '' || kind === 'custom') throw util.fail(400, 'Give --template, a --kind with a template (letter-templates.list --kind), or your own --body.', 'missing_param', { param: 'template' });
  const ent = app.findRecordById('entities', m.getString('entity'));
  const country = ent.getString('country');
  const rows = util.findMany(app, 'letter_templates', "kind = {:k} && archived = false && (entity = {:e} || (entity = '' && (country = {:c} || country = '')))", '', 200, { k: kind, e: ent.id, c: country });
  const rank = (r) => (r.getString('entity') === ent.id ? 0 : r.getString('country') === country ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (b.getBool('builtin') ? 1 : 0) - (a.getBool('builtin') ? 1 : 0) || (a.getString('created') < b.getString('created') ? -1 : a.getString('created') > b.getString('created') ? 1 : 0));
  if (rows.length > 0) return rows[0];
  const others = util.findMany(app, 'letter_templates', 'kind = {:k} && archived = false', 'name', 20, { k: kind }).map((r) => ({ id: r.id, name: r.getString('name'), country: r.getString('country') }));
  throw util.fail(
    400,
    'No ' + KIND_LABEL[kind].toLowerCase() + ' template for ' + ent.getString('name') + ' (' + country + ')' + (others.length > 0 ? '. Templates of this kind: ' + others.map((x) => x.name + (x.country !== '' ? ' (' + x.country + ')' : '')).join(', ') + '; pass one with --template' : '') + '. Add one with letter-templates.save, or give your own --body.',
    'no_template',
    { kind: kind, entity: ent.id, templates: others },
  );
}

/** letters.draft: a draft letter for a person from a template or your own text. */
function lettersDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = subjectOf(app, p);
  lc().needHr(ctx, s.m.getString('entity'), 'edit', 'draft letters');
  const tpl = draftTemplate(app, p, s.m);
  const kind = util.oneOf(p, 'kind', KINDS, tpl !== null ? tpl.getString('kind') : 'custom');
  const body = util.has(p, 'body') && util.str(p, 'body', '') !== '' ? util.text(p, 'body', 30000, '') : tpl !== null ? tpl.getString('body') : '';
  if (body.trim() === '') throw util.fail(400, 'The letter has no text: give --template, a --kind with a template, or your own --body.', 'missing_param', { param: 'body' });
  checkBody(body);
  const title = util.squash(util.text(p, 'title', 200, '')) || (tpl !== null ? tpl.getString('name') : KIND_LABEL[kind] + ' letter') + ' for ' + L('lib_people').displayName(s.e);
  const r = util.newRecord(app, 'letters');
  r.set('number', 'L' + String(util.nextNumber(app, 'letter')).padStart(4, '0'));
  r.set('employee', s.e.id);
  r.set('employment', s.m.id);
  r.set('entity', s.m.getString('entity'));
  r.set('template', tpl !== null ? tpl.id : '');
  r.set('kind', kind);
  r.set('title', title);
  r.set('body', body);
  r.set('letter_day', util.day(p, 'letter_day', util.today(app, s.m.getString('entity'))));
  r.set('status', 'draft');
  r.set('needs_ack', util.has(p, 'needs_ack') ? util.bool(p, 'needs_ack', false) : tpl !== null ? tpl.getBool('needs_ack') : false);
  r.set('drafted_by', ctx.memberId || '');
  r.set('drafted_actor', ctx.isAgent ? 'agent' : 'person');
  r.set('fields', { values: readValues(p) || {} });
  r.set('note', util.text(p, 'note', 2000, ''));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Drafted ' + r.getString('number') + ' ' + title });
  return lettersGet(ctx, { letter: r.id });
}

function previewDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = subjectOf(app, p);
  const tpl = draftTemplate(app, p, s.m);
  const body = util.str(p, 'body', '') !== '' ? util.str(p, 'body', '') : tpl !== null ? tpl.getString('body') : '';
  if (body.trim() === '') throw util.fail(400, 'The letter has no text: give --template, a --kind with a template, or your own --body.', 'missing_param', { param: 'body' });
  checkBody(body);
  const vals = valuesFor(ctx, { employee: s.e, employment: s.m, day: util.day(p, 'letter_day', util.today(app, s.m.getString('entity'))), values: readValues(p) || {}, signer: null, number: '', language: tpl !== null ? tpl.getString('language') : 'en' });
  const out = render(body, vals, false);
  return {
    label: 'Draft a letter for ' + L('lib_people').displayName(s.e) + ': ' + (util.str(p, 'title', '') || (tpl !== null ? tpl.getString('name') : 'custom letter')),
    target: 'employees:' + s.e.id,
    fields: [
      { name: 'title', before: '', after: util.str(p, 'title', '') || (tpl !== null ? tpl.getString('name') : '') },
      { name: 'text', before: '', after: util.clip(out.text, 3000) },
    ],
    notes: out.missing.length > 0 ? ['Still missing: ' + out.missing.join(', ')] : [],
    risk: 'low',
  };
}

/** letters.update: change a draft (title, text, day, values, acknowledgement). */
function lettersUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = letterRef(app, util.req(p, 'letter'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'change letters');
  if (r.getString('status') !== 'draft') throw util.fail(409, 'Only a draft can change; this letter is ' + r.getString('status') + '. Void it and draft a new one.', 'conflict');
  const before = { title: r.getString('title'), body: r.getString('body'), letter_day: r.getString('letter_day'), values: draftValues(r), needs_ack: r.getBool('needs_ack') };
  if (util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 200, ''));
    if (t === '') throw util.fail(400, 'title cannot be empty', 'invalid_param', { param: 'title' });
    r.set('title', t);
  }
  if (util.has(p, 'body')) {
    const b = util.text(p, 'body', 30000, '');
    checkBody(b);
    r.set('body', b);
  }
  if (util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', KINDS, r.getString('kind')));
  if (util.has(p, 'letter_day')) r.set('letter_day', util.day(p, 'letter_day', r.getString('letter_day')));
  const vals = readValues(p);
  if (vals !== undefined) r.set('fields', { values: Object.assign({}, draftValues(r), vals) });
  if (util.has(p, 'needs_ack')) r.set('needs_ack', util.bool(p, 'needs_ack', false));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 2000, ''));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Changed the draft ' + r.getString('number') + ' ' + r.getString('title'), before: before, after: { title: r.getString('title'), body: r.getString('body'), letter_day: r.getString('letter_day'), values: draftValues(r), needs_ack: r.getBool('needs_ack') } });
  return lettersGet(ctx, { letter: r.id });
}

/** letters.request-draft: a draft placeholder, and your AI agent is asked to write it (letter_draft with the letter's id). */
function lettersRequestDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = subjectOf(app, p);
  lc().needHr(ctx, s.m.getString('entity'), 'edit', 'ask for letters');
  const instructions = util.text(p, 'instructions', 4000, '');
  if (instructions.trim() === '') throw util.fail(400, 'Say what the letter is for and what it must say, e.g. --instructions "Visa support letter for the Japan trip in March, confirming salary and role".', 'missing_param', { param: 'instructions' });
  const tplRef = util.str(p, 'template', '');
  const tpl = tplRef !== '' ? templateRef(app, tplRef) : null;
  const kind = util.oneOf(p, 'kind', KINDS, tpl !== null ? tpl.getString('kind') : 'custom');
  const title = util.squash(util.text(p, 'title', 200, '')) || KIND_LABEL[kind] + ' letter for ' + L('lib_people').displayName(s.e);
  let r = null;
  lc().inTx(app, (tx) => {
    r = util.newRecord(tx, 'letters');
    r.set('number', 'L' + String(util.nextNumber(tx, 'letter')).padStart(4, '0'));
    r.set('employee', s.e.id);
    r.set('employment', s.m.id);
    r.set('entity', s.m.getString('entity'));
    r.set('template', tpl !== null ? tpl.id : '');
    r.set('kind', kind);
    r.set('title', title);
    r.set('body', tpl !== null ? tpl.getString('body') : '');
    r.set('letter_day', util.day(p, 'letter_day', util.today(tx, s.m.getString('entity'))));
    r.set('status', 'draft');
    r.set('needs_ack', tpl !== null ? tpl.getBool('needs_ack') : false);
    r.set('drafted_by', ctx.memberId || '');
    r.set('drafted_actor', 'person');
    r.set('fields', { values: {} });
    r.set('note', instructions);
    tx.save(r);
  });
  const a = L('lib_agent').ask(ctx, app.findRecordById('letters', r.id), 'letter_draft', { note: instructions, defer: true });
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Asked your AI agent to draft ' + r.getString('number') + ' ' + title, after: { trigger: 'letter_draft', request: a.request } });
  return { letter: lettersGet(ctx, { letter: r.id }).letter, asked: a.asked };
}

/** letters.issue: freeze the text, store it as a document of the person, tell them. */
function lettersIssue(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = letterRef(app, util.req(p, 'letter'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'issue letters');
  if (ctx.member === null) throw util.fail(403, 'A person issues letters.', 'not_permitted');
  if (r.getString('status') !== 'draft') throw util.fail(409, 'This letter is already ' + r.getString('status') + '.', 'conflict');
  if (r.getString('body').trim() === '') throw util.fail(409, 'This letter has no text yet.', 'empty_letter');
  const e = app.findRecordById('employees', r.getString('employee'));
  const m = util.byId(app, 'employments', r.getString('employment'));
  const tpl = util.byId(app, 'letter_templates', r.getString('template'));
  const day = r.getString('letter_day') || util.today(app, r.getString('entity'));
  const vals = valuesFor(ctx, { employee: e, employment: m, day: day, values: draftValues(r), signer: ctx.member, number: r.getString('number'), language: tpl !== null ? tpl.getString('language') : 'en' });
  const out = render(r.getString('body'), vals, true);
  if (out.hidden.length > 0) throw util.fail(403, 'This letter shows pay, and your role cannot see pay of ' + L('lib_people').displayName(e) + '. Ask someone with payroll view rights to issue it.', 'pay_hidden', { hidden: out.hidden });
  if (out.missing.length > 0) throw util.fail(409, 'Fill these before issuing: ' + out.missing.map((k) => (KNOWN[k] ? KNOWN[k].label : k)).join(', ') + '.', 'missing_values', { missing: out.missing });
  const needsAck = util.has(p, 'needs_ack') ? util.bool(p, 'needs_ack', false) : r.getBool('needs_ack');
  const used = {};
  for (const k of placeholders(r.getString('body'))) used[k] = vals.values[k] === undefined ? '' : vals.values[k];
  let docId = '';
  lc().inTx(app, (tx) => {
    const d = util.newRecord(tx, 'documents');
    d.set('employee', e.id);
    d.set('employment', m !== null ? m.id : '');
    d.set('category', 'letter');
    d.set('title', util.clip(r.getString('title'), 200));
    d.set('visible_to_employee', true);
    d.set('needs_ack', needsAck);
    d.set('source', 'letter');
    d.set('note', 'Letter ' + r.getString('number'));
    d.set('added_by', ctx.memberId);
    d.set('file', $filesystem.fileFromBytes(toBytes(plain(out.text) + '\r\n'), r.getString('number') + '-' + (util.slug(r.getString('title')) || 'letter') + '.txt'));
    tx.save(d);
    docId = d.id;
    const fresh = tx.findRecordById('letters', r.id);
    fresh.set('status', 'issued');
    fresh.set('issued_body', out.text);
    fresh.set('issued_at', util.nowIso());
    fresh.set('issued_by', ctx.memberId);
    fresh.set('letter_day', day);
    fresh.set('needs_ack', needsAck);
    fresh.set('document', d.id);
    fresh.set('fields', { values: draftValues(r), used: used });
    tx.save(fresh);
  });
  L('lib_agent').end(app, app.findRecordById('letters', r.id), 'letter_draft', 'closed', 'Issued by ' + ctx.name);
  if (e.getString('member') !== '' && util.bool(p, 'notify', true)) L('lib_notify').notify(app, [e.getString('member')], { kind: 'document', title: (needsAck ? 'Please read and acknowledge: ' : 'A letter for you: ') + r.getString('title'), body: '', link: '#/lifecycle/letters/' + r.id });
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Issued ' + r.getString('number') + ' ' + r.getString('title') + ' to ' + L('lib_people').displayName(e) });
  return lettersGet(ctx, { letter: r.id });
}

function lettersVoid(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = letterRef(app, util.req(p, 'letter'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'void letters');
  if (r.getString('status') !== 'issued') throw util.fail(409, 'Only an issued letter can be voided (delete a draft instead).', 'conflict');
  const reason = util.text(p, 'reason', 400, '');
  if (reason.trim() === '') throw util.fail(400, 'Say why the letter is void, e.g. --reason "Wrong last day"', 'missing_param', { param: 'reason' });
  lc().inTx(app, (tx) => {
    const fresh = tx.findRecordById('letters', r.id);
    fresh.set('status', 'void');
    fresh.set('void_reason', reason);
    tx.save(fresh);
    const d = util.byId(tx, 'documents', r.getString('document'));
    if (d !== null) {
      d.set('visible_to_employee', false);
      d.set('needs_ack', false);
      d.set('note', 'Letter ' + r.getString('number') + ' (void: ' + util.clip(reason, 200) + ')');
      tx.save(d);
    }
  });
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Voided ' + r.getString('number') + ' ' + r.getString('title') + ': ' + reason });
  return lettersGet(ctx, { letter: r.id });
}

function lettersDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = letterRef(app, util.req(p, 'letter'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'delete letters');
  if (r.getString('status') !== 'draft') throw util.fail(409, 'Only a draft can be deleted; void an issued letter instead.', 'conflict');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Deleted the draft ' + r.getString('number') + ' ' + r.getString('title') });
  return { deleted: true };
}

/** agent.retry on letter_draft: HR edit rights on the letter's entity, while it is a draft. */
function mayAsk(ctx, r) {
  lc().needHr(ctx, r.getString('entity'), 'edit', 'ask for letters');
  if (r.getString('status') !== 'draft') throw u().fail(409, 'This letter is already ' + r.getString('status') + '.', 'conflict');
}

/** letters.acknowledge: the person confirms they read their letter. */
function lettersAcknowledge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = letterRef(app, util.req(p, 'letter'));
  if (L('lib_auth').selfEmployee(ctx) !== r.getString('employee')) throw util.fail(403, 'Only the person the letter is for can acknowledge it.', 'not_permitted');
  if (r.getString('status') !== 'issued') throw util.fail(409, 'This letter is ' + r.getString('status') + '.', 'conflict');
  const d = util.byId(app, 'documents', r.getString('document'));
  if (d === null || !d.getBool('needs_ack')) throw util.fail(409, 'This letter needs no acknowledgement.', 'invalid');
  if (d.getString('acked_at') === '') {
    d.set('acked_at', util.nowIso());
    app.save(d);
  }
  L('lib_audit').note(ctx, { collection: 'letters', record: r.id, summary: 'Acknowledged ' + r.getString('number') + ' ' + r.getString('title') });
  return lettersGet(ctx, { letter: r.id });
}

module.exports = {
  mayAsk: mayAsk,
  KINDS: KINDS,
  KIND_LABEL: KIND_LABEL,
  PLACEHOLDERS: PLACEHOLDERS,
  placeholders: placeholders,
  checkBody: checkBody,
  render: render,
  valuesFor: valuesFor,
  plain: plain,
  templateView: templateView,
  templatesList: templatesList,
  templatesGet: templatesGet,
  templatesSave: templatesSave,
  templatesDelete: templatesDelete,
  letterView: letterView,
  listLetters: listLetters,
  lettersList: listLetters,
  lettersGet: lettersGet,
  lettersPreview: lettersPreview,
  lettersDraft: lettersDraft,
  previewDraft: previewDraft,
  lettersUpdate: lettersUpdate,
  lettersRequestDraft: lettersRequestDraft,
  lettersIssue: lettersIssue,
  lettersVoid: lettersVoid,
  lettersDelete: lettersDelete,
  lettersAcknowledge: lettersAcknowledge,
};
