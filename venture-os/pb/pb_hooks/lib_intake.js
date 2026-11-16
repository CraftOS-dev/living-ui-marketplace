/// <reference path="../pb_data/types.d.ts" />
/**
 * Intake (SPEC 7.6): every inbound or sourced deal starts here as an
 * intake item, from any channel (upload, email sweep, scout, CSV, sourced),
 * gets its reply due day (business days, lib_eng_days), is read by your AI
 * agent (trigger deck_triage, or deck_fetch when only a deck link came:
 * lib_agent.js, the request kept on the item) and waits for a person's
 * verdict: Advance (a deal at Screen), Pass (reason chip, the
 * pass email drafted by your AI agent), Hold (until a day) or Merge.
 *
 * Steps (the StepTrack): received -> reading -> facts -> ready.
 *
 * Cross-module contracts (SPEC 4.6):
 *   add(ctx, { channel, company?, url?, files?: [{ path, name }], text?, source_person?, scout?, thesis? }) -> item view
 *   verdictOf(app, itemId, { ctx? }) -> { facts, checks, missing, status }
 *     With ctx, a fact quoting a deck marked NDA keeps its quote only for those
 *     who may read that file (guardQuotes); without ctx (system work) it is whole.
 * Events: intake.added { item }, intake.ready { item }, intake.advanced { item, deal }, intake.passed { item, pass }.
 */

const CHANNELS = ['email', 'upload', 'scout', 'csv', 'sourced'];
const STATUSES = ['new', 'held', 'passed', 'advanced', 'merged'];
const STEPS = ['received', 'reading', 'facts', 'ready'];
const STEP_LABELS = ['Received', 'Reading', 'Facts', 'Ready'];
const SEGMENTS = ['new', 'waiting', 'held', 'passed', 'advanced', 'all'];
const DECK_EXT = ['pdf', 'pptx', 'ppt', 'key', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'webp', 'gif'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const MAX_FILES = 10;
const LICENCES = ['public', 'internal_only'];
const DECK_FOLDER = 'Deck';
const HOLD_CHOICES = [
  { value: '7', label: '1 week' },
  { value: '30', label: '1 month' },
  { value: '90', label: '3 months' },
];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* ------------------------------------------------------------- basics */

function settings(app) {
  return L('lib_settings').module(app, 'intake');
}

function who(ctx) {
  return ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
}

function stamp(ctx, rec) {
  rec.set('actor', who(ctx));
  rec.set('member', ctx.actor === 'person' ? ctx.memberId : '');
}

/** An item by id or display id (IN-0001). */
function itemRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'item is required (an id or a display id such as IN-0001).', 'missing_param', { param: 'item' });
  let rec = util.byId(app, 'intake_items', r);
  if (rec === null && /^in-\d+$/i.test(r)) rec = util.findOne(app, 'intake_items', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null && !/^in-\d+$/i.test(r)) {
    // By name (the item's or its company's): the newest open item, else the newest one.
    const rows = util.rows(app, "SELECT i.id AS id, i.status AS status FROM intake_items i LEFT JOIN companies c ON c.id = i.company WHERE LOWER(i.name) = LOWER({:n}) OR LOWER(c.name) = LOWER({:n}) OR LOWER(c.domain) = LOWER({:n}) ORDER BY CASE WHEN i.status IN ('new', 'held') THEN 0 ELSE 1 END, i.created DESC LIMIT 5", { id: '', status: '' }, { n: r });
    const open = rows.filter((x) => x.status === 'new' || x.status === 'held');
    if (open.length > 1) throw L('lib_refs').ambiguous('open Inbox items', r, open.map((x) => itemCand(app, x.id)), 'Pass the item number (IN-0007).');
    if (rows.length > 0) rec = util.byId(app, 'intake_items', (open[0] || rows[0]).id);
  }
  if (rec === null) {
    const refs = L('lib_refs');
    const found = refs.matches(app, 'intake_items', 'name', r, { number: 'number' });
    throw refs.notFound('Inbox item', r, found, 'intake.list --q <name>');
  }
  return rec;
}

function itemCand(app, id) {
  const x = u().byId(app, 'intake_items', id);
  return x === null ? { id: id, name: '' } : { id: x.id, name: x.getString('name'), number: x.getString('number'), status: x.getString('status') };
}

/** May ctx see this item? Scouts see only what they submitted. */
function canSee(ctx, rec) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  if (ctx.ownOnly) return rec.getString('submitted_by') === ctx.memberId;
  return L('lib_auth').can(ctx, 'intake', 'view');
}

function visible(ctx, ref) {
  const rec = itemRef(ctx.app, ref);
  if (!canSee(ctx, rec)) throw u().fail(404, 'No intake item ' + ref + ' you can see.', 'not_found');
  return rec;
}

/** Verdicts are for people who decide (scouts only submit). */
function guardDecide(ctx) {
  if (ctx.ownOnly) throw u().fail(403, 'Scouts submit deals; a partner decides on them.', 'not_permitted');
  L('lib_auth').need(ctx, 'intake', 'edit', 'decide on inbound deals');
}

function stepIndex(step) {
  const i = STEPS.indexOf(step);
  return i < 0 ? 0 : i;
}

function setStep(rec, step) {
  if (stepIndex(step) > stepIndex(rec.getString('step'))) rec.set('step', step);
}

function hostOf(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[\/?#]/)[0]
    .split('@')
    .pop()
    .split(':')[0]
    .replace(/^www\./, '');
}

/** The kind of a link by its host (structure, not words): docsend, papermark, drive or website. */
function linkKind(url) {
  const h = hostOf(url);
  if (h === '') return '';
  const ends = (d) => h === d || h.slice(-(d.length + 1)) === '.' + d;
  if (ends('docsend.com')) return 'docsend';
  if (ends('papermark.io') || ends('papermark.com')) return 'papermark';
  if (h === 'drive.google.com' || h === 'docs.google.com') return 'drive';
  return 'website';
}

/** A pasted value that is one web address (no spaces, a host with a dot). */
function looksUrl(s) {
  const t = String(s || '').trim();
  if (t === '' || /\s/.test(t)) return false;
  const h = hostOf(t);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && (t.indexOf('://') > 0 || t.indexOf('/') > 0 || t.indexOf('www.') === 0 || /\.[a-z]{2,}$/.test(h));
}

function extOf(name) {
  const n = String(name || '');
  const i = n.lastIndexOf('.');
  return i < 0 ? '' : n.slice(i + 1).toLowerCase();
}

function baseName(name) {
  const n = String(name || '').replace(/\\/g, '/').split('/').pop();
  const i = n.lastIndexOf('.');
  return u().squash((i > 0 ? n.slice(0, i) : n).replace(/[_]+/g, ' '));
}

/** "Maya Chen <maya@acme.ai>" -> { name, email } (an RFC 5322 address header). */
function parseFrom(header) {
  const s = String(header || '').trim();
  const m = /^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);
  if (m) return { name: u().squash(m[1].replace(/^"|"$/g, '')), email: m[2].toLowerCase() };
  if (/^[^\s@]+@[^\s@]+$/.test(s)) return { name: '', email: s.toLowerCase() };
  return { name: '', email: '' };
}

/* ---------------------------------------------------------- formatting */

/** A compact amount for Next figures ("USD 3M", "USD 850K"); null minor -> 'Unknown'. */
function compact(minor, currency) {
  if (minor === null || minor === undefined || currency === '') return 'Unknown';
  const exp = L('lib_money').exponent(currency);
  const major = Number(minor) / Math.pow(10, exp);
  const abs = Math.abs(major);
  let text;
  if (abs >= 1e9) text = trim1(major / 1e9) + 'B';
  else if (abs >= 1e6) text = trim1(major / 1e6) + 'M';
  else if (abs >= 1e3) text = trim1(major / 1e3) + 'K';
  else text = String(Math.round(major));
  return currency + ' ' + text;
}

