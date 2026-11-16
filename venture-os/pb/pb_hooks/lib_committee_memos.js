/// <reference path="../pb_data/types.d.ts" />
/**
 * Investment memos (SPEC 7.9, REPORT Table 25).
 *
 * One memo per deal, in versions: memos.open starts version 1 as a draft
 * (the decision snapshot fills itself from the deal); memos.submit freezes
 * a version with a hash; opening again after a submit starts the next
 * version from the kept text.
 *
 * Blocks (memo_blocks): one kept block per section holds the text people
 * see. Your AI agent never edits it: memos.draft-block stores its draft as
 * a tracked change (state proposed) beside it; a person keeps it (it
 * becomes the kept block) or discards it. The thesis and recommendation
 * (and every section the template marks people only, such as scenarios)
 * refuse your AI agent.
 *
 * Text markup, the same for people and your AI agent: [n] cites the
 * block's n-th citation, [?] marks a figure without a source.
 * Citations: {"kind":"anchor","anchor":"<id>"} (a file or email passage of
 * this deal), {"kind":"note","note":"<id>"} (one of the deal's notes),
 * {"kind":"url","url":"https://...","source":"<publisher>"} (a named public
 * source). A citation outside the deal's scope is refused.
 *
 * AI-use disclosure (Research OS lib_ms.js): every block counts typed,
 * pasted and agent-written characters; a person's edit takes the changed
 * characters off the shares in proportion and adds what they typed or
 * pasted.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function C() {
  return L('lib_committee');
}
function RU() {
  return L('lib_committee_rules');
}

const MAX_TEXT = 40000;
const MAX_CITATIONS = 60;

/* ------------------------------------------------------------ templates */

function templateOut(t) {
  return { id: t.id, name: t.getString('name'), sections: u().jsonOf(t, 'sections', []) || [], is_default: t.getBool('is_default'), archived: t.getBool('archived') };
}

function defaultTemplate(app) {
  const t = u().findOne(app, 'memo_templates', 'is_default = true && archived = false', {});
  if (t !== null) return t;
  const any = app.findRecordsByFilter('memo_templates', 'archived = false', 'created', 1, 0);
  if (any.length === 0) throw u().fail(409, 'No memo template. Add one in Settings, Committee.', 'no_template');
  return any[0];
}

function templateRef(app, ref) {
  if (!ref) return defaultTemplate(app);
  return u().byIdOrName(app, 'memo_templates', ref, 'name', 'memos.templates');
}

function sectionsOf(app, memo) {
  const t = memo.getString('template') !== '' ? u().byId(app, 'memo_templates', memo.getString('template')) : null;
  return t !== null ? u().jsonOf(t, 'sections', []) || [] : u().jsonOf(defaultTemplate(app), 'sections', []) || [];
}

function sectionDef(app, memo, key) {
  const s = sectionsOf(app, memo).filter((x) => x.key === key)[0];
  if (s === undefined) {
    const keys = sectionsOf(app, memo).map((x) => x.key);
    const near = u().nearest(key, keys);
    throw u().fail(400, 'No section "' + key + '" in this memo' + (near ? ' (did you mean ' + near + '?)' : '') + '. Sections: ' + keys.join(', ') + '.', 'invalid_param', { param: 'section', allowed: keys });
  }
  return s;
}

function peopleOnly(s) {
  return C().LOCKED_SECTIONS.indexOf(s.key) >= 0 || s.people_only === true;
}

/** memos.templates */
function templates(ctx) {
  return { templates: ctx.app.findRecordsByFilter('memo_templates', '1=1', '-is_default,name', 0, 0).map(templateOut) };
}

/** memos.template-save: a template's name and sections (thesis and recommendation stay people only). */
function templateSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'template', '');
  const t = id !== '' ? templateRef(app, id) : util.newRecord(app, 'memo_templates');
  const before = id !== '' ? templateOut(t) : null;
  if (util.has(p, 'name') || id === '') {
    const name = util.squash(util.text(p, 'name', 80, ''));
    if (name === '') throw util.fail(400, 'name is required.', 'missing_param', { param: 'name' });
    t.set('name', name);
  }
  if (util.has(p, 'sections')) {
    const raw = util.list(p, 'sections') || [];
    if (raw.length === 0 || raw.length > 30) throw util.fail(400, 'sections is a list of 1 to 30 sections.', 'invalid_param', { param: 'sections' });
    const seen = {};
    const out = raw.map((s, i) => {
      const o = typeof s === 'string' ? { label: s } : s;
      util.keysOnly(o, ['key', 'label', 'people_only'], 'Section ' + (i + 1));
      const label = util.squash(String(o.label || ''));
      if (label === '' || label.length > 60) throw util.fail(400, 'Section ' + (i + 1) + ': label is 1 to 60 characters.', 'invalid_param', { param: 'sections' });
      const key = String(o.key || util.slug(label).replace(/-/g, '_')).slice(0, 40);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) throw util.fail(400, 'Section ' + (i + 1) + ': key is lower case letters, digits and _.', 'invalid_param', { param: 'sections' });
      if (seen[key]) throw util.fail(400, 'Section key ' + key + ' appears twice.', 'invalid_param', { param: 'sections' });
      seen[key] = true;
      return { key: key, label: label, people_only: C().LOCKED_SECTIONS.indexOf(key) >= 0 || o.people_only === true };
    });
    t.set('sections', out);
  } else if (id === '') t.set('sections', u().jsonOf(defaultTemplate(app), 'sections', []));
  if (util.has(p, 'is_default')) t.set('is_default', util.bool(p, 'is_default', false));
  if (util.has(p, 'archived')) t.set('archived', util.bool(p, 'archived', false));
  if (t.getBool('is_default') && t.getBool('archived')) throw util.fail(400, 'The default template cannot be archived.', 'invalid_param', { param: 'archived' });
  L('lib_records').stampWritten(ctx, t);
  app.save(t);
  if (t.getBool('is_default')) for (const o of app.findRecordsByFilter('memo_templates', 'is_default = true && id != {:id}', '', 0, 0, { id: t.id })) {
    o.set('is_default', false);
    app.save(o);
  }
  L('lib_audit').note(ctx, { collection: 'memo_templates', record: t.id, summary: (id === '' ? 'Added' : 'Changed') + ' the memo template ' + t.getString('name'), before: before, after: templateOut(t) });
  return { template: templateOut(t) };
}

/* ------------------------------------------------------------ citations */

function notesOf(app, dealId) {
  const notes = L('lib_deals_notes').forDeal(app, dealId) || [];
  const out = {};
  for (const n of notes) {
    const id = n && typeof n.id === 'string' ? n.id : '';
    if (id === '') continue;
    let title = '';
    try {
      title = typeof n.getString === 'function' ? n.getString('title') : String(n.title || n.template || '');
    } catch {
      title = '';
    }
    out[id] = title || 'Note';
  }
  return out;
}

