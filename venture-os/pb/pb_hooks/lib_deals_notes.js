/// <reference path="../pb_data/types.d.ts" />
/**
 * Meeting notes of the deals module (SPEC 7.7, REPORT Table 23).
 *
 * A note is a person's written record of a meeting on a deal (or on a
 * company without a deal), in a template's sections (First call, Partner
 * meeting, Reference, Board, Free). It autosaves as a draft; when the person
 * saves it (save true); Ask your AI agent (notes.review, trigger
 * note_review { note_id }) asks it to fill the template's summary, propose
 * deal field changes each with its quote (deals.update proposals), open
 * tasks for stated next steps (tasks.save) and log references (refs.log),
 * then link them with notes.summary-save (which marks the review done).
 * Your AI agent never edits a person's body.
 *
 * A transcript (.txt, .vtt, .srt, .docx from any notetaker) is a stored
 * file owned by the note (lib_files, folder Notes, tied to the deal); its
 * text comes from the kernel's text step (a review is asked once it is
 * read). consent says whether the meeting knew it was recorded.
 *
 * Contract (SPEC 4.6): forDeal(app, dealId) -> notes, newest first.
 *
 * Rights: a deal note follows its deal (lib_deals.visible); writing needs
 * pipeline edit or a seat on the deal team. A company note needs pipeline
 * or portfolio rights. Only the author (or the owner) changes a person's
 * body; your AI agent changes only notes it wrote itself.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const CONSENT = ['informed', 'not_recorded', 'unknown'];
const TRANSCRIPT_EXT = ['txt', 'vtt', 'srt', 'docx'];
const STEPS = ['Saved', 'Reading', 'Summary', 'Ready'];
const SECTION_MAX = 50000;
const DRAFT_DAYS = 30;
const READING = ['waiting', 'extracting'];

/* ------------------------------------------------------------ templates */

function templateOut(r) {
  const util = u();
  return { id: r.id, key: r.getString('key'), name: r.getString('name'), sections: util.jsonOf(r, 'sections', []) || [], stages: util.jsonOf(r, 'stages', []) || [], sort: r.getInt('sort'), archived: r.getBool('archived'), builtin: r.getBool('builtin') };
}

function templates(app, all) {
  return app.findRecordsByFilter('note_templates', all ? '1=1' : 'archived = false', 'sort,name', 0, 0).map(templateOut);
}

/** A template by key or id (404 naming the keys). */
function templateRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.findOne(app, 'note_templates', 'key = {:k}', { k: r }) || util.byId(app, 'note_templates', r);
  if (rec === null) throw util.fail(400, 'template must be one of: ' + templates(app, false).map((t) => t.key).join(', ') + '.', 'invalid_param', { param: 'template', allowed: templates(app, false).map((t) => t.key) });
  return rec;
}

/** The template a new note on this deal opens with: the one naming the deal's stage, else First call, else the first. */
function templateFor(app, deal) {
  const list = templates(app, false);
  const stage = deal ? deal.getString('stage') : '';
  const hit = list.filter((t) => stage !== '' && t.stages.indexOf(stage) >= 0)[0];
  return hit || list.filter((t) => t.key === 'first_call')[0] || list[0];
}

function opTemplates(ctx) {
  return { templates: templates(ctx.app, false) };
}

/** notes.template-save: add a template, or rename, re-section, re-stage or archive one. */
function opTemplateSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'template', '');
  let r = null;
  let before = null;
  if (ref !== '') {
    r = templateRef(app, ref);
    before = templateOut(r);
  } else {
    r = util.newRecord(app, 'note_templates');
    r.set('builtin', false);
    r.set('archived', false);
    r.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM note_templates') + 1);
  }
  if (ref === '' || util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 60, ''));
    if (name === '') throw util.fail(400, 'name is required, e.g. --name "Customer call"', 'missing_param', { param: 'name' });
    const dup = util.findOne(app, 'note_templates', 'name = {:n} && id != {:id}', { n: name, id: r.id || '-' });
    if (dup !== null) throw util.fail(409, 'There is already a template named ' + name + '.', 'duplicate');
    r.set('name', name);
    if (ref === '') {
      let key = util.slug(name).replace(/-/g, '_') || 'template';
      let n = 1;
      const base = key;
      while (util.findOne(app, 'note_templates', 'key = {:k}', { k: key }) !== null) key = base + '_' + ++n;
      r.set('key', key);
    }
  }
  const raw = util.list(p, 'sections');
  if (raw !== undefined || ref === '') {
    const list = raw || [];
    if (list.length < 1 || list.length > 12) throw util.fail(400, 'A template has 1 to 12 sections: --sections \'["Team","Product"]\'.', 'invalid_param', { param: 'sections' });
    const old = r.id ? util.jsonOf(r, 'sections', []) || [] : [];
    const out = [];
    for (const s of list) {
      const label = util.squash(typeof s === 'string' ? s : s && s.label);
      if (label === '' || label.length > 40) throw util.fail(400, 'Each section is a label of 1 to 40 characters.', 'invalid_param', { param: 'sections' });
      const kept = s && typeof s === 'object' && s.key ? String(s.key) : (old.filter((o) => o.label.toLowerCase() === label.toLowerCase())[0] || {}).key;
      const key = kept || util.slug(label).replace(/-/g, '_');
      if (!/^[a-z0-9_]{1,40}$/.test(key)) throw util.fail(400, 'Section "' + label + '" needs letters or digits.', 'invalid_param', { param: 'sections' });
      if (out.some((x) => x.key === key)) throw util.fail(400, 'Section "' + label + '" is there twice.', 'invalid_param', { param: 'sections' });
      out.push({ key: key, label: label });
    }
    r.set('sections', out);
  }
  const st = util.list(p, 'stages');
  if (st !== undefined) r.set('stages', st.map((x) => util.clip(String(x), 40)).filter((x) => /^[a-z0-9_]{1,40}$/.test(x)));
  else if (ref === '') r.set('stages', []);
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  L('lib_records').stampWritten(ctx, r);
  app.save(r);
  const after = templateOut(r);
  L('lib_audit').note(ctx, { collection: 'note_templates', record: r.id, summary: (before ? 'Changed the note template ' : 'Added the note template ') + after.name, before: before || undefined, after: after });
  return { template: after };
}

