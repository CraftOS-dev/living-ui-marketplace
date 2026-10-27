/// <reference path="../pb_data/types.d.ts" />
/**
 * The answers: one row per question key (form questions and each founder's
 * profile answers, fp.<founder>.<field>).
 *
 * Who wrote what is kept, because the founders must read every answer before
 * it goes to YC:
 *   - your AI agent fills empty or unconfirmed answers directly (origin
 *     agent, confirmed false: "check this");
 *   - once a founder wrote or confirmed an answer, your AI agent never
 *     overwrites it: its text is stored as a suggestion the founder accepts
 *     or dismisses;
 *   - a founder's edit is confirmed by writing it.
 * Every change to a reviewed answer queues it for the reviewer (lib_judge).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const ONLY = ['all', 'missing', 'unconfirmed', 'flagged', 'needs'];

/** The six months ending with the current one, oldest first (YYYY-MM). */
function months() {
  const d = new Date();
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.getUTCFullYear() + '-' + ('0' + (m.getUTCMonth() + 1)).slice(-2));
  }
  return out;
}

/** A value made canonical for its question type, or an error naming what is wrong. */
function normalize(def, raw) {
  const U = L('lib_util');
  const v = raw === undefined || raw === null ? '' : raw;
  if (def.type === 'yesno') {
    const s = String(v).trim().toLowerCase();
    if (s === '') return '';
    if (s === 'yes' || s === 'true' || s === 'y' || s === '1') return 'yes';
    if (s === 'no' || s === 'false' || s === 'n' || s === '0') return 'no';
    throw U.fail(400, def.key + ' is a yes or no question: give --value yes or --value no.', 'invalid_value', { key: def.key });
  }
  if (def.type === 'number') {
    const s = String(v).trim().split(',').join('').split('$').join('');
    if (s === '') return '';
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) throw U.fail(400, def.key + ' takes a number (US dollars or months), for example --value 12000.', 'invalid_value', { key: def.key });
    return String(Math.round(n * 100) / 100);
  }
  if (def.type === 'choice') {
    const s = String(v).trim();
    if (s === '') return '';
    for (const c of def.choices) if (c.toLowerCase() === s.toLowerCase()) return c;
    throw U.fail(400, def.key + ' must be one of: ' + def.choices.join(', ') + '.', 'invalid_value', { key: def.key, choices: def.choices });
  }
  if (def.type === 'months') {
    const o = typeof v === 'object' && v !== null ? v : U.obj(String(v).trim() === '' ? '' : v, 'The monthly revenue');
    const out = {};
    for (const k of Object.keys(o)) {
      if (!/^\d{4}-\d{2}$/.test(k)) throw U.fail(400, 'Months are written YYYY-MM, for example {"2026-09":1200}.', 'invalid_value', { key: def.key });
      const raw2 = o[k];
      if (raw2 === '' || raw2 === null || raw2 === undefined) continue;
      const n = Number(String(raw2).split(',').join(''));
      if (!Number.isFinite(n) || n < 0) throw U.fail(400, 'Revenue for ' + k + ' must be a number of US dollars.', 'invalid_value', { key: def.key });
      out[k] = Math.round(n * 100) / 100;
    }
    return Object.keys(out).length === 0 ? '' : JSON.stringify(out);
  }
  if (def.type === 'short' || def.type === 'url') return String(v).split('\n').join(' ').trim();
  return String(v).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Is a gated question asked, given the answers so far? */
function gateOpen(def, vals) {
  if (!def.gate) return true;
  return (vals[def.gate.key] || '') === def.gate.is;
}

/** Counts measured on the text itself: characters, words, em dashes, the limit. */
function measures(def, value) {
  const U = L('lib_util');
  if (def.type !== 'long' && def.type !== 'short') return { chars: U.chars(value), words: 0, em_dashes: 0, over_limit: false, long: false };
  const words = U.words(value);
  return {
    chars: U.chars(value),
    words: words,
    em_dashes: U.emDashes(value),
    over_limit: def.limit ? U.chars(value) > def.limit : false,
    long: def.words ? words > Math.round(def.words * 1.5) : false,
  };
}

