/// <reference path="../pb_data/types.d.ts" />
/**
 * Offers and referrals, and the hire.
 *
 * An offer comes from an application: title, start day, pay (basis, amount,
 * period) in the entity's currency, extra components (signing bonus,
 * allowances), terms copied from the offer terms, and a letter rendered from
 * a template with {{placeholders}}. It is approved (approval kind `offer`),
 * sent, then accepted or declined. On acceptance HR OS emits
 * `offer.accepted { application, offer, candidate }` and offers the kernel's
 * hire flow prefilled (offers.hire-draft); people.hire with
 * --from_application links the new employment back (employment.hired), the
 * application becomes hired, the opening closes when its positions are
 * filled and the requisition when it has its people.
 *
 * Referrals: any member refers someone for an open role; they see only
 * whether it is in process, hired or not moving forward.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function h() {
  return L('lib_hiring');
}

const BASIS = ['salary', 'hourly', 'daily'];
const COMPONENT_PER = ['once', 'year', 'month', 'week', 'day', 'hour'];
const OPEN = ['draft', 'pending', 'approved', 'sent'];

/* --------------------------------------------------------------- views */

function money(minor, cur) {
  return minor > 0 && cur !== '' ? L('lib_money').format(minor, cur) : '';
}

function payLine(o) {
  const per = o.getString('pay_per');
  return money(o.getInt('amount_minor'), o.getString('currency')) + (per ? ' a ' + per : '');
}

function componentsOf(o) {
  const cur = o.getString('currency');
  return (u().jsonOf(o, 'components', []) || []).map((c) => ({ name: String(c.name || ''), amount_minor: Number(c.amount_minor) || 0, amount: cur !== '' ? L('lib_money').fromMinor(Number(c.amount_minor) || 0, cur) : '', per: String(c.per || 'once'), note: String(c.note || ''), text: money(Number(c.amount_minor) || 0, cur) + (c.per && c.per !== 'once' ? ' a ' + c.per : c.per === 'once' ? ' once' : '') }));
}

function offerAccess(ctx, o) {
  const util = u();
  const a = util.byId(ctx.app, 'applications', o.getString('application'));
  if (a === null) return '';
  const job = util.byId(ctx.app, 'openings', a.getString('opening'));
  if (job === null) return '';
  const acc = h().appAccess(ctx, a, job);
  return acc === 'interviewer' ? '' : acc;
}

function offerRef(ctx, ref, write) {
  const util = u();
  const s = String(ref || '').trim();
  const o = util.byId(ctx.app, 'offers', s) || (s !== '' ? util.findOne(ctx.app, 'offers', 'number = {:n}', { n: s.toUpperCase() }) : null);
  if (o === null) throw util.fail(404, 'No offer ' + ref + '. Run offers.list.', 'not_found');
  const acc = offerAccess(ctx, o);
  if (acc === '') throw util.fail(404, 'No offer ' + ref + ' that you can see.', 'not_found');
  if (write && !h().writable(ctx, acc)) throw util.fail(403, 'Your role can look at this offer but not change it.', 'not_permitted');
  return { rec: o, access: acc };
}

function offerIssues(o, job) {
  const out = [];
  if (job !== null && job.getString('currency') === o.getString('currency') && job.getString('pay_per') === o.getString('pay_per')) {
    const lo = job.getInt('salary_min_minor');
    const hi = job.getInt('salary_max_minor');
    const amt = o.getInt('amount_minor');
    if ((lo > 0 && amt < lo) || (hi > 0 && amt > hi)) out.push({ code: 'outside_range', severity: 'warning', message: 'The pay is outside the range on the opening (' + L('lib_hiring_jobs').payText(o.getString('currency'), lo, hi, job.getString('pay_per')) + ').' });
  }
  if (o.getString('start_day') === '') out.push({ code: 'no_start_day', severity: 'warning', message: 'Add the start day.' });
  return out;
}