/* ---------------------------------------------------------------- rights */

function dealOf(app, n) {
  const id = n.getString('deal');
  return id === '' ? null : u().byId(app, 'deals', id);
}

function canSee(ctx, n) {
  if (n.getString('deleted_at') !== '') return false;
  if (ctx.actor === 'system') return true;
  const d = dealOf(ctx.app, n);
  if (n.getString('deal') !== '') return d !== null && L('lib_deals').visible(ctx, d);
  if (ctx.isAgent) return true;
  const auth = L('lib_auth');
  return auth.can(ctx, 'pipeline', 'view') || auth.can(ctx, 'portfolio', 'view');
}

/** May ctx write notes on this deal (or company): pipeline edit or the deal team; company notes pipeline or portfolio edit. */
function mayWrite(ctx, dealRec) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  const auth = L('lib_auth');
  if (dealRec) return auth.can(ctx, 'pipeline', 'edit') || L('lib_deals').isTeam(ctx.app, dealRec.id, ctx.memberId);
  return auth.can(ctx, 'pipeline', 'edit') || auth.can(ctx, 'portfolio', 'edit');
}

/** May ctx change this note's body (a person: the author or the owner; your AI agent: only its own notes). */
function mayEditBody(ctx, n) {
  if (ctx.actor === 'system') return true;
  if (ctx.isAgent) return n.getString('actor') === 'agent' && n.getString('author') === '';
  const author = n.getString('author');
  return author === ctx.memberId || author === '' || ctx.owner === true;
}

function noteRef(ctx, id) {
  const util = u();
  const n = util.byId(ctx.app, 'notes', String(id || ''));
  if (n === null || !canSee(ctx, n)) {
    if (n !== null && n.getString('deal') !== '' && n.getString('deleted_at') === '') {
      const d = dealOf(ctx.app, n);
      if (d !== null && d.getBool('restricted')) throw util.fail(403, ctx.isAgent ? 'This note belongs to a restricted deal your AI agent may not work on.' : 'This note belongs to a restricted deal.', 'restricted');
    }
    throw util.fail(404, 'No note ' + id + ' you can see. Run notes.list --deal <deal>.', 'not_found');
  }
  return n;
}

function writable(ctx, n) {
  if (!mayWrite(ctx, dealOf(ctx.app, n))) throw u().fail(403, 'Your role cannot write notes on this deal (needs edit access to Deals or a seat on the deal team).', 'not_permitted');
}

function bodyGuard(ctx, n) {
  writable(ctx, n);
  if (mayEditBody(ctx, n)) return;
  throw u().fail(403, ctx.isAgent ? "Your AI agent never edits a person's note. Put what you found in notes.summary-save, proposals and tasks." : 'Only the author of this note can change it.', 'not_permitted');
}

/* ----------------------------------------------------------------- views */

function sectionsOf(app, key) {
  const t = u().findOne(app, 'note_templates', 'key = {:k}', { k: key });
  return t === null ? [{ key: 'notes', label: 'Notes' }] : u().jsonOf(t, 'sections', []) || [];
}

