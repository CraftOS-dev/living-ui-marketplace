/// <reference path="../pb_data/types.d.ts" />
/**
 * The answers: one row per question key (form questions and each founder's
 * profile answers, fp.<founder>.<field>).
 *
 * Who wrote what is kept, because the founders must read every answer before
 * it goes to speedrun:
 *   - your AI agent fills empty or unconfirmed answers directly (origin
 *     agent, confirmed false: "check this");
 *   - once a founder wrote or confirmed an answer, your AI agent never
 *     overwrites it: its text is stored as a suggestion the founder accepts
 *     or dismisses;
 *   - a founder's edit is confirmed by writing it;
 *   - two Team answers (full-time or part-time, the number of full-time
 *     founders) are written from the team page (origin system) until someone
 *     writes them by hand.
 * Every change to a reviewed answer queues it for the reviewer (lib_judge).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const ONLY = ['all', 'missing', 'unconfirmed', 'flagged', 'needs'];

function validDay(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
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
    const s = String(v).trim().split(',').join('').split('$').join('').split('%').join('');
    if (s === '') return '';
    const n = Number(s);
    const what = def.unit === 'percent' ? 'a percent, for example --value 42 for 42%' : def.unit === 'months' ? 'a number of months, for example --value 14' : def.unit === 'count' ? 'a count, for example --value 3' : 'a number of US dollars, for example --value 120000';
    if (!Number.isFinite(n) || n < 0) throw U.fail(400, def.key + ' takes ' + what + '.', 'invalid_value', { key: def.key });
    if (def.unit === 'percent' && n > 1000) throw U.fail(400, def.key + ' is a percent: ' + n + ' is out of range.', 'invalid_value', { key: def.key });
    if (def.unit === 'count' && Math.round(n) !== n) throw U.fail(400, def.key + ' takes a whole number.', 'invalid_value', { key: def.key });
    return String(Math.round(n * 100) / 100);
  }
  if (def.type === 'choice') {
    const s = String(v).trim();
    if (s === '') return '';
    for (const c of def.choices) if (c.toLowerCase() === s.toLowerCase()) return c;
    if (def.choices === L('lib_questions').COUNTRIES) {
      const c = L('lib_questions').countryOf(s, U.nearest);
      if (c.country !== null) return c.country;
      throw U.fail(400, def.key + ' must be a country as speedrun\'s form lists it' + (c.near !== '' ? ' (did you mean ' + c.near + '?)' : '') + '; questions.list gives them all.', 'invalid_value', { key: def.key });
    }
    throw U.fail(400, def.key + ' must be one of: ' + def.choices.join(', ') + '.', 'invalid_value', { key: def.key, choices: def.choices });
  }
  if (def.type === 'month') {
    const s = String(v).trim();
    if (s === '') return '';
    const m = /^(\d{4})-(\d{1,2})$/.exec(s);
    if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1990 || Number(m[1]) > 2100) throw U.fail(400, def.key + ' is a year and month written YYYY-MM, for example --value 2025-06.', 'invalid_value', { key: def.key });
    return m[1] + '-' + ('0' + m[2]).slice(-2);
  }
  if (def.type === 'date') {
    const s = String(v).trim();
    if (s === '') return '';
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m === null || !validDay(Number(m[1]), Number(m[2]), Number(m[3]))) throw U.fail(400, def.key + ' is a date written YYYY-MM-DD, for example --value 2026-03-15.', 'invalid_value', { key: def.key });
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  if (def.type === 'rows') {
    const example = '[' + '{' + def.columns.map((c) => '"' + c.key + '":' + (c.num ? '100000' : '"..."')).join(',') + '}' + ']';
    let arr = Array.isArray(v) ? v : null;
    if (arr === null && String(v).trim() === '') arr = [];
    if (arr === null) {
      try {
        arr = JSON.parse(String(v));
      } catch {
        arr = null;
      }
    }
    if (!Array.isArray(arr)) throw U.fail(400, def.key + ' is a JSON list of rows such as ' + example + '.', 'invalid_value', { key: def.key });
    const out = [];
    for (const row of arr) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw U.fail(400, def.key + ' is a JSON list of rows such as ' + example + '.', 'invalid_value', { key: def.key });
      const r = {};
      let any = false;
      for (const c of def.columns) {
        const cell = row[c.key] === undefined || row[c.key] === null ? '' : String(row[c.key]).trim();
        if (c.num) {
          const t = cell.split(',').join('').split('$').join('');
          if (t === '') r[c.key] = null;
          else {
            const n = Number(t);
            if (!Number.isFinite(n) || n < 0) throw U.fail(400, def.key + ': ' + c.label + ' takes a number of US dollars.', 'invalid_value', { key: def.key });
            r[c.key] = Math.round(n * 100) / 100;
            any = true;
          }
        } else {
          r[c.key] = U.clip(cell, 400);
          if (cell !== '') any = true;
        }
      }
      if (any) out.push(r);
    }
    if (out.length > 30) throw U.fail(400, def.key + ' takes at most 30 rows.', 'invalid_value', { key: def.key });
    return out.length === 0 ? '' : JSON.stringify(out);
  }
  if (def.type === 'short' || def.type === 'url') return String(v).split('\n').join(' ').trim();
  return String(v).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Is a gated question asked, given the answers so far? Gates nest: the gate's own question must be asked too. */