function offerView(ctx, o, access) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const pay = hh.seesPay(ctx, access);
  const cache = {};
  const cand = util.byId(app, 'candidates', o.getString('candidate'));
  const job = util.byId(app, 'openings', o.getString('opening'));
  const ent = util.byId(app, 'entities', o.getString('entity'));
  const ap = o.getString('approval') !== '' ? util.byId(app, 'approvals', o.getString('approval')) : null;
  const status = o.getString('status');
  const emp = o.getString('employment') !== '' ? util.byId(app, 'employments', o.getString('employment')) : null;
  return {
    id: o.id,
    number: o.getString('number'),
    application: o.getString('application'),
    opening: o.getString('opening'),
    opening_number: job !== null ? job.getString('number') : '',
    opening_title: job !== null ? job.getString('title') : '',
    candidate: o.getString('candidate'),
    candidate_name: cand !== null ? cand.getString('name') : '',
    candidate_email: cand !== null ? cand.getString('email') : '',
    entity: o.getString('entity'),
    entity_name: ent !== null ? ent.getString('name') : '',
    country: ent !== null ? ent.getString('country') : '',
    title: o.getString('title'),
    department: o.getString('department'),
    department_name: hh.nameOf(app, 'departments', o.getString('department')),
    location: o.getString('location'),
    location_name: hh.nameOf(app, 'locations', o.getString('location')),
    employment_type: o.getString('employment_type'),
    employment_type_name: hh.nameOf(app, 'employment_types', o.getString('employment_type')),
    start_day: o.getString('start_day'),
    pay_basis: o.getString('pay_basis'),
    pay_per: o.getString('pay_per'),
    currency: o.getString('currency'),
    amount_minor: pay ? o.getInt('amount_minor') : null,
    amount: pay && o.getString('currency') !== '' ? L('lib_money').fromMinor(o.getInt('amount_minor'), o.getString('currency')) : '',
    pay_text: pay ? payLine(o) : '',
    components: pay ? componentsOf(o) : [],
    terms: util.jsonOf(o, 'terms', []) || [],
    template: o.getString('template'),
    template_name: hh.nameOf(app, 'offer_templates', o.getString('template')),
    letter_frozen: o.getString('letter') !== '',
    status: status,
    approval: o.getString('approval'),
    approval_status: ap !== null ? ap.getString('status') : '',
    approval_note: ap !== null ? ap.getString('note') : '',
    expires_day: o.getString('expires_day'),
    sent_at: o.getString('sent_at'),
    responded_at: o.getString('responded_at'),
    decline_reason: o.getString('decline_reason'),
    note: o.getString('note'),
    employment: o.getString('employment'),
    employment_number: emp !== null ? emp.getString('number') : '',
    created_by_name: hh.memberName(app, o.getString('created_by'), cache),
    issues: pay ? offerIssues(o, job) : [],
    access: access,
    can: {
      edit: hh.writable(ctx, access) && status === 'draft' && hh.agentMay(ctx, 'offers.update'),
      submit: hh.writable(ctx, access) && status === 'draft' && hh.agentMay(ctx, 'offers.submit'),
      send: hh.writable(ctx, access) && status === 'approved' && hh.agentMay(ctx, 'offers.send'),
      respond: hh.writable(ctx, access) && (status === 'sent' || status === 'approved') && hh.agentMay(ctx, 'offers.respond'),
      withdraw: hh.writable(ctx, access) && OPEN.indexOf(status) >= 0 && hh.agentMay(ctx, 'offers.withdraw'),
      hire: status === 'accepted' && o.getString('employment') === '' && (ctx.isAgent || L('lib_auth').can(ctx, 'people', 'full')) && hh.agentMay(ctx, 'people.hire'),
    },
    created: o.getString('created'),
    updated: o.getString('updated'),
  };
}

/** Offers of one application the caller may see. */
function forApplication(ctx, applicationId, access) {
  return u()
    .findMany(ctx.app, 'offers', 'application = {:a}', '-created', 0, { a: applicationId })
    .map((o) => offerView(ctx, o, access));
}

/* --------------------------------------------------------------- letter */

function letterVars(ctx, o) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const cand = util.byId(app, 'candidates', o.getString('candidate'));
  const ent = util.byId(app, 'entities', o.getString('entity'));
  const job = util.byId(app, 'openings', o.getString('opening'));
  const cc = ent !== null ? ent.getString('country') : '';
  const countries = L('lib_countries');
  const country = cc !== '' && countries.has(cc) ? countries.get(cc).name : cc;
  const dep = hh.nameOf(app, 'departments', o.getString('department'));
  const comps = componentsOf(o);
  const vars = {
    today: hh.longDay(util.today(app, o.getString('entity'))),
    candidate_name: cand !== null ? cand.getString('name') : '',
    title: o.getString('title'),
    company: hh.companyName(app),
    entity: ent !== null ? ent.getString('name') : '',
    entity_legal_name: ent !== null ? ent.getString('legal_name') || ent.getString('name') : '',
    department: dep,
    department_line: dep !== '' ? ', in ' + dep : '',
    location: hh.nameOf(app, 'locations', o.getString('location')) || (job !== null ? job.getString('location_text') : ''),
    employment_type: hh.nameOf(app, 'employment_types', o.getString('employment_type')),
    start_day: hh.longDay(o.getString('start_day')),
    pay: payLine(o),
    components: comps.length > 0 ? '**Also**\n\n' + comps.map((c) => '- ' + c.name + ': ' + c.text + (c.note !== '' ? ' (' + c.note + ')' : '')).join('\n') : '',
    expires_day: hh.longDay(o.getString('expires_day')),
    sender_name: hh.memberName(app, o.getString('created_by')) || ctx.name || hh.companyName(app),
    country: country,
  };
  const terms = util.jsonOf(o, 'terms', []) || [];
  vars.terms = terms.length > 0 ? terms.map((t) => '**' + t.title + '**\n\n' + hh.render(t.text, vars)).join('\n\n') : '';
  return vars;
}

function templateOf(app, o) {
  const util = u();
  let t = o.getString('template') !== '' ? util.byId(app, 'offer_templates', o.getString('template')) : null;
  if (t === null) t = util.findOne(app, 'offer_templates', "archived = false && entity = {:e} && is_default = true", { e: o.getString('entity') }) || util.findOne(app, 'offer_templates', 'archived = false && is_default = true', {}) || util.findOne(app, 'offer_templates', 'archived = false', {});
  return t;
}

/** The letter as markdown: the frozen copy once sent, else rendered now. */
function letterText(ctx, o) {
  if (o.getString('letter') !== '') return o.getString('letter');
  const t = templateOf(ctx.app, o);
  if (t === null) return '';
  return h().render(t.getString('body'), letterVars(ctx, o));
}