/**
 * Check and clean a block's citations against the deal's citation scope.
 * -> [{ kind, anchor? | note? | url, source?, title? }]; 400 naming the item when one does not resolve or is out of scope.
 */
function cleanCitations(ctx, dealId, raw) {
  const util = u();
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw util.fail(400, 'citations must be a JSON list.', 'invalid_param', { param: 'citations' });
  if (raw.length > MAX_CITATIONS) throw util.fail(400, 'At most ' + MAX_CITATIONS + ' citations in one block.', 'invalid_param', { param: 'citations' });
  const out = [];
  let notes = null;
  raw.forEach((c0, i) => {
    const where = 'Citation ' + (i + 1);
    const c = typeof c0 === 'string' ? { kind: 'anchor', anchor: c0 } : c0;
    if (c === null || typeof c !== 'object') throw util.fail(400, where + ' must be an object.', 'invalid_param', { param: 'citations' });
    util.keysOnly(c, ['kind', 'anchor', 'note', 'url', 'source', 'title', 'file', 'page', 'lines', 'quote'], where);
    const kind = c.kind || (c.anchor || c.file ? 'anchor' : c.note ? 'note' : c.url ? 'url' : '');
    if (kind === 'anchor') {
      // A passage inline ({"file","page","lines"|"quote"}) is anchored in the same call (qa-cli RULING CLI-18).
      if (!c.anchor && c.file) {
        const spec = { file: c.file, page: c.page, lines: c.lines, quote: c.quote };
        Object.keys(spec).forEach((k) => (spec[k] === undefined || spec[k] === '' ? delete spec[k] : null));
        c.anchor = L('lib_text').anchor(ctx, spec).id;
      }
      const r = L('lib_text').resolve(ctx, [String(c.anchor || '')], { deal: dealId })[0];
      if (!r.ok) throw util.fail(400, where + ': anchor ' + c.anchor + ' does not resolve (' + r.reason + '). Make one with anchors.create.', 'citation_invalid', { index: i + 1, reason: r.reason });
      if (r.in_scope !== true) throw util.fail(400, where + ": anchor " + c.anchor + " is outside this deal's citation scope (only its own room, its company's files and its own emails).", 'citation_out_of_scope', { index: i + 1 });
      if (r.valid === false) throw util.fail(400, where + ': the quote of anchor ' + c.anchor + ' is no longer on its page.', 'citation_stale', { index: i + 1 });
      out.push({ kind: 'anchor', anchor: r.id });
    } else if (kind === 'note') {
      if (notes === null) notes = notesOf(ctx.app, dealId);
      const id = String(c.note || '');
      if (notes[id] === undefined) throw util.fail(400, where + ': note ' + id + " is not one of this deal's notes.", 'citation_out_of_scope', { index: i + 1 });
      out.push({ kind: 'note', note: id });
    } else if (kind === 'url') {
      const url = String(c.url || '').trim();
      if (!/^https?:\/\/[^\s/]+\.[^\s]+$/.test(url) || url.length > 1000) throw util.fail(400, where + ': url must be a full http(s) link.', 'invalid_param', { param: 'citations' });
      const source = util.squash(String(c.source || ''));
      if (source === '' || source.length > 120) throw util.fail(400, where + ': a public source needs its name (--source, e.g. "TechCrunch").', 'missing_param', { param: 'citations' });
      out.push({ kind: 'url', url: url, source: source, title: util.clip(util.squash(String(c.title || '')), 200) });
    } else throw util.fail(400, where + ': kind is anchor, note or url.', 'invalid_param', { param: 'citations' });
  });
  return out;
}

/**
 * Citations as screens show them: label, page, quote, ok. A passage of a
 * file under NDA that ctx may not read (the anchors.resolve rule) keeps its
 * source, page and validity with the
 * quote withheld: quote '', hidden true, hidden_reason.
 */
function citationsOut(ctx, dealId, list) {
  const util = u();
  const anchors = list.filter((c) => c.kind === 'anchor').map((c) => c.anchor);
  const res = {};
  if (anchors.length > 0) {
    let rs = [];
    try {
      rs = L('lib_text').resolve(ctx, anchors, { deal: dealId });
    } catch {
      rs = [];
    }
    for (const r of rs) res[r.id] = r;
    const nda = anchors.filter((id) => res[id] && !res[id].ok && C().NDA_REASONS.indexOf(res[id].reason) >= 0);
    if (nda.length > 0) {
      let ws = [];
      try {
        ws = L('lib_text').resolve(L('lib_auth').systemCtx(ctx.app), nda, { deal: dealId });
      } catch {
        ws = [];
      }
      for (const w of ws) if (w.ok) res[w.id] = Object.assign({}, w, { quote: '', hidden: true, hidden_reason: res[w.id].reason });
    }
  }
  let notes = null;
  return list.map((c, i) => {
    const n = i + 1;
    if (c.kind === 'anchor') {
      const r = res[c.anchor];
      if (!r || !r.ok) return { n: n, kind: 'anchor', anchor: c.anchor, ok: false, label: 'Source not visible', reason: r ? r.reason : 'not_visible' };
      const out = { n: n, kind: 'anchor', anchor: c.anchor, ok: r.valid !== false && r.in_scope === true, label: r.file_name ? r.file_name + (r.page ? ', p. ' + r.page : '') : 'Email', file: r.file || '', page: r.page || 0, quote: util.clip(r.quote || '', 400), valid: r.valid, in_scope: r.in_scope, message_id: r.message_id || '' };
      if (r.hidden === true) {
        out.hidden = true;
        out.hidden_reason = r.hidden_reason;
      }
      return out;
    }
    if (c.kind === 'note') {
      if (notes === null) notes = notesOf(ctx.app, dealId);
      return { n: n, kind: 'note', note: c.note, ok: notes[c.note] !== undefined, label: notes[c.note] || 'Note' };
    }
    return { n: n, kind: 'url', url: c.url, source: c.source, title: c.title || '', ok: true, label: c.source };
  });
}

function checkMarkers(text, citations) {
  const mk = RU().markers(text);
  for (const n of mk.cites) {
    if (n < 1 || n > citations.length) throw u().fail(400, 'The text cites [' + n + '] but the block has ' + citations.length + ' citation' + (citations.length === 1 ? '' : 's') + '. Cite [1] to [' + citations.length + '], or add the citation.', 'citation_marker', { marker: n });
  }
  return mk;
}

/* ------------------------------------------------------------ scenarios */

