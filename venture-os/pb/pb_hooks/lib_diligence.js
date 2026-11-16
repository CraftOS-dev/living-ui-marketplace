/// <reference path="../pb_data/types.d.ts" />
/**
 * Diligence (SPEC 7.8): a deal's checklist (questions from a template),
 * the answers your AI agent proposes from the deal room and named public
 * sources (each typed, graded and cited), and a person's one-click confirm
 * or reject.
 *
 * Answers:
 *   agent_proposed  your AI agent's answer, waiting for a person
 *   confirmed       a person confirmed it (or entered it by hand)
 *   rejected        a person rejected it
 *   superseded      a newer answer replaced it
 * A question's `state` (open, proposed, confirmed) and `answer` (the answer
 * shown) are kept here on every change. A new proposal over a confirmed
 * answer waits beside it; the confirmed one stays until a person confirms
 * the new one. Your AI agent's answers must cite: anchors in the deal's
 * citation scope (lib_text.resolve with the deal; NDA files only while a
 * person's ask about the deal is pending) or public source links; refused
 * otherwise. Your AI agent is asked with trigger diligence_answers
 * { deal_id } (dd.ask), page_ocr { file_id } (a scanned file) and
 * grid_answers { grid_id } (a grid's cells), the request kept on the record.
 *
 * Exports for other modules (SPEC 4.6):
 *   answersFor(app, dealId) -> { questions, answers }
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function D() {
  return L('lib_deals');
}

const TYPES = ['text', 'number', 'yes_no', 'date'];
const GRADES = ['artifact', 'founder_reported', 'public', 'unverifiable', 'unknown'];
const NUM_KINDS = ['quoted', 'computed', 'external', 'entered'];
const REASONS = ['wrong', 'unsupported', 'outdated', 'other'];
const HIGH = ['artifact', 'public'];
const LIVE = ['agent_proposed', 'confirmed'];
const STEPS = ['Queued', 'Reading', 'Answering', 'Ready'];
const MAX_BATCH = 100;
const MAX_QUESTIONS = 400;
const ITEM_KEYS = ['question', 'grid', 'company', 'column', 'value', 'unit', 'num_kind', 'grade', 'anchors', 'sources', 'formula', 'note', 'not_found'];

/* ------------------------------------------------------------- helpers */

function nowIso() {
  return u().nowIso();
}

function who(ctx) {
  return ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
}

function stamp(ctx, rec) {
  const w = who(ctx);
  rec.set('actor', w);
  rec.set('member', w === 'person' ? ctx.memberId || '' : '');
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function arr(list) {
  const out = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

/** A deal the caller may see (id or D-0001). */
function dealFor(ctx, ref) {
  const d = D().ref(ctx.app, ref);
  D().guard(ctx, d);
  return d;
}

function dealTitle(app, d) {
  const c = u().byId(app, 'companies', d.getString('company'));
  return d.getString('name') || (c !== null ? c.getString('name') : d.getString('number'));
}

function dealMini(app, d) {
  return { id: d.id, number: d.getString('number'), title: dealTitle(app, d), company: d.getString('company'), stage: d.getString('stage'), status: d.getString('status') };
}

/* ----------------------------------------------------------- templates */

function templateOut(r, full) {
  const util = u();
  const qs = util.jsonOf(r, 'questions', []) || [];
  const out = { id: r.id, key: r.getString('key'), name: r.getString('name'), archived: r.getBool('archived'), sort: r.getInt('sort'), areas: util.jsonOf(r, 'areas', []) || [], count: qs.length };
  if (full) out.questions = qs;
  return out;
}

function templateRef(app, ref) {
  const util = u();
  const r0 = String(ref || '').trim();
  if (r0 === '') throw util.fail(400, 'template is required (seed, series_a or a template id).', 'missing_param', { param: 'template' });
  let r = util.byId(app, 'dd_templates', r0);
  if (r === null) r = util.findOne(app, 'dd_templates', 'key = {:k}', { k: r0.toLowerCase() });
  if (r === null) {
    const keys = util.findMany(app, 'dd_templates', 'archived = false', 'sort').map((t) => t.getString('key'));
    throw util.fail(404, 'No checklist "' + r0 + '". Checklists: ' + keys.join(', ') + '.', 'not_found', { allowed: keys });
  }
  return r;
}

/** The checklist for a deal's round (seed for pre-seed and seed rounds, series_a for later ones), or the first one; null when none. */
function suggestedTemplate(app, d) {
  const round = u().jsonOf(d, 'round', {}) || {};
  const t = String(round.type || '');
  const key = ['series_a', 'series_b', 'series_c', 'series_d_plus'].indexOf(t) >= 0 ? 'series_a' : 'seed';
  const r = u().findOne(app, 'dd_templates', 'key = {:k} && archived = false', { k: key });
  if (r !== null) return r;
  return u().findMany(app, 'dd_templates', 'archived = false', 'sort', 1)[0] || null;
}

function templateForDeal(app, d) {
  const r = suggestedTemplate(app, d);
  if (r === null) throw u().fail(409, 'There is no checklist yet (Settings, Diligence).', 'no_template');
  return r;
}

function cleanUnit(type, raw, where) {
  const util = u();
  if (type !== 'number') return '';
  const s = util.squash(raw);
  if (s === '' || s === 'money' || s === '%') return s;
  if (/^[A-Z]{3}$/.test(s)) return s;
  if (!/^[A-Za-z][A-Za-z ]{0,19}$/.test(s)) throw util.fail(400, where + ': unit is money, %, a currency code or one word such as months.', 'invalid_param', { param: 'unit' });
  return s.toLowerCase();
}

function cleanAreas(raw) {
  const util = u();
  if (!Array.isArray(raw) || raw.length === 0) throw util.fail(400, 'areas is a JSON list such as [{"key":"team","label":"Team"}].', 'invalid_param', { param: 'areas' });
  if (raw.length > 20) throw util.fail(400, 'At most 20 areas.', 'too_many', { param: 'areas' });
  const out = [];
  const seen = {};
  raw.forEach((a, i) => {
    util.keysOnly(a, ['key', 'label'], 'Area ' + (i + 1));
    const label = util.squash(a && a.label);
    if (label === '' || label.length > 60) throw util.fail(400, 'Area ' + (i + 1) + ' needs a label (at most 60 characters).', 'invalid_param', { param: 'areas' });
    const key = slug(a.key || label);
    if (key === '' || seen[key]) throw util.fail(400, 'Area ' + (i + 1) + ': the key "' + key + '" is empty or used twice.', 'invalid_param', { param: 'areas' });
    seen[key] = true;
    out.push({ key: key, label: label });
  });
  return out;
}

function cleanTemplateQuestions(raw, areas) {
  const util = u();
  if (!Array.isArray(raw)) throw util.fail(400, 'questions is a JSON list of {"key","area","text","type","unit"}.', 'invalid_param', { param: 'questions' });
  if (raw.length > 200) throw util.fail(400, 'At most 200 questions in a checklist.', 'too_many', { param: 'questions' });
  const areaKeys = areas.map((a) => a.key);
  const seen = {};
  return raw.map((q, i) => {
    const where = 'Question ' + (i + 1);
    util.keysOnly(q, ['key', 'area', 'text', 'type', 'unit'], where);
    const text = util.squash(q && q.text);
    if (text === '' || text.length > 300) throw util.fail(400, where + ' needs text (at most 300 characters).', 'invalid_param', { param: 'questions' });
    const area = String((q && q.area) || '');
    if (areaKeys.indexOf(area) < 0) throw util.fail(400, where + ': area must be one of ' + areaKeys.join(', ') + '.', 'invalid_param', { param: 'questions', allowed: areaKeys });
    const type = String((q && q.type) || 'text');
    if (TYPES.indexOf(type) < 0) throw util.fail(400, where + ': type must be one of ' + TYPES.join(', ') + '.', 'invalid_param', { param: 'questions', allowed: TYPES });
    let key = slug(q.key || area + '_' + text);
    if (key === '') key = area + '_' + (i + 1);
    let k = key;
    let n = 2;
    while (seen[k]) k = key.slice(0, 36) + '_' + n++;
    seen[k] = true;
    return { key: k, area: area, text: text, type: type, unit: cleanUnit(type, q.unit, where) };
  });
}

/** dd.templates: the checklists (with their questions when --full). */
function opTemplates(ctx, p) {
  const util = u();
  const all = util.bool(p, 'all', false);
  const full = util.bool(p, 'full', false);
  const rows = util.findMany(ctx.app, 'dd_templates', all ? '1=1' : 'archived = false', 'sort,created');
  return { templates: rows.map((r) => templateOut(r, full)) };
}

/** dd.template-save: create or change a checklist (areas and questions). */
function opTemplateSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'template', '');
  let rec = ref !== '' ? templateRef(app, ref) : null;
  const before = rec !== null ? templateOut(rec, true) : null;
  if (rec === null) {
    const name = util.text(p, 'name', 80, '');
    if (name === '') throw util.fail(400, 'name is required for a new checklist.', 'missing_param', { param: 'name' });
    let key = slug(name) || 'checklist';
    let k = key;
    let n = 2;
    while (util.findOne(app, 'dd_templates', 'key = {:k}', { k: k }) !== null) k = key.slice(0, 36) + '_' + n++;
    rec = util.newRecord(app, 'dd_templates');
    rec.set('key', k);
    rec.set('name', name);
    rec.set('areas', []);
    rec.set('questions', []);
    rec.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM dd_templates') + 1);
  } else if (util.str(p, 'name', '') !== '') rec.set('name', util.text(p, 'name', 80, ''));
  const rawAreas = util.list(p, 'areas');
  const areas = rawAreas !== undefined ? cleanAreas(rawAreas) : util.jsonOf(rec, 'areas', []) || [];
  const rawQs = util.list(p, 'questions');
  if (rawQs !== undefined) rec.set('questions', cleanTemplateQuestions(rawQs, areas));
  else if (rawAreas !== undefined) cleanTemplateQuestions(util.jsonOf(rec, 'questions', []) || [], areas);
  rec.set('areas', areas);
  if (util.has(p, 'archived') && util.str(p, 'archived', '') !== '') rec.set('archived', util.bool(p, 'archived', false));
  if (areas.length === 0) throw util.fail(400, 'A checklist needs at least one area (--areas).', 'missing_param', { param: 'areas' });
  stamp(ctx, rec);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'dd_templates', record: rec.id, summary: (before === null ? 'Added the checklist ' : 'Changed the checklist ') + rec.getString('name'), before: before, after: templateOut(rec, true) });
  return { template: templateOut(rec, true) };
}