function view(def, rec, vals) {
  const U = L('lib_util');
  const value = rec ? rec.getString('value') : '';
  const judge = rec ? U.json(rec, 'judge', null) : null;
  const judgedHash = rec ? rec.getString('judged_hash') : '';
  const m = measures(def, value);
  const current = judge !== null && judgedHash === U.hash(value);
  const issues = current && Array.isArray(judge.issues) ? judge.issues.length : 0;
  const flags = issues + (m.over_limit ? 1 : 0) + (m.em_dashes > 0 ? 1 : 0) + (m.long ? 1 : 0) + (current && Array.isArray(judge.missing) ? judge.missing.length : 0);
  return {
    key: def.key,
    section: def.section,
    label: def.label,
    short: L('lib_questions').shortOf(def.key),
    type: def.type,
    limit: def.limit || 0,
    choices: def.choices || [],
    required: !!def.required,
    gate: def.gate || null,
    open: gateOpen(def, vals),
    by: def.by,
    tip: def.tip || '',
    words_hint: def.words || 0,
    judged: !!def.judge,
    value: value,
    origin: rec ? rec.getString('origin') : '',
    confirmed: rec ? rec.getBool('confirmed') : false,
    suggestion: rec ? rec.getString('suggestion') : '',
    suggestion_why: rec ? rec.getString('suggestion_why') : '',
    source: rec ? rec.getString('source') : '',
    need: rec ? rec.getString('need') : '',
    judge: judge,
    judge_state: rec ? rec.getString('judge_state') || 'none' : 'none',
    judge_current: judge !== null && judgedHash === U.hash(value),
    measures: m,
    flags: value === '' ? 0 : flags,
    edited_at: rec ? rec.getString('edited_at') : '',
  };
}

/** Every question with its answer, the founders' profiles included. */
function all(app) {
  const Q = L('lib_questions');
  const S = L('lib_store');
  const recs = S.answerRecords(app);
  const vals = {};
  for (const k of Object.keys(recs)) vals[k] = recs[k].getString('value');
  const out = [];
  for (const def of Q.QUESTIONS) out.push(view(def, recs[def.key] || null, vals));
  for (const f of S.founderRecords(app)) {
    for (const p of Q.PROFILE) {
      const key = 'fp.' + f.id + '.' + p.field;
      const def = Object.assign({ key: key, section: 'profile' }, p);
      const v = view(def, recs[key] || null, vals);
      v.founder = f.id;
      v.founder_name = f.getString('name');
      v.field = p.field;
      out.push(v);
    }
  }
  return out;
}

function isMissing(a) {
  return a.required && a.open && a.value === '';
}

function counts(items) {
  const c = { questions: 0, required: 0, answered: 0, missing: 0, unconfirmed: 0, flagged: 0, needs: 0, suggestions: 0 };
  for (const a of items) {
    if (!a.open) continue;
    c.questions++;
    if (a.required) c.required++;
    if (a.value !== '') c.answered++;
    if (isMissing(a)) c.missing++;
    if (a.value !== '' && !a.confirmed) c.unconfirmed++;
    if (a.flags > 0) c.flagged++;
    if (a.need !== '') c.needs++;
    if (a.suggestion !== '') c.suggestions++;
  }
  return c;
}