function parsePercent(v, where) {
  const s = String(v === undefined || v === null ? '' : v).trim().replace(/%$/, '');
  const ppm = L('lib_money').parseScaled(s, 4, false);
  if (ppm === null || ppm < 0 || ppm > 1000000) throw u().fail(400, where + ': probability is a percent from 0 to 100, e.g. 25.', 'invalid_param', { param: 'scenarios' });
  return ppm;
}

/** Scenario rows from a person: [{ label, probability, multiple | exit_value }] -> stored rows. */
function cleanScenarios(app, deal, raw) {
  const util = u();
  if (!Array.isArray(raw)) throw util.fail(400, 'scenarios must be a JSON list.', 'invalid_param', { param: 'scenarios' });
  if (raw.length > 8) throw util.fail(400, 'At most 8 scenarios.', 'invalid_param', { param: 'scenarios' });
  const cur = deal.getString('currency') || L('lib_settings').row(app).getString('base_currency') || 'USD';
  return raw.map((r, i) => {
    const where = 'Scenario ' + (i + 1);
    util.keysOnly(r, ['label', 'probability', 'probability_ppm', 'multiple', 'multiple_e8', 'exit_value', 'exit_value_minor'], where);
    const label = util.squash(String(r.label || ''));
    if (label === '' || label.length > 60) throw util.fail(400, where + ': label is 1 to 60 characters.', 'invalid_param', { param: 'scenarios' });
    const prob = r.probability_ppm !== undefined ? Number(r.probability_ppm) : parsePercent(r.probability, where);
    if (!Number.isInteger(prob) || prob < 0 || prob > 1000000) throw util.fail(400, where + ': probability out of range.', 'invalid_param', { param: 'scenarios' });
    const row = { label: label, probability_ppm: prob, multiple_e8: null, exit_value_minor: null };
    if (r.exit_value !== undefined && r.exit_value !== '' && r.exit_value !== null) {
      const v = L('lib_money').toMinor(String(r.exit_value), cur, false);
      if (v === null) throw util.fail(400, where + ': exit_value is an amount in ' + cur + ', e.g. 250000000.', 'invalid_param', { param: 'scenarios' });
      row.exit_value_minor = v;
    } else if (r.exit_value_minor !== undefined && r.exit_value_minor !== null && r.exit_value_minor !== '') row.exit_value_minor = Number(r.exit_value_minor);
    else if (r.multiple_e8 !== undefined && r.multiple_e8 !== null && r.multiple_e8 !== '') row.multiple_e8 = Number(r.multiple_e8);
    else if (r.multiple !== undefined && r.multiple !== null && String(r.multiple).trim() !== '') {
      const m = L('lib_money').parseScaled(String(r.multiple).trim().replace(/x$/i, ''), 8, false);
      if (m === null) throw util.fail(400, where + ': multiple is a number such as 3.5.', 'invalid_param', { param: 'scenarios' });
      row.multiple_e8 = m;
    }
    return row;
  });
}

let _scn = null;
function SCN() {
  if (_scn === null) _scn = require(`${__hooks}/lib_eng_scenarios.js`);
  return _scn;
}

/** The scenarios with the engine's expected multiple (null with a reason until the probabilities sum to 100%). */
function scenariosView(app, deal, rows) {
  const dv = L('lib_deals').dealOut(app, deal, false);
  const out = { rows: [], sum_ppm: 0, expected_multiple_e8: null, expected_proceeds_minor: null, currency: dv.currency, reason: null };
  let missing = false;
  for (const r of rows || []) {
    let mult = r.multiple_e8;
    if ((mult === null || mult === undefined) && r.exit_value_minor !== null && r.exit_value_minor !== undefined) {
      if (dv.ownership_ppm !== null && dv.check_minor !== null) mult = SCN().multipleFromExit({ exit_value_minor: r.exit_value_minor, ownership_ppm: dv.ownership_ppm, invested_minor: dv.check_minor }).multiple_e8;
      else mult = null;
    }
    if (mult === null || mult === undefined) missing = true;
    out.rows.push({ label: r.label, probability_ppm: r.probability_ppm, multiple_e8: mult === undefined ? null : mult, exit_value_minor: r.exit_value_minor === undefined ? null : r.exit_value_minor });
    out.sum_ppm += Number(r.probability_ppm) || 0;
  }
  if (out.rows.length === 0) out.reason = 'no_scenarios';
  else if (missing) out.reason = dv.ownership_ppm === null ? 'ownership_unknown' : 'multiple_missing';
  else if (out.sum_ppm !== 1000000) out.reason = 'probabilities_not_100';
  else {
    const e = SCN().expected({ scenarios: out.rows.map((r) => ({ label: r.label, probability_ppm: r.probability_ppm, multiple_e8: r.multiple_e8 })), check_minor: dv.check_minor === null ? undefined : dv.check_minor });
    out.expected_multiple_e8 = e.expected_multiple_e8;
    out.expected_proceeds_minor = e.expected_proceeds_minor === undefined ? null : e.expected_proceeds_minor;
    out.rows = out.rows.map((r, i) => Object.assign(r, { weighted_e8: e.rows[i] ? e.rows[i].weighted_e8 : null }));
  }
  return out;
}

/* ---------------------------------------------------------------- memos */

function needMemoRights(ctx, lvl) {
  const auth = L('lib_auth');
  if (auth.can(ctx, 'committee', lvl) || auth.can(ctx, 'pipeline', lvl)) return;
  auth.need(ctx, 'committee', lvl, lvl === 'view' ? 'read memos' : 'write memos');
}

/** A memo by --memo (id) or --deal (its latest version, or --version). */
function memoRef(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'memo', '');
  let m = null;
  if (id !== '') {
    m = util.byId(app, 'memos', id);
    if (m === null) {
      const v = util.int(p, 'version', 0, 0, 100000);
      const rows = app.findRecordsByFilter('memos', 'number = {:n}', '-version', 0, 0, { n: id.toUpperCase() });
      m = v > 0 ? rows.filter((r) => r.getInt('version') === v)[0] || null : rows[0] || null;
    }
    if (m === null) throw util.fail(404, 'No memo ' + id + '. Run memos.list.', 'not_found');
  } else {
    const deal = C().needDeal(ctx, util.req(p, 'deal', 'D-0012'));
    const v = util.int(p, 'version', 0, 0, 100000);
    m = v > 0 ? util.findOne(app, 'memos', 'deal = {:d} && version = {:v}', { d: deal.id, v: v }) : C().latestMemo(app, deal.id);
    if (m === null) throw util.fail(404, 'No memo on ' + deal.getString('number') + ' yet. A person opens one (memos.open).', 'no_memo', { deal: deal.getString('number') });
  }
  if (!C().canSeeDeal(ctx, m.getString('deal'))) throw util.fail(403, 'This memo is on a deal you cannot see.', 'restricted');
  return m;
}