function previewTemplateSave(ctx, params) {
  const util = u();
  const ref = String(params.template || '');
  const rec = ref !== '' ? templateRef(ctx.app, ref) : null;
  const name = rec !== null ? rec.getString('name') : String(params.name || 'new checklist');
  let qs = [];
  try {
    qs = util.list(params, 'questions') || [];
  } catch {
    qs = [];
  }
  return { label: (rec === null ? 'Add the checklist ' : 'Change the checklist ') + name, target: rec !== null ? 'dd_templates:' + rec.id : '', fields: qs.slice(0, 20).map((q, i) => ({ name: 'question ' + (i + 1), before: '', after: String((q && q.text) || '') })), notes: [], risk: 'low' };
}

/* ----------------------------------------------------------- questions */

function questionsOf(app, dealId, withDeleted) {
  return arr(u().findMany(app, 'dd_questions', 'deal = {:d}' + (withDeleted ? '' : " && deleted_at = ''"), 'sort,created', 0, { d: dealId }));
}

function nextSort(app, dealId, area) {
  const r = u().one(app, "SELECT COALESCE(MAX(sort), -1) AS s FROM dd_questions WHERE deal = {:d} AND area = {:a}", { s: 0 }, { d: dealId, a: area });
  if (r !== null && r.s >= 0) return r.s + 1;
  const all = u().one(app, 'SELECT COALESCE(MAX(sort), -1) AS s FROM dd_questions WHERE deal = {:d}', { s: 0 }, { d: dealId });
  return (Math.floor(((all !== null ? all.s : -1) + 1) / 100) + 1) * 100;
}

/** Add a checklist's questions to a deal: new keys added, removed ones restored, existing kept. */
function applyTemplate(ctx, d, tpl) {
  const util = u();
  const app = ctx.app;
  const areas = util.jsonOf(tpl, 'areas', []) || [];
  const labels = {};
  areas.forEach((a) => (labels[a.key] = a.label));
  const have = {};
  for (const q of questionsOf(app, d.id, true)) if (q.getString('key') !== '') have[q.getString('key')] = q;
  const qs = util.jsonOf(tpl, 'questions', []) || [];
  if (Object.keys(have).length + qs.length > MAX_QUESTIONS * 2) throw util.fail(409, 'This deal has too many questions already.', 'too_many');
  let added = 0;
  let restored = 0;
  let kept = 0;
  const within = {};
  qs.forEach((tq) => {
    const ai = Math.max(0, areas.map((a) => a.key).indexOf(tq.area));
    within[tq.area] = (within[tq.area] || 0) + 1;
    const old = have[tq.key];
    if (old !== undefined) {
      if (old.getString('deleted_at') === '') {
        kept++;
        return;
      }
      old.set('deleted_at', '');
      app.save(old);
      restored++;
      return;
    }
    const r = util.newRecord(app, 'dd_questions');
    r.set('deal', d.id);
    r.set('key', tq.key);
    r.set('template', tpl.getString('key'));
    r.set('area', tq.area);
    r.set('area_label', labels[tq.area] || tq.area);
    r.set('text', tq.text);
    r.set('type', tq.type);
    r.set('unit', tq.unit || '');
    r.set('sort', ai * 100 + within[tq.area]);
    r.set('source', 'template');
    r.set('state', 'open');
    r.set('run', ctx.run || '');
    stamp(ctx, r);
    app.save(r);
    added++;
  });
  return { added: added, restored: restored, kept: kept };
}

/** dd.template-apply: add a checklist's questions to a deal (default: the checklist for its round). */
function opTemplateApply(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const tpl = util.str(p, 'template', '') !== '' ? templateRef(app, util.str(p, 'template', '')) : templateForDeal(app, d);
  if (tpl.getBool('archived')) throw util.fail(409, 'The checklist ' + tpl.getString('name') + ' is archived.', 'archived');
  const r = applyTemplate(ctx, d, tpl);
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: 'Applied the ' + tpl.getString('name') + ' checklist to ' + dealTitle(app, d) + ' (' + r.added + ' added)' });
  return { deal: dealMini(app, d), template: tpl.getString('key'), added: r.added, restored: r.restored, kept: r.kept, questions: questionsOf(app, d.id, false).length };
}

/** dd.questions-save: add, change or remove questions on a deal. */
function opQuestionsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const items = util.list(p, 'questions') || [];
  const remove = util.list(p, 'remove') || [];
  if (items.length === 0 && remove.length === 0) throw util.fail(400, 'Give --questions \'[{"area":"traction","text":"...","type":"number","unit":"money"}]\' or --remove \'["<question id>"]\'.', 'missing_param', { param: 'questions' });
  if (items.length > MAX_BATCH) throw util.fail(400, 'At most ' + MAX_BATCH + ' questions at once.', 'too_many');
  const existing = questionsOf(app, d.id, false);
  if (existing.length + items.length > MAX_QUESTIONS) throw util.fail(409, 'A deal holds at most ' + MAX_QUESTIONS + ' questions.', 'too_many');
  const labels = {};
  existing.forEach((q) => (labels[q.getString('area')] = q.getString('area_label')));
  let added = 0;
  let changed = 0;
  let removed = 0;
  items.forEach((it, i) => {
    const where = 'Question ' + (i + 1);
    util.keysOnly(it, ['question', 'area', 'area_label', 'text', 'type', 'unit'], where);
    const text = util.squash(it.text);
    if (text.length > 300) throw util.fail(400, where + ': text is at most 300 characters.', 'invalid_param', { param: 'questions' });
    let rec = null;
    if (it.question) {
      rec = util.byId(app, 'dd_questions', String(it.question));
      if (rec === null || rec.getString('deal') !== d.id || rec.getString('deleted_at') !== '') throw util.fail(404, where + ': no question ' + it.question + ' on this deal.', 'not_found');
    } else if (text === '') throw util.fail(400, where + ' needs text.', 'invalid_param', { param: 'questions' });
    const type = String(it.type || (rec !== null ? rec.getString('type') : 'text'));
    if (TYPES.indexOf(type) < 0) throw util.fail(400, where + ': type must be one of ' + TYPES.join(', ') + '.', 'invalid_param', { param: 'questions', allowed: TYPES });
    const unit = cleanUnit(type, it.unit !== undefined ? it.unit : rec !== null ? rec.getString('unit') : '', where);
    let area = slug(it.area || it.area_label || (rec !== null ? rec.getString('area') : ''));
    if (area === '') area = 'other';
    const areaLabel = util.squash(it.area_label) || labels[area] || (area === 'other' ? 'Other' : area.charAt(0).toUpperCase() + area.slice(1).replace(/_/g, ' '));
    labels[area] = areaLabel;
    if (rec === null) {
      rec = util.newRecord(app, 'dd_questions');
      rec.set('deal', d.id);
      rec.set('key', '');
      rec.set('template', '');
      rec.set('source', ctx.isAgent ? 'agent' : 'person');
      rec.set('state', 'open');
      rec.set('sort', nextSort(app, d.id, area));
      rec.set('run', ctx.run || '');
      stamp(ctx, rec);
      added++;
    } else {
      changed++;
      if (type !== rec.getString('type') || unit !== rec.getString('unit')) {
        // A new type or unit: the answers no longer fit.
        for (const a of liveAnswers(app, { question: rec.id })) {
          a.set('status', 'superseded');
          app.save(a);
        }
        rec.set('state', 'open');
        rec.set('answer', '');
      }
    }
    rec.set('area', area);
    rec.set('area_label', areaLabel);
    if (text !== '') rec.set('text', text);
    rec.set('type', type);
    rec.set('unit', unit);
    app.save(rec);
  });
  remove.forEach((id) => {
    const rec = util.byId(app, 'dd_questions', String(id));
    if (rec === null || rec.getString('deal') !== d.id) throw util.fail(404, 'No question ' + id + ' on this deal.', 'not_found');
    if (rec.getString('deleted_at') !== '') return;
    rec.set('deleted_at', nowIso());
    app.save(rec);
    removed++;
  });
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: 'Diligence questions on ' + dealTitle(app, d) + ': ' + added + ' added, ' + changed + ' changed, ' + removed + ' removed' });
  return { deal: dealMini(app, d), added: added, changed: changed, removed: removed, questions: questionsOf(app, d.id, false).length };
}