/* ---------------------------------------------------------------- ops */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  if (hh.level(ctx) === 'none') return { offers: [], total: 0 };
  const bind = {};
  const where = [hh.jobWhere(ctx, bind, 'j')];
  const status = util.str(p, 'status', 'open');
  if (status === 'open') where.push("o.status IN ('draft', 'pending', 'approved', 'sent', 'accepted') AND o.employment = ''");
  else if (status !== 'all') {
    where.push('o.status = {:s}');
    bind.s = status;
  }
  const op = util.str(p, 'opening', '');
  if (op !== '') {
    where.push('o.opening = {:op}');
    bind.op = L('lib_hiring_jobs').openingRef(ctx, op).id;
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(c.name LIKE {:q} ESCAPE '\\' OR o.title LIKE {:q} ESCAPE '\\' OR o.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const pg = util.page(p, 50, 300);
  const base = ' FROM offers o JOIN openings j ON j.id = o.opening JOIN candidates c ON c.id = o.candidate WHERE ' + where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n' + base, bind);
  const ids = util.rows(app, "SELECT o.id AS id" + base + " ORDER BY CASE o.status WHEN 'accepted' THEN 0 WHEN 'approved' THEN 1 WHEN 'pending' THEN 2 WHEN 'sent' THEN 3 WHEN 'draft' THEN 4 ELSE 5 END, o.updated DESC LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return {
    offers: ids.map((x) => {
      const o = app.findRecordById('offers', x.id);
      return offerView(ctx, o, offerAccess(ctx, o));
    }),
    total: total,
  };
}

function get(ctx, p) {
  const x = offerRef(ctx, u().req(p, 'offer'), false);
  const v = offerView(ctx, x.rec, x.access);
  if (h().seesPay(ctx, x.access)) v.letter = letterText(ctx, x.rec);
  v.hire = x.rec.getString('status') === 'accepted' ? hireDraftOf(ctx, x.rec) : null;
  return { offer: v };
}

function readComponents(p, cur) {
  const util = u();
  const raw = util.list(p, 'components') || [];
  if (raw.length > 20) throw util.fail(400, 'At most 20 components.', 'invalid_param', { param: 'components' });
  return raw.map((c, i) => {
    util.keysOnly(c, ['name', 'amount', 'per', 'note'], 'component ' + (i + 1));
    const name = util.clip(util.squash(c.name), 80);
    if (name === '') throw util.fail(400, 'component ' + (i + 1) + ': name is required.', 'invalid_param', { param: 'components' });
    const amt = util.money({ v: c.amount === undefined || c.amount === null ? '' : String(c.amount) }, 'v', cur, { required: true });
    const per = String(c.per || 'once');
    if (COMPONENT_PER.indexOf(per) < 0) throw util.fail(400, 'component ' + (i + 1) + ': per is one of ' + COMPONENT_PER.join(', '), 'invalid_param', { param: 'components' });
    return { name: name, amount_minor: amt, per: per, note: util.clip(String(c.note || ''), 300) };
  });
}

function readTerms(app, p) {
  const util = u();
  const raw = util.list(p, 'terms') || [];
  if (raw.length > 30) throw util.fail(400, 'At most 30 terms.', 'invalid_param', { param: 'terms' });
  return raw.map((t, i) => {
    if (typeof t === 'string') {
      const r = util.byId(app, 'offer_terms', t) || util.findOne(app, 'offer_terms', 'title = {:t}', { t: t });
      if (r === null) throw util.fail(400, 'term ' + (i + 1) + ': no offer term "' + t + '". Run offer-terms.list.', 'invalid_param', { param: 'terms' });
      return { term: r.id, title: r.getString('title'), text: r.getString('text') };
    }
    util.keysOnly(t, ['term', 'title', 'text'], 'term ' + (i + 1));
    const title = util.clip(util.squash(t.title), 160);
    if (title === '') throw util.fail(400, 'term ' + (i + 1) + ': title is required.', 'invalid_param', { param: 'terms' });
    return { term: String(t.term || ''), title: title, text: util.clip(String(t.text || ''), 8000) };
  });
}

function fill(ctx, o, p, isNew, job) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const hh = h();
  if (isNew || util.has(p, 'title')) o.set('title', util.squash(util.text(p, 'title', 160, '')) || o.getString('title') || job.getString('title'));
  if (util.has(p, 'start_day')) o.set('start_day', util.day(p, 'start_day', ''));
  if (util.has(p, 'pay_basis')) o.set('pay_basis', util.oneOf(p, 'pay_basis', BASIS, 'salary'));
  else if (isNew) o.set('pay_basis', job.getString('pay_per') === 'hour' ? 'hourly' : job.getString('pay_per') === 'day' ? 'daily' : 'salary');
  if (util.has(p, 'pay_per')) o.set('pay_per', util.oneOf(p, 'pay_per', hh.PER, 'year'));
  else if (isNew) o.set('pay_per', job.getString('pay_per') || 'month');
  if (o.getString('pay_basis') === 'hourly' && o.getString('pay_per') !== 'hour') o.set('pay_per', 'hour');
  if (o.getString('pay_basis') === 'daily' && o.getString('pay_per') !== 'day') o.set('pay_per', 'day');
  if (util.has(p, 'currency')) {
    const c = util.str(p, 'currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency is a three-letter code', 'invalid_param', { param: 'currency' });
    if (!util.has(p, 'amount') && c !== o.getString('currency')) throw util.fail(400, 'Give the amount again in ' + c + '.', 'missing_param', { param: 'amount' });
    o.set('currency', c);
  }
  const cur = o.getString('currency');
  if (util.has(p, 'amount')) o.set('amount_minor', util.money(p, 'amount', cur, { required: true, positive: true }));
  else if (isNew) throw util.fail(400, 'amount is required: the pay in ' + cur + ' a ' + o.getString('pay_per') + ', e.g. --amount 7800.00', 'missing_param', { param: 'amount' });
  if (util.has(p, 'components')) o.set('components', readComponents(p, cur));
  else if (isNew) o.set('components', []);
  if (util.has(p, 'terms')) o.set('terms', readTerms(app, p));
  else if (isNew) o.set('terms', []);
  if (util.has(p, 'template')) {
    const t = util.str(p, 'template', '');
    if (t !== '' && util.byId(app, 'offer_templates', t) === null) throw util.fail(400, 'No letter template ' + t + '. Run offer-templates.list.', 'invalid_param', { param: 'template' });
    o.set('template', t);
  }
  if (util.has(p, 'department')) o.set('department', util.str(p, 'department', '') === '' ? '' : org.kindRef(app, 'department', util.str(p, 'department', '')).id);
  if (util.has(p, 'location')) o.set('location', util.str(p, 'location', '') === '' ? '' : org.kindRef(app, 'location', util.str(p, 'location', '')).id);
  if (util.has(p, 'employment_type')) o.set('employment_type', util.str(p, 'employment_type', '') === '' ? '' : org.kindRef(app, 'employment_type', util.str(p, 'employment_type', '')).id);
  if (util.has(p, 'expires_day')) o.set('expires_day', util.day(p, 'expires_day', ''));
  if (util.has(p, 'note')) o.set('note', util.text(p, 'note', 4000, ''));
}

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const cands = L('lib_hiring_candidates');
  const a = cands.appRef(ctx, util.req(p, 'application'));
  const job = app.findRecordById('openings', a.getString('opening'));
  const acc = hh.needApp(ctx, a, true, job);
  if (acc === 'interviewer') throw util.fail(403, 'Offers are made by the hiring team.', 'not_permitted');
  if (a.getString('status') !== 'active') throw util.fail(409, 'This application is ' + a.getString('status') + '.', 'conflict');
  const open = util.findOne(app, 'offers', "application = {:a} && (status = 'draft' || status = 'pending' || status = 'approved' || status = 'sent')", { a: a.id });
  if (open !== null) throw util.fail(409, 'Offer ' + open.getString('number') + ' is already ' + open.getString('status') + ' for this application.', 'offer_open', { offer: open.id });
  const o = util.newRecord(app, 'offers');
  o.set('application', a.id);
  o.set('opening', job.id);
  o.set('candidate', a.getString('candidate'));
  o.set('entity', job.getString('entity'));
  o.set('currency', job.getString('currency') || hh.nameOf(app, 'entities', job.getString('entity'), 'currency'));
  o.set('department', job.getString('department'));
  o.set('location', job.getString('location'));
  o.set('employment_type', job.getString('employment_type'));
  o.set('expires_day', util.dayAdd(util.today(app, job.getString('entity')), 7));
  fill(ctx, o, p, true, job);
  const tpl = templateOf(app, o);
  if (o.getString('template') === '' && tpl !== null) o.set('template', tpl.id);
  o.set('status', 'draft');
  o.set('created_by', ctx.memberId || '');
  o.set('number', 'OF' + String(util.nextNumber(app, 'offer')).padStart(4, '0'));
  app.save(o);
  const offerStage = hh.stagesOf(job).filter((s) => s.kind === 'offer')[0];
  if (offerStage && a.getString('stage') !== offerStage.key) {
    const from = a.getString('stage');
    a.set('stage', offerStage.key);
    a.set('stage_since', util.nowIso());
    app.save(a);
    hh.event(ctx, { candidate: a.getString('candidate'), application: a.id, kind: 'moved', from: from, to: offerStage.key, text: 'Moved to ' + offerStage.name + ' with the offer' });
  }
  hh.event(ctx, { candidate: a.getString('candidate'), application: a.id, kind: 'offer', text: 'Drafted offer ' + o.getString('number') + ' (' + o.getString('title') + ')', ref: o.id });
  L('lib_audit').note(ctx, { collection: 'offers', record: o.id, summary: 'Drafted offer ' + o.getString('number') + ' for ' + hh.nameOf(app, 'candidates', a.getString('candidate')) });
  const v = offerView(ctx, o, acc);
  v.letter = letterText(ctx, o);
  return { offer: v };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = offerRef(ctx, util.req(p, 'offer'), true);
  const o = x.rec;
  if (o.getString('status') !== 'draft') throw util.fail(409, 'Offer ' + o.getString('number') + ' is ' + o.getString('status') + '; only a draft changes (withdraw it and make a new one).', 'conflict');
  const before = offerView(ctx, o, x.access);
  const job = app.findRecordById('openings', o.getString('opening'));
  fill(ctx, o, p, false, job);
  app.save(o);
  const after = offerView(ctx, o, x.access);
  L('lib_audit').note(ctx, { collection: 'offers', record: o.id, summary: 'Changed offer ' + o.getString('number'), before: before, after: after });
  after.letter = letterText(ctx, o);
  return { offer: after };
}