function gateOpen(def, vals) {
  if (!def.gate) return true;
  const parent = L('lib_questions').byKey(def.gate.key);
  if (parent !== null && !gateOpen(parent, vals)) return false;
  return (vals[def.gate.key] || '') === def.gate.is;
}

/** The rows of a rows answer (an empty list when empty or unreadable). */
function rowsOf(value) {
  if (value === '') return [];
  try {
    const r = JSON.parse(value);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
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
  const issues = judge && Array.isArray(judge.issues) ? judge.issues.length : 0;
  const flags = issues + (m.over_limit ? 1 : 0) + (m.em_dashes > 0 ? 1 : 0) + (m.long ? 1 : 0) + (judge && Array.isArray(judge.missing) ? judge.missing.length : 0);
  return {
    key: def.key,
    section: def.section,
    label: def.label,
    short: L('lib_questions').shortOf(def.key),
    type: def.type,
    unit: def.unit || '',
    columns: def.columns || [],
    limit: def.limit || 0,
    choices: def.choices || [],
    required: !!def.required,
    gate: def.gate || null,
    open: gateOpen(def, vals),
    by: def.by,
    derived: !!def.derived,
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
    judged_at: rec ? rec.getString('judged_at') : '',
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
        if (a.judge && Array.isArray(a.judge.issues)) for (const i of a.judge.issues) why.push(i.label);
        if (a.judge && Array.isArray(a.judge.missing)) for (const m of a.judge.missing) why.push('Missing: ' + m);
        if (a.measures.over_limit) why.push('Over the ' + a.limit + ' character limit');
        if (a.measures.em_dashes > 0) why.push(a.measures.em_dashes + ' em dashes');
        if (a.measures.long) why.push('Longer than needed');
        b.why_flagged = why;
      }
      if (a.limit > 0) b.limit = a.limit;
      if (a.unit !== '') b.unit = a.unit;
      if (a.columns.length > 0) b.columns = a.columns.map((col) => col.key);
      if (a.choices.length > 0 && a.choices.length <= 20) b.choices = a.choices;
      if (a.derived) b.derived = 'written from the team page until someone writes it by hand';
      if (a.founder_name !== undefined) b.founder_name = a.founder_name;
      if (a.failing_checks !== undefined) b.failing_checks = a.failing_checks;
      return b;
    });
  }
  return { sections: Q.SECTIONS.concat([{ key: 'profile', label: 'Founder experience (keys fp.<founder id>.experience)' }]), counts: c, items: items };
}