function bodyOf(n) {
  const b = u().jsonOf(n, 'body', {}) || {};
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

function flatten(sections, body) {
  const parts = [];
  for (const s of sections) {
    const t = String(body[s.key] || '').trim();
    if (t !== '') parts.push(s.label + '\n' + t);
  }
  for (const k of Object.keys(body)) if (!sections.some((s) => s.key === k) && String(body[k] || '').trim() !== '') parts.push(String(body[k]).trim());
  return parts.join('\n\n');
}

function transcriptOf(app, n, withText) {
  const id = n.getString('transcript');
  if (id === '') return null;
  const f = u().byId(app, 'files', id);
  if (f === null) return null;
  const t = L('lib_files').textsOf(app, [id])[id] || { state: 'waiting', pages: 0 };
  const out = { file: id, name: f.getString('name'), ext: f.getString('ext'), bytes: f.getInt('bytes'), text_state: t.state, pages: t.pages || 0 };
  if (withText) {
    const pages = L('lib_files').text(app, id);
    let text = pages.map((p) => p.text).join('\n');
    if (text.length > 400000) text = text.slice(0, 400000);
    out.text = text;
    out.truncated = pages.map((p) => p.text).join('\n').length > 400000;
  }
  return out;
}

/** The review StepTrack from the note's note_review ask: { state, steps: { labels, at }, request, error }. */
function reviewOf(app, n) {
  if (n.getString('status') !== 'saved') return { state: 'draft', steps: null, request: '', error: '' };
  const A = L('lib_agent');
  const tr = transcriptOf(app, n, false);
  const hasSummary = n.getString('summary_at') !== '';
  const e = A.state(n, 'note_review');
  const at = (i) => ({ labels: STEPS, at: i });
  const d = dealOf(app, n);
  if (tr !== null && READING.indexOf(tr.text_state) >= 0) return { state: 'reading', steps: at(1), request: e ? e.request : '', error: '' };
  if (e === null) {
    if (d !== null && d.getBool('restricted') && !d.getBool('agent_allowed')) return { state: 'off', steps: null, request: '', error: '' };
    return hasSummary ? { state: 'ready', steps: at(3), request: '', error: '' } : { state: 'saved', steps: at(0), request: '', error: '' };
  }
  if (e.done_at) return { state: 'ready', steps: at(3), request: e.request, error: '' };
  if (A.pending(n, 'note_review')) return { state: 'waiting', steps: at(1), request: e.request, error: '' };
  return { state: 'failed', steps: at(hasSummary ? 2 : 1), request: e.request, error: e.error || "Your AI agent hasn't picked this up." };
}

/** How many of these proposals still wait for a person. */
function pendingOf(app, ids) {
  if (ids.length === 0) return 0;
  const bind = {};
  const list = ids.map((id, i) => ((bind['p' + i] = id), '{:p' + i + '}')).join(', ');
  return u().count(app, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending' AND id IN (" + list + ')', bind);
}

function memberMini(app, id) {
  return L('lib_records').mini(app, 'members', id);
}

/** A note as screens and your AI agent read it (detail: the review's proposals and tasks; text: the transcript text). */
function noteOut(ctx, n, opts) {
  const util = u();
  const app = ctx.app;
  const o = opts || {};
  const d = dealOf(app, n);
  const sections = sectionsOf(app, n.getString('template'));
  const t = util.findOne(app, 'note_templates', 'key = {:k}', { k: n.getString('template') });
  const body = bodyOf(n);
  const summary = util.jsonOf(n, 'summary', null);
  const review = util.jsonOf(n, 'review', {}) || {};
  const out = {
    id: n.id,
    deal: d ? { id: d.id, number: d.getString('number'), title: d.getString('name') || ((L('lib_records').mini(app, 'companies', d.getString('company')) || {}).name || ''), stage: d.getString('stage') } : null,
    company: L('lib_records').mini(app, 'companies', n.getString('company')),
    template: { key: n.getString('template'), name: t ? t.getString('name') : n.getString('template'), sections: sections },
    title: n.getString('title'),
    body: body,
    empty: n.getString('body_text').trim() === '' && n.getString('transcript') === '',
    meeting_day: n.getString('meeting_day'),
    cal_event: n.getString('cal_event'),
    consent: n.getString('consent'),
    status: n.getString('status'),
    saved_at: n.getString('saved_at'),
    author: memberMini(app, n.getString('author')),
    mine: ctx.memberId !== '' && ctx.memberId !== undefined && n.getString('author') === ctx.memberId,
    can_edit: mayWrite(ctx, d) && mayEditBody(ctx, n),
    actor: n.getString('actor'),
    transcript: transcriptOf(app, n, o.text === true),
    summary: summary,
    summary_at: n.getString('summary_at'),
    summary_by: n.getString('summary_by'),
    review: Object.assign(reviewOf(app, n), { agent: L('lib_agent').view(n, ['note_review']), proposals: review.proposals || [], tasks: review.tasks || [], refs: review.refs || [], pending: pendingOf(app, review.proposals || []) }),
    created: n.getString('created'),
    updated: n.getString('updated'),
  };
  if (o.detail) {
    const P = L('lib_proposals');
    out.review.proposals = (review.proposals || [])
      .map((id) => util.byId(app, 'proposals', id))
      .filter((r) => r !== null && P.canSee(ctx, r))
      .map((r) => P.view(app, r));
    out.review.tasks = (review.tasks || [])
      .map((id) => util.byId(app, 'tasks', id))
      .filter((r) => r !== null)
      .map((r) => L('lib_tasks').view(app, r, {}));
  }
  return out;
}

/* ----------------------------------------------------------------- reads */

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = ["deleted_at = ''"];
  const bind = {};
  const deal = util.str(p, 'deal', '');
  if (deal !== '') {
    const d = L('lib_deals').ref(app, deal);
    L('lib_deals').guard(ctx, d);
    where.push('deal = {:d}');
    bind.d = d.id;
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    where.push('company = {:c}');
    bind.c = L('lib_records').resolve(app, 'companies', company, { deleted: true }).id;
  }
  if (util.str(p, 'author', '') === 'me') {
    where.push('author = {:a}');
    bind.a = ctx.memberId || '-';
  }
  const status = util.oneOf(p, 'status', ['draft', 'saved', 'all'], 'all');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const pg = util.page(p, 50, 200);
  const all = util.findMany(app, 'notes', where.join(' && '), '-meeting_day,-created', pg.offset + pg.limit + 500, bind);
  const rows = all.filter((n) => canSee(ctx, n));
  return { notes: rows.slice(pg.offset, pg.offset + pg.limit).map((n) => noteOut(ctx, n)), total: rows.length, hidden: all.length - rows.length };
}

