/// <reference path="../pb_data/types.d.ts" />
/**
 * Triage (SPEC 7.6): what your AI agent reads from a deck, saved as facts
 * over the shared fact keys (lib_theses.FACT_KEYS), each with an evidence
 * grade and a page anchor; the standard slides the deck lacks; open
 * questions. Thesis fit is computed, never judged: lib_theses.fit, met,
 * unmet or unknown, no score.
 *
 *   triage.start       your AI agent takes the item: step Reading, and the work packet
 *   triage.facts-save  facts (with grade and anchor), company, one-liner, founders, missing slides, questions
 *   triage.fit         the item against every active thesis
 *   triage.confirm     a person confirms facts as read
 *
 * A value a person confirmed is never overwritten by your AI agent: its
 * different value is reported back as kept. Numbers are saved as the deck
 * states them (quoted); your AI agent never computes one.
 */

const SLIDES = [
  { key: 'problem', label: 'Problem' },
  { key: 'solution', label: 'Solution' },
  { key: 'product', label: 'Product' },
  { key: 'market', label: 'Market' },
  { key: 'business_model', label: 'Model' },
  { key: 'traction', label: 'Traction' },
  { key: 'competition', label: 'Competition' },
  { key: 'team', label: 'Team' },
  { key: 'financials', label: 'Financials' },
  { key: 'ask', label: 'Ask' },
];
const GRADES = ['artifact', 'founder_reported', 'public', 'unverifiable', 'unknown'];
const NUM_KINDS = ['quoted', 'computed', 'external', 'entered'];
const SOURCES = ['deck', 'email', 'public', 'person'];
const FACT_FIELDS = ['key', 'value', 'currency', 'grade', 'num_kind', 'source', 'file', 'page', 'quote', 'anchor', 'url', 'note'];
const PCT_KEYS = ['growth_mom_ppm', 'gross_margin_ppm'];
const MAX_FACTS = 40;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function I() {
  return L('lib_intake');
}

function slideLabel(key) {
  for (const s of SLIDES) if (s.key === key) return s.label;
  return key;
}

/* -------------------------------------------------------------- values */

/** A fact value of key `key` in its stored form (money in minor units, percents in ppm). Throws 400 naming the fact. */
function valueOf(ctx, key, raw, currency, where) {
  const util = u();
  const T = L('lib_theses');
  const info = T.facts()[key];
  const type = info.type;
  const bad = (msg) => util.fail(400, where + ' (' + key + '): ' + msg, 'invalid_fact', { key: key });
  if (raw === null || raw === undefined || raw === '') return null;
  if (type === 'money') {
    if (currency === '') throw bad('a money fact needs its currency (--facts \'[{"key":"' + key + '","value":"3000000","currency":"USD",...}]\').');
    const v = L('lib_money').toMinor(String(raw).replace(/,/g, '').trim(), currency, false);
    if (v === null) throw bad('"' + raw + '" is not an amount in ' + currency + ' (major units, e.g. 3000000 or 1250.50).');
    return v;
  }
  if (PCT_KEYS.indexOf(key) >= 0) {
    const v = L('lib_money').parseScaled(String(raw).replace(/%$/, '').trim(), 4, true);
    if (v === null) throw bad('give the percent as a number, e.g. 15 for 15%.');
    return v;
  }
  if (type === 'int') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
    if (!Number.isInteger(n) || n < 0) throw bad('a whole number.');
    if (key === 'founded_year' && (n < 1800 || n > 2100)) throw bad('a year such as 2023.');
    return n;
  }
  if (type === 'num') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0) throw bad('a number.');
    return Math.round(n * 10) / 10;
  }
  if (type === 'bool') {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
    if (s === true || s === 'true' || s === 'yes') return true;
    if (s === false || s === 'false' || s === 'no') return false;
    throw bad('true or false.');
  }
  const t = util.squash(String(raw));
  if (t === '') return null;
  if (t.length > 300) throw bad('at most 300 characters.');
  if (info.values && info.values.indexOf(t) < 0) throw bad('one of: ' + info.values.join(', ') + '.');
  if (info.code === 'country') return L('lib_norm').country(t, where + ' (' + key + ')');
  if (info.code === 'currency') return L('lib_norm').currency(t, where + ' (' + key + ')');
  return t;
}