function list(ctx, p) {
  const Q = L('lib_questions');
  const U = L('lib_util');
  const targeted = checkTargets(ctx.app);
  let items = all(ctx.app).map((a) => (targeted[a.key] !== undefined ? Object.assign({}, a, { failing_checks: targeted[a.key] }) : a));
  const c = counts(items);
  const isFlagged = (a) => a.open && a.value !== '' && (a.flags > 0 || a.failing_checks !== undefined);
  c.flagged = items.filter(isFlagged).length;
  if (p.section) {
    const known = Q.SECTIONS.map((s) => s.key).concat(['profile']);
    if (known.indexOf(p.section) < 0) throw U.fail(400, 'section must be one of: ' + known.join(', ') + '.', 'invalid_param', { param: 'section' });
    items = items.filter((a) => a.section === p.section);
  }
  const only = p.only || 'all';
  if (only === 'missing') items = items.filter(isMissing);
  else if (only === 'unconfirmed') items = items.filter((a) => a.open && a.value !== '' && !a.confirmed);
  else if (only === 'flagged') items = items.filter(isFlagged);
  else if (only === 'needs') items = items.filter((a) => a.open && a.need !== '');
  if (p.brief === true) {
    items = items.map((a) => {
      const b = { key: a.key, short: a.short, label: a.label, type: a.type, required: a.required, open: a.open, by: a.by, value: U.clip(a.value, 160), confirmed: a.confirmed, need: a.need, flags: a.flags };
      if (a.flags > 0) {
        const why = [];
        if (a.judge_current && a.judge && Array.isArray(a.judge.issues)) for (const i of a.judge.issues) why.push(i.label);
        if (a.judge_current && a.judge && Array.isArray(a.judge.missing)) for (const m of a.judge.missing) why.push('Missing: ' + m);
        if (a.measures.over_limit) why.push('Over the ' + a.limit + ' character limit');
        if (a.measures.em_dashes > 0) why.push(a.measures.em_dashes + ' em dashes');
        if (a.measures.long) why.push('Longer than needed');
        b.why_flagged = why;
      }
      if (a.limit > 0) b.limit = a.limit;
      if (a.choices.length > 0) b.choices = a.choices;
      if (a.founder_name !== undefined) b.founder_name = a.founder_name;
      if (a.failing_checks !== undefined) b.failing_checks = a.failing_checks;
      return b;
    });
  }
  return { sections: Q.SECTIONS.concat([{ key: 'profile', label: 'Founder profiles (keys fp.<founder id>.<field>)' }]), months: months(), counts: c, items: items };
}