function opGet(ctx, p) {
  const util = u();
  const n = noteRef(ctx, util.req(p, 'note'));
  // Reading a note moves its transcript to the front of the text step (and stores a finished reading).
  if (n.getString('transcript') !== '') L('lib_files').collectFor(ctx.app, [n.getString('transcript')]);
  const out = noteOut(ctx, n, { detail: true, text: ctx.isAgent || util.bool(p, 'text', false) });
  if (ctx.isAgent && out.transcript && (out.transcript.text_state === 'waiting' || out.transcript.text_state === 'extracting')) out.transcript.hint = 'The app is still reading this transcript (moved to the front; ready within about a minute). Read it now from files.download --file ' + out.transcript.file + ' if you cannot wait.';
  return { note: out };
}

/* ---------------------------------------------------------------- writes */

/** Read --sections (JSON {key: text}) against the template; answers the merged body. */
function bodyFrom(p, sections, old) {
  const util = u();
  const raw = util.obj(p, 'sections');
  const body = Object.assign({}, old || {});
  if (raw === undefined) return body;
  const keys = sections.map((s) => s.key);
  for (const k of Object.keys(raw)) {
    if (keys.indexOf(k) < 0) throw util.fail(400, 'Unknown section "' + k + '". This template has: ' + keys.join(', ') + '.', 'invalid_param', { param: 'sections', allowed: keys });
    const v = raw[k] === null || raw[k] === undefined ? '' : String(raw[k]);
    if (v.length > SECTION_MAX) throw util.fail(400, 'Section ' + k + ' is too long (at most ' + SECTION_MAX + ' characters).', 'invalid_param', { param: 'sections' });
    if (v.trim() === '') delete body[k];
    else body[k] = v;
  }
  return body;
}

function setBody(n, sections, body) {
  n.set('body', body);
  n.set('body_text', u().clip(flatten(sections, body), 400000));
}

/** agent.ask --trigger note_review --record <note>: a saved note with text, or a transcript that was read. */
function askCheck(ctx, n) {
  const util = u();
  writable(ctx, n);
  if (n.getString('status') !== 'saved' || n.getString('deleted_at') !== '') throw util.fail(409, 'Save the note first.', 'draft');
  const tr = transcriptOf(ctx.app, n, false);
  if (tr !== null && READING.indexOf(tr.text_state) >= 0) throw util.fail(409, 'The transcript is still being read; ask once it is ready.', 'reading');
  const hasText = n.getString('body_text').trim() !== '' || (tr !== null && tr.text_state === 'ready');
  if (!hasText) throw util.fail(409, 'The note has no text or transcript to review.', 'empty');
  return {};
}

/** The deal of a note ('' for a company note): a restricted deal your AI agent may not work on refuses the ask. */
function dealOfNote(app, n) {
  return n.getString('deal');
}

function dayParam(ctx, p) {
  const util = u();
  return util.day(p, 'meeting_day', '') || util.today(ctx.app);
}