function frozen(m) {
  return m.getString('status') !== 'draft';
}

function snapshotOf(ctx, deal) {
  const app = ctx.app;
  const d = L('lib_deals').dealOut(app, deal, false);
  return {
    company: d.company ? d.company.name : d.title,
    deal: d.number,
    stage: d.stage_label,
    round_type: d.round.type || d.round_type || '',
    raise_minor: d.round.raise_minor,
    pre_money_minor: d.round.pre_money_minor,
    post_money_minor: d.round.post_money_minor,
    check_minor: d.check_minor,
    ownership_ppm: d.ownership_ppm,
    instrument: d.instrument,
    currency: d.currency,
    fund: d.fund ? d.fund.name : '',
    point: d.point ? d.point.name : '',
    author: ctx.name,
    day: u().today(app),
  };
}

function originOf(b) {
  const a = b.getInt('agent_chars');
  const p = b.getInt('typed_chars') + b.getInt('pasted_chars');
  if (a > 0 && p === 0) return 'agent';
  if (a > 0) return 'mixed';
  return 'person';
}

function blockOut(ctx, memo, b, deal) {
  const util = u();
  const section = b.getString('section');
  const out = {
    id: b.id,
    section: section,
    state: b.getString('state'),
    content: b.getString('content'),
    citations: citationsOut(ctx, memo.getString('deal'), util.jsonOf(b, 'citations', []) || []),
    uncited: b.getInt('uncited'),
    counts: { typed: b.getInt('typed_chars'), pasted: b.getInt('pasted_chars'), agent: b.getInt('agent_chars') },
    origin: originOf(b),
    actor: b.getString('actor'),
    base: b.getString('base'),
    updated: b.getString('updated'),
    created: b.getString('created'),
  };
  const data = util.jsonOf(b, 'data', null);
  if (section === 'scenarios' || (data && Array.isArray(data.scenarios))) out.scenarios = scenariosView(ctx.app, deal, data && Array.isArray(data.scenarios) ? data.scenarios : []);
  return out;
}

/** The memo's AI-use counters from its kept blocks (stored on the memo). */
function recount(app, memoId) {
  const r = u().one(app, "SELECT COALESCE(SUM(typed_chars), 0) AS t, COALESCE(SUM(pasted_chars), 0) AS p, COALESCE(SUM(agent_chars), 0) AS a FROM memo_blocks WHERE memo = {:m} AND state = 'kept'", { t: 0, p: 0, a: 0 }, { m: memoId });
  const m = app.findRecordById('memos', memoId);
  m.set('typed_chars', r ? r.t : 0);
  m.set('pasted_chars', r ? r.p : 0);
  m.set('agent_chars', r ? r.a : 0);
  app.save(m);
  return m;
}

function disclosureOf(m) {
  const sh = RU().shares({ typed: m.getInt('typed_chars'), pasted: m.getInt('pasted_chars'), agent: m.getInt('agent_chars') });
  const text = sh.chars === 0 ? 'No text yet.' : sh.agent === 0 ? 'No text in this memo was drafted by an AI tool.' : 'About ' + sh.agent + '% of this memo came from drafts by your AI agent that a person reviewed and kept; ' + sh.typed + '% was typed and ' + sh.pasted + '% pasted by people.';
  return Object.assign(sh, { text: text });
}

/** The memo's memo_sections ask as a StepTrack with the sections it named (null when never asked). */
function sectionsAsk(m) {
  const t = L('lib_agent').track(m, 'memo_sections', ['Asked', 'Drafted']);
  if (t === null) return null;
  return Object.assign(t, { sections: (u().jsonOf(m, 'agent', {}) || {})._sections || [] });
}

/** The whole memo as the Memo tab and your AI agent see it. */
function memoOut(ctx, m) {
  const util = u();
  const app = ctx.app;
  const deal = app.findRecordById('deals', m.getString('deal'));
  const blocks = app.findRecordsByFilter('memo_blocks', "memo = {:m} && (state = 'kept' || state = 'proposed')", 'created', 0, 0, { m: m.id });
  const kept = {};
  const proposed = {};
  for (const b of blocks) {
    if (b.getString('state') === 'kept') kept[b.getString('section')] = b;
    else proposed[b.getString('section')] = b;
  }
  const defs = sectionsOf(app, m);
  const keys = defs.map((s) => s.key);
  for (const b of blocks) if (keys.indexOf(b.getString('section')) < 0) {
    keys.push(b.getString('section'));
    defs.push({ key: b.getString('section'), label: b.getString('section'), people_only: false, removed: true });
  }
  const sections = defs.map((s) => ({
    key: s.key,
    label: s.label,
    people_only: peopleOnly(s),
    removed: s.removed === true,
    block: kept[s.key] ? blockOut(ctx, m, kept[s.key], deal) : null,
    proposed: proposed[s.key] ? blockOut(ctx, m, proposed[s.key], deal) : null,
    scenarios: s.key === 'scenarios' && !kept[s.key] ? scenariosView(app, deal, []) : undefined,
  }));
  const versions = app.findRecordsByFilter('memos', 'deal = {:d}', '-version', 0, 0, { d: deal.id }).map((v) => ({ id: v.id, version: v.getInt('version'), status: v.getString('status'), hash: v.getString('hash'), submitted_at: v.getString('submitted_at') }));
  const item = util.one(app, "SELECT a.id AS id, a.meeting AS meeting FROM agenda_items a WHERE a.memo = {:m} ORDER BY a.created DESC LIMIT 1", { id: '', meeting: '' }, { m: m.id });
  let agenda = null;
  if (item !== null) {
    const mt = app.findRecordById('ic_meetings', item.meeting);
    agenda = { item: item.id, meeting: mt.id, number: mt.getString('number'), starts_at: mt.getString('starts_at') };
  }
  return {
    id: m.id,
    number: m.getString('number'),
    version: m.getInt('version'),
    status: m.getString('status'),
    frozen: frozen(m),
    hash: m.getString('hash'),
    deal: C().dealMini(app, deal.id),
    template: m.getString('template'),
    snapshot: util.jsonOf(m, 'snapshot', {}) || {},
    author: C().mini(app, 'members', m.getString('author')),
    submitted_at: m.getString('submitted_at'),
    submitted_by: C().mini(app, 'members', m.getString('submitted_by')),
    sections: sections,
    pending: Object.keys(proposed).length,
    uncited: blocks.filter((b) => b.getString('state') === 'kept').reduce((a, b) => a + b.getInt('uncited'), 0),
    disclosure: disclosureOf(m),
    versions: versions,
    ask: sectionsAsk(m),
    agenda: agenda,
    created: m.getString('created'),
    updated: m.getString('updated'),
  };
}