function definitionOrFail(app, key) {
  const Q = L('lib_questions');
  const U = L('lib_util');
  const def = Q.definition(key);
  if (def === null) {
    const keys = Q.QUESTIONS.map((q) => q.key);
    const near = U.nearest(key, keys);
    throw U.fail(404, 'No question "' + key + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Run answers.list for every key; founder profile keys look like fp.<founder id>.impressive.', 'unknown_key', { key: key });
  }
  const prof = Q.profileOf(key);
  if (prof !== null && U.byId(app, 'founders', prof.founder) === null) throw U.fail(404, 'No founder ' + prof.founder + ' for ' + key + '. Run founders.list.', 'unknown_founder', { key: key });
  return def;
}

function get(ctx, p) {
  const def = definitionOrFail(ctx.app, p.key);
  const S = L('lib_store');
  const recs = S.answerRecords(ctx.app);
  const vals = {};
  for (const k of Object.keys(recs)) vals[k] = recs[k].getString('value');
  return view(def, recs[p.key] || null, vals);
}

function record(app, key) {
  const U = L('lib_util');
  let rec = U.findOne(app, 'answers', 'key = {:k}', { k: key });
  if (rec === null) {
    rec = U.newRecord(app, 'answers');
    rec.set('key', key);
    rec.set('judge_state', 'none');
    rec.set('judge', null);
  }
  return rec;
}

/** Queue a reviewed answer for the reviewer when its text changed since the last review. */
function queueJudge(app, def, rec) {
  const U = L('lib_util');
  const value = rec.getString('value');
  if (!def.judge) return;
  if (value === '') {
    rec.set('judge_state', 'none');
    rec.set('judge', null);
    rec.set('judged_hash', '');
    return;
  }
  if (rec.getString('judged_hash') === U.hash(value) && rec.getString('judge_state') === 'done') return;
  const prev = U.json(rec, 'judge', null);
  if (prev && prev.attempts) rec.set('judge', Object.assign({}, prev, { attempts: 0 }));
  rec.set('judge_state', 'queued');
}

function set(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const def = definitionOrFail(app, p.key);
  S.assertPreparing(app);
  const value = normalize(def, p.value);
  const rec = record(app, p.key);
  const before = rec.getString('value');
  let stored = 'value';
  if (ctx.isAgent) {
    const founderOwned = before !== '' && (rec.getString('origin') === 'person' || rec.getBool('confirmed'));
    if (founderOwned && value !== before) {
      if (value === '') throw U.fail(409, p.key + ' was written or confirmed by a founder; your AI agent cannot clear it. Suggest a new text instead.', 'founder_owned', { key: p.key });
      rec.set('suggestion', value);
      rec.set('suggestion_why', U.clip(p.why || '', 600));
      stored = 'suggestion';
    } else if (value !== before) {
      rec.set('value', value);
      rec.set('origin', value === '' ? '' : 'agent');
      rec.set('confirmed', false);
      rec.set('edited_at', U.now());
    }
    if (p.source !== undefined) rec.set('source', U.clip(p.source, 600));
  } else {
    if (value !== before) {
      rec.set('value', value);
      rec.set('origin', value === '' ? '' : 'person');
      rec.set('edited_at', U.now());
    }
    rec.set('confirmed', value !== '');
    if (value !== '' && p.need === undefined) rec.set('need', '');
    if (rec.getString('suggestion') !== '' && rec.getString('suggestion') === value) {
      rec.set('suggestion', '');
      rec.set('suggestion_why', '');
    }
  }
  if (p.need !== undefined) rec.set('need', U.clip(String(p.need).trim(), 600));
  queueJudge(app, def, rec);
  app.save(rec);
  if (rec.getString('judge_state') === 'queued') S.wake(app);
  if (ctx.isAgent) S.log(app, 'agent', (stored === 'suggestion' ? 'Suggested a new answer for ' : value === '' ? 'Cleared ' : before !== '' ? 'Changed ' : 'Filled ') + shortLabel(def), p.key);
  const m = measures(def, stored === 'suggestion' ? value : rec.getString('value'));
  const warnings = [];
  if (m.over_limit) warnings.push('Over the ' + def.limit + ' character limit (' + m.chars + ').');
  if (m.em_dashes > 0) warnings.push(m.em_dashes + ' em dashes: YC partners read them as machine-written.');
  if (m.long) warnings.push(m.words + ' words: about ' + def.words + ' is plenty.');
  const out = { key: p.key, stored: stored, value: rec.getString('value'), confirmed: rec.getBool('confirmed'), review: rec.getString('judge_state') };
  if (rec.getString('need') !== '') {
    out.need = rec.getString('need');
    if (ctx.isAgent && p.need === undefined) warnings.push('Your question to the founders is still open on ' + p.key + '. If this answers it, clear it with --need "".');
  }
  if (warnings.length > 0) out.warnings = warnings;
  return out;
}

/** Several answers in one call; each follows the rules of set. */
function setMany(ctx, p) {
  const U = L('lib_util');
  const items = U.list(p.items, 'items');
  if (items.length === 0) throw U.fail(400, 'items is an empty list.', 'invalid_param', { param: 'items' });
  if (items.length > 80) throw U.fail(400, 'At most 80 answers per call.', 'invalid_param', { param: 'items' });
  const results = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || typeof it.key !== 'string' || (it.value === undefined && it.need === undefined)) {
      results.push({ ok: false, key: it && typeof it.key === 'string' ? it.key : undefined, error: 'Each item is {"key": ..., "value": ...}, {"key": ..., "need": ...} or both.' });
      continue;
    }
    try {
      if (it.value === undefined) {
        const r = need(ctx, { key: it.key, text: String(it.need) });
        results.push(Object.assign({ ok: true, stored: 'need' }, r));
        continue;
      }
      const r = set(ctx, { key: it.key, value: it.value === null ? '' : typeof it.value === 'object' ? it.value : String(it.value), source: it.source !== undefined ? String(it.source) : undefined, why: it.why !== undefined ? String(it.why) : undefined, need: it.need !== undefined ? String(it.need) : undefined });
      results.push(Object.assign({ ok: true, asked: it.need !== undefined && String(it.need).trim() !== '' ? true : undefined }, r));
    } catch (err) {
      results.push({ ok: false, key: it.key, error: String((err && err.message) || err), code: (err && err.code) || 'error' });
    }
  }
  return { stored: results.filter((r) => r.ok && r.stored === 'value').length, suggested: results.filter((r) => r.ok && r.stored === 'suggestion').length, asked: results.filter((r) => r.ok && (r.stored === 'need' || r.asked === true)).length, refused: results.filter((r) => !r.ok).length, results: results };
}