/** notes.create: a note on a deal (or a company) in a template; --cal_event makes it the note of that meeting (asked twice, the same note). */
function opCreate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const D = L('lib_deals');
  const dealRef = util.str(p, 'deal', '');
  let d = null;
  let companyId = '';
  if (dealRef !== '') {
    d = D.ref(app, dealRef);
    D.guard(ctx, d);
    companyId = d.getString('company');
  } else {
    const c = util.str(p, 'company', '');
    if (c === '') throw util.fail(400, 'Give --deal (or --company for a note without a deal).', 'missing_param', { param: 'deal' });
    companyId = L('lib_records').resolve(app, 'companies', c).id;
  }
  if (!mayWrite(ctx, d)) throw util.fail(403, 'Your role cannot write notes on this deal (needs edit access to Deals or a seat on the deal team).', 'not_permitted');
  const calEvent = util.text(p, 'cal_event', 40, '');
  if (calEvent !== '') {
    const same = util.findOne(app, 'notes', "cal_event = {:e} && deal = {:d} && company = {:c} && deleted_at = ''", { e: calEvent, d: d ? d.id : '', c: companyId });
    if (same !== null) {
      if (!ctx.isAgent && same.getString('author') === '' && same.getString('status') === 'draft') {
        same.set('author', ctx.memberId);
        app.save(same);
      }
      return { note: noteOut(ctx, same, { detail: true }), existing: true };
    }
  }
  const tpl = util.str(p, 'template', '') !== '' ? templateOut(templateRef(app, util.str(p, 'template', ''))) : templateFor(app, d);
  if (tpl === undefined) throw util.fail(409, 'No note templates. Add one in Settings, Pipelines.', 'no_template');
  const consent = util.oneOf(p, 'consent', CONSENT, 'unknown');
  const n = util.newRecord(app, 'notes');
  n.set('deal', d ? d.id : '');
  n.set('company', companyId);
  n.set('template', tpl.key);
  n.set('title', util.squash(util.text(p, 'title', 200, '')));
  setBody(n, tpl.sections, bodyFrom(p, tpl.sections, {}));
  n.set('meeting_day', dayParam(ctx, p));
  n.set('cal_event', calEvent);
  n.set('consent', consent);
  n.set('status', 'draft');
  n.set('author', ctx.isAgent ? '' : ctx.memberId || '');
  n.set('run', ctx.run || '');
  n.set('review', {});
  n.set('deleted_at', '');
  L('lib_records').stampWritten(ctx, n);
  app.save(n);
  if (util.bool(p, 'save', false)) saveNow(ctx, n);
  if (d !== null) touchDeal(app, d.id);
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: 'Wrote a ' + tpl.name + ' note' + (d ? ' on ' + d.getString('number') : '') });
  return { note: noteOut(ctx, app.findRecordById('notes', n.id), { detail: true }) };
}

function touchDeal(app, dealId) {
  const d = u().byId(app, 'deals', dealId);
  if (d === null) return;
  d.set('last_activity_at', u().nowIso());
  app.save(d);
}

/** Finish a note (status saved), queue its review and emit note.saved { note, deal }. */
function saveNow(ctx, n) {
  if (n.getString('status') !== 'saved') {
    n.set('status', 'saved');
    n.set('saved_at', u().nowIso());
    ctx.app.save(n);
  }
  L('lib_records').emit(ctx, 'note.saved', { note: n.id, deal: n.getString('deal') });
}

/** notes.update: autosave of the sections, title, day, consent or template; --save true finishes it (Ask your AI agent reviews it). */
function opUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = noteRef(ctx, util.req(p, 'note'));
  const touchesBody = ['sections', 'title', 'meeting_day', 'template', 'consent'].some((k) => util.has(p, k));
  if (touchesBody) bodyGuard(ctx, n);
  else writable(ctx, n);
  const before = { title: n.getString('title'), template: n.getString('template'), consent: n.getString('consent'), status: n.getString('status') };
  if (util.str(p, 'template', '') !== '' && util.str(p, 'template', '') !== n.getString('template')) {
    if (n.getString('body_text').trim() !== '') throw util.fail(409, 'This note already has text; its template stays. Start a new note for another template.', 'has_text');
    n.set('template', templateOut(templateRef(app, util.str(p, 'template', ''))).key);
  }
  const sections = sectionsOf(app, n.getString('template'));
  if (util.has(p, 'sections')) setBody(n, sections, bodyFrom(p, sections, bodyOf(n)));
  if (util.has(p, 'title')) n.set('title', util.squash(util.text(p, 'title', 200, '')));
  if (util.has(p, 'meeting_day')) n.set('meeting_day', dayParam(ctx, p));
  if (util.has(p, 'consent')) {
    const c = util.oneOf(p, 'consent', CONSENT, 'unknown');
    if (c === 'not_recorded' && n.getString('transcript') !== '') throw util.fail(409, 'This note has a transcript, so the meeting was recorded.', 'has_transcript');
    n.set('consent', c);
  }
  if (!ctx.isAgent && n.getString('author') === '' && touchesBody) n.set('author', ctx.memberId || '');
  app.save(n);
  if (util.bool(p, 'save', false)) saveNow(ctx, n);
  if (n.getString('deal') !== '') touchDeal(app, n.getString('deal'));
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: (util.bool(p, 'save', false) ? 'Saved the note ' : 'Changed the note ') + (n.getString('title') || n.getString('template')), before: before, after: { title: n.getString('title'), template: n.getString('template'), consent: n.getString('consent'), status: n.getString('status') } });
  return { note: noteOut(ctx, app.findRecordById('notes', n.id), { detail: true }) };
}