/** memos.list: the latest memo of every visible deal (or of one deal), newest first. */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'view');
  const pg = util.page(p, 50, 200);
  const status = util.oneOf(p, 'status', ['draft', 'submitted', 'final', 'all'], 'all');
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const where = ['m.version = (SELECT MAX(version) FROM memos x WHERE x.deal = m.deal)'];
  const bind = Object.assign({}, vis.bind);
  if (status !== 'all') {
    where.push('m.status = {:s}');
    bind.s = status;
  }
  const dealRef = util.str(p, 'deal', '');
  if (dealRef !== '') {
    where.push('m.deal = {:d}');
    bind.d = C().needDeal(ctx, dealRef).id;
  }
  const w = where.join(' AND ');
  const all = util.count(app, 'SELECT COUNT(*) AS n FROM memos m WHERE ' + w, bind);
  const rows = util.rows(app, 'SELECT m.id AS id FROM memos m JOIN deals d ON d.id = m.deal WHERE ' + w + ' AND ' + vis.sql + ' ORDER BY m.updated DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const shown = util.count(app, 'SELECT COUNT(*) AS n FROM memos m JOIN deals d ON d.id = m.deal WHERE ' + w + ' AND ' + vis.sql, bind);
  return {
    memos: rows.map((r) => {
      const m = app.findRecordById('memos', r.id);
      return { id: m.id, number: m.getString('number'), version: m.getInt('version'), status: m.getString('status'), hash: m.getString('hash'), deal: C().dealMini(app, m.getString('deal')), author: C().mini(app, 'members', m.getString('author')), submitted_at: m.getString('submitted_at'), pending: util.count(app, "SELECT COUNT(*) AS n FROM memo_blocks WHERE memo = {:m} AND state = 'proposed'", { m: m.id }), disclosure: disclosureOf(m), updated: m.getString('updated') };
    }),
    total: shown,
    hidden: all - shown,
  };
}

/** memos.get (a deal without a memo yet answers memo null; a person opens one with memos.open). */
function get(ctx, p) {
  needMemoRights(ctx, 'view');
  const util = u();
  if (util.str(p, 'memo', '') === '' && util.int(p, 'version', 0, 0, 100000) === 0) {
    const deal = C().needDeal(ctx, util.req(p, 'deal', 'D-0012'));
    const m = C().latestMemo(ctx.app, deal.id);
    if (m === null) return { memo: null, message: 'No memo on ' + deal.getString('number') + ' yet. A person opens one (memos.open).' };
    return { memo: memoOut(ctx, m) };
  }
  return { memo: memoOut(ctx, memoRef(ctx, p)) };
}

/** memos.open: the deal's memo (version 1 from the template; after a submit, the next version from the kept text). */
function open(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const deal = C().needDeal(ctx, util.req(p, 'deal', 'D-0012'));
  const latest = C().latestMemo(app, deal.id);
  if (latest !== null && latest.getString('status') === 'draft') return { memo: memoOut(ctx, latest), created: false };
  const m = util.newRecord(app, 'memos');
  m.set('number', latest !== null ? latest.getString('number') : util.nextId(app, 'M', 3));
  m.set('deal', deal.id);
  m.set('company', deal.getString('company'));
  m.set('template', latest !== null && util.str(p, 'template', '') === '' ? latest.getString('template') : templateRef(app, util.str(p, 'template', '')).id);
  m.set('version', latest !== null ? latest.getInt('version') + 1 : 1);
  m.set('status', 'draft');
  m.set('snapshot', snapshotOf(ctx, deal));
  m.set('prev', latest !== null ? latest.id : '');
  m.set('author', ctx.memberId);
  L('lib_records').stampWritten(ctx, m);
  app.save(m);
  if (latest !== null) {
    for (const b of app.findRecordsByFilter('memo_blocks', "memo = {:m} && state = 'kept'", 'created', 0, 0, { m: latest.id })) {
      const nb = util.newRecord(app, 'memo_blocks');
      nb.set('memo', m.id);
      nb.set('section', b.getString('section'));
      nb.set('state', 'kept');
      nb.set('content', b.getString('content'));
      nb.set('citations', util.jsonOf(b, 'citations', []) || []);
      nb.set('data', util.jsonOf(b, 'data', null));
      nb.set('uncited', b.getInt('uncited'));
      nb.set('typed_chars', b.getInt('typed_chars'));
      nb.set('pasted_chars', b.getInt('pasted_chars'));
      nb.set('agent_chars', b.getInt('agent_chars'));
      nb.set('actor', b.getString('actor'));
      nb.set('member', b.getString('member'));
      app.save(nb);
    }
    recount(app, m.id);
  }
  L('lib_audit').note(ctx, { collection: 'memos', record: m.id, summary: 'Opened memo ' + m.getString('number') + ' v' + m.getInt('version') + ' for ' + deal.getString('number') });
  return { memo: memoOut(ctx, m), created: true };
}

function needDraft(m) {
  if (frozen(m)) throw u().fail(409, 'Memo ' + m.getString('number') + ' v' + m.getInt('version') + ' is ' + m.getString('status') + ' and frozen. Open the next version (memos.open) to change it.', 'memo_frozen', { memo: m.id, version: m.getInt('version') });
}

function keptBlock(app, memoId, section) {
  return u().findOne(app, 'memo_blocks', "memo = {:m} && section = {:s} && state = 'kept'", { m: memoId, s: section });
}

/** memos.block-save: a person's text in a section (direct, autosaved), counting typed and pasted characters. */
function blockSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const m = memoRef(ctx, p);
  needDraft(m);
  const s = sectionDef(app, m, util.req(p, 'section', 'team'));
  const deal = app.findRecordById('deals', m.getString('deal'));
  let b = keptBlock(app, m.id, s.key);
  const isNew = b === null;
  if (isNew) {
    b = util.newRecord(app, 'memo_blocks');
    b.set('memo', m.id);
    b.set('section', s.key);
    b.set('state', 'kept');
  }
  const beforeText = isNew ? '' : b.getString('content');
  const text = util.has(p, 'text') ? util.text(p, 'text', MAX_TEXT, '') : beforeText;
  const citations = util.has(p, 'citations') ? cleanCitations(ctx, deal.id, util.list(p, 'citations'), '') : util.jsonOf(b, 'citations', []) || [];
  const mk = checkMarkers(text, citations);
  if (util.has(p, 'scenarios')) b.set('data', { scenarios: cleanScenarios(app, deal, util.list(p, 'scenarios')) });
  const c = RU().recount({ typed: b.getInt('typed_chars'), pasted: b.getInt('pasted_chars'), agent: b.getInt('agent_chars') }, beforeText, text, util.int(p, 'pasted', 0, 0, MAX_TEXT));
  b.set('content', text);
  b.set('citations', citations);
  b.set('uncited', mk.uncited);
  b.set('typed_chars', c.typed);
  b.set('pasted_chars', c.pasted);
  b.set('agent_chars', c.agent);
  L('lib_records').stampWritten(ctx, b);
  app.save(b);
  const mm = recount(app, m.id);
  L('lib_audit').note(ctx, { collection: 'memo_blocks', record: b.id, summary: 'Wrote ' + s.label + ' in memo ' + m.getString('number') });
  return { block: blockOut(ctx, mm, b, deal), disclosure: disclosureOf(mm) };
}