function submit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = offerRef(ctx, util.req(p, 'offer'), true);
  const o = x.rec;
  if (o.getString('status') !== 'draft') throw util.fail(409, 'Offer ' + o.getString('number') + ' is already ' + o.getString('status') + '.', 'conflict');
  if (o.getString('start_day') === '') throw util.fail(400, 'Add the start day first.', 'missing_param', { param: 'start_day' });
  const v = offerView(ctx, o, 'all');
  let ap = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const rec = tx.findRecordById('offers', o.id);
    rec.set('status', 'pending');
    tx.save(rec);
    ap = L('lib_approvals').open(t, {
      kind: 'offer',
      ref_collection: 'offers',
      ref_id: rec.id,
      entity: rec.getString('entity'),
      summary: 'Offer ' + rec.getString('number') + ' for ' + v.candidate_name + ': ' + rec.getString('title'),
      amount_minor: rec.getInt('amount_minor'),
      currency: rec.getString('currency'),
      facts: [{ type: 'text', key: 'candidate', label: 'Candidate', value: v.candidate_name }].concat(rec.getString('currency') !== '' ? [{ type: 'money', key: 'pay', label: ({ year: 'Yearly pay', month: 'Monthly pay', week: 'Weekly pay', day: 'Daily rate', hour: 'Hourly rate' }[rec.getString('pay_per')] || 'Pay'), amount_minor: rec.getInt('amount_minor'), currency: rec.getString('currency') }] : []).concat([{ type: 'day', key: 'start_day', label: 'Start day', value: rec.getString('start_day') }, { type: 'text', key: 'title', label: 'Role', value: rec.getString('title') }]).concat(rec.getString('expires_day') !== '' ? [{ type: 'day', key: 'expires_day', label: 'Answer by', value: rec.getString('expires_day') }] : []),
      payload: { offer: rec.id, number: rec.getString('number'), candidate: rec.getString('candidate'), candidate_name: v.candidate_name, title: rec.getString('title'), opening_title: v.opening_title, entity_name: v.entity_name, department_name: v.department_name, start_day: rec.getString('start_day'), amount_minor: rec.getInt('amount_minor'), currency: rec.getString('currency'), pay_per: rec.getString('pay_per'), components: v.components.map((c) => ({ name: c.name, amount_minor: c.amount_minor, per: c.per })), terms: (u().jsonOf(rec, 'terms', []) || []).map((x2) => x2.title), expires_day: rec.getString('expires_day'), issues: v.issues.map((i) => i.message) },
    });
    const fresh = tx.findRecordById('offers', rec.id);
    fresh.set('approval', ap.id);
    tx.save(fresh);
    hh.event(t, { candidate: rec.getString('candidate'), application: rec.getString('application'), kind: 'offer', text: 'Sent offer ' + rec.getString('number') + ' for approval', ref: rec.id });
    L('lib_audit').write(t, { op: 'offers.submit', collection: 'offers', record: rec.id, summary: 'Sent offer ' + rec.getString('number') + ' (' + v.candidate_name + ') for approval' });
  });
  ctx.audited = true;
  return { offer: offerView(ctx, app.findRecordById('offers', o.id), x.access), approval: ap };
}