/** notes.review: Ask your AI agent to review a saved note now (trigger note_review). */
function opReview(ctx, p) {
  const util = u();
  const n = noteRef(ctx, util.req(p, 'note'));
  askCheck(ctx, n);
  const r = L('lib_agent').requestFor(ctx, 'note_review', n, {}, { again: util.str(p, 'again', '') });
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: 'Asked your AI agent to review the note ' + (n.getString('title') || n.getString('template')) });
  return { note: noteOut(ctx, ctx.app.findRecordById('notes', n.id), { detail: true }), request: r.request };
}

/** notes.attach-transcript: a .txt, .vtt, .srt or .docx file from any notetaker, stored with the note (folder Notes of the deal). */
function opAttachTranscript(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = noteRef(ctx, util.req(p, 'note'));
  bodyGuard(ctx, n);
  const upload = ctx.e ? util.uploaded(ctx.e, 'file') : null;
  const path = util.str(p, 'path', '');
  if (upload === null && path === '') throw util.fail(400, 'Upload the transcript (field file), or give --path (your AI agent).', 'missing_param', { param: 'file' });
  const name = upload !== null ? String(upload.originalName || upload.name || '') : path.replace(/^.*[\\/]/, '');
  const ext = name.indexOf('.') >= 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (TRANSCRIPT_EXT.indexOf(ext) < 0) throw util.fail(400, 'A transcript is a .txt, .vtt, .srt or .docx file.', 'invalid_param', { param: 'file', allowed: TRANSCRIPT_EXT });
  const consent = util.oneOf(p, 'consent', CONSENT, '');
  if (consent === 'not_recorded' || (consent === '' && n.getString('consent') === 'not_recorded')) throw util.fail(409, 'The note says the meeting was not recorded. Set consent first.', 'consent');
  const f = L('lib_files').add(ctx, { owner_collection: 'notes', owner_id: n.id, deal: n.getString('deal'), folder: 'Notes', upload: upload || undefined, path: upload === null ? path : undefined, name: name });
  const rec = app.findRecordById('notes', n.id);
  rec.set('transcript', f.id);
  if (consent !== '') rec.set('consent', consent);
  if (!ctx.isAgent && rec.getString('author') === '') rec.set('author', ctx.memberId || '');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: 'Attached the transcript ' + f.name });
  return { note: noteOut(ctx, app.findRecordById('notes', n.id), { detail: true }), file: f };
}

/** notes.summary-save: the template's summary sections and the review's links (proposals, tasks, references). */
function opSummarySave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = noteRef(ctx, util.req(p, 'note'));
  writable(ctx, n);
  const sections = sectionsOf(app, n.getString('template'));
  const keys = sections.map((s) => s.key);
  const old = util.jsonOf(n, 'summary', null) || { headline: '', sections: {} };
  const out = { headline: old.headline || '', sections: Object.assign({}, old.sections || {}) };
  if (util.has(p, 'headline')) out.headline = util.squash(util.text(p, 'headline', 300, ''));
  const raw = util.obj(p, 'sections');
  if (raw !== undefined) {
    for (const k of Object.keys(raw)) {
      if (keys.indexOf(k) < 0) throw util.fail(400, 'Unknown section "' + k + '". The ' + n.getString('template') + ' template has: ' + keys.join(', ') + '.', 'invalid_param', { param: 'sections', allowed: keys });
      const v = String(raw[k] === null || raw[k] === undefined ? '' : raw[k]).trim();
      if (v.length > 8000) throw util.fail(400, 'Summary section ' + k + ' is too long (at most 8000 characters).', 'invalid_param', { param: 'sections' });
      if (v === '') delete out.sections[k];
      else out.sections[k] = v;
    }
  }
  const review = util.jsonOf(n, 'review', {}) || {};
  const dealId = n.getString('deal');
  const addIds = (name, collection, check) => {
    const list = util.list(p, name);
    if (list === undefined) return review[name] || [];
    const cur = (review[name] || []).slice();
    for (const x of list) {
      const id = String(x || '').trim();
      if (!/^[a-z0-9]{15}$/.test(id)) throw util.fail(400, name + ' is a JSON list of record ids.', 'invalid_param', { param: name });
      if (collection !== '') {
        const r = util.byId(app, collection, id);
        if (r === null) throw util.fail(404, 'No ' + collection.replace(/s$/, '') + ' ' + id + '.', 'not_found', { param: name });
        check(r);
      }
      if (cur.indexOf(id) < 0) cur.push(id);
    }
    if (cur.length > 100) throw util.fail(400, 'At most 100 ' + name + ' on one note.', 'too_many', { param: name });
    return cur;
  };
  const sameDeal = (what) => (r) => {
    if (dealId !== '' && r.getString('deal') !== dealId) throw util.fail(400, 'That ' + what + ' is not about this note\'s deal.', 'invalid_param', { param: what + 's' });
  };
  review.proposals = addIds('proposals', 'proposals', sameDeal('proposal'));
  review.tasks = addIds('tasks', 'tasks', sameDeal('task'));
  review.refs = addIds('refs', '', null);
  n.set('summary', out);
  n.set('summary_at', util.nowIso());
  n.set('summary_by', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  n.set('review', review);
  app.save(n);
  if (ctx.isAgent) {
    // The review landed: its proposals say they came from the note, and the person who asked sees it done.
    L('lib_proposals').markVia(app, review.proposals, 'note_review');
    L('lib_agent').landed(app, 'note_review', n);
  }
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: 'Summarised the note ' + (n.getString('title') || n.getString('template')) + ' (' + review.proposals.length + ' proposals, ' + review.tasks.length + ' tasks)' });
  return { note: noteOut(ctx, app.findRecordById('notes', n.id), { detail: true }) };
}