/** memos.draft-block (your AI agent): a section draft as a tracked change (state proposed); never thesis or recommendation. */
function draftBlock(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'memos.draft-block is for your AI agent; type in the section instead (memos.block-save).', 'agent_only');
  const m = memoRef(ctx, p);
  const s = sectionDef(app, m, util.req(p, 'section', 'market'));
  if (peopleOnly(s)) throw util.fail(403, 'Your AI agent never writes the ' + s.label + ' section: it is the partner\'s own judgment. Draft the objective sections only (' + sectionsOf(app, m).filter((x) => !peopleOnly(x)).map((x) => x.key).join(', ') + ').', 'people_only_section', { section: s.key });
  if (frozen(m)) throw util.fail(409, 'Memo ' + m.getString('number') + ' v' + m.getInt('version') + ' is ' + m.getString('status') + '. Say so (agent.cannot --trigger memo_sections); the partner opens the next version.', 'memo_frozen');
  const deal = app.findRecordById('deals', m.getString('deal'));
  const text = util.text(p, 'text', MAX_TEXT, '');
  if (util.squash(text) === '') throw util.fail(400, 'text is required (the drafted section; cite with [n], mark uncited figures with [?]).', 'missing_param', { param: 'text' });
  const citations = cleanCitations(ctx, deal.id, util.has(p, 'citations') ? util.list(p, 'citations') : []);
  const mk = checkMarkers(text, citations);
  const kept = keptBlock(app, m.id, s.key);
  for (const old of app.findRecordsByFilter('memo_blocks', "memo = {:m} && section = {:s} && state = 'proposed'", '', 0, 0, { m: m.id, s: s.key })) {
    old.set('state', 'superseded');
    app.save(old);
  }
  const b = util.newRecord(app, 'memo_blocks');
  b.set('memo', m.id);
  b.set('section', s.key);
  b.set('state', 'proposed');
  b.set('content', text);
  b.set('citations', citations);
  b.set('uncited', mk.uncited);
  b.set('base', kept !== null ? kept.id : '');
  b.set('base_updated', kept !== null ? kept.getString('updated') : '');
  b.set('agent_chars', mk.chars);
  L('lib_records').stampWritten(ctx, b);
  app.save(b);
  // The ask lands once every section it named has a draft from after the ask (the deal's NDA files stay open till then).
  const fresh = app.findRecordById('memos', m.id);
  const ask = L('lib_agent').state(fresh, 'memo_sections');
  const named = (util.jsonOf(fresh, 'agent', {}) || {})._sections || [];
  const since = ask && ask.at ? ask.at.replace('T', ' ') : '';
  const drafted = (key) => util.count(app, "SELECT COUNT(*) AS n FROM memo_blocks WHERE memo = {:m} AND section = {:s} AND state = 'proposed' AND created >= {:a}", { m: m.id, s: key, a: since }) > 0;
  if (named.length === 0 || named.every(drafted)) L('lib_agent').landed(app, 'memo_sections', fresh);
  L('lib_audit').note(ctx, { collection: 'memo_blocks', record: b.id, summary: 'Your AI agent drafted ' + s.label + ' in memo ' + m.getString('number') + ' (waits for keep or discard)' });
  return { block: blockOut(ctx, m, b, deal), state: 'proposed', uncited: mk.uncited, message: 'Drafted as a tracked change; the partner keeps or discards it.' };
}

function pickProposed(app, m, p) {
  const util = u();
  const raw = util.str(p, 'blocks', '');
  const section = util.str(p, 'section', '');
  let rows;
  if (raw === 'all' || (raw === '' && section === '')) rows = app.findRecordsByFilter('memo_blocks', "memo = {:m} && state = 'proposed'", 'created', 0, 0, { m: m.id });
  else if (section !== '') rows = app.findRecordsByFilter('memo_blocks', "memo = {:m} && state = 'proposed' && section = {:s}", '', 0, 0, { m: m.id, s: section });
  else {
    const ids = util.list(p, 'blocks') || [];
    rows = ids.map((id) => {
      const b = util.byId(app, 'memo_blocks', String(id));
      if (b === null || b.getString('memo') !== m.id) throw util.fail(404, 'No block ' + id + ' in memo ' + m.getString('number') + '.', 'not_found');
      return b;
    });
  }
  return rows.filter((b) => b.getString('state') === 'proposed');
}

/** memos.keep: keep drafted sections (each becomes the section's text); a section a person changed since the draft stays theirs. */
function keep(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const m = memoRef(ctx, p);
  needDraft(m);
  const kept = [];
  const stale = [];
  for (const b of pickProposed(app, m, p)) {
    const cur = keptBlock(app, m.id, b.getString('section'));
    if ((cur === null && b.getString('base') !== '') || (cur !== null && (cur.id !== b.getString('base') || cur.getString('updated') !== b.getString('base_updated')))) {
      b.set('state', 'superseded');
      app.save(b);
      stale.push(b.getString('section'));
      continue;
    }
    if (cur !== null) {
      cur.set('state', 'superseded');
      app.save(cur);
    }
    b.set('state', 'kept');
    b.set('decided_by', ctx.memberId);
    b.set('decided_at', util.nowIso());
    app.save(b);
    kept.push(b.getString('section'));
  }
  const mm = recount(app, m.id);
  L('lib_audit').note(ctx, { collection: 'memos', record: m.id, summary: 'Kept ' + kept.length + ' drafted section' + (kept.length === 1 ? '' : 's') + ' in memo ' + m.getString('number') });
  return { kept: kept, stale: stale, memo: memoOut(ctx, mm) };
}

/** memos.discard: discard drafted sections. */
function discard(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const m = memoRef(ctx, p);
  const out = [];
  for (const b of pickProposed(app, m, p)) {
    b.set('state', 'discarded');
    b.set('decided_by', ctx.memberId);
    b.set('decided_at', util.nowIso());
    app.save(b);
    out.push(b.getString('section'));
  }
  L('lib_audit').note(ctx, { collection: 'memos', record: m.id, summary: 'Discarded ' + out.length + ' drafted section' + (out.length === 1 ? '' : 's') + ' in memo ' + m.getString('number') });
  return { discarded: out, memo: memoOut(ctx, m) };
}