function trim1(x) {
  const r = Math.round(x * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

function pctText(ppm) {
  if (ppm === null || ppm === undefined) return 'Unknown';
  return trim1(Number(ppm) / 10000) + '%';
}

/* ---------------------------------------------------------- reply SLA */

function slaDays(app) {
  const n = Number(settings(app).reply_sla_days);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : 5;
}

function dueDay(app, receivedAt) {
  const D = L('lib_eng_days');
  return D.slaDue({ received_at: receivedAt, zone: u().zoneOf(app), days: slaDays(app) }).due_day;
}

/** { day, state: open|due_today|overdue|none, left } for an item (only new items run against the clock). */
function dueOf(app, rec, today) {
  const day = rec.getString('reply_due_day');
  if (day === '' || rec.getString('status') !== 'new') return { day: day, state: 'none', left: null };
  const s = L('lib_eng_days').slaState({ due_day: day, today: today });
  return { day: day, state: s.state, left: s.business_days_left };
}

/* --------------------------------------------------------------- facts */

/** Facts of several items: { itemId: { key: row } }. */
function factsOf(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const bind = {};
  const marks = ids.map((id, i) => {
    bind['i' + i] = id;
    return '{:i' + i + '}';
  });
  const rows = u().rows(app, "SELECT id, item, key, COALESCE(value, 'null') AS value, currency, grade, num_kind, status, source, file, page, quote, anchor, url, note, actor FROM facts WHERE item IN (" + marks.join(',') + ')', { id: '', item: '', key: '', value: '', currency: '', grade: '', num_kind: '', status: '', source: '', file: '', page: 0, quote: '', anchor: '', url: '', note: '', actor: '' }, bind);
  for (const r of rows) {
    if (out[r.item] === undefined) out[r.item] = {};
    let v = null;
    try {
      v = r.value === '' || r.value === 'null' ? null : JSON.parse(r.value);
    } catch {
      v = null;
    }
    out[r.item][r.key] = { id: r.id, key: r.key, value: v, currency: r.currency, grade: r.grade, num_kind: r.num_kind, status: r.status, source: r.source, file: r.file, page: r.page || null, quote: r.quote, anchor: r.anchor, url: r.url, note: r.note, actor: r.actor };
  }
  return out;
}

/**
 * NDA quotes (SPEC 11): a fact quoting a file marked NDA keeps its verbatim
 * quote only for those who may read that file, the rule anchors.resolve
 * applies (lib_files.canRead: the deal team; your AI agent only while a
 * person's NDA ask about the file's deal is pending). For anyone else the
 * quote is withheld: quote '', hidden true and hidden_reason (nda,
 * nda_not_asked or not_visible). Value, grade, page and anchor id stay.
 */
function guardQuotes(ctx, facts) {
  if (!ctx || ctx.actor === 'system') return facts;
  const util = u();
  const Fi = L('lib_files');
  const verdict = {};
  return facts.map((f) => {
    if (!f.file || !f.quote) return f;
    if (verdict[f.file] === undefined) {
      const rec = util.byId(ctx.app, 'files', f.file);
      verdict[f.file] = rec === null || !rec.getBool('nda') ? { ok: true } : Fi.canRead(ctx, rec, { deleted: true });
    }
    const r = verdict[f.file];
    if (r.ok) return f;
    return Object.assign({}, f, { quote: '', hidden: true, hidden_reason: r.reason === 'restricted' || r.reason === 'not_permitted' ? 'not_visible' : r.reason });
  });
}

/** Facts in the fit engine's shape; a money fact in another currency than the item's currency fact counts as unknown. */
function engineFacts(map) {
  const out = {};
  const cur = map.currency && map.currency.value ? String(map.currency.value) : '';
  for (const k of Object.keys(map)) {
    const f = map[k];
    if (/_minor$/.test(k) && f.currency !== '' && f.currency !== cur) out[k] = { value: null, grade: 'unknown' };
    else out[k] = { value: f.value, grade: f.grade };
  }
  return out;
}

/** Fit against every active thesis: [{ thesis, state, counts, checks }] (no score). */
function fitOf(app, map, theses) {
  const T = L('lib_theses');
  const list = theses === undefined ? T.active(app) : theses;
  const facts = engineFacts(map || {});
  const out = [];
  for (const t of list) {
    if (!t.criteria || t.criteria.length === 0) continue;
    const r = T.fit(app, t.id, facts);
    const hasReq = r.checks.some((c) => c.required);
    const state = hasReq ? r.required.state : r.counts.unmet > 0 ? 'unmet' : r.counts.unknown > 0 ? 'unknown' : 'met';
    out.push({ thesis: r.thesis, state: state, counts: r.counts, required: r.required, checks: r.checks });
  }
  return out;
}

/** The four figures of the card: Raise, Valuation, ARR or Revenue, Growth. */
function figuresOf(map, baseCurrency) {
  const m = map || {};
  const cur = m.currency && m.currency.value ? String(m.currency.value) : baseCurrency;
  const money = (f) => (f && f.value !== null && f.value !== undefined ? { minor: Number(f.value), currency: f.currency || cur, grade: f.grade, key: f.key } : null);
  const raise = money(m.raise_minor);
  const val = money(m.post_money_minor) || money(m.pre_money_minor);
  const arr = money(m.arr_minor);
  const rev = money(m.revenue_minor);
  const growth = m.growth_mom_ppm && m.growth_mom_ppm.value !== null && m.growth_mom_ppm.value !== undefined ? m.growth_mom_ppm : null;
  return [
    { key: 'raise', label: 'Raise', fact: raise ? 'raise_minor' : '', minor: raise ? raise.minor : null, currency: raise ? raise.currency : cur, grade: raise ? raise.grade : 'unknown', text: raise ? compact(raise.minor, raise.currency) : 'Unknown' },
    { key: 'valuation', label: 'Valuation', fact: val ? val.key : '', minor: val ? val.minor : null, currency: val ? val.currency : cur, grade: val ? val.grade : 'unknown', text: val ? compact(val.minor, val.currency) : 'Unknown' },
    arr || !rev
      ? { key: 'arr', label: 'ARR', fact: arr ? 'arr_minor' : '', minor: arr ? arr.minor : null, currency: arr ? arr.currency : cur, grade: arr ? arr.grade : 'unknown', text: arr ? compact(arr.minor, arr.currency) : 'Unknown' }
      : { key: 'revenue', label: 'Revenue', fact: 'revenue_minor', minor: rev.minor, currency: rev.currency, grade: rev.grade, text: compact(rev.minor, rev.currency) },
    { key: 'growth', label: 'Growth', fact: growth ? 'growth_mom_ppm' : '', ppm: growth ? Number(growth.value) : null, grade: growth ? growth.grade : 'unknown', text: growth ? pctText(growth.value) + ' MoM' : 'Unknown' },
  ];
}

/* -------------------------------------------------------------- history */

/** Earlier items, passes and deals for the same company or the same founders. */
function historyOf(ctx, rec) {
  const util = u();
  const app = ctx.app;
  let company = rec.getString('company');
  if (company === '' && rec.getString('guess_domain') !== '') {
    const c = util.one(app, "SELECT id FROM companies WHERE domain = {:d} AND merged_into = '' AND deleted_at = '' LIMIT 1", { id: '' }, { d: rec.getString('guess_domain') });
    if (c !== null) company = c.id;
  }
  const founders = (util.jsonOf(rec, 'people', []) || []).filter((x) => x && x.role === 'founder' && x.person).map((x) => x.person);
  const out = [];
  const bind = { me: rec.id, c: company || '-' };
  const fm = founders.map((p, i) => {
    bind['p' + i] = p;
    return '{:p' + i + '}';
  });
  const byFounder = fm.length > 0 ? " OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(i.people) THEN i.people ELSE '[]' END) j WHERE json_extract(j.value, '$.person') IN (" + fm.join(',') + '))' : '';
  const items = util.rows(app, "SELECT i.id, i.number, i.status, i.received_at, i.deal, i.pass, i.company FROM intake_items i WHERE i.id != {:me} AND i.status != 'merged' AND (i.company = {:c}" + byFounder + ') ORDER BY i.received_at DESC LIMIT 10', { id: '', number: '', status: '', received_at: '', deal: '', pass: '', company: '' }, bind);
  for (const it of items) {
    let reason = '';
    if (it.pass !== '') {
      const p = util.byId(app, 'passes', it.pass);
      if (p !== null) reason = p.getString('reason');
    }
    out.push({ kind: 'item', id: it.id, label: it.number, status: it.status, day: util.dayOf(app, it.received_at), reason: reason, same: it.company === company && company !== '' ? 'company' : 'founder', href: '#/inbox?item=' + it.number });
  }
  let hidden = 0;
  if (company !== '') {
    for (const d of util.findMany(app, 'deals', "company = {:c} && deleted_at = ''", '-created', 10, { c: company })) {
      if (d.id === rec.getString('deal') || d.getString('intake_item') === rec.id) continue;
      if (!L('lib_auth').dealVisible(ctx, d)) {
        hidden++;
        continue;
      }
      out.push({ kind: 'deal', id: d.id, label: d.getString('number'), status: d.getString('status'), stage: d.getString('stage'), day: util.dayOf(app, d.getString('created')), reason: d.getString('status_reason'), same: 'company', href: '#/deals/' + d.getString('number') });
    }
  }
  out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return { company: company, prior: out, hidden: hidden };
}

/* ---------------------------------------------------------------- views */

/** The step to draw: the stored step, or Reading once your AI agent started (triage.start). */
function shownStep(rec) {
  let i = stepIndex(rec.getString('step'));
  if (i < 1 && rec.getString('triage_state') === 'working') i = 1;
  return i;
}

function sourceOf(app, rec) {
  const R = L('lib_records');
  if (rec.getString('scout') !== '') {
    const s = u().byId(app, 'scouts', rec.getString('scout'));
    if (s !== null) return { kind: 'scout', label: s.getString('name'), id: s.id };
  }
  if (rec.getString('source_person') !== '') {
    const p = R.mini(app, 'people', rec.getString('source_person'));
    if (p !== null) return { kind: rec.getString('channel') === 'email' ? 'email' : 'person', label: p.name || p.email, id: p.id };
  }
  const ch = rec.getString('channel');
  return { kind: ch, label: ch === 'upload' ? 'Upload' : ch === 'csv' ? 'Import' : ch === 'sourced' ? 'Sourced' : ch === 'email' ? 'Email' : 'Scout', id: '' };
}

/** A list row. */
function rowOut(ctx, rec, x) {
  const app = ctx.app;
  const status = rec.getString('status');
  const at = shownStep(rec);
  const asked = L('lib_agent').view(rec, READS);
  const fit = x.fit[rec.id] || [];
  const R = L('lib_records');
  const out = {
    id: rec.id,
    number: rec.getString('number'),
    name: rec.getString('name'),
    one_liner: rec.getString('one_liner'),
    channel: rec.getString('channel'),
    status: status,
    step: STEPS[at],
    steps: { labels: STEP_LABELS, at: at },
    triage_state: rec.getString('triage_state'),
    waiting_agent: rec.getString('triage_state') === 'waiting' && at < 3 && READS.some((t) => asked[t] !== undefined && asked[t].pending),
    read_trigger: readTrigger(rec),
    agent: asked,
    source: sourceOf(app, rec),
    company: R.mini(app, 'companies', rec.getString('company')),
    fit: fit.map((f) => ({ thesis: f.thesis, state: f.state, counts: f.counts })),
    figures: x.figures[rec.id] || [],
    due: dueOf(app, rec, x.today),
    received_at: rec.getString('received_at'),
    files: (u().jsonOf(rec, 'files', []) || []).length,
    hold_until: rec.getString('hold_until'),
    revisit_day: rec.getString('revisit_day'),
    deal: null,
    pass: null,
  };
  if (rec.getString('deal') !== '') {
    const d = u().byId(app, 'deals', rec.getString('deal'));
    out.deal = d !== null ? { id: d.id, number: d.getString('number') } : null;
  }
  if (rec.getString('pass') !== '') {
    const p = u().byId(app, 'passes', rec.getString('pass'));
    if (p !== null) out.pass = { id: p.id, reason: p.getString('reason'), reason_label: L('lib_intake_pass').reasonLabel(p.getString('reason')), email_state: L('lib_intake_pass').mailState(app, p), revisit_day: p.getString('revisit_day') };
  }
  if (ctx.ownOnly) {
    out.fit = [];
    out.figures = [];
  }
  return out;
}

/** Shared lookups for a page of rows. */
function extras(ctx, recs, withFit) {
  const app = ctx.app;
  const today = u().today(app);
  const facts = factsOf(
    app,
    recs.map((r) => r.id),
  );
  const theses = withFit ? L('lib_theses').active(app) : [];
  const base = L('lib_settings').row(app).getString('base_currency') || 'USD';
  const fit = {};
  const figures = {};
  for (const r of recs) {
    const f = facts[r.id] || {};
    figures[r.id] = figuresOf(f, base);
    fit[r.id] = withFit && Object.keys(f).length > 0 ? fitOf(app, f, theses) : [];
  }
  return { today: today, facts: facts, fit: fit, figures: figures };
}

function factOut(app, f) {
  const T = L('lib_theses').facts();
  const info = T[f.key] || { label: f.key, type: 'text' };
  let fileName = '';
  if (f.file) {
    const fr = u().byId(app, 'files', f.file);
    if (fr !== null) fileName = fr.getString('name');
  }
  return Object.assign({}, f, { label: info.label, type: info.type, file_name: fileName, text: factText(f, info) });
}

/** A fact's value as people read it. */
function factText(f, info) {
  if (f.value === null || f.value === undefined || f.grade === 'unknown') return 'Unknown';
  const t = info ? info.type : 'text';
  if (t === 'money') return compact(f.value, f.currency || '');
  if (t === 'bool') return f.value === true ? 'Yes' : 'No';
  if (f.key === 'growth_mom_ppm') return pctText(f.value) + ' MoM';
  if (f.key === 'gross_margin_ppm') return pctText(f.value);
  if (f.key === 'runway_months') return String(f.value) + ' months';
  if (typeof f.value === 'string') return info && info.values ? codeText(f.value) : f.value;
  return String(f.value);
}

const CODE_TEXT = { saas: 'SaaS', pre_seed: 'Pre-seed', seed_extension: 'Seed extension', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', series_d_plus: 'Series D+' };

/** A coded value as people read it (seed -> Seed, saas -> SaaS). */
function codeText(v) {
  if (CODE_TEXT[v] !== undefined) return CODE_TEXT[v];
  const t = String(v).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The full card. */
function detail(ctx, rec) {
  const app = ctx.app;
  const util = u();
  const x = extras(ctx, [rec], !ctx.ownOnly);
  const row = rowOut(ctx, rec, x);
  const S = L('lib_intake_triage');
  const F = L('lib_files');
  const fileIds = util.jsonOf(rec, 'files', []) || [];
  const files = [];
  const texts = fileIds.length > 0 ? F.textsOf(app, fileIds) : {};
  for (const fid of fileIds) {
    const f = util.byId(app, 'files', fid);
    if (f === null || f.getString('deleted_at') !== '') continue;
    files.push(F.fileOut(app, f, texts[fid]));
  }
  const map = x.facts[rec.id] || {};
  const facts = ctx.ownOnly ? [] : L('lib_theses').facts();
  const factList = [];
  for (const k of Object.keys(facts)) if (map[k] !== undefined) factList.push(factOut(app, map[k]));
  const shownFacts = guardQuotes(ctx, factList);
  const people = (util.jsonOf(rec, 'people', []) || []).map((p) => Object.assign({ role: p.role }, L('lib_records').mini(app, 'people', p.person) || { id: p.person, name: '', email: '' }));
  let pass = null;
  if (rec.getString('pass') !== '') {
    const p = util.byId(app, 'passes', rec.getString('pass'));
    if (p !== null) pass = L('lib_intake_pass').passOut(ctx, p);
  }
  const merged = rec.getString('merged_into') !== '' ? util.byId(app, 'intake_items', rec.getString('merged_into')) : null;
  return Object.assign(row, {
    text: ctx.ownOnly ? '' : util.clip(rec.getString('text'), 20000),
    url: rec.getString('url'),
    link_kind: rec.getString('link_kind'),
    licence: rec.getString('licence'),
    website: rec.getString('website'),
    email_from: rec.getString('email_from'),
    email_subject: rec.getString('email_subject'),
    files_list: files,
    facts: shownFacts,
    fit: ctx.ownOnly ? [] : x.fit[rec.id] || [],
    missing: ctx.ownOnly ? [] : (util.jsonOf(rec, 'missing', []) || []).map((k) => ({ key: k, label: S.slideLabel(k) })),
    questions: ctx.ownOnly ? [] : util.jsonOf(rec, 'questions', []) || [],
    history: ctx.ownOnly ? { prior: [], hidden: 0 } : historyOf(ctx, rec),
    people: people,
    thesis: thesisMini(app, rec.getString('thesis')),
    pass: pass,
    triage_note: rec.getString('triage_note'),
    note: rec.getString('note'),
    merged_into: merged !== null ? { id: merged.id, number: merged.getString('number') } : null,
    decided_by: L('lib_records').mini(app, 'members', rec.getString('decided_by')),
    decided_at: rec.getString('decided_at'),
    may_decide: !ctx.isAgent && !ctx.ownOnly && L('lib_auth').can(ctx, 'intake', 'edit'),
    agent_facts: factList.some((f) => f.actor === 'agent'),
    logo_domain: logoDomain(app, row.company, rec.getString('website')),
  });
}

/** The domain whose public favicon is the company's logo on the card ('' in a demo firm: its companies are fictional). */
function logoDomain(app, company, website) {
  if (L('lib_mail').demo(app)) return '';
  if (company && company.domain) return company.domain;
  const m = String(website || '').match(/^(?:https?:\/\/)?(?:www\.)?([^/?#\s]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function thesisMini(app, id) {
  if (!id) return null;
  const t = u().byId(app, 'theses', id);
  return t === null ? null : { id: t.id, name: t.getString('name') };
}

/** The fund a new deal defaults to: the one fund in the person's scope, or the firm's only active fund. */
function defaultFund(ctx) {
  const util = u();
  const scope = L('lib_auth').scope(ctx);
  if (scope.length === 1) return scope[0];
  const funds = util.rows(ctx.app, "SELECT id FROM entities WHERE kind = 'fund' AND archived = FALSE LIMIT 2", { id: '' });
  return funds.length === 1 ? funds[0].id : '';
}

function itemView(ctx, id) {
  return detail(ctx, ctx.app.findRecordById('intake_items', id));
}

/* ------------------------------------------------------------- triage */

/** The triggers that read an item (its `agent` keeps their requests). */
const READS = ['deck_triage', 'deck_fetch'];

/** How your AI agent reads this item: deck_fetch for a deck link alone, deck_triage when there is something to read, '' when nothing. */
function readTrigger(rec) {
  const files = u().jsonOf(rec, 'files', []) || [];
  const lk = rec.getString('link_kind');
  if (files.length > 0) return 'deck_triage';
  if (lk === 'docsend' || lk === 'papermark' || lk === 'drive') return 'deck_fetch';
  if (lk === 'website' || u().squash(rec.getString('text')) !== '') return 'deck_triage';
  return '';
}

/**
 * Ask your AI agent to read a saved item without a click on Ask: the
 * person who added it (Add deal, a scout's submission, a file a person
 * added) asks; a deck that arrived by email is read only while the firm's
 * email_decks switch is on. A deck your AI agent fetched from a link it
 * reads in the same run (deck_fetch), so nothing fires for it. Imports and
 * what your AI agent sourced itself wait for Ask your AI agent. Sets the
 * item's triage state on `rec` (the caller saves it). Answers the request
 * id ('' when nothing was asked).
 */
function askRead(ctx, rec) {
  if (ctx.dryRun) return '';
  const t = readTrigger(rec);
  if (t === '') {
    rec.set('triage_state', 'none');
    rec.set('step', 'ready');
    return '';
  }
  if (ctx.isAgent) return '';
  const A = L('lib_agent');
  const ch = rec.getString('channel');
  let id = '';
  if (ch === 'email') id = A.ask(ctx.app, t, rec, {}, { policy: true });
  else if (ctx.actor === 'person' && ctx.memberId && (ch === 'upload' || ch === 'scout')) id = A.ask(ctx.app, t, rec, {}, { by: ctx.memberId });
  // Fired, or asked again by the minute job once the cooldown passes: the item waits for your AI agent.
  if (id !== '' || A.deferred(ctx.app, t, rec.id)) {
    rec.set('triage_state', 'waiting');
    rec.set('triage_note', '');
  } else if (rec.getString('triage_state') !== 'done') rec.set('triage_state', 'none');
  return id;
}

/** agent.ask --trigger deck_triage|deck_fetch --record <item>: the item is open and has that to read. */
function askCheck(ctx, rec, p) {
  const util = u();
  guardDecide(ctx);
  open(rec, ['new', 'held'], 'read');
  const t = readTrigger(rec);
  const want = util.str(p, 'trigger', '');
  if (t === '') throw util.fail(409, 'There is nothing to read on ' + rec.getString('number') + ': add a deck, a link or the email text first.', 'nothing_to_read');
  if (want !== '' && want !== t) throw util.fail(409, rec.getString('number') + (t === 'deck_fetch' ? ' has only a deck link: ask with deck_fetch.' : ' has its deck: ask with deck_triage.'), 'invalid_param', { param: 'trigger', use: t });
  return {};
}

/** After a person's ask fired: the item waits for your AI agent. */
function onAsked(ctx, rec) {
  const fresh = ctx.app.findRecordById('intake_items', rec.id);
  fresh.set('triage_state', 'waiting');
  fresh.set('triage_note', '');
  ctx.app.save(fresh);
}

/** agent.cannot on a reading: the item shows why, and Ask your AI agent again. */
function onCannot(ctx, rec, reason) {
  const fresh = ctx.app.findRecordById('intake_items', rec.id);
  fresh.set('triage_state', 'failed');
  fresh.set('triage_note', u().clip(String(reason || ''), 2000));
  ctx.app.save(fresh);
}

/* ------------------------------------------------------------------ add */

function scoutForMember(ctx) {
  const util = u();
  const app = ctx.app;
  let s = util.findOne(app, 'scouts', 'account = {:m}', { m: ctx.memberId });
  if (s !== null) return s;
  if (ctx.email !== '') s = util.findOne(app, 'scouts', 'email = {:e}', { e: ctx.email.toLowerCase() });
  if (s !== null) {
    s.set('account', ctx.memberId);
    app.save(s);
    return s;
  }
  s = util.newRecord(app, 'scouts');
  s.set('name', ctx.name || ctx.email);
  s.set('email', String(ctx.email || '').toLowerCase());
  s.set('account', ctx.memberId);
  s.set('status', 'active');
  stamp(ctx, s);
  app.save(s);
  return s;
}

function scoutRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') return null;
  let s = util.byId(app, 'scouts', r);
  if (s === null && r.indexOf('@') > 0) s = util.findOne(app, 'scouts', 'email = {:e}', { e: r.toLowerCase() });
  if (s === null) {
    const rows = util.rows(app, 'SELECT id FROM scouts WHERE LOWER(name) = LOWER({:n}) LIMIT 2', { id: '' }, { n: r });
    if (rows.length === 1) s = app.findRecordById('scouts', rows[0].id);
  }
  if (s === null) throw util.fail(404, 'No scout ' + r + '. Run scouts.list.', 'not_found', { param: 'scout' });
  return s;
}

/** A person reference: id, email, or { name, email }. Answers the person id. */
function personFor(ctx, ref, sourceRef) {
  if (ref === undefined || ref === null || ref === '') return '';
  const R = L('lib_records');
  if (typeof ref === 'object') return R.upsertPerson(ctx, Object.assign({ origin: 'intake', source_ref: sourceRef || '' }, ref)).id;
  const r = String(ref).trim();
  if (r.indexOf('@') > 0) return R.upsertPerson(ctx, { email: r, origin: 'intake', source_ref: sourceRef || '' }).id;
  return R.resolve(ctx.app, 'people', r).id;
}

/** A company from a reference a person or your AI agent gave: id, domain, website or name. */
function companyFor(ctx, ref, sourceRef) {
  const R = L('lib_records');
  if (ref === undefined || ref === null || ref === '') return null;
  if (typeof ref === 'object') return R.upsertCompany(ctx, Object.assign({ origin: 'intake', source_ref: sourceRef || '' }, ref));
  const r = String(ref).trim();
  const byId = u().byId(ctx.app, 'companies', r);
  if (byId !== null) return R.companyOut(ctx.app, byId);
  if (looksUrl(r) && r.indexOf(' ') < 0) return R.upsertCompany(ctx, { website: L('lib_norm').url(r), origin: 'intake', source_ref: sourceRef || '' });
  return R.upsertCompany(ctx, { name: r, origin: 'intake', source_ref: sourceRef || '' });
}

/**
 * add(ctx, o) -> item view (SPEC 4.6). o: { channel, company?, url?, files?: [{ path, name }],
 * uploads? (form files), text?, name?, source_person?, scout?, thesis?, website?, received_at?,
 * message? { id, thread_id, from, subject } (the Gmail sweep), trusted? (hook-held paths),
 * licence? ('public' default | 'internal_only': from the firm's licensed sources, never in LP outputs) }.
 */
function add(ctx, o0) {
  const util = u();
  const app = ctx.app;
  const o = Object.assign({}, o0 || {});
  let channel = String(o.channel || (ctx.isAgent ? 'sourced' : 'upload'));
  if (ctx.ownOnly) channel = 'scout';
  if (CHANNELS.indexOf(channel) < 0) throw util.fail(400, 'channel must be one of: ' + CHANNELS.join(', ') + '.', 'invalid_param', { param: 'channel' });
  if (ctx.ownOnly && (o.scout || o.thesis)) throw util.fail(403, 'Scouts add deals as themselves.', 'not_permitted');
  let text = typeof o.text === 'string' ? o.text : '';
  let url = String(o.url || '').trim();
  if (url === '' && looksUrl(text)) {
    url = text.trim();
    text = '';
  }
  if (text.length > 100000) throw util.fail(400, 'text is too long (at most 100,000 characters).', 'invalid_param', { param: 'text' });
  const licence = o.licence === undefined || o.licence === null || o.licence === '' ? 'public' : String(o.licence);
  if (LICENCES.indexOf(licence) < 0) throw util.fail(400, 'licence must be one of: ' + LICENCES.join(', ') + '.', 'invalid_param', { param: 'licence' });
  if (url !== '' && !looksUrl(url)) throw util.fail(400, 'url is not a web address.', 'invalid_param', { param: 'url' });
  url = url !== '' ? L('lib_norm').url(url) : '';
  const uploads = o.uploads || [];
  const paths = o.files || [];
  if (uploads.length + paths.length > MAX_FILES) throw util.fail(400, 'At most ' + MAX_FILES + ' files in one deal.', 'too_many');
  for (const f of uploads) {
    const ext = extOf(f.originalName || f.name);
    if (DECK_EXT.indexOf(ext) < 0) throw util.fail(400, '"' + (f.originalName || f.name) + '" is not a deck: drop a PDF, PowerPoint, Keynote or an image.', 'invalid_file', { allowed: DECK_EXT });
  }
  for (const f of paths) {
    const ext = extOf(f.name || f.path);
    if (DECK_EXT.indexOf(ext) < 0) throw util.fail(400, '"' + (f.name || f.path) + '" is not a deck: give a PDF, PowerPoint, Keynote or an image.', 'invalid_file', { allowed: DECK_EXT });
  }
  const msg = o.message || null;
  if (msg && msg.id) {
    const dup = util.findOne(app, 'intake_items', 'message_id = {:m}', { m: String(msg.id) });
    if (dup !== null) throw util.fail(409, 'That email is already in the Inbox as ' + dup.getString('number') + '.', 'duplicate', { item: dup.id, number: dup.getString('number') });
  }
  const sourceRef = msg && msg.id ? 'gmail:' + msg.id : url;
  const hasSomething = uploads.length + paths.length > 0 || url !== '' || util.squash(text) !== '' || (o.company !== undefined && o.company !== null && o.company !== '') || util.squash(o.name || '') !== '';
  if (!hasSomething) throw util.fail(400, 'Drop a deck, paste a link or an email, or name the company.', 'missing_param', { param: 'file' });

  // Who and what.
  let scout = null;
  if (ctx.ownOnly) scout = scoutForMember(ctx);
  else if (o.scout) scout = scoutRef(app, o.scout);
  if (scout !== null && channel === 'upload') channel = 'scout';
  let thesis = '';
  if (o.thesis) thesis = L('lib_theses').thesisRef(app, o.thesis).id;
  let sourcePerson = '';
  if (o.source_person) sourcePerson = personFor(ctx, o.source_person, sourceRef);
  let company = null;
  if (o.company !== undefined && o.company !== null && o.company !== '') company = companyFor(ctx, o.company, sourceRef);
  const lk = url !== '' ? linkKind(url) : '';
  let website = String(o.website || '').trim();
  if (website === '' && lk === 'website') website = url;
  if (company === null && website !== '' && !ctx.ownOnly) {
    const d = L('lib_norm').domain(website);
    if (d !== '' && !L('lib_norm').isFreeMail(d)) company = companyFor(ctx, L('lib_norm').url(website), sourceRef);
  }
  let guess = '';
  if (company === null) {
    if (website !== '') guess = L('lib_norm').workDomain(website);
    else if (msg && msg.from) guess = L('lib_norm').workDomain(parseFrom(msg.from).email);
  }
  const fileNames = uploads.map((f) => f.originalName || f.name).concat(paths.map((f) => f.name || f.path));
  const name = company !== null ? company.name : util.squash(o.name || '') !== '' ? util.clip(util.squash(o.name), 200) : msg && msg.subject ? util.clip(util.squash(msg.subject), 200) : fileNames.length > 0 ? util.clip(baseName(fileNames[0]), 200) : guess !== '' ? L('lib_norm').companyFromDomain(guess) : url !== '' ? hostOf(url) : 'Untitled';
  const receivedAt = o.received_at && Number.isFinite(Date.parse(String(o.received_at))) ? new Date(Date.parse(String(o.received_at))).toISOString() : util.nowIso();

  const rec = util.newRecord(app, 'intake_items');
  rec.set('number', util.nextId(app, 'IN', 4));
  rec.set('channel', channel);
  rec.set('status', 'new');
  rec.set('step', 'received');
  rec.set('triage_state', 'none');
  rec.set('name', name);
  rec.set('company', company !== null ? company.id : '');
  rec.set('guess_domain', guess);
  rec.set('website', util.clip(website, 300));
  rec.set('source_person', sourcePerson);
  rec.set('scout', scout !== null ? scout.id : '');
  rec.set('submitted_by', ctx.actor === 'person' ? ctx.memberId : '');
  rec.set('thesis', thesis);
  rec.set('url', util.clip(url, 1000));
  rec.set('link_kind', lk);
  rec.set('licence', licence);
  rec.set('text', text);
  rec.set('message_id', msg && msg.id ? util.clip(String(msg.id), 200) : '');
  rec.set('thread_id', msg && msg.thread_id ? util.clip(String(msg.thread_id), 200) : '');
  rec.set('email_from', msg && msg.from ? util.clip(String(msg.from), 300) : '');
  rec.set('email_subject', msg && msg.subject ? util.clip(String(msg.subject), 300) : '');
  rec.set('received_at', receivedAt);
  rec.set('reply_due_day', dueDay(app, receivedAt));
  rec.set('files', []);
  rec.set('people', sourcePerson !== '' && company !== null && sameDomain(app, sourcePerson, company.domain) ? [{ person: sourcePerson, role: 'founder' }] : []);
  rec.set('missing', []);
  rec.set('questions', []);
  rec.set('prov', { name: { by: who(ctx), at: util.nowIso(), source: sourceRef } });
  rec.set('run', ctx.run || '');
  stamp(ctx, rec);
  app.save(rec);

  // Files: people's uploads, your AI agent's paths, or hook-held paths (the Gmail sweep).
  const F = L('lib_files');
  const origin = channel === 'email' ? 'email' : ctx.isAgent ? 'agent' : channel === 'csv' ? 'import' : 'upload';
  for (const f of uploads) F.add(ctx, { owner_collection: 'intake_items', owner_id: rec.id, folder: DECK_FOLDER, upload: f, origin: origin, source_ref: sourceRef });
  for (const f of paths) {
    if (o.trusted === true) F.fromPath(ctx, { owner_collection: 'intake_items', owner_id: rec.id, folder: DECK_FOLDER, path: f.path, name: f.name, origin: origin, source_ref: sourceRef });
    else F.add(ctx, { owner_collection: 'intake_items', owner_id: rec.id, folder: DECK_FOLDER, path: f.path, name: f.name, origin: origin, source_ref: sourceRef });
  }
  const fresh = app.findRecordById('intake_items', rec.id);
  if ((util.jsonOf(fresh, 'files', []) || []).length === 0) askRead(ctx, fresh);
  app.save(fresh);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: (ctx.isAgent ? 'Your AI agent added ' : 'Added ') + fresh.getString('number') + ' ' + util.clip(name, 120) + ' to the Inbox' });
  if (!ctx.dryRun) L('lib_events').emit(ctx, 'intake.added', { item: rec.id });
  return itemView(ctx, rec.id);
}

function sameDomain(app, personId, domain) {
  if (!domain) return false;
  const p = u().byId(app, 'people', personId);
  if (p === null) return false;
  return L('lib_norm').workDomain(p.getString('email')) === domain;
}

/* ----------------------------------------------------------------- ops */

/** A param that is a reference (text) or an object (JSON from the screens, or JSON text from the CLI). */
function refParam(p, name) {
  const util = u();
  if (!util.has(p, name)) return '';
  const v = util.scalar(p[name]);
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v;
  const t = util.str(p, name, '');
  return t.charAt(0) === '{' ? util.obj(p, name) : t;
}

function opAdd(ctx, p) {
  const util = u();
  const uploads = ctx.e ? L('lib_files').uploadedAll(ctx.e, 'file') : [];
  const paths = (util.list(p, 'paths') || []).map((x) => {
    if (!ctx.isAgent) throw util.fail(403, 'paths is for your AI agent; upload the file instead.', 'not_permitted', { param: 'paths' });
    return { path: String(x), name: String(x).replace(/\\/g, '/').split('/').pop() };
  });
  return add(ctx, {
    channel: util.str(p, 'channel', ''),
    company: refParam(p, 'company'),
    url: util.str(p, 'url', ''),
    licence: util.str(p, 'licence', ''),
    text: util.text(p, 'text', 100000, ''),
    name: util.text(p, 'name', 200, ''),
    website: util.str(p, 'website', ''),
    source_person: refParam(p, 'source_person'),
    scout: util.str(p, 'scout', ''),
    thesis: util.str(p, 'thesis', ''),
    received_at: util.str(p, 'received_at', ''),
    uploads: uploads,
    files: paths,
  });
}

/** Segment counts in one query. */
function counts(ctx) {
  const util = u();
  const own = ctx.ownOnly ? ' AND i.submitted_by = {:m}' : '';
  const r = util.one(
    ctx.app,
    "SELECT COALESCE(SUM(CASE WHEN i.status = 'new' THEN 1 ELSE 0 END), 0) AS n_new, COALESCE(SUM(CASE WHEN i.status = 'held' THEN 1 ELSE 0 END), 0) AS n_held, COALESCE(SUM(CASE WHEN i.status = 'passed' AND (p.email_state = 'waiting' OR (p.email_state = 'failed' AND p.outbound = '') OR (p.outbound != '' AND o.status IN ('draft', 'approved', 'sending', 'failed'))) THEN 1 ELSE 0 END), 0) AS n_waiting, COALESCE(SUM(CASE WHEN i.status = 'passed' THEN 1 ELSE 0 END), 0) AS n_passed, COALESCE(SUM(CASE WHEN i.status = 'advanced' THEN 1 ELSE 0 END), 0) AS n_advanced FROM intake_items i LEFT JOIN passes p ON p.id = i.pass LEFT JOIN outbound o ON o.id = p.outbound WHERE 1 = 1" + own,
    { n_new: 0, n_held: 0, n_waiting: 0, n_passed: 0, n_advanced: 0 },
    { m: ctx.memberId || '-' },
  );
  return { new: r.n_new, waiting: r.n_waiting, held: r.n_held, passed: r.n_passed, advanced: r.n_advanced };
}

/**
 * The Inbox at a glance: ready for a verdict, past the reply day, due today,
 * and the median reply time over the last 90 days (business days from
 * arrival to the verdict, lib_eng_days).
 */
function stats(ctx) {
  const util = u();
  const app = ctx.app;
  const t = util.today(app);
  const own = ctx.ownOnly ? ' AND submitted_by = {:m}' : '';
  const r = util.one(app, "SELECT COALESCE(SUM(CASE WHEN step = 'ready' THEN 1 ELSE 0 END), 0) AS ready, COALESCE(SUM(CASE WHEN reply_due_day != '' AND reply_due_day < {:t} THEN 1 ELSE 0 END), 0) AS overdue, COALESCE(SUM(CASE WHEN reply_due_day = {:t} THEN 1 ELSE 0 END), 0) AS today FROM intake_items WHERE status = 'new'" + own, { ready: 0, overdue: 0, today: 0 }, { t: t, m: ctx.memberId || '-' });
  const since = util.atOf(app, util.dayAdd(t, -90), '00:00');
  const D = L('lib_eng_days');
  const zone = util.zoneOf(app);
  const spans = [];
  for (const x of util.rows(app, "SELECT received_at, decided_at FROM intake_items WHERE status IN ('advanced', 'passed') AND decided_at != '' AND decided_at >= {:s}" + own + ' ORDER BY decided_at DESC LIMIT 500', { received_at: '', decided_at: '' }, { s: since, m: ctx.memberId || '-' })) {
    if (x.received_at === '') continue;
    const a = D.localDay(zone, x.received_at);
    const b = D.localDay(zone, x.decided_at);
    if (b >= a) spans.push(D.businessDaysBetween(a, b, {}));
  }
  spans.sort((p, q) => p - q);
  let median = null;
  if (spans.length > 0) median = spans.length % 2 === 1 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2;
  return { ready: r.ready, overdue: r.overdue, due_today: r.today, reply_days: median, decided_90: spans.length };
}

/** intake.list: one segment of the Inbox, newest first (New: oldest due first), with counts per segment. */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const seg = util.oneOf(p, 'segment', SEGMENTS, 'new');
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  if (seg === 'new') where.push("i.status = 'new'");
  else if (seg === 'held') where.push("i.status = 'held'");
  else if (seg === 'passed') where.push("i.status = 'passed'");
  else if (seg === 'advanced') where.push("i.status = 'advanced'");
  else if (seg === 'waiting') where.push("i.status = 'passed' AND (p.email_state = 'waiting' OR (p.email_state = 'failed' AND p.outbound = '') OR (p.outbound != '' AND o.status IN ('draft', 'approved', 'sending', 'failed')))");
  else where.push("i.status != 'merged'");
  if (ctx.ownOnly) {
    where.push('i.submitted_by = {:m}');
    bind.m = ctx.memberId;
  }
  const channel = util.oneOf(p, 'channel', CHANNELS, '');
  if (channel !== '') {
    where.push('i.channel = {:ch}');
    bind.ch = channel;
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(i.number LIKE {:q} ESCAPE '\\' OR i.name LIKE {:q} ESCAPE '\\' OR i.one_liner LIKE {:q} ESCAPE '\\' OR i.email_from LIKE {:q} ESCAPE '\\' OR c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const order = seg === 'new' ? 'i.reply_due_day ASC, i.received_at ASC' : seg === 'held' ? 'i.hold_until ASC, i.received_at DESC' : 'i.received_at DESC';
  const ids = util.rows(app, 'SELECT i.id FROM intake_items i LEFT JOIN passes p ON p.id = i.pass LEFT JOIN outbound o ON o.id = p.outbound LEFT JOIN companies c ON c.id = i.company WHERE ' + where.join(' AND ') + ' ORDER BY ' + order + ' LIMIT ' + (pg.limit + 1) + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const more = ids.length > pg.limit;
  const recs = ids.slice(0, pg.limit).map((r) => app.findRecordById('intake_items', r.id));
  const x = extras(ctx, recs, !ctx.ownOnly);
  return { segment: seg, items: recs.map((r) => rowOut(ctx, r, x)), counts: counts(ctx), stats: pg.offset === 0 ? stats(ctx) : null, next_offset: more ? pg.offset + pg.limit : null, sla_days: slaDays(app), hidden: 0 };
}

function opGet(ctx, p) {
  return detail(ctx, visible(ctx, u().req(p, 'item')));
}

/** intake.update: a person corrects the item (company, name, one-liner, source, scout, thesis, link). */
function opUpdate(ctx, p) {
  const util = u();
  guardDecide(ctx);
  const rec = visible(ctx, util.req(p, 'item'));
  const changed = [];
  if (refParam(p, 'company') !== '') {
    const c = companyFor(ctx, refParam(p, 'company'), 'intake ' + rec.getString('number'));
    rec.set('company', c.id);
    rec.set('name', c.name);
    rec.set('guess_domain', '');
    changed.push('company');
  }
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 200, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty.', 'invalid_param', { param: 'name' });
    rec.set('name', n);
    changed.push('name');
  }
  if (util.has(p, 'one_liner')) {
    rec.set('one_liner', util.squash(util.text(p, 'one_liner', 300, '')));
    changed.push('one_liner');
  }
  if (util.has(p, 'source_person')) {
    const sp = refParam(p, 'source_person');
    rec.set('source_person', sp === '' ? '' : personFor(ctx, sp, 'intake ' + rec.getString('number')));
    changed.push('source_person');
  }
  if (util.has(p, 'scout')) {
    const s = util.str(p, 'scout', '');
    rec.set('scout', s === '' ? '' : scoutRef(ctx.app, s).id);
    changed.push('scout');
  }
  if (util.has(p, 'thesis')) {
    const t = util.str(p, 'thesis', '');
    rec.set('thesis', t === '' ? '' : L('lib_theses').thesisRef(ctx.app, t).id);
    changed.push('thesis');
  }
  if (util.has(p, 'url')) {
    const url0 = util.str(p, 'url', '');
    if (url0 !== '' && !looksUrl(url0)) throw util.fail(400, 'url is not a web address.', 'invalid_param', { param: 'url' });
    const url = url0 === '' ? '' : L('lib_norm').url(url0);
    rec.set('url', url);
    rec.set('link_kind', url === '' ? '' : linkKind(url));
    changed.push('url');
  }
  if (util.has(p, 'licence')) {
    rec.set('licence', util.oneOf(p, 'licence', LICENCES, 'public'));
    changed.push('licence');
  }
  if (changed.length === 0) throw util.fail(400, 'Give at least one of: company, name, one_liner, source_person, scout, thesis, url, licence.', 'missing_param');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Changed ' + changed.join(', ') + ' of ' + rec.getString('number') });
  return detail(ctx, rec);
}

/* ------------------------------------------------------------ verdicts */

function itemsParam(ctx, p) {
  const util = u();
  const list = util.list(p, 'items');
  const one = util.str(p, 'item', '');
  const refs = list !== undefined && list.length > 0 ? list.map(String) : one !== '' ? [one] : [];
  if (refs.length === 0) throw util.fail(400, 'item is required (or items, a JSON list).', 'missing_param', { param: 'item' });
  if (refs.length > 100) throw util.fail(400, 'At most 100 items at once.', 'too_many');
  return refs.map((r) => visible(ctx, r));
}

function open(rec, allowed, verb) {
  const st = rec.getString('status');
  if (allowed.indexOf(st) < 0) {
    let where = st;
    if (st === 'advanced') where = 'advanced' + (rec.getString('deal') !== '' ? ' to a deal' : '');
    throw u().fail(409, rec.getString('number') + ' is already ' + where + '; it cannot be ' + verb + '.', 'not_open', { item: rec.id, status: st });
  }
}

/** The round terms the facts carry, in deals.create's shape. */
function roundOf(map) {
  const T = L('lib_theses');
  const out = {};
  const rt = map.round_type && map.round_type.value;
  if (typeof rt === 'string' && T.ROUND_TYPES.indexOf(rt) >= 0) out.type = rt;
  const cur = map.currency && map.currency.value ? String(map.currency.value) : '';
  for (const k of ['raise_minor', 'pre_money_minor', 'post_money_minor']) {
    const f = map[k];
    if (!f || f.value === null || f.grade === 'unknown') continue;
    if (f.currency !== '' && cur !== '' && f.currency !== cur) continue;
    if (Number.isInteger(Number(f.value)) && Number(f.value) >= 0) out[k] = Number(f.value);
  }
  return { round: out, currency: cur };
}

/** intake.advance: open the deal at Screen (point partner = you unless chosen); the deck moves to the deal room. */
function opAdvance(ctx, p) {
  const util = u();
  const app = ctx.app;
  guardDecide(ctx);
  const rec = visible(ctx, util.req(p, 'item'));
  open(rec, ['new', 'held'], 'advanced');
  const R = L('lib_records');
  let companyId = rec.getString('company');
  if (companyId === '') {
    const cname = util.squash(util.str(p, 'company', ''));
    if (cname !== '') companyId = companyFor(ctx, cname, 'intake ' + rec.getString('number')).id;
    else throw util.fail(400, 'Name the company first (--company), then advance.', 'company_needed', { param: 'company' });
  }
  const map = factsOf(app, [rec.id])[rec.id] || {};
  const r = roundOf(map);
  const people = [];
  for (const x of util.jsonOf(rec, 'people', []) || []) if (x && x.person) people.push({ person: x.person, role: x.role === 'founder' ? 'founder' : 'contact' });
  const sp = rec.getString('source_person');
  const founderIds = people.filter((x) => x.role === 'founder').map((x) => x.person);
  if (sp !== '' && founderIds.indexOf(sp) < 0 && !people.some((x) => x.person === sp)) people.push({ person: sp, role: 'referrer' });
  const ch = rec.getString('channel');
  let source = ch === 'scout' ? 'scout' : ch === 'sourced' ? 'sourced' : ch === 'csv' ? 'other' : 'inbound';
  if ((ch === 'email' || ch === 'upload') && sp !== '' && founderIds.indexOf(sp) < 0) {
    const c = util.byId(app, 'companies', companyId);
    if (c !== null && !sameDomain(app, sp, c.getString('domain'))) source = 'referral';
  }
  const stage = util.str(p, 'stage', '') || 'screen';
  const deal = L('lib_deals').create(ctx, {
    company: companyId,
    pipeline: 'deal_flow',
    stage: stage,
    source: source,
    source_person: sp !== '' ? sp : undefined,
    point: util.str(p, 'point', '') || 'me',
    fund: util.str(p, 'fund', '') || defaultFund(ctx),
    round: r.round,
    currency: r.currency || undefined,
    people: people,
    intake_item: rec.id,
    source_ref: 'intake ' + rec.getString('number'),
  });
  // The deck goes to the deal room (every version moves; the item keeps the ids).
  const F = L('lib_files');
  for (const fid of util.jsonOf(rec, 'files', []) || []) {
    const f = util.byId(app, 'files', fid);
    if (f === null || f.getString('owner_collection') !== 'intake_items' || f.getString('owner_id') !== rec.id || !f.getBool('current')) continue;
    F.move(ctx, fid, { owner_collection: 'deals', owner_id: deal.id, folder: DECK_FOLDER });
  }
  const fresh = app.findRecordById('intake_items', rec.id);
  fresh.set('status', 'advanced');
  fresh.set('company', companyId);
  fresh.set('deal', deal.id);
  fresh.set('decided_by', ctx.memberId);
  fresh.set('decided_at', util.nowIso());
  fresh.set('hold_until', '');
  fresh.set('note', util.text(p, 'note', 2000, '') || fresh.getString('note'));
  if (fresh.getString('name') === '' || fresh.getString('company') !== rec.getString('company')) {
    const c = util.byId(app, 'companies', companyId);
    if (c !== null) fresh.set('name', c.getString('name'));
  }
  app.save(fresh);
  L('lib_events').emit(ctx, 'intake.advanced', { item: rec.id, deal: deal.id });
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Advanced ' + rec.getString('number') + ' ' + util.clip(fresh.getString('name'), 100) + ' to ' + deal.number });
  return { item: detail(ctx, fresh), deal: { id: deal.id, number: deal.number, stage: deal.stage, href: '#/deals/' + deal.number } };
}

/** intake.hold: until a day (--until) or for some days (--days); comes back in Next on that day. */
function opHold(ctx, p) {
  const util = u();
  guardDecide(ctx);
  const recs = itemsParam(ctx, p);
  let until = util.day(p, 'until', '');
  const days = util.int(p, 'days', 0, 1, 365);
  if (until === '' && days > 0) until = util.dayAdd(util.today(ctx.app), days);
  if (until === '') until = util.dayAdd(util.today(ctx.app), 14);
  if (until <= util.today(ctx.app)) throw util.fail(400, 'until must be after today.', 'invalid_param', { param: 'until' });
  const out = [];
  for (const rec of recs) {
    open(rec, ['new', 'held'], 'held');
    rec.set('status', 'held');
    rec.set('hold_until', until);
    rec.set('decided_by', ctx.memberId);
    rec.set('decided_at', util.nowIso());
    if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
    ctx.app.save(rec);
    out.push(rec);
  }
  L('lib_audit').note(ctx, { collection: 'intake_items', record: out[0].id, summary: 'Held ' + out.map((r) => r.getString('number')).join(', ') + ' until ' + until });
  return out.length === 1 ? { item: detail(ctx, out[0]) } : { items: out.map((r) => detail(ctx, r)) };
}

/** intake.reopen: back to New (a passed item's unsent email is cancelled). */
function opReopen(ctx, p) {
  const util = u();
  guardDecide(ctx);
  const rec = visible(ctx, util.req(p, 'item'));
  open(rec, ['passed', 'held'], 'reopened');
  if (rec.getString('status') === 'passed' && rec.getString('pass') !== '') L('lib_intake_pass').onReopen(ctx, rec);
  rec.set('status', 'new');
  rec.set('hold_until', '');
  rec.set('revisit_day', '');
  rec.set('decided_by', '');
  rec.set('decided_at', '');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Reopened ' + rec.getString('number') });
  return { item: detail(ctx, rec) };
}

/** intake.merge: fold a duplicate item into another (its files, missing facts and people move). */
function opMerge(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.ownOnly) throw util.fail(403, 'Scouts submit deals; a partner merges them.', 'not_permitted');
  const drop = visible(ctx, util.req(p, 'item'));
  const keep = visible(ctx, util.req(p, 'into'));
  if (drop.id === keep.id) throw util.fail(400, 'An item cannot merge into itself.', 'invalid_param', { param: 'into' });
  open(drop, ['new', 'held'], 'merged');
  open(keep, ['new', 'held'], 'merged into');
  const F = L('lib_files');
  const keepFiles = util.jsonOf(keep, 'files', []) || [];
  for (const fid of util.jsonOf(drop, 'files', []) || []) {
    const f = util.byId(app, 'files', fid);
    if (f === null) continue;
    if (f.getString('owner_collection') === 'intake_items' && f.getString('owner_id') === drop.id && f.getBool('current')) F.move(ctx, fid, { owner_collection: 'intake_items', owner_id: keep.id, folder: DECK_FOLDER });
    if (keepFiles.indexOf(fid) < 0) keepFiles.push(fid);
  }
  const have = {};
  for (const f of util.findMany(app, 'facts', 'item = {:i}', '', 0, { i: keep.id })) have[f.getString('key')] = true;
  let moved = 0;
  for (const f of util.findMany(app, 'facts', 'item = {:i}', '', 0, { i: drop.id })) {
    if (have[f.getString('key')]) continue;
    f.set('item', keep.id);
    app.save(f);
    moved++;
  }
  const kp = util.jsonOf(keep, 'people', []) || [];
  for (const x of util.jsonOf(drop, 'people', []) || []) if (x && x.person && !kp.some((y) => y.person === x.person)) kp.push(x);
  const k2 = app.findRecordById('intake_items', keep.id);
  k2.set('files', keepFiles);
  k2.set('people', kp);
  if (k2.getString('company') === '' && drop.getString('company') !== '') k2.set('company', drop.getString('company'));
  if (k2.getString('source_person') === '' && drop.getString('source_person') !== '') k2.set('source_person', drop.getString('source_person'));
  if (k2.getString('one_liner') === '') k2.set('one_liner', drop.getString('one_liner'));
  if (drop.getString('licence') === 'internal_only') k2.set('licence', 'internal_only');
  if (drop.getString('received_at') !== '' && drop.getString('received_at') < k2.getString('received_at')) {
    k2.set('received_at', drop.getString('received_at'));
    k2.set('reply_due_day', drop.getString('reply_due_day'));
  }
  app.save(k2);
  const d2 = app.findRecordById('intake_items', drop.id);
  d2.set('status', 'merged');
  d2.set('merged_into', keep.id);
  d2.set('decided_by', ctx.memberId);
  d2.set('decided_at', util.nowIso());
  app.save(d2);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: keep.id, summary: 'Merged ' + drop.getString('number') + ' into ' + keep.getString('number') + ' (' + moved + ' facts moved)' });
  return { item: detail(ctx, k2), merged: { id: drop.id, number: drop.getString('number') } };
}

function previewMerge(ctx, params) {
  const drop = itemRef(ctx.app, params.item);
  const keep = itemRef(ctx.app, params.into);
  return { label: 'Merge ' + drop.getString('number') + ' ' + drop.getString('name') + ' into ' + keep.getString('number') + ' ' + keep.getString('name'), target: { collection: 'intake_items', id: keep.id }, fields: [{ field: 'merged_into', before: '', after: keep.getString('number') }], notes: [], risk: 'low' };
}

/** intake.retriage: Ask your AI agent to read the item (again): deck_triage, or deck_fetch for a deck link alone. */
function opRetriage(ctx, p) {
  const util = u();
  const rec = visible(ctx, util.req(p, 'item'));
  askCheck(ctx, rec, {});
  const t = readTrigger(rec);
  const r = L('lib_agent').requestFor(ctx, t, rec, {}, { again: util.str(p, 'again', '') });
  rec.set('triage_state', 'waiting');
  rec.set('triage_note', '');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Asked your AI agent to read ' + rec.getString('number') });
  return { item: detail(ctx, rec), request: r.request, trigger: t };
}

/* ------------------------------------------------- the deal page's view */

/**
 * verdictOf(app, itemId, { ctx? }) -> { facts, checks, missing, status } (SPEC 4.6).
 * With ctx the NDA quotes ctx may not read are withheld (guardQuotes); without ctx the facts are whole.
 */
function verdictOf(app, itemId, opts) {
  const util = u();
  const o = opts || {};
  const rec = util.byId(app, 'intake_items', String(itemId || ''));
  if (rec === null) return null;
  const map = factsOf(app, [rec.id])[rec.id] || {};
  const S = L('lib_intake_triage');
  const facts = [];
  const keys = L('lib_theses').facts();
  for (const k of Object.keys(keys)) if (map[k] !== undefined) facts.push(factOut(app, map[k]));
  const base = L('lib_settings').row(app).getString('base_currency') || 'USD';
  return {
    item: { id: rec.id, number: rec.getString('number'), name: rec.getString('name'), one_liner: rec.getString('one_liner'), channel: rec.getString('channel'), received_at: rec.getString('received_at'), licence: rec.getString('licence') },
    licence: rec.getString('licence'),
    status: rec.getString('status'),
    facts: o.ctx ? guardQuotes(o.ctx, facts) : facts,
    figures: figuresOf(map, base),
    checks: fitOf(app, map),
    missing: (util.jsonOf(rec, 'missing', []) || []).map((k) => ({ key: k, label: S.slideLabel(k) })),
    questions: util.jsonOf(rec, 'questions', []) || [],
  };
}

/** intake.verdict: the intake facts, thesis checks, missing slides and source item of a deal. */
function opVerdict(ctx, p) {
  const util = u();
  const D = L('lib_deals');
  const d = D.ref(ctx.app, util.req(p, 'deal'));
  D.guard(ctx, d);
  let itemId = d.getString('intake_item');
  if (itemId === '') {
    const r = util.findOne(ctx.app, 'intake_items', 'deal = {:d}', { d: d.id });
    if (r !== null) itemId = r.id;
  }
  if (itemId === '') return { deal: { id: d.id, number: d.getString('number') }, item: null, status: '', facts: [], figures: [], checks: [], missing: [], questions: [] };
  return Object.assign({ deal: { id: d.id, number: d.getString('number') } }, verdictOf(ctx.app, itemId, { ctx: ctx }));
}

/* ----------------------------------------------------------------- Next */

function figuresForNext(figs) {
  return figs
    .filter((f) => f.key !== 'growth')
    .slice(0, 3)
    .map((f) => ({ label: f.label, value: f.text }));
}

/** needsYou: verdicts (ready or held until today), stalls (past the reply day), revisits of passed deals, pass emails to write. */
function needsYou(ctx) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent || !ctx.memberId || ctx.ownOnly) return [];
  if (!L('lib_auth').can(ctx, 'intake', 'edit')) return [];
  const today = util.today(app);
  const reasons = L('lib_intake_pass').reasonOptions(app);
  const recs = util.findMany(app, 'intake_items', "(status = 'new' && (step = 'ready' || (reply_due_day != '' && reply_due_day < {:t}))) || (status = 'held' && hold_until != '' && hold_until <= {:t}) || (status = 'passed' && revisit_day != '' && revisit_day <= {:t})", 'reply_due_day,received_at', 300, { t: today });
  const x = extras(ctx, recs, true);
  const out = [];
  for (const rec of recs) {
    const st = rec.getString('status');
    const row = rowOut(ctx, rec, x);
    const chips = [];
    for (const f of row.fit.slice(0, 3)) chips.push({ label: f.thesis.name, tone: f.state === 'met' ? 'good' : f.state === 'unmet' ? 'bad' : 'neutral' });
    if (st === 'passed') {
      const pass = rec.getString('pass') !== '' ? util.byId(app, 'passes', rec.getString('pass')) : null;
      if (pass === null || pass.getString('revisit_state') !== 'open') continue;
      out.push({
        key: 'intake:revisit:' + rec.id,
        kind: 'verdict',
        title: rec.getString('name'),
        figures: figuresForNext(row.figures),
        chips: [{ label: 'Revisit', tone: 'warn' }, { label: L('lib_intake_pass').reasonLabel(pass.getString('reason')), tone: 'neutral' }].concat(pass.getString('revisit_milestone') !== '' ? [{ label: util.clip(pass.getString('revisit_milestone'), 30), tone: 'neutral' }] : []),
        agent: false,
        rank: 20,
        at: util.atOf(app, rec.getString('revisit_day'), '08:00'),
        href: '#/inbox?item=' + rec.getString('number'),
        data: { item: rec.id, number: rec.getString('number'), revisit: true },
        actions: [
          { label: 'Re-open', op: 'intake.reopen', params: { item: rec.id }, primary: true },
          { label: 'Keep passed', op: 'intake.keep', params: { item: rec.id } },
        ],
      });
      continue;
    }
    const due = row.due;
    const overdue = st === 'new' && due.state === 'overdue';
    const ready = row.steps.at >= 3;
    const heldDue = st === 'held';
    if (!overdue && !ready && !heldDue) continue;
    if (heldDue) chips.unshift({ label: 'Held', tone: 'neutral' });
    else if (overdue) chips.unshift({ label: 'Reply overdue', tone: 'bad' });
    else if (due.state === 'due_today') chips.unshift({ label: 'Reply today', tone: 'warn' });
    out.push({
      key: 'intake:' + rec.id,
      kind: overdue ? 'stall' : 'verdict',
      card: 'triage',
      title: rec.getString('name'),
      figures: figuresForNext(row.figures),
      chips: chips.slice(0, 6),
      steps: row.steps.at < 3 ? row.steps : null,
      agent: (x.facts[rec.id] && Object.keys(x.facts[rec.id]).some((k) => x.facts[rec.id][k].actor === 'agent')) === true,
      rank: overdue ? 10 : 20,
      at: rec.getString('received_at'),
      href: '#/inbox?item=' + rec.getString('number'),
      data: { item: rec.id, number: rec.getString('number'), one_liner: rec.getString('one_liner'), due_day: due.day, due_state: due.state, step: row.step },
      actions: [
        { label: 'Advance', op: 'intake.advance', params: { item: rec.id }, primary: true },
        { label: 'Pass', op: 'intake.pass', params: { item: rec.id }, choose: { param: 'reason', options: reasons } },
        { label: 'Hold', op: 'intake.hold', params: { item: rec.id }, choose: { param: 'days', options: HOLD_CHOICES } },
      ],
    });
  }
  return out.concat(L('lib_intake_pass').nextItems(ctx));
}