/** The answers whose text holds some words, ignoring case (to update a fact everywhere it is stated). */
function find(ctx, p) {
  const U = L('lib_util');
  const raw = String(p.text || '').trim().toLowerCase();
  if (raw === '') throw U.fail(400, 'Give --text.', 'missing_param', { param: 'text' });
  // A figure matches however it is written: 4,100 = 4100 = $4,100.
  const numeric = /^[$\d.,\s%]+$/.test(raw) && /\d/.test(raw);
  const plain = (s) => (numeric ? s.toLowerCase().split(',').join('').split('$').join('') : s.toLowerCase());
  const want = plain(raw).trim();
  const hits = [];
  for (const a of all(ctx.app)) {
    const at = plain(a.value).indexOf(want);
    if (at >= 0) hits.push({ key: a.key, in: 'answer', label: U.clip(a.label, 80), founder_name: a.founder_name, excerpt: U.clip(plain(a.value).slice(Math.max(0, at - 60), at + want.length + 60), 200), confirmed: a.confirmed });
    if (plain(a.need).indexOf(want) >= 0) hits.push({ key: a.key, in: 'need', label: U.clip(a.label, 80), founder_name: a.founder_name, excerpt: U.clip(a.need, 200) });
  }
  const founders = [];
  for (const f of L('lib_store').founders(ctx.app)) {
    for (const field of ['name', 'role', 'work', 'education', 'location', 'need']) {
      const v = String(f[field] || '');
      if (plain(v).indexOf(want) >= 0) founders.push({ founder: f.id, name: f.name, field: field, excerpt: U.clip(v, 200) });
    }
  }
  return { text: p.text, found: hits.length + founders.length, answers: hits, founders: founders };
}

/** Answer keys a failing check points at, with the checks' titles. */
function checkTargets(app) {
  const out = {};
  for (const c of L('lib_checks').run(app).checks) {
    if (c.status !== 'fail' || c.coverage === true || c.severity === 'tip') continue;
    const keys = Array.isArray(c.keys) && c.keys.length > 0 ? c.keys : c.target && c.target.kind === 'answer' && c.target.key ? [c.target.key] : [];
    for (const k of keys) (out[k] = out[k] || []).push(c.title);
  }
  return out;
}

function shortLabel(def) {
  return '"' + L('lib_util').clip(def.label, 60) + '"';
}

/** Founders mark answers as read and right: one key, a section, or every answered question. */
function confirm(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  L('lib_store').assertPreparing(app);
  const items = all(app).filter((a) => a.open && a.value !== '' && !a.confirmed);
  let targets = [];
  if (p.key) targets = items.filter((a) => a.key === p.key);
  else if (p.section) targets = items.filter((a) => a.section === p.section);
  else throw U.fail(400, 'Give --key or --section.', 'missing_param');
  for (const a of targets) {
    const rec = record(app, a.key);
    rec.set('confirmed', true);
    app.save(rec);
  }
  return { confirmed: targets.length };
}

function accept(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const def = definitionOrFail(app, p.key);
  L('lib_store').assertPreparing(app);
  const rec = record(app, p.key);
  const s = rec.getString('suggestion');
  if (s === '') throw U.fail(409, 'There is no suggestion on ' + p.key + '.', 'no_suggestion');
  rec.set('value', s);
  rec.set('origin', 'agent');
  rec.set('confirmed', true);
  rec.set('suggestion', '');
  rec.set('suggestion_why', '');
  rec.set('edited_at', U.now());
  queueJudge(app, def, rec);
  app.save(rec);
  L('lib_store').wake(app);
  return { key: p.key, value: s };
}

/** A founder takes the reviewer's shorter version of an answer. */
function useShorter(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const def = definitionOrFail(app, p.key);
  L('lib_store').assertPreparing(app);
  const rec = record(app, p.key);
  const judge = U.json(rec, 'judge', null);
  const shorter = judge && typeof judge.shorter === 'string' ? judge.shorter : '';
  if (shorter === '' || rec.getString('judged_hash') !== U.hash(rec.getString('value'))) throw U.fail(409, 'There is no current shorter version of ' + p.key + '.', 'no_shorter');
  rec.set('value', shorter);
  rec.set('origin', 'agent');
  rec.set('confirmed', true);
  rec.set('edited_at', U.now());
  queueJudge(app, def, rec);
  app.save(rec);
  L('lib_store').wake(app);
  return { key: p.key, value: shorter };
}