/** The approval subscriber of kind `offer`. */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const o = util.byId(ctx.app, 'offers', approval.ref_id);
  if (o === null || o.getString('status') !== 'pending') return;
  o.set('status', decision === 'approved' ? 'approved' : 'draft');
  ctx.app.save(o);
  h().event(ctx, { candidate: o.getString('candidate'), application: o.getString('application'), kind: 'offer', text: 'Offer ' + o.getString('number') + (decision === 'approved' ? ' approved' : decision === 'rejected' ? ' not approved' : ' approval cancelled') + (note ? ': ' + util.clip(note, 400) : ''), ref: o.id });
}

function send(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = offerRef(ctx, util.req(p, 'offer'), true);
  const o = x.rec;
  if (o.getString('status') !== 'approved') throw util.fail(409, 'Offer ' + o.getString('number') + ' is ' + o.getString('status') + '; it is sent once approved.', 'not_approved');
  const letter = letterText(ctx, o);
  o.set('letter', letter);
  o.set('status', 'sent');
  o.set('sent_at', util.nowIso());
  app.save(o);
  let email = '';
  if (util.bool(p, 'email', false)) {
    const cand = app.findRecordById('candidates', o.getString('candidate'));
    const job = app.findRecordById('openings', o.getString('opening'));
    const a = app.findRecordById('applications', o.getString('application'));
    email = L('lib_hiring_candidates').queueMessage(ctx, cand, a, job, 'Your offer from {{company}}', letter, true);
  }
  hh.event(ctx, { candidate: o.getString('candidate'), application: o.getString('application'), kind: 'offer', text: 'Offer ' + o.getString('number') + ' sent' + (email === 'queued' ? ' by email' : ''), ref: o.id });
  L('lib_audit').note(ctx, { collection: 'offers', record: o.id, summary: 'Sent offer ' + o.getString('number') + ' to ' + hh.nameOf(app, 'candidates', o.getString('candidate')) });
  return { offer: offerView(ctx, o, x.access), email: email };
}