/* --------------------------------------------------- search and timeline */

function search(ctx, q, limit) {
  const util = u();
  if (!ctx.isAgent && !ctx.ownOnly && !L('lib_auth').can(ctx, 'intake', 'view')) return [];
  const like = util.like(q);
  const own = ctx.ownOnly ? ' AND i.submitted_by = {:m}' : '';
  const rows = util.rows(
    ctx.app,
    "SELECT DISTINCT i.id, i.number, i.name, i.status, i.one_liner FROM intake_items i LEFT JOIN companies c ON c.id = i.company LEFT JOIN people sp ON sp.id = i.source_person WHERE i.status != 'merged' AND (i.number LIKE {:q} ESCAPE '\\' OR i.name LIKE {:q} ESCAPE '\\' OR c.name LIKE {:q} ESCAPE '\\' OR c.domain LIKE {:q} ESCAPE '\\' OR sp.name LIKE {:q} ESCAPE '\\' OR sp.email LIKE {:q} ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(i.people) THEN i.people ELSE '[]' END) j JOIN people fp ON fp.id = json_extract(j.value, '$.person') WHERE fp.name LIKE {:q} ESCAPE '\\' OR fp.email LIKE {:q} ESCAPE '\\'))" + own + ' ORDER BY i.received_at DESC LIMIT ' + Math.max(1, Math.min(20, limit || 6)),
    { id: '', number: '', name: '', status: '', one_liner: '' },
    { q: like, m: ctx.memberId || '-' },
  );
  return rows.map((r) => ({ kind: 'intake', id: r.id, title: r.name, subtitle: r.number + ' ' + r.status, href: '#/inbox?item=' + r.number, icon: 'Inbox' }));
}