function previewQuestionsSave(ctx, params) {
  const util = u();
  const d = D().ref(ctx.app, params.deal);
  let items = [];
  let remove = [];
  try {
    items = util.list(params, 'questions') || [];
    remove = util.list(params, 'remove') || [];
  } catch {
    items = [];
  }
  const fields = items.slice(0, 20).map((q) => ({ name: String((q && (q.area_label || q.area)) || 'question'), before: '', after: String((q && q.text) || '') }));
  remove.slice(0, 10).forEach((id) => {
    const q = util.byId(ctx.app, 'dd_questions', String(id));
    fields.push({ name: 'remove', before: q !== null ? q.getString('text') : String(id), after: '' });
  });
  return { label: 'Diligence questions for ' + dealTitle(ctx.app, d) + ': ' + items.length + ' to add or change' + (remove.length > 0 ? ', ' + remove.length + ' to remove' : ''), target: 'deals:' + d.id, fields: fields, notes: [], risk: 'low' };
}

/* -------------------------------------------------------------- answers */

/** Live answers (proposed or confirmed) of a question or of a grid cell. */
function liveAnswers(app, target) {
  if (target.question) return arr(u().findMany(app, 'dd_answers', "question = {:q} && (status = 'agent_proposed' || status = 'confirmed')", '-created', 0, { q: target.question }));
  return arr(u().findMany(app, 'dd_answers', "grid = {:g} && company = {:c} && col_key = {:k} && (status = 'agent_proposed' || status = 'confirmed')", '-created', 0, { g: target.grid, c: target.company, k: target.col }));
}

function decimalText(v, places) {
  const n = Math.round(Number(v));
  const neg = n < 0;
  let d = String(Math.abs(n));
  while (d.length <= places) d = '0' + d;
  const frac = d.slice(d.length - places).replace(/0+$/, '');
  return (neg ? '-' : '') + u().group(d.slice(0, d.length - places)) + (frac !== '' ? '.' + frac : '');
}

/** The answer as text for people and the agent ("USD 1,200,000.00", "18.5 months", "Yes"). */
function display(a) {
  const type = a.getString('type');
  const unit = a.getString('unit');
  if (type === 'number') {
    if (/^[A-Z]{3}$/.test(unit)) return L('lib_money').format(a.getInt('value_minor'), unit);
    if (unit === '%') return L('lib_money').ppmText(a.getInt('value_ppm')) + '%';
    return decimalText(a.getInt('value_e6'), 6) + (unit !== '' ? ' ' + unit : '');
  }
  if (type === 'yes_no') return a.getBool('value_bool') ? 'Yes' : 'No';
  if (type === 'date') return a.getString('value_day');
  return a.getString('value_text');
}

/** Same value? (to skip repeats and refuse a value a person rejected) */
function valueKey(type, unit, v) {
  return [type, unit, v.value_text || '', v.value_minor || 0, v.value_ppm || 0, v.value_e6 || 0, v.value_bool ? 1 : 0, v.value_day || ''].join('|');
}

function valueKeyOf(a) {
  return valueKey(a.getString('type'), a.getString('unit'), { value_text: a.getString('value_text'), value_minor: a.getInt('value_minor'), value_ppm: a.getInt('value_ppm'), value_e6: a.getInt('value_e6'), value_bool: a.getBool('value_bool'), value_day: a.getString('value_day') });
}

/** File read rights per file id for quote hiding (cache in `rights`). */
function quoteVisible(ctx, fileId, rights) {
  if (!fileId) return true;
  if (rights[fileId] !== undefined) return rights[fileId];
  const f = u().byId(ctx.app, 'files', fileId);
  rights[fileId] = f !== null && L('lib_files').canRead(ctx, f, { deleted: true }).ok;
  return rights[fileId];
}

/** An answer for screens and the agent; quotes from files the caller may not open are hidden. */
function answerOut(ctx, a, rights) {
  const util = u();
  const cites = (util.jsonOf(a, 'cites', []) || []).map((c) => {
    const open = quoteVisible(ctx, c.file, rights);
    return { anchor: c.anchor, file: c.file, file_name: open ? c.file_name : '', page: c.page, quote: open ? c.quote : null, nda: c.nda === true, hidden: !open };
  });
  return {
    id: a.id,
    question: a.getString('question'),
    grid: a.getString('grid'),
    company: a.getString('company'),
    column: a.getString('col_key'),
    status: a.getString('status'),
    type: a.getString('type'),
    value: display(a),
    raw: { text: a.getString('value_text'), minor: a.getInt('value_minor'), ppm: a.getInt('value_ppm'), e6: a.getInt('value_e6'), bool: a.getBool('value_bool'), day: a.getString('value_day') },
    unit: a.getString('unit'),
    num_kind: a.getString('num_kind'),
    formula: a.getString('formula'),
    grade: a.getString('grade'),
    high: HIGH.indexOf(a.getString('grade')) >= 0,
    cites: cites,
    sources: util.jsonOf(a, 'sources', []) || [],
    note: a.getString('note'),
    actor: a.getString('actor'),
    at: a.getString('created'),
    confirmed_by: L('lib_records').mini(ctx.app, 'members', a.getString('confirmed_by')),
    confirmed_at: a.getString('confirmed_at'),
  };
}

/** Parse one item's value by the question's type and unit. */
function parseValue(type, unitQ, it, where) {
  const util = u();
  const money = L('lib_money');
  const v = { value_text: '', value_minor: 0, value_ppm: 0, value_e6: 0, value_bool: false, value_day: '' };
  const raw = it.value === undefined || it.value === null ? '' : typeof it.value === 'boolean' ? (it.value ? 'yes' : 'no') : String(it.value).trim();
  if (raw === '') throw util.fail(400, where + ': value is required (or not_found true when the room does not say).', 'missing_param', { param: 'value' });
  let unit = '';
  if (type === 'text') {
    v.value_text = raw;
    if (raw.length > 2000) throw util.fail(400, where + ': a text answer is at most 2000 characters.', 'invalid_param');
  } else if (type === 'yes_no') {
    const s = raw.toLowerCase();
    if (s === 'yes' || s === 'true') v.value_bool = true;
    else if (s === 'no' || s === 'false') v.value_bool = false;
    else throw util.fail(400, where + ': a yes/no answer is yes or no.', 'invalid_param');
  } else if (type === 'date') {
    if (!util.isDay(raw)) throw util.fail(400, where + ': a date answer is YYYY-MM-DD.', 'invalid_param');
    v.value_day = raw;
  } else {
    const given = util.squash(it.unit);
    unit = given !== '' ? given : unitQ === 'money' ? '' : unitQ;
    if (/^[A-Za-z]{3}$/.test(unit) && (unitQ === 'money' || unitQ === '' || /^[A-Z]{3}$/.test(unit))) unit = unit.toUpperCase();
    const isCur = /^[A-Z]{3}$/.test(unit);
    if (unitQ === 'money' && !isCur) throw util.fail(400, where + ': this question takes an amount: give unit as its currency code (USD, EUR, GBP...).', 'invalid_param', { param: 'unit' });
    if (unitQ === '%' && unit !== '%') throw util.fail(400, where + ': this question takes a percent: unit "%".', 'invalid_param', { param: 'unit' });
    if (unitQ !== '' && unitQ !== 'money' && unitQ !== '%' && (isCur || unit === '%')) throw util.fail(400, where + ': this question is counted in ' + unitQ + ', not ' + unit + '.', 'invalid_param', { param: 'unit' });
    const plain = raw.replace(/%$/, '').trim();
    if (isCur) {
      const m = money.toMinor(plain, unit, true);
      if (m === null) throw util.fail(400, where + ': value must be a plain amount in ' + unit + ' such as 1200000 or 1200000.50 (no k, M or symbols).', 'invalid_amount');
      v.value_minor = m;
    } else if (unit === '%') {
      const n = money.parseScaled(plain, 4, true);
      if (n === null) throw util.fail(400, where + ': value must be a percent such as 12.5.', 'invalid_param');
      v.value_ppm = n;
    } else {
      if (unit.length > 20 || (unit !== '' && !/^[A-Za-z][A-Za-z ]{0,19}$/.test(unit))) throw util.fail(400, where + ': unit is one word such as months.', 'invalid_param', { param: 'unit' });
      unit = unit.toLowerCase();
      const n = money.parseScaled(plain, 6, true);
      if (n === null) throw util.fail(400, where + ': value must be a plain number such as 42 or 18.5 (no k or M).', 'invalid_param');
      v.value_e6 = n;
    }
  }
  return { v: v, unit: unit };
}