function respond(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = offerRef(ctx, util.req(p, 'offer'), true);
  const o = x.rec;
  const answer = util.oneOf(p, 'answer', ['accepted', 'declined'], '');
  if (answer === '') throw util.fail(400, 'answer is accepted or declined', 'missing_param', { param: 'answer' });
  if (['sent', 'approved'].indexOf(o.getString('status')) < 0) throw util.fail(409, 'Offer ' + o.getString('number') + ' is ' + o.getString('status') + '.', 'conflict');
  if (o.getString('letter') === '') o.set('letter', letterText(ctx, o));
  o.set('status', answer);
  o.set('responded_at', util.nowIso());
  if (answer === 'declined') o.set('decline_reason', util.text(p, 'reason', 2000, ''));
  app.save(o);
  const cand = app.findRecordById('candidates', o.getString('candidate'));
  hh.event(ctx, { candidate: cand.id, application: o.getString('application'), kind: 'offer', text: cand.getString('name') + (answer === 'accepted' ? ' accepted' : ' declined') + ' offer ' + o.getString('number') + (answer === 'declined' && o.getString('decline_reason') !== '' ? ': ' + o.getString('decline_reason') : ''), ref: o.id });
  let events = [];
  if (answer === 'accepted') {
    events = L('lib_events').emit(ctx, 'offer.accepted', { application: o.getString('application'), offer: o.id, candidate: cand.id });
    const job = app.findRecordById('openings', o.getString('opening'));
    const hrIds = [];
    for (const m of util.findMany(app, 'members', "status = 'active'", 'created')) {
      const role = util.byId(app, 'roles', m.getString('role'));
      if (role !== null && (role.getString('code') === 'owner' || L('lib_auth').levelsOfRole(role).people === 'full')) hrIds.push(m.id);
    }
    const who = hrIds.concat([job.getString('owner'), job.getString('hiring_manager')]).filter((id, i, arr) => id !== '' && id !== ctx.memberId && arr.indexOf(id) === i);
    L('lib_notify').notify(app, who, { kind: 'hiring', title: 'Ready to hire: ' + cand.getString('name') + ' accepted ' + o.getString('title'), body: 'Start day ' + o.getString('start_day'), link: '#/hiring/offers/' + o.id, facts: [{ type: 'state', key: 'status', value: 'accepted' }].concat(o.getString('start_day') !== '' ? [{ type: 'day', key: 'start_day', label: 'Start day', value: o.getString('start_day') }] : []) });
  }
  L('lib_audit').note(ctx, { collection: 'offers', record: o.id, summary: 'Offer ' + o.getString('number') + ' ' + answer + ' by ' + cand.getString('name') });
  return { offer: offerView(ctx, o, x.access), hire: answer === 'accepted' ? hireDraftOf(ctx, o) : null, events: events };
}

function withdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = offerRef(ctx, util.req(p, 'offer'), true);
  const o = x.rec;
  if (OPEN.indexOf(o.getString('status')) < 0) throw util.fail(409, 'Offer ' + o.getString('number') + ' is ' + o.getString('status') + '.', 'conflict');
  if (o.getString('status') === 'pending' && o.getString('approval') !== '') L('lib_approvals').cancel(ctx, o.getString('approval'), 'Offer withdrawn');
  const fresh = app.findRecordById('offers', o.id);
  fresh.set('status', 'withdrawn');
  fresh.set('note', util.clip((fresh.getString('note') !== '' ? fresh.getString('note') + '\n' : '') + util.text(p, 'reason', 1000, ''), 4000));
  app.save(fresh);
  h().event(ctx, { candidate: fresh.getString('candidate'), application: fresh.getString('application'), kind: 'offer', text: 'Withdrew offer ' + fresh.getString('number') + (util.str(p, 'reason', '') !== '' ? ': ' + util.text(p, 'reason', 1000, '') : ''), ref: fresh.id });
  L('lib_audit').note(ctx, { collection: 'offers', record: o.id, summary: 'Withdrew offer ' + o.getString('number') });
  return { offer: offerView(ctx, fresh, x.access) };
}

/** offers.letter: the letter for the print page (markdown, the entity's names). */
function letter(ctx, p) {
  const util = u();
  const x = offerRef(ctx, util.req(p, 'offer'), false);
  if (!h().seesPay(ctx, x.access)) throw util.fail(403, 'You cannot see this offer letter.', 'not_permitted');
  const o = x.rec;
  const ent = util.byId(ctx.app, 'entities', o.getString('entity'));
  return { offer: o.id, number: o.getString('number'), status: o.getString('status'), frozen: o.getString('letter') !== '', markdown: letterText(ctx, o), entity_name: ent !== null ? ent.getString('legal_name') || ent.getString('name') : '', candidate_name: h().nameOf(ctx.app, 'candidates', o.getString('candidate')), title: o.getString('title') };
}

/* ------------------------------------------------------------------ hire */

/** The params of people.hire for an accepted offer (the kernel's hire page reads them). */
function hireDraftOf(ctx, o) {
  const util = u();
  const app = ctx.app;
  const cand = util.byId(app, 'candidates', o.getString('candidate'));
  const job = util.byId(app, 'openings', o.getString('opening'));
  const seePay = h().seesPay(ctx, offerAccess(ctx, o) || 'all');
  const out = {
    entity: o.getString('entity'),
    legal_name: cand !== null ? cand.getString('name') : '',
    personal_email: cand !== null ? cand.getString('email') : '',
    phone: cand !== null ? cand.getString('phone') : '',
    title: o.getString('title'),
    job_title: job !== null ? job.getString('job_title') : '',
    department: o.getString('department'),
    location: o.getString('location'),
    employment_type: o.getString('employment_type'),
    start_day: o.getString('start_day'),
    from_application: o.getString('application'),
  };
  if (seePay) {
    out.pay_basis = o.getString('pay_basis');
    out.pay_amount = L('lib_money').fromMinor(o.getInt('amount_minor'), o.getString('currency'));
    out.pay_per = o.getString('pay_per');
  }
  if (cand !== null && cand.getString('employee') !== '') out.employee = cand.getString('employee');
  return out;
}

function hireDraft(ctx, p) {
  const util = u();
  let o = null;
  if (util.str(p, 'offer', '') !== '') o = offerRef(ctx, util.str(p, 'offer', ''), false).rec;
  else {
    const a = L('lib_hiring_candidates').appRef(ctx, util.req(p, 'application'));
    h().needApp(ctx, a, false);
    o = util.findOne(ctx.app, 'offers', "application = {:a} && status = 'accepted'", { a: a.id });
    if (o === null) throw util.fail(404, 'This application has no accepted offer.', 'no_accepted_offer');
    if (offerAccess(ctx, o) === '') throw util.fail(404, 'No accepted offer you can see.', 'not_found');
  }
  if (o.getString('status') !== 'accepted') throw util.fail(409, 'Offer ' + o.getString('number') + ' is ' + o.getString('status') + '; hire once it is accepted.', 'not_accepted');
  return { hire: hireDraftOf(ctx, o), offer: o.id, application: o.getString('application'), linked: o.getString('employment') !== '' };
}