/** Timeline entries for a company, a person or a deal. */
function timelineFor(ctx, t) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent && !L('lib_auth').can(ctx, 'intake', 'view')) return { items: [], hidden: 0 };
  let recs = [];
  if (t.kind === 'deal' || t.deal) {
    const d = util.byId(app, 'deals', t.deal || t.id);
    if (d === null) return { items: [], hidden: 0 };
    recs = util.findMany(app, 'intake_items', 'deal = {:d}', '', 5, { d: d.id });
  } else if (t.kind === 'company' || t.company) {
    recs = util.findMany(app, 'intake_items', "company = {:c} && status != 'merged'", '-received_at', 20, { c: t.company || t.id });
  } else if (t.kind === 'person' || t.person) {
    const pid = t.person || t.id;
    recs = util.findMany(app, 'intake_items', "source_person = {:p} && status != 'merged'", '-received_at', 20, { p: pid });
  }
  const items = [];
  for (const r of recs) {
    const href = '#/inbox?item=' + r.getString('number');
    items.push({ at: r.getString('received_at'), module: 'intake', kind: 'intake.added', title: 'Inbound ' + r.getString('number') + ': ' + r.getString('name'), href: href, icon: 'Inbox', actor: r.getString('actor') });
    if (r.getString('status') === 'passed' && r.getString('pass') !== '') {
      const p = util.byId(app, 'passes', r.getString('pass'));
      if (p !== null) items.push({ at: p.getString('decided_at') || p.getString('created'), module: 'intake', kind: 'intake.passed', title: 'Passed: ' + L('lib_intake_pass').reasonLabel(p.getString('reason')), href: href, icon: 'CircleSlash', actor: 'person' });
    }
    if (r.getString('status') === 'advanced') items.push({ at: r.getString('decided_at'), module: 'intake', kind: 'intake.advanced', title: 'Advanced to a deal', href: href, icon: 'ArrowRight', actor: 'person' });
  }
  return { items: items, hidden: 0 };
}