/** The squashed text with a map back to raw offsets (quotes match spaces aside). */
function squashMap(raw) {
  const map = [];
  let text = '';
  let space = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (/\s/.test(c)) {
      if (!space && text !== '') {
        text += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    text += c;
    map.push(i);
  }
  return { text: text, map: map };
}

/** The page row of a file (or null). */
function pageRow(app, fileId, pageNo) {
  return u().findOne(app, 'pages', 'file = {:f} && page_no = {:p}', { f: fileId, p: pageNo });
}

/* ---------------------------------------------------------------- ops */

/** triage.start: take the item (step Reading) and get everything needed to read it. */
function opStart(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = I().visible(ctx, util.req(p, 'item'));
  if (rec.getString('status') !== 'new' && rec.getString('status') !== 'held') throw util.fail(409, rec.getString('number') + ' is ' + rec.getString('status') + '; nothing to read.', 'not_open');
  I().setStep(rec, 'reading');
  if (ctx.isAgent) rec.set('triage_state', 'working');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: (ctx.isAgent ? 'Your AI agent started reading ' : 'Started reading ') + rec.getString('number') });
  const F = L('lib_files');
  const ids = util.jsonOf(rec, 'files', []) || [];
  const texts = ids.length > 0 ? F.textsOf(app, ids) : {};
  const files = [];
  for (const fid of ids) {
    const f = util.byId(app, 'files', fid);
    if (f === null || f.getString('deleted_at') !== '' || !f.getBool('current')) continue;
    const t = texts[fid] || {};
    const ocr = util.rows(app, 'SELECT page_no FROM pages WHERE file = {:f} AND needs_ocr = TRUE ORDER BY page_no LIMIT 60', { page_no: 0 }, { f: fid }).map((r) => r.page_no);
    files.push({ id: f.id, name: f.getString('name'), ext: f.getString('ext'), bytes: f.getInt('bytes'), text_state: t.state || 'waiting', pages: t.pages || 0, pages_with_text: t.pages_with_text || 0, image_pages: ocr });
  }
  const keys = L('lib_theses').facts();
  const factKeys = Object.keys(keys).map((k) => {
    const x = keys[k];
    const out = { key: k, label: x.label, type: x.type };
    if (x.values) out.values = x.values;
    if (PCT_KEYS.indexOf(k) >= 0) out.unit = 'percent (15 = 15%)';
    if (x.type === 'money') out.unit = 'major units with currency';
    if (k === 'runway_months') out.unit = 'months';
    return out;
  });
  const existing = I().factsOf(app, [rec.id])[rec.id] || {};
  // The people already known on the item (founders, the sender), so the read does not ask who they are (qa-cli CLI-13).
  const people = (util.jsonOf(rec, 'people', []) || [])
    .map((x) => {
      const pr = x && x.person ? util.byId(app, 'people', x.person) : null;
      return pr === null ? null : { id: pr.id, name: pr.getString('name'), email: pr.getString('email'), title: pr.getString('title'), role: x.role || '' };
    })
    .filter((x) => x !== null);
  if (rec.getString('source_person') !== '' && people.filter((x) => x.id === rec.getString('source_person')).length === 0) {
    const sp = util.byId(app, 'people', rec.getString('source_person'));
    if (sp !== null) people.push({ id: sp.id, name: sp.getString('name'), email: sp.getString('email'), title: sp.getString('title'), role: 'source' });
  }
  const next = files.length > 0 ? 'Read each file (files.text --file <id>; image_pages with your own vision through files.download), then save every fact you found in one triage.facts-save --item ' + rec.id + ' (the item becomes Ready).' : 'No deck is attached: read the email text (item.text) and the link (item.url) if any; save what the email states in one triage.facts-save (grade founder_reported, quote the email) and list every standard slide as missing (the item becomes Ready). Never guess a figure.';
  return {
    item: { id: rec.id, number: rec.getString('number'), name: rec.getString('name'), channel: rec.getString('channel'), status: rec.getString('status'), url: rec.getString('url'), link_kind: rec.getString('link_kind'), website: rec.getString('website'), email_from: rec.getString('email_from'), email_subject: rec.getString('email_subject'), text: rec.getString('text'), message_id: rec.getString('message_id'), company: L('lib_records').mini(app, 'companies', rec.getString('company')), one_liner: rec.getString('one_liner') },
    files: files,
    people: people,
    fact_keys: factKeys,
    grades: GRADES,
    slides: SLIDES,
    facts: Object.keys(existing).map((k) => ({ key: k, value: existing[k].value, currency: existing[k].currency, grade: existing[k].grade, status: existing[k].status, actor: existing[k].actor })),
    history: I().historyOf(ctx, rec).prior,
    theses: L('lib_theses')
      .active(app)
      .map((t) => ({ id: t.id, name: t.name, criteria: t.criteria })),
    next: next,
  };
}