/**
 * Link a hire to its application: the application becomes hired (the
 * opening's hired stage), the accepted offer gets the employment, the
 * candidate the employee, the opening closes when its positions are filled
 * and the requisition becomes filled. Idempotent.
 */
function linkHire(ctx, applicationId, employmentId, employeeId) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const a = util.byId(app, 'applications', applicationId);
  if (a === null) return { linked: false, reason: 'No application ' + applicationId + '.' };
  if (a.getString('status') === 'hired') {
    if (a.getString('hired_employment') === employmentId) return { linked: true, already: true, application: a.id };
    return { linked: false, reason: 'This application is already linked to another hire.' };
  }
  if (a.getString('status') !== 'active') return { linked: false, reason: 'This application is ' + a.getString('status') + '; reopen it before you link a hire.' };
  const job = app.findRecordById('openings', a.getString('opening'));
  const hired = hh.hiredStage(job);
  const cand = app.findRecordById('candidates', a.getString('candidate'));
  const from = a.getString('stage');
  a.set('status', 'hired');
  if (hired !== null) a.set('stage', hired.key);
  a.set('stage_since', util.nowIso());
  a.set('hired_employment', employmentId);
  a.set('hired_at', util.nowIso());
  a.set('closed_at', util.nowIso());
  a.set('closed_by', ctx.memberId || '');
  app.save(a);
  if (employeeId) {
    cand.set('employee', employeeId);
    app.save(cand);
  }
  const offer = util.findOne(app, 'offers', "application = {:a} && status = 'accepted'", { a: a.id });
  if (offer !== null) {
    offer.set('employment', employmentId);
    app.save(offer);
  }
  L('lib_hiring_interviews').cancelOpenFor(ctx, a.id, 'Hired');
  const emp = util.byId(app, 'employments', employmentId);
  hh.event(ctx, { candidate: cand.id, application: a.id, kind: 'hired', from: from, to: hired !== null ? hired.key : '', text: 'Hired' + (emp !== null ? ' as ' + emp.getString('number') : '') + (offer === null ? ' (no accepted offer on record)' : ''), ref: employmentId });
  const counts = L('lib_hiring_jobs').stageCounts(app, job.id);
  let closed = false;
  if (counts.hired >= job.getInt('positions') && ['open', 'on_hold', 'draft'].indexOf(job.getString('status')) >= 0) {
    job.set('status', 'closed');
    job.set('close_reason', 'filled');
    job.set('closed_at', util.nowIso());
    app.save(job);
    closed = true;
  }
  const reqStatus = L('lib_hiring_plans').refreshFilled(app, job.getString('requisition'));
  const ref = util.findOne(app, 'referrals', 'application = {:a}', { a: a.id });
  if (ref !== null && ref.getString('referrer_member') !== '') L('lib_notify').notify(app, [ref.getString('referrer_member')], { kind: 'hiring', title: 'Your referral ' + cand.getString('name') + ' was hired', body: 'Thank you for the referral.', link: '#/hiring/referrals' });
  L('lib_audit').write(ctx, { op: 'hiring.hired', collection: 'applications', record: a.id, summary: cand.getString('name') + ' hired for ' + job.getString('number') + ' ' + job.getString('title') + (closed ? '; the opening is filled and closed' : '') + (reqStatus === 'filled' ? '; the requisition is filled' : '') });
  return { linked: true, application: a.id, opening_closed: closed, requisition_status: reqStatus, active_left: closed ? util.count(app, "SELECT COUNT(*) AS n FROM applications WHERE opening = {:j} AND status = 'active'", { j: job.id }) : 0 };
}

/** Kernel event employment.hired: link the hire that came from an application. */
function onHired(ctx, payload) {
  if (!payload || !payload.from_application) return null;
  return linkHire(ctx, String(payload.from_application), payload.employment, payload.employee);
}

/* ------------------------------------------------------------- referrals */

/** What a referrer may know: submitted, in process, hired or not moving forward. */
function referralStatus(app, r) {
  if (r.getString('status') === 'withdrawn') return 'withdrawn';
  const a = r.getString('application') !== '' ? u().byId(app, 'applications', r.getString('application')) : null;
  if (a === null) return 'submitted';
  if (a.getString('status') === 'hired') return 'hired';
  if (a.getString('status') !== 'active') return 'not_selected';
  const job = u().byId(app, 'openings', a.getString('opening'));
  const first = job !== null ? h().firstStage(job) : null;
  return first !== null && a.getString('stage') === first.key ? 'submitted' : 'in_process';
}

function referralView(ctx, r, forReferrer) {
  const util = u();
  const app = ctx.app;
  const job = util.byId(app, 'openings', r.getString('opening'));
  const v = {
    id: r.id,
    opening: r.getString('opening'),
    opening_title: job !== null ? job.getString('title') : '',
    opening_number: job !== null ? job.getString('number') : '',
    name: r.getString('name'),
    email: r.getString('email'),
    relationship: r.getString('relationship'),
    note: r.getString('note'),
    status: referralStatus(app, r),
    created: r.getString('created'),
  };
  if (!forReferrer) {
    v.candidate = r.getString('candidate');
    v.application = r.getString('application');
    const emp = r.getString('referrer') !== '' ? util.byId(app, 'employees', r.getString('referrer')) : null;
    v.referrer_name = emp !== null ? L('lib_people').displayName(emp) : h().memberName(app, r.getString('referrer_member'));
  }
  return v;
}