/** app.today block: the Inbox at a glance. */
function today(ctx) {
  const util = u();
  if (ctx.isAgent || ctx.ownOnly || !L('lib_auth').can(ctx, 'intake', 'view')) return { key: 'intake', new: 0, overdue: 0, ready: 0 };
  const t = util.today(ctx.app);
  const r = util.one(ctx.app, "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN reply_due_day != '' AND reply_due_day < {:t} THEN 1 ELSE 0 END), 0) AS late, COALESCE(SUM(CASE WHEN step = 'ready' THEN 1 ELSE 0 END), 0) AS ready FROM intake_items WHERE status = 'new'", { n: 0, late: 0, ready: 0 }, { t: t });
  return { key: 'intake', new: r.n, overdue: r.late, ready: r.ready };
}

/** Each morning: the people who decide hear how many inbound deals are past their reply day (once a day). */
function morning(app) {
  const util = u();
  const t = util.today(app);
  const n = util.count(app, "SELECT COUNT(*) AS n FROM intake_items WHERE status = 'new' AND reply_due_day != '' AND reply_due_day < {:t}", { t: t });
  if (n === 0) return 0;
  const auth = L('lib_auth');
  const ids = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", '', 500)) {
    const role = util.byId(app, 'roles', m.getString('role'));
    if (role === null || role.getBool('own_items')) continue;
    const lv = auth.levelsOfRole(role).intake;
    if (lv === 'edit' || lv === 'full') ids.push(m.id);
  }
  L('lib_notify').notify(app, ids, { kind: 'intake', title: n + ' inbound deal' + (n === 1 ? ' is' : 's are') + ' past the reply day', body: '', link: '#/inbox', ref: 'intake:overdue:' + t });
  return n;
}