function dismiss(ctx, p) {
  const app = ctx.app;
  definitionOrFail(app, p.key);
  const rec = record(app, p.key);
  rec.set('suggestion', '');
  rec.set('suggestion_why', '');
  app.save(rec);
  return { key: p.key };
}

/** Your AI agent says what it needs a founder to tell it; --clear true (or an empty text) removes the question. */
function need(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  definitionOrFail(app, p.key);
  L('lib_store').assertPreparing(app);
  const text = p.clear === true ? '' : String(p.text === undefined ? '' : p.text).trim();
  if (p.clear !== true && p.text === undefined) throw U.fail(400, 'Give --text "<one short question>", or --clear true to remove the question.', 'missing_param', { param: 'text' });
  const rec = record(app, p.key);
  rec.set('need', U.clip(text, 600));
  app.save(rec);
  if (text !== '') L('lib_store').log(app, 'agent', 'Asked: ' + U.clip(text, 120), p.key);
  return { key: p.key, need: rec.getString('need') };
}

/** Review one answer again now, or every answered reviewed question. */
function recheck(ctx, p) {
  const Q = L('lib_questions');
  const app = ctx.app;
  let n = 0;
  const keys = p.key ? [p.key] : all(app).filter((a) => a.judged && a.value !== '').map((a) => a.key);
  for (const key of keys) {
    const def = definitionOrFail(app, key);
    if (!def.judge) continue;
    const rec = record(app, key);
    if (rec.getString('value') === '') continue;
    rec.set('judge_state', 'queued');
    rec.set('judged_hash', '');
    app.save(rec);
    n++;
  }
  const s = L('lib_store').settings(app);
  s.set('review_hash', '');
  app.save(s);
  L('lib_store').wake(app);
  return { queued: n };
}

/** The equity answer, written from the team page while no founder has written it by hand. */
function syncBreakdown(app) {
  const S = L('lib_store');
  const fs = S.founders(app);
  const rec = record(app, 'e_breakdown');
  const origin = rec.getString('origin');
  if (origin !== '' && origin !== 'system') return;
  const parts = [];
  let total = 0;
  for (const f of fs) {
    if (!(f.equity > 0)) continue;
    total += f.equity;
    parts.push(f.name + (f.role ? ' (' + f.role + ')' : '') + ': ' + f.equity + '%');
  }
  let text = parts.join('\n');
  if (text !== '' && total < 100) text += '\nUnallocated or other holders: ' + Math.round((100 - total) * 100) / 100 + '%';
  if (text === rec.getString('value')) return;
  rec.set('value', text);
  if (text !== '') rec.set('need', '');
  rec.set('origin', text === '' ? '' : 'system');
  rec.set('confirmed', text !== '' && fs.every((f) => f.confirmed));
  rec.set('edited_at', L('lib_util').now());
  app.save(rec);
}

/** Drop a removed founder's profile answers. */
function dropFounder(app, founderId) {
  const recs = app.findRecordsByFilter('answers', 'key ~ {:p}', '', 0, 0, { p: 'fp.' + founderId + '.%' });
  for (const r of recs) app.delete(app.findRecordById('answers', r.id));
}

function questions() {
  const Q = L('lib_questions');
  return {
    sections: Q.SECTIONS,
    questions: Q.QUESTIONS.map((q) => ({ key: q.key, section: q.section, label: q.label, type: q.type, limit: q.limit || 0, choices: q.choices || [], required: !!q.required, gate: q.gate || null, by: q.by, tip: q.tip || '' })),
    profile: Q.PROFILE.map((q) => ({ key: 'fp.<founder id>.' + q.field, label: q.label, type: q.type, required: !!q.required, by: q.by, tip: q.tip || '' })),
    months: months(),
  };
}

module.exports = {
  ONLY: ONLY,
  months: months,
  normalize: normalize,
  gateOpen: gateOpen,
  measures: measures,
  all: all,
  counts: counts,
  isMissing: isMissing,
  list: list,
  get: get,
  set: set,
  setMany: setMany,
  find: find,
  confirm: confirm,
  accept: accept,
  useShorter: useShorter,
  dismiss: dismiss,
  need: need,
  recheck: recheck,
  syncBreakdown: syncBreakdown,
  dropFounder: dropFounder,
  questions: questions,
};