function cleanSources(raw, where) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') return [];
  let list = raw;
  if (typeof list === 'string') list = list.trim().charAt(0) === '[' ? JSON.parse(list) : [list];
  if (!Array.isArray(list)) throw util.fail(400, where + ': sources is a list of links.', 'invalid_param', { param: 'sources' });
  if (list.length > 10) throw util.fail(400, where + ': at most 10 sources.', 'too_many');
  return list.map((s) => {
    const t = String(s || '').trim();
    if (!/^https?:\/\/[^\s]+$/.test(t) || t.length > 500) throw util.fail(400, where + ': each source is a public link starting with http (got "' + util.clip(t, 60) + '").', 'invalid_param', { param: 'sources' });
    return t;
  });
}

function cleanIds(raw, where, ctx) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') return [];
  let list = raw;
  if (typeof list === 'string') list = list.trim().charAt(0) === '[' ? JSON.parse(list) : [list];
  if (!Array.isArray(list)) throw util.fail(400, where + ': anchors is a list of anchor ids, or of passages {"file","page","quote"} (or "lines").', 'invalid_param', { param: 'anchors' });
  if (list.length > 10) throw util.fail(400, where + ': at most 10 anchors.', 'too_many');
  return list
    .map((x) => {
      // An inline passage becomes its anchor in the same call (SPEC qa-cli RULING CLI-18).
      if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
        if (!ctx) throw util.fail(400, where + ': give anchor ids here.', 'invalid_param', { param: 'anchors' });
        util.keysOnly(x, ['file', 'page', 'quote', 'lines', 'start', 'end', 'area'], where + ' anchor');
        try {
          return L('lib_text').anchor(ctx, Object.assign({}, x)).id;
        } catch (err) {
          if (err && typeof err.status === 'number' && err.status < 500) throw util.fail(err.status, where + ': ' + String(err.message || err), err.code || 'citation_invalid', err.extra);
          throw err;
        }
      }
      return String(x || '').trim();
    })
    .filter((x) => x !== '');
}

/** The target of one item: a question on a deal, or a grid cell of a company without a room. */
function targetOf(ctx, it, where, cache) {
  const util = u();
  const app = ctx.app;
  if (it.question) {
    const q = util.byId(app, 'dd_questions', String(it.question));
    if (q === null || q.getString('deleted_at') !== '') throw util.fail(404, where + ': no question ' + it.question + '. Run dd.get --deal.', 'not_found');
    if (cache.deals[q.getString('deal')] === undefined) {
      const d = util.byId(app, 'deals', q.getString('deal'));
      D().guard(ctx, d);
      cache.deals[d.id] = d;
    }
    return { question: q.id, q: q, deal: cache.deals[q.getString('deal')], type: q.getString('type'), unit: q.getString('unit') };
  }
  if (it.grid) {
    const G = L('lib_diligence_grid');
    if (cache.grids[it.grid] === undefined) cache.grids[it.grid] = G.gridRef(app, String(it.grid));
    const g = cache.grids[it.grid];
    const row = G.rowsOf(g).filter((r) => r.company === String(it.company || ''))[0];
    if (!row) throw util.fail(400, where + ': company ' + (it.company || '(none)') + ' is not a row of this grid.', 'invalid_param', { param: 'company' });
    if (row.deal) throw util.fail(400, where + ': this company has a deal room: answer its question there (dd.get --deal ' + row.deal + ').', 'has_room', { deal: row.deal });
    const col = G.columnsOf(g).filter((c) => c.key === String(it.column || ''))[0];
    if (!col) throw util.fail(400, where + ': column ' + (it.column || '(none)') + ' is not in this grid.', 'invalid_param', { param: 'column' });
    return { grid: g.id, g: g, company: row.company, col: col.key, deal: null, type: col.type, unit: col.unit || '' };
  }
  throw util.fail(400, where + ': give question (a deal question) or grid, company and column (a grid cell).', 'missing_param', { param: 'question' });
}

/** Check one item's citations: anchors in scope and still valid, or public source links. Returns the cites snapshot. */
function citesOf(ctx, t, anchors, where) {
  const util = u();
  if (anchors.length === 0) return [];
  const res = L('lib_text').resolve(ctx, anchors, t.deal !== null ? { deal: t.deal.id } : {});
  return res.map((r) => {
    if (!r.ok) throw util.fail(400, where + ': anchor ' + r.id + ' does not resolve (' + r.reason + ')' + (r.reason === 'nda_not_asked' ? '; NDA files open only while a person asked you about this deal' : '') + '.', 'citation_invalid', { anchor: r.id, reason: r.reason });
    if (r.kind === 'message') throw util.fail(400, where + ': anchor ' + r.id + ' is a message passage; cite a file passage or a public link.', 'citation_invalid', { anchor: r.id });
    if (r.valid === false) throw util.fail(400, where + ': anchor ' + r.id + ' no longer matches its page.', 'citation_invalid', { anchor: r.id, reason: 'stale' });
    if (r.deleted) throw util.fail(400, where + ': anchor ' + r.id + ' is in a deleted file.', 'citation_invalid', { anchor: r.id, reason: 'deleted' });
    const f = util.byId(ctx.app, 'files', r.file);
    if (t.deal !== null) {
      if (r.in_scope !== true) throw util.fail(400, where + ': anchor ' + r.id + ' is outside this deal\'s citation scope (its room and its company\'s files).', 'citation_scope', { anchor: r.id });
    } else if (f === null || f.getString('owner_collection') !== 'companies' || f.getString('owner_id') !== t.company || f.getString('deal') !== '' || f.getBool('nda')) {
      throw util.fail(400, where + ': a grid cell cites only that company\'s own files or public links.', 'citation_scope', { anchor: r.id });
    }
    return { anchor: r.id, file: r.file, file_name: r.file_name, version: r.version, page: r.page, quote: util.clip(r.quote, 600), nda: f !== null && f.getBool('nda') };
  });
}

/** Check one item fully (no writes). */
function checkItem(ctx, it, i, cache) {
  const util = u();
  const where = 'Answer ' + (i + 1);
  if (it === null || typeof it !== 'object' || Array.isArray(it)) throw util.fail(400, where + ' must be an object.', 'invalid_param');
  util.keysOnly(it, ITEM_KEYS, where);
  const t = targetOf(ctx, it, where, cache);
  if (it.not_found === true || it.not_found === 'true') {
    if (!t.question) throw util.fail(400, where + ': not_found is for deal questions.', 'invalid_param');
    return { t: t, notFound: true, note: util.clip(util.squash(it.note), 600) };
  }
  const pv = parseValue(t.type, t.unit, it, where);
  const anchors = cleanIds(it.anchors, where, ctx);
  const sources = cleanSources(it.sources, where);
  let grade = String(it.grade || '');
  if (grade === '') grade = ctx.isAgent ? '' : 'founder_reported';
  if (GRADES.indexOf(grade) < 0) throw util.fail(400, where + ': grade is one of ' + GRADES.join(', ') + '.', 'invalid_param', { param: 'grade', allowed: GRADES });
  let numKind = String(it.num_kind || '');
  if (t.type === 'number') {
    if (numKind === '') numKind = ctx.isAgent ? '' : 'entered';
    if (ctx.isAgent && numKind === '') throw util.fail(400, where + ': give num_kind: quoted (the number is on the page, with its anchor) or external (a public source link).', 'missing_param', { param: 'num_kind', allowed: ['quoted', 'external'] });
    if (NUM_KINDS.indexOf(numKind) < 0) throw util.fail(400, where + ': num_kind is quoted (the number is on the page), computed (give formula) or external (give sources).', 'invalid_param', { param: 'num_kind', allowed: NUM_KINDS });
    if (ctx.isAgent && numKind === 'entered') throw util.fail(400, where + ': entered is for numbers a person typed; yours are quoted or external.', 'invalid_param', { param: 'num_kind' });
    // SPEC 0: no number is computed by a model. Your AI agent answers the inputs it read; a derived figure (runway, growth, a multiple) is left to the app and to people.
    if (ctx.isAgent && numKind === 'computed') throw util.fail(400, where + ': your AI agent never computes a number. Answer only figures the room or a public source states (quoted or external). For a derived figure such as runway or growth, answer the inputs that are asked as their own questions, and answer this one {"question":"<id>","not_found":true,"note":"Not stated; inputs: cash USD 3.9M (p.4), net burn USD 520K a month (p.4)"} so a person can work it out.', 'agent_no_compute', { param: 'num_kind', allowed: ['quoted', 'external'] });
  } else numKind = '';
  const formula = util.squash(it.formula);
  if (formula.length > 300) throw util.fail(400, where + ': formula is at most 300 characters.', 'invalid_param');
  if (numKind === 'computed' && formula === '') throw util.fail(400, where + ': a computed number needs its formula, e.g. "MRR 100000 x 12".', 'missing_param', { param: 'formula' });
  if (numKind === 'external' && sources.length === 0) throw util.fail(400, where + ': an external number needs its public source link.', 'missing_param', { param: 'sources' });
  if (ctx.isAgent && anchors.length === 0 && sources.length === 0) throw util.fail(400, where + ': cite it: anchors from the room (anchors.create) or public source links. Without a citation leave it (not_found true).', 'citation_required');
  if (grade === 'artifact' && anchors.length === 0) throw util.fail(400, where + ': grade artifact needs an anchor in a document.', 'citation_required');
  if (grade === 'public' && sources.length === 0) throw util.fail(400, where + ': grade public needs a public source link.', 'citation_required');
  const cites = citesOf(ctx, t, anchors, where);
  return { t: t, pv: pv, anchors: anchors, sources: sources, grade: grade, numKind: numKind, formula: formula, cites: cites, note: util.clip(util.squash(it.note), 600) };
}