/* ---------------------------------------------------------------- events */

/** file.added on an intake item: remember the file and ask your AI agent to read it (askRead: who added it decides). */
function onFileAdded(ctx, pl) {
  if (!pl || pl.owner_collection !== 'intake_items') return null;
  const util = u();
  const rec = util.byId(ctx.app, 'intake_items', String(pl.owner_id || ''));
  if (rec === null) return null;
  const files = util.jsonOf(rec, 'files', []) || [];
  if (files.indexOf(pl.file) < 0) files.push(pl.file);
  rec.set('files', files);
  ctx.app.save(rec);
  if (rec.getString('status') === 'new' || rec.getString('status') === 'held') {
    askRead(ctx, rec);
    ctx.app.save(rec);
  }
  return rec.id;
}

/** The deal an item became (its NDA decks), or ''. */
function dealOf(app, rec) {
  return rec.getString('deal');
}

/** record.merged: re-point intake rows from the dropped company or person to the kept one. */
function onRecordMerged(ctx, pl) {
  if (!pl || !pl.keep || !pl.drop) return null;
  const util = u();
  const app = ctx.app;
  let n = 0;
  if (pl.kind === 'companies') {
    for (const r of util.findMany(app, 'intake_items', 'company = {:d}', '', 0, { d: pl.drop })) {
      r.set('company', pl.keep);
      app.save(r);
      n++;
    }
    for (const r of util.findMany(app, 'passes', 'company = {:d}', '', 0, { d: pl.drop })) {
      r.set('company', pl.keep);
      app.save(r);
      n++;
    }
  } else if (pl.kind === 'people') {
    for (const r of util.findMany(app, 'intake_items', 'source_person = {:d}', '', 0, { d: pl.drop })) {
      r.set('source_person', pl.keep);
      app.save(r);
      n++;
    }
    for (const r of util.rows(app, "SELECT i.id FROM intake_items i WHERE EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(i.people) THEN i.people ELSE '[]' END) j WHERE json_extract(j.value, '$.person') = {:d})", { id: '' }, { d: pl.drop })) {
      const rec = app.findRecordById('intake_items', r.id);
      const list = (util.jsonOf(rec, 'people', []) || []).map((x) => (x.person === pl.drop ? Object.assign({}, x, { person: pl.keep }) : x));
      const seen = {};
      rec.set(
        'people',
        list.filter((x) => {
          if (seen[x.person]) return false;
          seen[x.person] = true;
          return true;
        }),
      );
      app.save(rec);
      n++;
    }
    for (const r of util.findMany(app, 'scouts', 'person = {:d}', '', 0, { d: pl.drop })) {
      r.set('person', pl.keep);
      app.save(r);
      n++;
    }
  }
  return n;
}