/**
 * triage.facts-save: facts with grade and anchor; the company, one-liner,
 * founders, missing standard slides and open questions. A person's call
 * confirms what it saves.
 */
function opFactsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.ownOnly) throw util.fail(403, 'Scouts submit deals; facts are saved by a partner or your AI agent.', 'not_permitted');
  const rec = I().visible(ctx, util.req(p, 'item'));
  const st = rec.getString('status');
  if (st === 'merged') throw util.fail(409, rec.getString('number') + ' was merged; save facts on the item it merged into.', 'not_open');
  const list = util.list(p, 'facts') || [];
  if (list.length > MAX_FACTS) throw util.fail(400, 'At most ' + MAX_FACTS + ' facts in one call.', 'too_many');
  const files = util.jsonOf(rec, 'files', []) || [];
  const existing = I().factsOf(app, [rec.id])[rec.id] || {};
  const keys = L('lib_theses').facts();
  const curFact = list.find((f) => f && f.key === 'currency' && f.value);
  const itemCurrency = curFact ? L('lib_norm').currency(String(curFact.value), 'currency') : existing.currency && existing.currency.value ? String(existing.currency.value) : '';
  const prepared = [];
  const seen = {};
  list.forEach((f0, i) => {
    const where = 'facts[' + i + ']';
    if (f0 === null || typeof f0 !== 'object' || Array.isArray(f0)) throw util.fail(400, where + ' must be an object {"key","value","grade",...}.', 'invalid_fact');
    util.keysOnly(f0, FACT_FIELDS, where);
    const key = String(f0.key || '');
    if (keys[key] === undefined) {
      const near = util.nearest(key, Object.keys(keys));
      throw util.fail(400, where + ': unknown fact key "' + key + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Keys: ' + Object.keys(keys).join(', ') + '.', 'invalid_fact', { allowed: Object.keys(keys) });
    }
    if (seen[key]) throw util.fail(400, where + ': ' + key + ' appears twice.', 'invalid_fact');
    seen[key] = true;
    const type = keys[key].type;
    let currency = '';
    if (type === 'money') currency = f0.currency ? L('lib_norm').currency(String(f0.currency), where + ' currency') : itemCurrency;
    const value = valueOf(ctx, key, f0.value, currency, where);
    let grade = String(f0.grade || '');
    if (value === null) grade = 'unknown';
    if (GRADES.indexOf(grade) < 0) throw util.fail(400, where + ' (' + key + '): grade must be one of: ' + GRADES.join(', ') + '.', 'invalid_fact');
    const file = String(f0.file || '');
    const url = String(f0.url || '').trim();
    const quote = util.squash(String(f0.quote || ''));
    let source = String(f0.source || '');
    if (source === '') source = file !== '' ? 'deck' : url !== '' ? 'public' : quote !== '' ? 'email' : ctx.actor === 'person' ? 'person' : '';
    if (value !== null && SOURCES.indexOf(source) < 0) throw util.fail(400, where + ' (' + key + '): say where it comes from: --file and --page (the deck), a quote of the email, or a url (public).', 'invalid_fact');
    if (source === 'person' && ctx.isAgent) throw util.fail(400, where + ' (' + key + '): source person is for people; give the deck page, the email quote or a url.', 'invalid_fact');
    if (source === 'deck' && value !== null) {
      if (files.indexOf(file) < 0) throw util.fail(400, where + ' (' + key + '): file must be one of this item\'s files: ' + (files.length > 0 ? files.join(', ') : 'none yet') + '.', 'invalid_fact');
      if (!Number.isInteger(Number(f0.page)) || Number(f0.page) < 1) throw util.fail(400, where + ' (' + key + '): page is the 1-based page (slide) number.', 'invalid_fact');
    }
    if (source === 'email' && value !== null && quote === '') throw util.fail(400, where + ' (' + key + '): give the quote from the email.', 'invalid_fact');
    if (source === 'public' && value !== null && !I().looksUrl(url)) throw util.fail(400, where + ' (' + key + '): give the url of the public source.', 'invalid_fact');
    let numKind = String(f0.num_kind || '');
    if (numKind === '') numKind = source === 'public' ? 'external' : source === 'person' ? 'entered' : 'quoted';
    if (NUM_KINDS.indexOf(numKind) < 0) throw util.fail(400, where + ' (' + key + '): num_kind must be one of: ' + NUM_KINDS.join(', ') + '.', 'invalid_fact');
    if (ctx.isAgent && numKind === 'computed') throw util.fail(400, where + ' (' + key + '): save the number the source states (quoted or external); never compute one.', 'invalid_fact');
    prepared.push({ key: key, value: value, currency: currency, grade: grade, num_kind: numKind, source: value === null ? source || 'deck' : source, file: source === 'deck' ? file : '', page: source === 'deck' ? Number(f0.page) || 0 : 0, quote: util.clip(quote, 2000), anchor: String(f0.anchor || ''), url: util.clip(url, 1000), note: util.clip(util.squash(String(f0.note || '')), 600) });
  });

  // Write the facts (anchored where the page has text).
  const kept = [];
  let saved = 0;
  for (const f of prepared) {
    const old = existing[f.key];
    if (old && ctx.isAgent && old.status === 'confirmed') {
      if (JSON.stringify(old.value) !== JSON.stringify(f.value)) kept.push({ key: f.key, kept: old.value, yours: f.value, why: 'a person confirmed this value' });
      continue;
    }
    let anchor = '';
    if (f.anchor !== '') {
      const a = util.byId(app, 'anchors', f.anchor);
      if (a === null) throw util.fail(400, 'facts (' + f.key + '): no anchor ' + f.anchor + '.', 'invalid_fact');
      anchor = a.id;
    } else if (f.source === 'deck' && f.value !== null && f.quote !== '') {
      const pg = pageRow(app, f.file, f.page);
      if (pg !== null && !pg.getBool('needs_ocr') && util.squash(pg.getString('text')) !== '') {
        try {
          anchor = L('lib_text').anchor(ctx, { file: f.file, page: f.page, quote: f.quote }).id;
        } catch (err) {
          throw util.fail(400, 'facts (' + f.key + '): ' + String((err && err.message) || err) + ' Give the exact words of page ' + f.page + ', or leave quote out.', 'quote_not_found', { key: f.key, page: f.page });
        }
      }
    } else if (f.source === 'email' && f.value !== null) {
      const raw = rec.getString('text');
      const sm = squashMap(raw);
      const at = sm.text.indexOf(f.quote);
      if (at < 0) throw util.fail(400, 'facts (' + f.key + '): that quote is not in the email (it must match its words exactly, spaces aside).', 'quote_not_found', { key: f.key });
      const start = sm.map[at];
      const end = sm.map[at + f.quote.length - 1] + 1;
      anchor = L('lib_text').messageAnchor(ctx, { message_id: rec.getString('message_id') || 'intake:' + rec.id, ref_collection: 'intake_items', ref_id: rec.id, start: start, end: end, quote: raw.slice(start, end) }).id;
    }
    const r = old ? app.findRecordById('facts', old.id) : util.newRecord(app, 'facts');
    r.set('item', rec.id);
    r.set('key', f.key);
    r.set('value', f.value === null ? null : f.value);
    r.set('currency', f.currency);
    r.set('grade', f.grade);
    r.set('num_kind', f.value === null ? '' : f.num_kind);
    r.set('status', ctx.actor === 'person' ? 'confirmed' : 'agent_proposed');
    r.set('source', f.source);
    r.set('file', f.file);
    r.set('page', f.page);
    r.set('quote', f.quote);
    r.set('anchor', anchor);
    r.set('url', f.url);
    r.set('note', f.note);
    r.set('run', ctx.run || '');
    r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
    r.set('member', ctx.actor === 'person' ? ctx.memberId : '');
    app.save(r);
    saved++;
  }

  // The item: company, one-liner, founders, missing slides, questions.
  const fresh = app.findRecordById('intake_items', rec.id);
  const prov = util.jsonOf(fresh, 'prov', {}) || {};
  const mark = (field) => {
    prov[field] = { by: ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system', at: util.nowIso(), run: ctx.run || '' };
  };
  const personOwned = (field) => ctx.isAgent && prov[field] && prov[field].by === 'person';
  const changed = [];
  const companyIn = I().refParam(p, 'company');
  if (companyIn !== '') {
    if (personOwned('company') && fresh.getString('company') !== '') kept.push({ key: 'company', why: 'a person set the company' });
    else {
      const c = I().companyFor(ctx, companyIn, 'intake ' + fresh.getString('number'));
      fresh.set('company', c.id);
      fresh.set('name', c.name);
      fresh.set('guess_domain', '');
      mark('company');
      changed.push('company');
      const sp = fresh.getString('source_person');
      const people = util.jsonOf(fresh, 'people', []) || [];
      if (sp !== '' && I().sameDomain(app, sp, c.domain) && !people.some((x) => x.person === sp)) {
        people.push({ person: sp, role: 'founder' });
        fresh.set('people', people);
      }
    }
  }
  if (util.has(p, 'one_liner')) {
    const t = util.squash(util.text(p, 'one_liner', 300, ''));
    if (personOwned('one_liner') && fresh.getString('one_liner') !== '') kept.push({ key: 'one_liner', why: 'a person wrote the one-liner' });
    else if (t !== '') {
      fresh.set('one_liner', t);
      mark('one_liner');
      changed.push('one_liner');
    }
  }
  const founders = util.list(p, 'founders');
  if (founders !== undefined) {
    if (founders.length > 10) throw util.fail(400, 'At most 10 founders.', 'too_many');
    const people = util.jsonOf(fresh, 'people', []) || [];
    founders.forEach((x, i) => {
      if (x === null || typeof x !== 'object') throw util.fail(400, 'founders[' + i + '] is {"name","email","title","linkedin"}.', 'invalid_param', { param: 'founders' });
      util.keysOnly(x, ['name', 'email', 'title', 'linkedin'], 'founders[' + i + ']');
      if (!x.name && !x.email) throw util.fail(400, 'founders[' + i + '] needs a name or an email.', 'invalid_param', { param: 'founders' });
      const o = { name: x.name || undefined, email: x.email || undefined, title: x.title || undefined, linkedin: x.linkedin || undefined, origin: 'intake', source_ref: 'intake ' + fresh.getString('number') };
      if (fresh.getString('company') !== '') o.company = fresh.getString('company');
      if (!o.email && !o.company) throw util.fail(400, 'founders[' + i + ']: without an email, save the company first (--company) so the founder is found within it.', 'invalid_param', { param: 'founders' });
      const pid = L('lib_records').upsertPerson(ctx, o).id;
      const ex = people.find((y) => y.person === pid);
      if (ex) ex.role = 'founder';
      else people.push({ person: pid, role: 'founder' });
    });
    fresh.set('people', people);
    changed.push('founders');
  }
  const missing = util.list(p, 'missing');
  if (missing !== undefined) {
    const allowed = SLIDES.map((s) => s.key);
    for (const k of missing) if (allowed.indexOf(String(k)) < 0) throw util.fail(400, 'missing takes slide keys: ' + allowed.join(', ') + '.', 'invalid_param', { param: 'missing' });
    fresh.set('missing', missing.map(String).filter((k, i, a) => a.indexOf(k) === i));
    changed.push('missing');
  }
  const questions = util.list(p, 'questions');
  if (questions !== undefined) {
    if (questions.length > 12) throw util.fail(400, 'At most 12 questions.', 'too_many');
    fresh.set(
      'questions',
      questions.map((q, i) => {
        const t = util.squash(String(q || ''));
        if (t === '' || t.length > 300) throw util.fail(400, 'questions[' + i + '] is one question of at most 300 characters.', 'invalid_param', { param: 'questions' });
        return t;
      }),
    );
    changed.push('questions');
  }
  // Your AI agent's save is its reading: the item is Ready for a person's verdict (people's own saves keep it at Facts).
  const ready = ctx.isAgent && fresh.getString('triage_state') !== 'done';
  if (ctx.isAgent) {
    I().setStep(fresh, 'ready');
    fresh.set('triage_state', 'done');
    fresh.set('triage_note', '');
  } else if (saved > 0 || changed.length > 0) I().setStep(fresh, 'facts');
  fresh.set('prov', prov);
  app.save(fresh);
  if (ctx.isAgent) {
    for (const t of I().READS) L('lib_agent').landed(app, t, fresh);
    if (ready && !ctx.dryRun) L('lib_events').emit(ctx, 'intake.ready', { item: rec.id });
  }
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: (ctx.isAgent ? 'Your AI agent saved ' : 'Saved ') + saved + ' fact' + (saved === 1 ? '' : 's') + (changed.length > 0 ? ' and ' + changed.join(', ') : '') + ' for ' + rec.getString('number') });
  return { item: I().detail(ctx, fresh), saved: saved, kept: kept };
}