/** After answers change: the question's state and shown answer. */
function refreshQuestion(app, q) {
  const live = liveAnswers(app, { question: q.id });
  const conf = live.filter((a) => a.getString('status') === 'confirmed')[0];
  const prop = live.filter((a) => a.getString('status') === 'agent_proposed')[0];
  const shown = conf || prop || null;
  q.set('state', conf ? 'confirmed' : prop ? 'proposed' : 'open');
  q.set('answer', shown !== null ? shown.id : '');
  app.save(q);
}

/** Write one checked item. Answers { status: 'saved' | 'same' | 'checked', answer }. */
function writeItem(ctx, c) {
  const util = u();
  const app = ctx.app;
  const t = c.t;
  if (c.notFound) {
    const q = app.findRecordById('dd_questions', t.question);
    q.set('checked_at', nowIso());
    q.set('check_note', c.note);
    app.save(q);
    return { status: 'checked', question: t.question, answer: '' };
  }
  const key = valueKey(t.type, c.pv.unit, c.pv.v);
  const live = liveAnswers(app, t);
  if (ctx.isAgent) {
    const same = live.filter((a) => valueKeyOf(a) === key)[0];
    if (same) return { status: 'same', question: t.question || '', answer: same.id };
    const rejected = t.question
      ? arr(util.findMany(app, 'dd_answers', "question = {:q} && status = 'rejected'", '-created', 50, { q: t.question }))
      : arr(util.findMany(app, 'dd_answers', "grid = {:g} && company = {:c} && col_key = {:k} && status = 'rejected'", '-created', 50, { g: t.grid, c: t.company, k: t.col }));
    if (rejected.some((a) => valueKeyOf(a) === key)) return { status: 'rejected_before', question: t.question || '', answer: '' };
  }
  const a = util.newRecord(app, 'dd_answers');
  if (t.question) {
    a.set('question', t.question);
    a.set('deal', t.deal.id);
  } else {
    a.set('grid', t.grid);
    a.set('company', t.company);
    a.set('col_key', t.col);
  }
  a.set('type', t.type);
  for (const k of Object.keys(c.pv.v)) a.set(k, c.pv.v[k]);
  a.set('unit', c.pv.unit);
  a.set('num_kind', c.numKind);
  a.set('formula', c.formula);
  a.set('grade', c.grade);
  a.set('anchors', c.anchors);
  a.set('cites', c.cites);
  a.set('sources', c.sources);
  a.set('note', c.note);
  a.set('run', ctx.run || '');
  stamp(ctx, a);
  if (ctx.isAgent) {
    a.set('status', 'agent_proposed');
    app.save(a);
    for (const o of live) {
      if (o.getString('status') !== 'agent_proposed') continue;
      o.set('status', 'superseded');
      app.save(o);
    }
  } else {
    a.set('status', 'confirmed');
    a.set('confirmed_by', ctx.memberId || '');
    a.set('confirmed_at', nowIso());
    app.save(a);
    for (const o of live) {
      o.set('status', 'superseded');
      app.save(o);
    }
  }
  if (t.question) refreshQuestion(app, app.findRecordById('dd_questions', t.question));
  return { status: 'saved', question: t.question || '', answer: a.id };
}

/**
 * dd.answer: answers for questions (or grid cells), all checked before any
 * is written: one bad item refuses the whole call with every problem named.
 */
function opAnswer(ctx, p) {
  const util = u();
  const items = (util.list(p, 'answers') || []).slice();
  // --rest_not_found "<where you looked>": every other open question of the deal is checked not found in one go (qa-cli run 2 F5).
  const rest = util.squash(util.text(p, 'rest_not_found', 600, ''));
  if (rest !== '') {
    let dealId = util.str(p, 'deal', '') !== '' ? dealFor(ctx, util.str(p, 'deal', '')).id : '';
    if (dealId === '') {
      const first = items.filter((it) => it && it.question)[0];
      const q = first ? util.byId(ctx.app, 'dd_questions', String(first.question)) : null;
      dealId = q !== null ? q.getString('deal') : '';
    }
    if (dealId === '') throw util.fail(400, 'rest_not_found needs --deal (or answers on that deal\'s questions).', 'missing_param', { param: 'deal' });
    const named = {};
    for (const it of items) if (it && it.question) named[it.question] = true;
    for (const q of questionsOf(ctx.app, dealId, false)) if (q.getString('state') === 'open' && !named[q.id]) items.push({ question: q.id, not_found: true, note: rest });
  }
  if (items.length === 0) throw util.fail(400, 'Give --answers \'[{"question":"<id>","value":"1200000","unit":"USD","num_kind":"quoted","grade":"founder_reported","anchors":["<anchor id>"]}]\'.', 'missing_param', { param: 'answers' });
  if (items.length > MAX_BATCH + (rest !== '' ? 1000 : 0)) throw util.fail(400, 'At most ' + MAX_BATCH + ' answers at once.', 'too_many');
  const cache = { deals: {}, grids: {} };
  const checked = [];
  const problems = [];
  items.forEach((it, i) => {
    try {
      checked.push(checkItem(ctx, it, i, cache));
    } catch (err) {
      problems.push({ index: i, question: (it && it.question) || '', code: (err && err.code) || 'invalid', message: String((err && err.message) || err) });
    }
  });
  if (problems.length > 0) {
    throw util.fail(400, problems.length + ' of ' + items.length + ' answers refused, nothing saved: ' + problems.slice(0, 3).map((x) => x.message).join(' ') + (problems.length > 3 ? ' (see data.items)' : ''), problems[0].code === 'citation_invalid' || problems[0].code === 'citation_scope' || problems[0].code === 'citation_required' ? problems[0].code : 'answers_refused', { items: problems });
  }
  const seen = {};
  checked.forEach((c, i) => {
    const k = c.t.question || c.t.grid + ':' + c.t.company + ':' + c.t.col;
    if (seen[k] !== undefined) throw util.fail(400, 'Answers ' + (seen[k] + 1) + ' and ' + (i + 1) + ' are for the same question; send one.', 'duplicate');
    seen[k] = i;
  });
  const out = checked.map((c) => writeItem(ctx, c));
  const saved = out.filter((o) => o.status === 'saved').length;
  const dealIds = Object.keys(cache.deals);
  if (ctx.isAgent) {
    // Your AI agent's answers land the asks that named their deal or grid: a deal's once every open question is
    // checked (--rest_not_found ends it), so the deal's NDA files stay open across its batches.
    const A = L('lib_agent');
    for (const id of dealIds) {
      if (rest === '' && u().count(ctx.app, "SELECT COUNT(*) AS n FROM dd_questions WHERE deal = {:d} AND deleted_at = '' AND state = 'open' AND checked_at = ''", { d: id }) > 0) continue;
      A.landed(ctx.app, 'diligence_answers', ctx.app.findRecordById('deals', id));
    }
    for (const id of Object.keys(cache.grids)) {
      const g = util.byId(ctx.app, 'compare_grids', id);
      if (g !== null) A.landed(ctx.app, 'grid_answers', g);
    }
  }
  L('lib_audit').note(ctx, {
    collection: dealIds.length === 1 ? 'deals' : 'dd_answers',
    record: dealIds.length === 1 ? dealIds[0] : '',
    summary: (ctx.isAgent ? 'Your AI agent proposed ' : 'Entered ') + saved + ' diligence answer' + (saved === 1 ? '' : 's') + (dealIds.length === 1 ? ' for ' + dealTitle(ctx.app, cache.deals[dealIds[0]]) : ''),
  });
  return {
    saved: saved,
    same: out.filter((o) => o.status === 'same').length,
    checked: out.filter((o) => o.status === 'checked').length,
    rejected_before: out.filter((o) => o.status === 'rejected_before').map((o) => o.question),
    results: ctx.isAgent ? out.filter((o) => o.status !== 'checked' && o.status !== 'same') : out,
    message: ctx.isAgent ? 'Saved as proposed answers; a person confirms them. rejected_before lists questions where a person already rejected that value.' : 'Saved as confirmed.',
  };
}