function definitionOrFail(app, key) {
  const Q = L('lib_questions');
  const U = L('lib_util');
  const def = Q.definition(key);
  if (def === null) {
    const keys = Q.QUESTIONS.map((q) => q.key);
    const near = U.nearest(key, keys);
    throw U.fail(404, 'No question "' + key + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. Run answers.list for every key; founder experience keys look like fp.<founder id>.experience.', 'unknown_key', { key: key });
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

/** Saving never schedules a review or clears the previous feedback. */
function queueJudge(app, def, rec) {
  // Freshness comes from judged_hash; only answers.recheck creates review work.
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
  // A derived answer cleared by hand goes back to the team page's value.
  if (def.derived && rec.getString('value') === '') syncDerived(app);
  if (ctx.isAgent) S.log(app, 'agent', (stored === 'suggestion' ? 'Suggested a new answer for ' : value === '' ? 'Cleared ' : before !== '' ? 'Changed ' : 'Filled ') + shortLabel(def), p.key);
  const m = measures(def, stored === 'suggestion' ? value : rec.getString('value'));
  const warnings = [];
  if (m.over_limit) warnings.push('Over the ' + def.limit + ' character limit (' + m.chars + '): speedrun\'s form stops at ' + def.limit + '.');
  if (m.em_dashes > 0) warnings.push(m.em_dashes + ' em dashes: they read as machine-written.');
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
    for (const field of ['name', 'role', 'email', 'phone', 'college', 'city', 'country', 'need']) {
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

/** Explicitly request a snapshot review; duplicate requests join the active run. */
function recheck(ctx, p) {
  return L('lib_judge').requestReview(ctx, p);
}

/** Write one derived answer from the team page while nobody has written it by hand. */
function writeDerived(app, key, text, confirmed) {
  const rec = record(app, key);
  const origin = rec.getString('origin');
  if (origin !== '' && origin !== 'system') return;
  if (text === rec.getString('value') && rec.getBool('confirmed') === (text !== '' && confirmed)) return;
  rec.set('value', text);
  if (text !== '') rec.set('need', '');
  rec.set('origin', text === '' ? '' : 'system');
  rec.set('confirmed', text !== '' && confirmed);
  rec.set('edited_at', L('lib_util').now());
  app.save(rec);
}

/**
 * The two Team answers the team page settles: whether the founder applying
 * (the first on the team) is full-time, and how many founders are full-time
 * (speedrun asks for 0 when the founder applying is part-time). Unknown stays
 * empty: nobody is counted part-time or full-time until a founder says so.
 */
function syncDerived(app) {
  const fs = L('lib_store').founders(app);
  const lead = fs.length > 0 ? fs[0] : null;
  const employment = lead === null || lead.full_time === null ? '' : lead.full_time ? 'Full-time' : 'Part-time';
  writeDerived(app, 't_employment', employment, lead !== null && lead.confirmed);
  const known = fs.length > 0 && fs.every((f) => f.full_time !== null);
  const count = lead !== null && lead.full_time === false ? 0 : fs.filter((f) => f.full_time === true).length;
  writeDerived(app, 't_ft_founders', lead !== null && lead.full_time === false ? '0' : known ? String(count) : '', fs.every((f) => f.confirmed));
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
    questions: Q.QUESTIONS.map((q) => ({ key: q.key, section: q.section, label: q.label, type: q.type, unit: q.unit || undefined, columns: q.columns || undefined, limit: q.limit || 0, choices: q.choices && q.choices.length <= 20 ? q.choices : undefined, choices_from: q.choices && q.choices.length > 20 ? 'countries' : undefined, required: !!q.required, gate: q.gate || null, by: q.by, derived: q.derived || undefined, tip: q.tip || '' })),
    profile: Q.PROFILE.map((q) => ({ key: 'fp.<founder id>.' + q.field, label: q.label, type: q.type, limit: q.limit || 0, required: !!q.required, by: q.by, tip: q.tip || '' })),
    founder_fields: {
      education: Q.EDUCATION,
      note: 'Founders are people with over 10% equity. The first founder is the CEO who applies. country and citizenship take a name from countries.',
    },
    countries: Q.COUNTRIES,
  };
}

module.exports = {
  ONLY: ONLY,
  normalize: normalize,
  gateOpen: gateOpen,
  rowsOf: rowsOf,
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
  syncDerived: syncDerived,
  dropFounder: dropFounder,
  questions: questions,
};