/** triage.fit: the item against every active thesis (met, unmet, unknown; unknown is not unmet; no score). */
function opFit(ctx, p) {
  const util = u();
  const rec = I().visible(ctx, util.req(p, 'item'));
  if (ctx.ownOnly) throw util.fail(403, 'Scouts see the status of their deals only.', 'not_permitted');
  const map = I().factsOf(ctx.app, [rec.id])[rec.id] || {};
  return { item: { id: rec.id, number: rec.getString('number') }, fit: I().fitOf(ctx.app, map) };
}

/** triage.confirm: a person confirms facts as read (all your AI agent's facts when keys is empty). */
function opConfirm(ctx, p) {
  const util = u();
  I().guardDecide(ctx);
  const rec = I().visible(ctx, util.req(p, 'item'));
  const keys = (util.list(p, 'keys') || []).map(String);
  let n = 0;
  for (const f of util.findMany(ctx.app, 'facts', 'item = {:i}', '', 0, { i: rec.id })) {
    if (keys.length > 0 && keys.indexOf(f.getString('key')) < 0) continue;
    if (f.getString('status') === 'confirmed') continue;
    f.set('status', 'confirmed');
    f.set('member', ctx.memberId);
    ctx.app.save(f);
    n++;
  }
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Confirmed ' + n + ' fact' + (n === 1 ? '' : 's') + ' of ' + rec.getString('number') });
  return { item: I().detail(ctx, rec), confirmed: n };
}

module.exports = { SLIDES: SLIDES, GRADES: GRADES, slideLabel: slideLabel, valueOf: valueOf, squashMap: squashMap, opStart: opStart, opFactsSave: opFactsSave, opFit: opFit, opConfirm: opConfirm };