function answerRef(ctx, id) {
  const util = u();
  const a = util.byId(ctx.app, 'dd_answers', String(id || '').trim());
  if (a === null) throw util.fail(404, 'No answer ' + id + '.', 'not_found');
  if (a.getString('deal') !== '') D().guard(ctx, util.byId(ctx.app, 'deals', a.getString('deal')));
  return a;
}

function idsParam(p) {
  const util = u();
  const ids = (util.list(p, 'answers') || []).map(String);
  if (util.str(p, 'answer', '') !== '') ids.push(util.str(p, 'answer', ''));
  if (ids.length === 0) throw util.fail(400, 'Give --answer <id> or --answers \'["id1","id2"]\'.', 'missing_param', { param: 'answers' });
  if (ids.length > 200) throw util.fail(400, 'At most 200 answers at once.', 'too_many');
  return ids;
}

/** dd.confirm: a person confirms proposed answers (one, or a list; --grade high keeps only the high-grade ones of the list). */
function opConfirm(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = idsParam(p);
  const highOnly = util.oneOf(p, 'grade', ['high', 'all'], 'all') === 'high';
  const done = [];
  const stale = [];
  const deals = {};
  ids.forEach((id) => {
    const a = answerRef(ctx, id);
    if (highOnly && HIGH.indexOf(a.getString('grade')) < 0) return;
    if (a.getString('status') !== 'agent_proposed') {
      stale.push(a.id);
      return;
    }
    a.set('status', 'confirmed');
    a.set('confirmed_by', ctx.memberId || '');
    a.set('confirmed_at', nowIso());
    app.save(a);
    const target = a.getString('question') !== '' ? { question: a.getString('question') } : { grid: a.getString('grid'), company: a.getString('company'), col: a.getString('col_key') };
    for (const o of liveAnswers(app, target)) {
      if (o.id === a.id) continue;
      o.set('status', 'superseded');
      app.save(o);
    }
    if (a.getString('question') !== '') refreshQuestion(app, app.findRecordById('dd_questions', a.getString('question')));
    if (a.getString('deal') !== '') deals[a.getString('deal')] = true;
    done.push(a.id);
  });
  if (done.length === 0 && stale.length === 0) throw util.fail(409, 'None of those answers is high grade (artifact or public).', 'none_high');
  if (done.length === 0) throw util.fail(409, 'Nothing to confirm: ' + (stale.length === 1 ? 'that answer was' : 'those answers were') + ' already confirmed, rejected or replaced by a newer answer. Reload to see the current one.', 'stale', { stale: stale });
  const dl = Object.keys(deals);
  L('lib_audit').note(ctx, { collection: dl.length === 1 ? 'deals' : 'dd_answers', record: dl.length === 1 ? dl[0] : done[0], summary: 'Confirmed ' + done.length + ' diligence answer' + (done.length === 1 ? '' : 's') + (dl.length === 1 ? ' for ' + dealTitle(app, util.byId(app, 'deals', dl[0])) : '') });
  return { confirmed: done, stale: stale };
}

/** dd.reject: a person rejects an answer (proposed or confirmed); the question opens again unless a confirmed answer remains. */
function opReject(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = idsParam(p);
  const reason = util.oneOf(p, 'reason', REASONS, '');
  const done = [];
  const stale = [];
  ids.forEach((id) => {
    const a = answerRef(ctx, id);
    if (LIVE.indexOf(a.getString('status')) < 0) {
      stale.push(a.id);
      return;
    }
    a.set('status', 'rejected');
    a.set('rejected_by', ctx.memberId || '');
    a.set('rejected_at', nowIso());
    a.set('reason', reason);
    app.save(a);
    if (a.getString('question') !== '') refreshQuestion(app, app.findRecordById('dd_questions', a.getString('question')));
    done.push(a.id);
  });
  if (done.length === 0) throw util.fail(409, 'Nothing to reject: already rejected or replaced. Reload to see the current answer.', 'stale', { stale: stale });
  L('lib_audit').note(ctx, { collection: 'dd_answers', record: done[0], summary: 'Rejected ' + done.length + ' diligence answer' + (done.length === 1 ? '' : 's') });
  return { rejected: done, stale: stale };
}

/* ----------------------------------------------------------- room, asks */

function roomOf(app, dealId) {
  const util = u();
  const r = util.one(
    app,
    "SELECT COUNT(*) AS files, COALESCE(SUM(t.pages), 0) AS pages, COALESCE(SUM(t.pages_with_text), 0) AS pages_read, COALESCE(SUM(CASE WHEN f.nda = TRUE THEN 1 ELSE 0 END), 0) AS nda, COALESCE(SUM(CASE WHEN t.state IS NULL OR t.state = 'waiting' OR t.state = 'extracting' THEN 1 ELSE 0 END), 0) AS reading FROM files f LEFT JOIN file_texts t ON t.file = f.id WHERE f.deal = {:d} AND f.current = TRUE AND f.deleted_at = ''",
    { files: 0, pages: 0, pages_read: 0, nda: 0, reading: 0 },
    { d: dealId },
  ) || { files: 0, pages: 0, pages_read: 0, nda: 0, reading: 0 };
  const ocr = util.count(app, "SELECT COUNT(*) AS n FROM pages p JOIN files f ON f.id = p.file WHERE f.deal = {:d} AND f.current = TRUE AND f.deleted_at = '' AND p.needs_ocr = TRUE", { d: dealId });
  return { files: r.files, pages: r.pages, pages_read: r.pages_read, pages_ocr: ocr, nda: r.nda, reading: r.reading };
}

/**
 * The record's ask of a trigger as a StepTrack (null when never asked):
 * Queued, Reading, Answering (your AI agent's answers arrived since it was
 * asked), Ready; failed when it could not or nobody picked it up in 24 hours.
 */
function askState(app, rec, trigger, labels) {
  const t = L('lib_agent').track(rec, trigger, labels);
  if (t === null || !t.open || labels.length < 4) return t;
  const col = trigger === 'grid_answers' ? 'grid' : 'deal';
  if (u().count(app, "SELECT COUNT(*) AS n FROM dd_answers WHERE " + col + " = {:r} AND status = 'agent_proposed' AND created >= {:a}", { r: rec.id, a: t.asked_at.replace('T', ' ') }) > 0) t.at = 2;
  return t;
}

function openCount(app, dealId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM dd_questions WHERE deal = {:d} AND deleted_at = '' AND state = 'open'", { d: dealId });
}

/** agent.ask --trigger diligence_answers --record <deal>: a deal with open questions your AI agent may work on. */
function askCheck(ctx, d) {
  const util = u();
  dealFor(ctx, d.id);
  L('lib_auth').need(ctx, 'diligence', 'edit', 'ask your AI agent for diligence answers');
  if (d.getBool('restricted') && !d.getBool('agent_allowed')) throw util.fail(409, 'Your AI agent is off for this restricted deal (the deal team can allow it).', 'agent_off');
  if (openCount(ctx.app, d.id) === 0) throw util.fail(409, questionsOf(ctx.app, d.id, false).length === 0 ? 'Apply a checklist first (dd.template-apply).' : 'Every question has an answer.', 'nothing_open');
  return {};
}

/** The deal itself (its NDA files open for your AI agent while it is asked). */
function dealSelf(app, d) {
  return d.id;
}

/** dd.ask: Ask your AI agent to answer the deal's open questions now: ONE trigger for the deal (it reads scanned pages of the room in the same run). */
function opAsk(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  askCheck(ctx, d);
  const r = L('lib_agent').requestFor(ctx, 'diligence_answers', d, {}, { again: util.str(p, 'again', '') });
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: 'Asked your AI agent to answer diligence questions for ' + dealTitle(app, d) });
  return { request: r.request, step: askState(app, app.findRecordById('deals', d.id), 'diligence_answers', STEPS) };
}

/* --------------------------------------------------------------- reads */