/* ---------------------------------------------------------------- import */

/** CSV import of a deal list: one intake item per row (channel csv). */
function importRow(ctx, row, info) {
  const util = u();
  const name = util.squash(row.company || '');
  if (name === '' && util.squash(row.website || '') === '') throw util.fail(400, 'company or website is required.', 'missing_param');
  if (row.founder_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.founder_email))) throw util.fail(400, 'founder_email is not an email address.', 'invalid_param');
  const deck = util.squash(row.deck_link || '');
  if (deck !== '' && !looksUrl(deck)) throw util.fail(400, 'deck_link is not a web address.', 'invalid_param');
  if (row.received !== undefined && row.received !== '' && !util.isDay(String(row.received))) throw util.fail(400, 'received is not a date.', 'invalid_param');
  // Same company already waiting in the Inbox: skipped (merge by hand if needed).
  if (name !== '') {
    const same = util.rows(ctx.app, "SELECT i.id, i.number FROM intake_items i LEFT JOIN companies c ON c.id = i.company WHERE i.status IN ('new', 'held') AND (LOWER(i.name) = LOWER({:n}) OR LOWER(c.name) = LOWER({:n})) LIMIT 1", { id: '', number: '' }, { n: name });
    if (same.length > 0) return { action: 'skipped', id: same[0].id, message: 'Already in the Inbox as ' + same[0].number };
  }
  const company = row.website ? { name: name || undefined, website: L('lib_norm').url(String(row.website)) } : name;
  const sp = row.founder_email ? { email: String(row.founder_email).toLowerCase(), name: row.founder_name || undefined } : '';
  const item = add(ctx, {
    channel: 'csv',
    company: company,
    url: deck,
    text: util.clip(String(row.note || ''), 4000),
    source_person: sp,
    received_at: row.received ? util.atOf(ctx.app, String(row.received), '09:00') : '',
  });
  if (row.one_liner) {
    const r = ctx.app.findRecordById('intake_items', item.id);
    r.set('one_liner', util.clip(util.squash(row.one_liner), 300));
    ctx.app.save(r);
  }
  if (sp !== '' && item.company) {
    const r = ctx.app.findRecordById('intake_items', item.id);
    const people = util.jsonOf(r, 'people', []) || [];
    if (r.getString('source_person') !== '' && !people.some((x) => x.person === r.getString('source_person'))) {
      people.push({ person: r.getString('source_person'), role: 'founder' });
      r.set('people', people);
      ctx.app.save(r);
    }
  }
  return { action: 'created', id: item.id, message: item.number };
}