/** notes.delete: the author or the owner moves a note to the trash (soft delete). */
function opDelete(ctx, p) {
  const util = u();
  const n = noteRef(ctx, util.req(p, 'note'));
  writable(ctx, n);
  if (n.getString('author') !== '' && n.getString('author') !== ctx.memberId && !ctx.owner) throw util.fail(403, 'Only the author or the owner deletes a note.', 'not_permitted');
  n.set('deleted_at', util.nowIso());
  ctx.app.save(n);
  L('lib_audit').note(ctx, { collection: 'notes', record: n.id, summary: 'Deleted the note ' + (n.getString('title') || n.getString('template')) });
  return { deleted: true, note: n.id };
}

/* -------------------------------------------------------------- contract */

/** forDeal(app, dealId) -> the deal's notes, newest first (no rights check: app code). */
function forDeal(app, dealId) {
  const util = u();
  return util.findMany(app, 'notes', "deal = {:d} && deleted_at = ''", '-meeting_day,-created', 500, { d: String(dealId || '') }).map((n) => ({
    id: n.id,
    deal: n.getString('deal'),
    company: n.getString('company'),
    template: n.getString('template'),
    title: n.getString('title'),
    meeting_day: n.getString('meeting_day'),
    cal_event: n.getString('cal_event'),
    consent: n.getString('consent'),
    status: n.getString('status'),
    empty: n.getString('body_text').trim() === '' && n.getString('transcript') === '',
    author: n.getString('author'),
    actor: n.getString('actor'),
    body_text: n.getString('body_text'),
    transcript: n.getString('transcript'),
    summary: util.jsonOf(n, 'summary', null),
    created: n.getString('created'),
    updated: n.getString('updated'),
  }));
}

/* ---------------------------------------------------------------- events */

/**
 * meeting.ended { cal_event, deal, company } (network): an open deal's
 * meeting gets an empty draft note in the template its stage calls for,
 * owned by the point partner, so "Add note" opens it at once
 * (notes.create --deal --cal_event answers the same note).
 */
function onMeetingEnded(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const dealId = payload && payload.deal ? String(payload.deal) : '';
  const ev = payload && payload.cal_event ? String(payload.cal_event) : '';
  if (dealId === '' || ev === '') return null;
  const d = util.byId(app, 'deals', dealId);
  if (d === null || d.getString('deleted_at') !== '' || d.getString('status') !== 'open') return null;
  if (util.findOne(app, 'notes', 'cal_event = {:e} && deal = {:d}', { e: ev, d: d.id }) !== null) return null;
  const tpl = templateFor(app, d);
  if (tpl === undefined) return null;
  const n = util.newRecord(app, 'notes');
  n.set('deal', d.id);
  n.set('company', d.getString('company'));
  n.set('template', tpl.key);
  n.set('title', '');
  setBody(n, tpl.sections, {});
  n.set('meeting_day', util.today(app));
  n.set('cal_event', util.clip(ev, 40));
  n.set('consent', 'unknown');
  n.set('status', 'draft');
  n.set('author', d.getString('point'));
  n.set('review', {});
  n.set('deleted_at', '');
  n.set('actor', 'system');
  n.set('member', '');
  app.save(n);
  return n.id;
}