/** dd.get: a deal's checklist with answers, progress per area, the room and the agent's progress. */
function opGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = dealFor(ctx, util.req(p, 'deal', 'D-0001'));
  const only = util.oneOf(p, 'state', ['open', 'proposed', 'confirmed', 'all'], 'all');
  const areaOnly = util.str(p, 'area', '');
  const compact = ctx.isAgent && !util.bool(p, 'full', false);
  const qs = questionsOf(app, d.id, false);
  const answers = arr(util.findMany(app, 'dd_answers', "deal = {:d} && (status = 'agent_proposed' || status = 'confirmed')", '-created', 0, { d: d.id }));
  const byQ = {};
  answers.forEach((a) => {
    const k = a.getString('question');
    if (byQ[k] === undefined) byQ[k] = { confirmed: null, proposed: null };
    if (a.getString('status') === 'confirmed' && byQ[k].confirmed === null) byQ[k].confirmed = a;
    if (a.getString('status') === 'agent_proposed' && byQ[k].proposed === null) byQ[k].proposed = a;
  });
  const rights = {};
  const areas = [];
  const areaIx = {};
  let hidden = 0;
  const outQs = [];
  qs.forEach((q) => {
    const area = q.getString('area');
    if (areaIx[area] === undefined) {
      areaIx[area] = areas.length;
      areas.push({ key: area, label: q.getString('area_label') || area, total: 0, answered: 0, confirmed: 0, proposed: 0 });
    }
    const ar = areas[areaIx[area]];
    const st = q.getString('state');
    ar.total++;
    if (st !== 'open') ar.answered++;
    if (st === 'confirmed') ar.confirmed++;
    if (st === 'proposed') ar.proposed++;
    if (only !== 'all' && st !== only) return;
    if (areaOnly !== '' && area !== areaOnly) return;
    const b = byQ[q.id] || { confirmed: null, proposed: null };
    const shown = b.confirmed || b.proposed;
    const ans = shown ? answerOut(ctx, shown, rights) : null;
    const pend = b.confirmed && b.proposed ? answerOut(ctx, b.proposed, rights) : null;
    [ans, pend].forEach((x) => {
      if (x) x.cites.forEach((c) => (hidden += c.hidden ? 1 : 0));
    });
    if (compact) {
      // Your AI agent's row: what to answer (id, area, text, type, unit) and only what is already there.
      const row = { id: q.id, area: area, text: q.getString('text'), type: q.getString('type') };
      if (q.getString('unit') !== '') row.unit = q.getString('unit');
      if (only === 'all') row.state = st;
      if (ans) row.answer = { value: ans.value, unit: ans.unit, grade: ans.grade, status: ans.status };
      if (pend) row.proposal = { value: pend.value, unit: pend.unit, grade: pend.grade };
      if (q.getString('check_note') !== '') row.check_note = q.getString('check_note');
      outQs.push(row);
      return;
    }
    outQs.push({ id: q.id, key: q.getString('key'), area: area, area_label: q.getString('area_label'), text: q.getString('text'), type: q.getString('type'), unit: q.getString('unit'), state: st, source: q.getString('source'), answer: ans, proposal: pend, checked_at: q.getString('checked_at'), check_note: q.getString('check_note') });
  });
  const counts = { total: qs.length, open: 0, proposed: 0, confirmed: 0, high: 0 };
  qs.forEach((q) => (counts[q.getString('state')] = (counts[q.getString('state')] || 0) + 1));
  answers.forEach((a) => {
    if (a.getString('status') === 'agent_proposed' && HIGH.indexOf(a.getString('grade')) >= 0) counts.high++;
  });
  const templates = util.findMany(app, 'dd_templates', 'archived = false', 'sort,created').map((t) => ({ key: t.getString('key'), name: t.getString('name'), count: (util.jsonOf(t, 'questions', []) || []).length }));
  return {
    deal: Object.assign(dealMini(app, d), { restricted: d.getBool('restricted'), agent_allowed: d.getBool('agent_allowed') }),
    areas: areas,
    questions: outQs,
    counts: counts,
    proposed_ids: answers.filter((a) => a.getString('status') === 'agent_proposed').map((a) => a.id),
    high_ids: answers.filter((a) => a.getString('status') === 'agent_proposed' && HIGH.indexOf(a.getString('grade')) >= 0).map((a) => a.id),
    room: roomOf(app, d.id),
    ask: askState(app, d, 'diligence_answers', STEPS),
    templates: templates,
    suggested_template: qs.length === 0 && suggestedTemplate(app, d) !== null ? suggestedTemplate(app, d).getString('key') : '',
    hidden_quotes: hidden,
  };
}

/** Contract (SPEC 4.6): a deal's questions and its current answers (confirmed and proposed), no rights check. */
function answersFor(app, dealId) {
  const util = u();
  const sys = L('lib_auth').systemCtx(app);
  const qs = questionsOf(app, dealId, false);
  const live = arr(util.findMany(app, 'dd_answers', "deal = {:d} && (status = 'agent_proposed' || status = 'confirmed')", '-created', 0, { d: dealId }));
  const rights = {};
  return {
    questions: qs.map((q) => ({ id: q.id, key: q.getString('key'), area: q.getString('area'), area_label: q.getString('area_label'), text: q.getString('text'), type: q.getString('type'), unit: q.getString('unit'), state: q.getString('state'), answer: q.getString('answer') })),
    answers: live.map((a) => answerOut(sys, a, rights, '')),
  };
}

/* ----------------------------------------------------------------- Next */

/** Who clears a deal's answers: its point partner and deal team; everyone who may confirm when it has neither. */
function forMe(ctx, d) {
  const util = u();
  const point = d.getString('point');
  const team = util.rows(ctx.app, 'SELECT member FROM deal_people WHERE deal = {:d} AND team = TRUE AND member != \'\'', { member: '' }, { d: d.id }).map((r) => r.member);
  if (point === '' && team.length === 0) return true;
  return point === ctx.memberId || team.indexOf(ctx.memberId) >= 0;
}

function shortQuote(c) {
  if (!c) return '';
  return u().clip(c.quote || '', 220);
}

function cardAnswers(ctx, list, rights, qText) {
  return list.slice(0, 40).map((a) => {
    const v = answerOut(ctx, a, rights, '');
    const c = v.cites[0];
    return { id: v.id, question: v.question, text: qText[v.question] || '', value: v.value, type: v.type, raw: v.raw, unit: v.unit, grade: v.grade, high: v.high, num_kind: v.num_kind, formula: v.formula, quote: shortQuote(c), hidden: c ? c.hidden : false, anchor: c ? c.anchor : '', file: c ? c.file : '', file_name: c ? c.file_name : '', page: c ? c.page : 0, source: v.sources[0] || '' };
  });
}

/**
 * The card's one primary action: Confirm all. When only some answers are high grade, the
 * kernel's chips ask which (High grade N or All N) before it runs (dd.confirm --grade).
 */
function confirmAll(list, high) {
  const all = list.map((a) => a.id);
  const mixed = high.length > 0 && high.length < all.length;
  return {
    label: 'Confirm all',
    op: 'dd.confirm',
    params: { answers: all },
    primary: true,
    choose: mixed ? { param: 'grade', options: [{ value: 'high', label: 'High grade ' + high.length }, { value: 'all', label: 'All ' + all.length }] } : null,
  };
}

/** Next: proposed answers waiting, one verify card per deal (and per grid of its creator). */
function needsYou(ctx) {
  const util = u();
  if (ctx.isAgent || !ctx.memberId) return [];
  if (!L('lib_auth').can(ctx, 'diligence', 'edit')) return [];
  const app = ctx.app;
  const out = [];
  const rights = {};
  const groups = util.rows(app, "SELECT a.deal AS deal, COUNT(*) AS n, MAX(a.created) AS at FROM dd_answers a JOIN deals d ON d.id = a.deal WHERE a.status = 'agent_proposed' AND a.deal != '' AND d.deleted_at = '' GROUP BY a.deal ORDER BY at DESC LIMIT 100", { deal: '', n: 0, at: '' });
  for (const g of groups) {
    const d = util.byId(app, 'deals', g.deal);
    if (d === null || !D().visible(ctx, d) || !forMe(ctx, d)) continue;
    const list = arr(util.findMany(app, 'dd_answers', "deal = {:d} && status = 'agent_proposed'", 'created', 0, { d: d.id }));
    const qText = {};
    list.forEach((a) => {
      const q = util.byId(app, 'dd_questions', a.getString('question'));
      if (q !== null) qText[q.id] = q.getString('text');
    });
    const high = list.filter((a) => HIGH.indexOf(a.getString('grade')) >= 0).map((a) => a.id);
    const title = dealTitle(app, d);
    out.push({
      key: 'diligence:verify:' + d.id,
      kind: 'verify',
      card: 'answers',
      title: title,
      figures: [
        { label: 'To check', value: String(list.length) },
        { label: 'High grade', value: String(high.length) },
      ],
      chips: [{ label: 'Diligence', tone: 'agent' }],
      agent: true,
      rank: 40,
      at: g.at.replace(' ', 'T'),
      href: '#/deals/' + d.getString('number') + '?tab=diligence',
      data: { deal: d.id, number: d.getString('number'), title: title, count: list.length, high: high, all: list.map((a) => a.id), answers: cardAnswers(ctx, list, rights, qText) },
      actions: [confirmAll(list, high)],
    });
  }
  const cells = util.rows(app, "SELECT a.grid AS grid, COUNT(*) AS n, MAX(a.created) AS at FROM dd_answers a JOIN compare_grids g ON g.id = a.grid WHERE a.status = 'agent_proposed' AND a.grid != '' AND g.deleted_at = '' AND g.member = {:m} GROUP BY a.grid", { grid: '', n: 0, at: '' }, { m: ctx.memberId });
  for (const c of cells) {
    const g = util.byId(app, 'compare_grids', c.grid);
    if (g === null) continue;
    const list = arr(util.findMany(app, 'dd_answers', "grid = {:g} && status = 'agent_proposed'", 'created', 0, { g: g.id }));
    const cols = {};
    (util.jsonOf(g, 'columns', []) || []).forEach((col) => (cols[col.key] = col.text));
    const names = {};
    list.forEach((a) => {
      const co = a.getString('company');
      if (names[co] === undefined) {
        const r = util.byId(app, 'companies', co);
        names[co] = r !== null ? r.getString('name') : '';
      }
    });
    const answersData = cardAnswers(ctx, list, rights, {}).map((x, i) => Object.assign(x, { text: (names[list[i].getString('company')] || '') + ': ' + (cols[list[i].getString('col_key')] || list[i].getString('col_key')) }));
    const high = list.filter((a) => HIGH.indexOf(a.getString('grade')) >= 0).map((a) => a.id);
    out.push({
      key: 'diligence:grid:' + g.id,
      kind: 'verify',
      card: 'answers',
      title: g.getString('name'),
      figures: [
        { label: 'To check', value: String(list.length) },
        { label: 'High grade', value: String(high.length) },
      ],
      chips: [{ label: 'Grid', tone: 'agent' }],
      agent: true,
      rank: 40,
      at: c.at.replace(' ', 'T'),
      href: '#/compare/' + g.id,
      data: { grid: g.id, title: g.getString('name'), count: list.length, high: high, all: list.map((a) => a.id), answers: answersData },
      actions: [confirmAll(list, high)],
    });
  }
  return out;
}