/** Canonical JSON (sorted keys) for the hash. */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/** memos.submit: freeze this version with a hash; it joins the next meeting's agenda. */
function submit(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const m = memoRef(ctx, p);
  needDraft(m);
  const deal = app.findRecordById('deals', m.getString('deal'));
  const pending = util.count(app, "SELECT COUNT(*) AS n FROM memo_blocks WHERE memo = {:m} AND state = 'proposed'", { m: m.id });
  if (pending > 0) throw util.fail(409, 'Keep or discard the ' + pending + ' drafted section' + (pending === 1 ? '' : 's') + ' first.', 'drafts_pending', { pending: pending });
  const blocks = app.findRecordsByFilter('memo_blocks', "memo = {:m} && state = 'kept'", 'created', 0, 0, { m: m.id });
  const defs = sectionsOf(app, m);
  const order = defs.map((s) => s.key);
  blocks.sort((a, b) => order.indexOf(a.getString('section')) - order.indexOf(b.getString('section')));
  const filled = blocks.filter((b) => util.squash(b.getString('content')) !== '' || (util.jsonOf(b, 'data', null) || {}).scenarios);
  if (filled.length === 0) throw util.fail(409, 'The memo is empty.', 'memo_empty');
  const problems = [];
  for (const b of blocks) {
    for (const c of citationsOut(ctx, deal.id, util.jsonOf(b, 'citations', []) || [])) if (!c.ok) problems.push(sectionLabelOf(defs, b.getString('section')) + ' [' + c.n + ']');
    const data = util.jsonOf(b, 'data', null);
    if (data && Array.isArray(data.scenarios) && data.scenarios.length > 0) {
      const sv = scenariosView(app, deal, data.scenarios);
      if (sv.reason === 'probabilities_not_100') throw util.fail(409, 'Scenario probabilities sum to ' + sv.sum_ppm / 10000 + '%; they must sum to 100%.', 'probabilities_not_100', { sum_ppm: sv.sum_ppm });
    }
  }
  if (problems.length > 0) throw util.fail(409, 'These citations no longer resolve: ' + problems.join(', ') + '. Fix or remove them.', 'citations_broken', { citations: problems });
  const snap = snapshotOf(ctx, deal);
  snap.author = (C().mini(app, 'members', m.getString('author')) || { name: ctx.name }).name;
  const frozenBlocks = blocks.map((b) => ({ section: b.getString('section'), label: sectionLabelOf(defs, b.getString('section')), content: b.getString('content'), citations: util.jsonOf(b, 'citations', []) || [], data: util.jsonOf(b, 'data', null) }));
  const hash = util.sha(canon({ number: m.getString('number'), version: m.getInt('version'), deal: deal.id, snapshot: snap, blocks: frozenBlocks }));
  m.set('snapshot', snap);
  m.set('frozen', { blocks: frozenBlocks, disclosure: disclosureOf(m) });
  m.set('hash', hash);
  m.set('status', 'submitted');
  m.set('submitted_at', util.nowIso());
  m.set('submitted_by', ctx.memberId);
  app.save(m);
  let agenda = null;
  const open = app.findRecordsByFilter('agenda_items', "deal = {:d} && (status = 'waiting' || status = 'voting')", '-created', 1, 0, { d: deal.id })[0];
  if (open) {
    if (C().attachMemo(app, open, m)) app.save(open);
    agenda = open;
  } else {
    const next = C().nextPlanned(app, deal.getString('fund'));
    if (next !== null && (deal.getString('status') === 'open' || deal.getString('status') === 'hold')) agenda = C().addItem(ctx, { meeting: next, deal: deal, source: 'memo' });
  }
  L('lib_audit').note(ctx, { collection: 'memos', record: m.id, summary: 'Submitted memo ' + m.getString('number') + ' v' + m.getInt('version') + ' (hash ' + hash.slice(0, 12) + ')' });
  const out = { memo: memoOut(ctx, m) };
  if (agenda !== null) out.agenda = { item: agenda.id, meeting: agenda.getString('meeting') };
  return out;
}

function sectionLabelOf(defs, key) {
  const s = defs.filter((x) => x.key === key)[0];
  return s ? s.label : key;
}

/** The objective sections to draft: the named ones, or every empty one; thesis, recommendation and scenarios stay with people. */
function sectionsWanted(app, m, wanted0) {
  const util = u();
  const defs = sectionsOf(app, m);
  let wanted = wanted0;
  if (wanted === undefined || wanted.length === 0) wanted = defs.filter((s) => !peopleOnly(s) && keptBlock(app, m.id, s.key) === null).map((s) => s.key);
  const out = [];
  for (const k of wanted) {
    const s = sectionDef(app, m, String(k));
    if (peopleOnly(s)) throw util.fail(400, s.label + ' is written by people only; your AI agent drafts the objective sections.', 'people_only_section', { section: s.key });
    if (out.indexOf(s.key) < 0) out.push(s.key);
  }
  if (out.length === 0) throw util.fail(400, 'Every objective section has text already; name the sections to redraft.', 'missing_param', { param: 'sections' });
  return out;
}

/** agent.ask --trigger memo_sections --record <memo> [--sections]: a draft memo; the sections go in the trigger's params. */
function askCheck(ctx, m, p) {
  needMemoRights(ctx, 'edit');
  needDraft(m);
  const raw = u().str(p || {}, 'sections', '');
  const list = raw === '' ? undefined : raw.charAt(0) === '[' ? u().list(p, 'sections') : raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
  return { sections: sectionsWanted(ctx.app, m, list).join(',') };
}

/** The deal of a memo (its NDA files open for your AI agent while it is asked). */
function memoDeal(app, m) {
  return m.getString('deal');
}

/** The sections an ask named, kept beside its request on the memo (machinery: raw SQL, like the request). */
function keepSections(app, memoId, list) {
  const fresh = app.findRecordById('memos', memoId);
  const a = u().jsonOf(fresh, 'agent', {}) || {};
  a._sections = list;
  u().exec(app, 'UPDATE memos SET agent = {:a} WHERE id = {:id}', { a: JSON.stringify(a), id: memoId });
}

/** After a person's agent.ask fired: the memo remembers which sections it named (the Memo tab shows them). */
function onAsked(ctx, m, request, extra) {
  keepSections(ctx.app, m.id, String((extra || {}).sections || '').split(',').filter((x) => x !== ''));
}