module.exports = {
  CHANNELS: CHANNELS,
  LICENCES: LICENCES,
  STATUSES: STATUSES,
  STEPS: STEPS,
  STEP_LABELS: STEP_LABELS,
  SEGMENTS: SEGMENTS,
  DECK_EXT: DECK_EXT,
  DECK_FOLDER: DECK_FOLDER,
  IMAGE_EXT: IMAGE_EXT,
  HOLD_CHOICES: HOLD_CHOICES,
  itemRef: itemRef,
  canSee: canSee,
  visible: visible,
  guardDecide: guardDecide,
  setStep: setStep,
  linkKind: linkKind,
  looksUrl: looksUrl,
  parseFrom: parseFrom,
  extOf: extOf,
  compact: compact,
  pctText: pctText,
  dueDay: dueDay,
  slaDays: slaDays,
  factsOf: factsOf,
  factOut: factOut,
  fitOf: fitOf,
  figuresOf: figuresOf,
  historyOf: historyOf,
  detail: detail,
  itemView: itemView,
  READS: READS,
  readTrigger: readTrigger,
  askRead: askRead,
  askCheck: askCheck,
  onAsked: onAsked,
  onCannot: onCannot,
  dealOf: dealOf,
  companyFor: companyFor,
  refParam: refParam,
  personFor: personFor,
  sameDomain: sameDomain,
  add: add,
  verdictOf: verdictOf,
  guardQuotes: guardQuotes,
  needsYou: needsYou,
  search: search,
  timelineFor: timelineFor,
  today: today,
  morning: morning,
  onFileAdded: onFileAdded,
  onRecordMerged: onRecordMerged,
  importRow: importRow,
  opAdd: opAdd,
  opList: opList,
  opGet: opGet,
  opUpdate: opUpdate,
  opAdvance: opAdvance,
  opHold: opHold,
  opReopen: opReopen,
  opMerge: opMerge,
  previewMerge: previewMerge,
  opRetriage: opRetriage,
  opVerdict: opVerdict,
  defaultFund: defaultFund,
};