/* --------------------------------------------------------------- events */

/** agent.ask --trigger page_ocr --record <file>: a file with scanned pages your AI agent may read. */
function ocrCheck(ctx, f) {
  const util = u();
  if (!L('lib_files').canRead(ctx, f, {}).ok) throw util.fail(404, 'No file ' + f.id + ' you can open.', 'not_found');
  const r = L('lib_files').canRead(L('lib_auth').agentCtx(ctx.app), f, {});
  if (!r.ok && r.reason !== 'nda_not_asked') throw util.fail(409, 'Your AI agent may not read this file (' + r.reason + ').', 'agent_off');
  if (util.count(ctx.app, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND needs_ocr = TRUE', { f: f.id }) === 0) throw util.fail(409, 'Every page of ' + f.getString('name') + ' has its text.', 'nothing_to_read');
  return {};
}

/** The deal of a file (its NDA pages open for your AI agent while it is asked). */
function fileDeal(app, f) {
  return f.getString('deal');
}

/** deal.moved into Diligence: the checklist for its round is applied when the deal never had one (your AI agent is asked only from the checklist's Ask). */
function onDealMoved(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!p || p.to !== 'diligence') return null;
  if (L('lib_settings').module(app, 'diligence').auto_apply === false) return null;
  const d = util.byId(app, 'deals', String(p.deal || ''));
  if (d === null) return null;
  if (util.count(app, 'SELECT COUNT(*) AS n FROM dd_questions WHERE deal = {:d}', { d: d.id }) > 0) return null;
  const tpl = suggestedTemplate(app, d);
  if (tpl === null) return null;
  const r = applyTemplate(ctx, d, tpl);
  return { template: tpl.getString('key'), added: r.added };
}

/** record.merged: re-point references and grid rows to the record kept. */
function onMerged(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!p || !p.keep || !p.drop) return null;
  let n = 0;
  if (p.kind === 'people') {
    for (const field of ['person', 'founder']) {
      for (const r of arr(util.findMany(app, 'references', field + ' = {:x}', '', 0, { x: p.drop }))) {
        r.set(field, p.keep);
        app.save(r);
        n++;
      }
    }
  } else if (p.kind === 'companies') {
    for (const r of arr(util.findMany(app, 'references', 'company = {:x}', '', 0, { x: p.drop }))) {
      r.set('company', p.keep);
      app.save(r);
      n++;
    }
    for (const a of arr(util.findMany(app, 'dd_answers', 'company = {:x}', '', 0, { x: p.drop }))) {
      a.set('company', p.keep);
      app.save(a);
      n++;
    }
    for (const g of arr(util.findMany(app, 'compare_grids', "deleted_at = ''", '', 0))) {
      const rows = util.jsonOf(g, 'rows', []) || [];
      if (!rows.some((r) => r.company === p.drop)) continue;
      const seen = {};
      const out = [];
      rows.forEach((r) => {
        const c = r.company === p.drop ? p.keep : r.company;
        if (seen[c]) return;
        seen[c] = true;
        out.push(Object.assign({}, r, { company: c }));
      });
      g.set('rows', out);
      app.save(g);
      n++;
    }
  }
  return { repointed: n };
}

/* ------------------------------------------------------------- timeline */

/** Timeline items: references logged and answers confirmed per day (deal); references given (person). */
function timelineFor(ctx, target) {
  const util = u();
  const app = ctx.app;
  const items = [];
  if (!target) return items;
  if (target.kind === 'deal' || target.deal) {
    const dealId = target.deal || target.id;
    const d = util.byId(app, 'deals', dealId);
    if (d === null) return items;
    const href = '#/deals/' + d.getString('number') + '?tab=diligence';
    for (const r of arr(util.findMany(app, 'references', "deal = {:d} && status = 'logged'", '-created', 50, { d: dealId }))) {
      items.push({ at: (r.getString('day') !== '' ? r.getString('day') + 'T12:00:00Z' : r.getString('created').replace(' ', 'T')), module: 'diligence', kind: 'reference', title: 'Reference: ' + (r.getString('name') || 'unnamed') + ' (' + (r.getString('signal') || 'no signal') + ')', href: href, icon: 'PhoneCall', actor: r.getString('actor') });
    }
    for (const g of util.rows(app, "SELECT substr(confirmed_at, 1, 10) AS day, COUNT(*) AS n FROM dd_answers WHERE deal = {:d} AND status = 'confirmed' AND confirmed_at != '' GROUP BY day ORDER BY day DESC LIMIT 30", { day: '', n: 0 }, { d: dealId })) {
      items.push({ at: g.day + 'T12:00:00Z', module: 'diligence', kind: 'answers_confirmed', title: g.n + ' diligence answer' + (g.n === 1 ? '' : 's') + ' confirmed', href: href, icon: 'CheckCheck', actor: 'person' });
    }
  } else if (target.kind === 'person' || target.person) {
    const pid = target.person || target.id;
    for (const r of arr(util.findMany(app, 'references', "person = {:p} && status = 'logged'", '-created', 30, { p: pid }))) {
      const d = util.byId(app, 'deals', r.getString('deal'));
      if (d === null || !D().visible(ctx, d)) continue;
      items.push({ at: (r.getString('day') !== '' ? r.getString('day') + 'T12:00:00Z' : r.getString('created').replace(' ', 'T')), module: 'diligence', kind: 'reference', title: 'Reference for ' + dealTitle(app, d), href: '#/deals/' + d.getString('number') + '?tab=diligence', icon: 'PhoneCall', actor: r.getString('actor') });
    }
  }
  return items;
}

module.exports = {
  TYPES: TYPES,
  GRADES: GRADES,
  NUM_KINDS: NUM_KINDS,
  HIGH: HIGH,
  STEPS: STEPS,
  slug: slug,
  arr: arr,
  dealFor: dealFor,
  dealTitle: dealTitle,
  dealMini: dealMini,
  templateRef: templateRef,
  suggestedTemplate: suggestedTemplate,
  templateForDeal: templateForDeal,
  applyTemplate: applyTemplate,
  questionsOf: questionsOf,
  nextSort: nextSort,
  liveAnswers: liveAnswers,
  answerOut: answerOut,
  display: display,
  roomOf: roomOf,
  askState: askState,
  askCheck: askCheck,
  dealSelf: dealSelf,
  ocrCheck: ocrCheck,
  fileDeal: fileDeal,
  stamp: stamp,
  opTemplates: opTemplates,
  opTemplateSave: opTemplateSave,
  previewTemplateSave: previewTemplateSave,
  opTemplateApply: opTemplateApply,
  opQuestionsSave: opQuestionsSave,
  previewQuestionsSave: previewQuestionsSave,
  opAnswer: opAnswer,
  opConfirm: opConfirm,
  opReject: opReject,
  opAsk: opAsk,
  opGet: opGet,
  answersFor: answersFor,
  needsYou: needsYou,
  onDealMoved: onDealMoved,
  onMerged: onMerged,
  timelineFor: timelineFor,
};