function refer(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const cands = L('lib_hiring_candidates');
  if (!ctx.memberId) throw util.fail(403, 'Referrals are made by people.', 'not_permitted');
  const job = L('lib_hiring_jobs').openingRef(ctx, util.req(p, 'opening'));
  if (job.getString('status') !== 'open') throw util.fail(409, 'This role is not open for referrals.', 'opening_closed');
  const name = util.squash(util.text(p, 'name', 160, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
  const email = util.str(p, 'email', '') !== '' ? String(util.str(p, 'email', '')).toLowerCase() : '';
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw util.fail(400, 'Enter a valid email address.', 'invalid_email', { param: 'email' });
  const me = L('lib_auth').selfEmployee(ctx);
  const myName = me !== '' ? L('lib_people').displayName(util.byId(app, 'employees', me)) : ctx.name;
  let cand = email !== '' ? util.findOne(app, 'candidates', 'email = {:e}', { e: email }) : null;
  if (cand !== null && util.findOne(app, 'applications', 'opening = {:j} && candidate = {:c}', { j: job.id, c: cand.id }) !== null) throw util.fail(409, name + ' is already being considered for this role. Thank you.', 'already_applied');
  let out = null;
  const file = L('lib_files').fileParam(ctx, p, 'resume', 'path');
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    let c = cand !== null ? tx.findRecordById('candidates', cand.id) : null;
    if (c === null) {
      c = u().newRecord(tx, 'candidates');
      c.set('name', name);
      c.set('email', email);
      c.set('phone', u().text(p, 'phone', 60, ''));
      c.set('source', 'referral');
      c.set('source_detail', 'Referred by ' + myName);
      c.set('links', []);
      c.set('tags', []);
      c.set('country', hh.nameOf(tx, 'entities', job.getString('entity'), 'country'));
      c.set('created_actor', 'person');
      if (file !== null) {
        c.set('resume', file);
        let original = '';
        try {
          original = String(file.originalName || file.name || '');
        } catch {
          original = '';
        }
        c.set('resume_name', u().clip(original.split(/[\\/]/).pop() || 'resume', 200));
      }
      tx.save(c);
    }
    const r = u().newRecord(tx, 'referrals');
    r.set('opening', job.id);
    r.set('candidate', c.id);
    r.set('referrer', me);
    r.set('referrer_member', ctx.memberId);
    r.set('name', name);
    r.set('email', email);
    r.set('phone', u().text(p, 'phone', 60, ''));
    r.set('relationship', u().text(p, 'relationship', 200, ''));
    r.set('note', u().text(p, 'note', 4000, ''));
    r.set('status', 'submitted');
    tx.save(r);
    hh.event(t, { candidate: c.id, kind: 'referral', text: 'Referred by ' + myName + ' for ' + job.getString('number') + ' ' + job.getString('title') + (r.getString('relationship') !== '' ? ' (' + r.getString('relationship') + ')' : ''), ref: r.id });
    const a = cands.addApplication(t, c, tx.findRecordById('openings', job.id), { source: 'referral', referral: r.id });
    r.set('application', a.id);
    tx.save(r);
    L('lib_audit').write(t, { op: 'referrals.add', collection: 'referrals', record: r.id, summary: myName + ' referred ' + name + ' for ' + job.getString('number') + ' ' + job.getString('title') });
    out = r.id;
  });
  ctx.audited = true;
  const who = [job.getString('owner'), job.getString('hiring_manager')].filter((id, i, arr) => id !== '' && id !== ctx.memberId && arr.indexOf(id) === i);
  L('lib_notify').notify(app, who, { kind: 'hiring', title: 'New referral for ' + job.getString('title') + ': ' + name, body: 'From ' + myName, link: '#/hiring/openings/' + job.id });
  return { referral: referralView(ctx, app.findRecordById('referrals', out), true) };
}

function referralsMine(ctx, p) {
  const util = u();
  if (!ctx.memberId) return { referrals: [] };
  return { referrals: util.findMany(ctx.app, 'referrals', 'referrer_member = {:m}', '-created', util.int(p, 'limit', 100, 1, 500), { m: ctx.memberId }).map((r) => referralView(ctx, r, true)) };
}

function referralsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const bind = {};
  const where = [hh.jobWhere(ctx, bind, 'j')];
  const op = util.str(p, 'opening', '');
  if (op !== '') {
    where.push('r.opening = {:op}');
    bind.op = L('lib_hiring_jobs').openingRef(ctx, op).id;
  }
  const ids = util.rows(app, 'SELECT r.id AS id FROM referrals r JOIN openings j ON j.id = r.opening WHERE ' + where.join(' AND ') + ' ORDER BY r.created DESC LIMIT ' + util.int(p, 'limit', 200, 1, 1000), { id: '' }, bind);
  return { referrals: ids.map((x) => referralView(ctx, app.findRecordById('referrals', x.id), false)) };
}

module.exports = {
  BASIS: BASIS,
  COMPONENT_PER: COMPONENT_PER,
  offerRef: offerRef,
  offerView: offerView,
  forApplication: forApplication,
  letterText: letterText,
  list: list,
  get: get,
  create: create,
  update: update,
  submit: submit,
  onDecision: onDecision,
  send: send,
  respond: respond,
  withdraw: withdraw,
  letter: letter,
  hireDraft: hireDraft,
  hireDraftOf: hireDraftOf,
  linkHire: linkHire,
  onHired: onHired,
  refer: refer,
  referralsMine: referralsMine,
  referralsList: referralsList,
};