/** record.merged of companies: notes follow the company kept. */
function onMerged(ctx, payload) {
  if (!payload || payload.kind !== 'companies') return 0;
  let n = 0;
  for (const r of ctx.app.findRecordsByFilter('notes', 'company = {:c}', '', 0, 0, { c: String(payload.drop) })) {
    r.set('company', String(payload.keep));
    ctx.app.save(r);
    n++;
  }
  return n;
}

/** Nightly (with the stall cron): empty drafts the app opened for a meeting and nobody wrote in 30 days go. */
function sweepDrafts(app) {
  const util = u();
  const before = new Date(Date.now() - DRAFT_DAYS * 86400000).toISOString().replace('T', ' ');
  const ids = util.rows(app, "SELECT id FROM notes WHERE status = 'draft' AND actor = 'system' AND body_text = '' AND transcript = '' AND created < {:t}", { id: '' }, { t: before });
  for (const r of ids) {
    const n = util.byId(app, 'notes', r.id);
    if (n !== null) app.delete(n);
  }
  return ids.length;
}

/* -------------------------------------------------- timeline and search */

/** Timeline items: saved notes of a deal or a company. */
function timelineFor(ctx, target) {
  const util = u();
  const app = ctx.app;
  const t = target || {};
  let rows = [];
  if (t.kind === 'deal' || t.deal) rows = util.findMany(app, 'notes', "deal = {:d} && deleted_at = '' && status = 'saved'", '-saved_at', 100, { d: String(t.deal || t.id) });
  else if (t.kind === 'company' || t.company) rows = util.findMany(app, 'notes', "company = {:c} && deleted_at = '' && status = 'saved'", '-saved_at', 100, { c: String(t.company || t.id) });
  else return [];
  let hidden = 0;
  const items = [];
  for (const n of rows) {
    if (!canSee(ctx, n)) {
      hidden++;
      continue;
    }
    const d = dealOf(app, n);
    const tpl = util.findOne(app, 'note_templates', 'key = {:k}', { k: n.getString('template') });
    items.push({
      at: n.getString('saved_at') || n.getString('created'),
      module: 'deals',
      kind: 'note',
      title: (tpl ? tpl.getString('name') : 'Note') + (n.getString('title') !== '' ? ': ' + n.getString('title') : ''),
      href: d ? '#/deals/' + d.getString('number') + '?tab=notes&note=' + n.id : '',
      icon: 'NotebookPen',
      actor: n.getString('actor'),
      ref: { collection: 'notes', id: n.id },
    });
  }
  return { items: items, hidden: hidden };
}

/** Ctrl-K: notes by title or text. */
function search(ctx, q, limit) {
  const util = u();
  const app = ctx.app;
  const s = String(q || '').trim();
  if (s.length < 2) return [];
  const rows = util.rows(app, "SELECT id FROM notes WHERE deleted_at = '' AND (title LIKE {:q} ESCAPE '\\' OR body_text LIKE {:q} ESCAPE '\\') ORDER BY updated DESC LIMIT 50", { id: '' }, { q: util.like(s) });
  const out = [];
  for (const r of rows) {
    const n = app.findRecordById('notes', r.id);
    if (!canSee(ctx, n)) continue;
    const d = dealOf(app, n);
    const tpl = util.findOne(app, 'note_templates', 'key = {:k}', { k: n.getString('template') });
    const company = L('lib_records').mini(app, 'companies', n.getString('company'));
    out.push({ kind: 'note', id: n.id, title: n.getString('title') || (tpl ? tpl.getString('name') : 'Note') + (company ? ', ' + company.name : ''), subtitle: (d ? d.getString('number') + ' ' : '') + n.getString('meeting_day'), href: d ? '#/deals/' + d.getString('number') + '?tab=notes&note=' + n.id : '', icon: 'NotebookPen' });
    if (out.length >= (limit || 8)) break;
  }
  return out;
}

module.exports = {
  CONSENT: CONSENT,
  TRANSCRIPT_EXT: TRANSCRIPT_EXT,
  STEPS: STEPS,
  templates: templates,
  templateFor: templateFor,
  opTemplates: opTemplates,
  opTemplateSave: opTemplateSave,
  canSee: canSee,
  noteOut: noteOut,
  reviewOf: reviewOf,
  askCheck: askCheck,
  dealOfNote: dealOfNote,
  opList: opList,
  opGet: opGet,
  opCreate: opCreate,
  opUpdate: opUpdate,
  opReview: opReview,
  opAttachTranscript: opAttachTranscript,
  opSummarySave: opSummarySave,
  opDelete: opDelete,
  forDeal: forDeal,
  onMeetingEnded: onMeetingEnded,
  onMerged: onMerged,
  sweepDrafts: sweepDrafts,
  timelineFor: timelineFor,
  search: search,
};