/** memos.draft-sections: Ask your AI agent to draft the chosen sections (never thesis or recommendation; trigger memo_sections). */
function draftSections(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'edit');
  const m = memoRef(ctx, p);
  needDraft(m);
  const out = sectionsWanted(app, m, util.list(p, 'sections'));
  const r = L('lib_agent').requestFor(ctx, 'memo_sections', m, { sections: out.join(',') }, { again: util.str(p, 'again', '') });
  keepSections(app, m.id, out);
  L('lib_audit').write(ctx, { op: 'memos.draft-sections', collection: 'memos', record: m.id, summary: 'Asked your AI agent to draft ' + out.join(', ') + ' in memo ' + m.getString('number') });
  ctx.audited = true;
  return { request: r.request, ask: sectionsAsk(app.findRecordById('memos', m.id)), sections: out };
}

/* --------------------------------------------------------------- export */

function moneyText(minor, cur) {
  if (minor === null || minor === undefined || !cur) return 'Unknown';
  return L('lib_money').format(minor, cur);
}

function ppmText(v) {
  if (v === null || v === undefined) return 'Unknown';
  return (Math.round(v / 100) / 100).toFixed(2) + '%';
}

function e8x(v) {
  if (v === null || v === undefined) return 'Unknown';
  return (Math.round(v / 1e6) / 100).toFixed(2) + 'x';
}

/** Paragraph runs for a block's text: [n] becomes a superscript number, [?] a marked gap. */
function runsOf(text) {
  const out = [];
  const re = /\[(\d{1,3}|\?)\]/g;
  let at = 0;
  let mm = re.exec(text);
  while (mm !== null) {
    if (mm.index > at) out.push({ text: text.slice(at, mm.index) });
    out.push(mm[1] === '?' ? { text: '[uncited]', italic: true, grey: true } : { text: mm[1], superscript: true });
    at = mm.index + mm[0].length;
    mm = re.exec(text);
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** memos.export: the memo as a Word file (.docx), streamed. */
function exportDoc(ctx, p) {
  const util = u();
  const app = ctx.app;
  needMemoRights(ctx, 'view');
  const m = memoRef(ctx, p);
  const view = memoOut(ctx, m);
  const snap = view.snapshot || {};
  const cur = snap.currency || '';
  const paras = [];
  paras.push({ style: 'Title', runs: [{ text: 'Investment memo: ' + (snap.company || (view.deal ? view.deal.title : '')) }] });
  paras.push({ style: 'Subtitle', runs: [{ text: view.number + ' v' + view.version + ', ' + (view.status === 'draft' ? 'draft' : 'submitted ' + util.dayOf(app, view.submitted_at)) + ', ' + (snap.author || '') }] });
  paras.push({
    table: {
      rows: [
        ['Company', snap.company || ''],
        ['Deal', (snap.deal || '') + (snap.stage ? ', ' + snap.stage : '')],
        ['Round', snap.round_type || 'Unknown'],
        ['Raise', moneyText(snap.raise_minor, cur)],
        ['Pre-money', moneyText(snap.pre_money_minor, cur)],
        ['Post-money', moneyText(snap.post_money_minor, cur)],
        ['Check', moneyText(snap.check_minor, cur)],
        ['Ownership', ppmText(snap.ownership_ppm)],
        ['Instrument', snap.instrument || 'Unknown'],
        ['Fund', snap.fund || ''],
        ['Point partner', snap.point || ''],
      ],
      header: false,
    },
  });
  for (const s of view.sections) {
    const b = s.block;
    if (b === null && !(s.scenarios && s.scenarios.rows.length > 0)) continue;
    paras.push({ style: 'Heading1', runs: [{ text: s.label }] });
    if (b !== null) for (const para of String(b.content || '').split(/\n\s*\n/)) if (util.squash(para) !== '') paras.push({ style: 'Normal', runs: runsOf(para.trim()) });
    const sc = b !== null && b.scenarios ? b.scenarios : s.scenarios;
    if (sc && sc.rows.length > 0) {
      const rows = [['Scenario', 'Probability', 'Multiple']].concat(sc.rows.map((r) => [r.label, ppmText(r.probability_ppm), e8x(r.multiple_e8)]));
      rows.push(['Expected multiple', ppmText(sc.sum_ppm), e8x(sc.expected_multiple_e8)]);
      paras.push({ table: { rows: rows, header: true, align: ['left', 'right', 'right'] } });
    }
    if (b !== null && b.citations.length > 0) {
      paras.push({ style: 'Heading2', runs: [{ text: 'Sources' }] });
      for (const c of b.citations) paras.push({ style: 'Source', runs: [{ text: c.n + '. ' }, { text: c.kind === 'url' ? c.source + (c.title ? ', ' + c.title : '') + ', ' + c.url : c.label + (c.quote ? ': "' + util.clip(c.quote, 240) + '"' : c.hidden ? ' (quote under NDA)' : '') }] });
    }
  }
  paras.push({ style: 'Small', runs: [{ text: 'AI-use disclosure: ' + view.disclosure.text }] });
  if (view.hash) paras.push({ style: 'Small', runs: [{ text: 'Version hash ' + view.hash }] });
  const bytes = L('lib_committee_docx').docx('Investment memo ' + view.number, paras);
  const file = util.slug(snap.company || 'memo') + '-memo-' + view.number.toLowerCase() + '-v' + view.version + '.docx';
  L('lib_audit').write(ctx, { op: 'memos.export', collection: 'memos', record: m.id, summary: 'Exported memo ' + view.number + ' v' + view.version + ' to Word' });
  ctx.audited = true;
  if (ctx.e === null || ctx.e === undefined) return { file: file, size: bytes.length };
  ctx.e.response.header().set('Content-Disposition', 'attachment; filename="' + file + '"');
  ctx.e.response.header().set('Cache-Control', 'no-store');
  ctx.e.blob(200, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes.buffer);
  return { __streamed: true };
}

module.exports = {
  askCheck: askCheck,
  memoDeal: memoDeal,
  onAsked: onAsked,
  templates: templates,
  templateSave: templateSave,
  defaultTemplate: defaultTemplate,
  sectionsOf: sectionsOf,
  peopleOnly: peopleOnly,
  cleanCitations: cleanCitations,
  citationsOut: citationsOut,
  checkMarkers: checkMarkers,
  cleanScenarios: cleanScenarios,
  scenariosView: scenariosView,
  memoRef: memoRef,
  memoOut: memoOut,
  disclosureOf: disclosureOf,
  list: list,
  get: get,
  open: open,
  blockSave: blockSave,
  draftBlock: draftBlock,
  keep: keep,
  discard: discard,
  submit: submit,
  draftSections: draftSections,
  exportDoc: exportDoc,
  runsOf: runsOf,
};
