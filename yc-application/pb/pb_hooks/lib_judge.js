/// <reference path="../pb_data/types.d.ts" />
/**
 * The reviewer: your AI agent reads each answer the way a YC partner would,
 * and then the whole application.
 *
 * Answer review. Every reviewed answer whose text changed is queued
 * (lib_answers). A background worker (hooks.pb.js, every minute, waking on
 * an in-memory flag) takes up to six queued answers that have rested for a
 * few seconds and asks the host LLM, in JSON mode, for a structured verdict
 * per answer: what a stranger understands, whether it answers the question,
 * a strength from 0 to 3, issues of fixed types with the words they are
 * about, the parts of the question left out, and a shorter version in the
 * founder's own words when the answer runs long.
 *
 * Whole-application review. When every answer is reviewed and anything
 * changed since the last read, the worker reads the whole application once:
 * founder signal, founder-market fit, insight, evidence of demand, how long
 * the founders have worked together, whether the founders build the product,
 * inconsistencies between answers, and the fixes that matter most. The odds
 * and the checks read this.
 *
 * Outside CraftBot the host LLM is unreachable: answers stay "offline" and
 * are retried, never judged by anything else.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const ISSUES = ['marketing', 'jargon', 'vague', 'no_numbers', 'overclaim', 'ai_voice', 'too_long', 'off_question', 'unclear', 'no_competitors', 'top_down_market', 'outsourced', 'weak_proof', 'grammar'];
const ISSUE_LABEL = {
  marketing: 'Marketing speak',
  jargon: 'Jargon',
  vague: 'Vague',
  no_numbers: 'No numbers',
  overclaim: 'Overclaim',
  ai_voice: 'Sounds machine-written',
  too_long: 'Too long',
  off_question: 'Off the question',
  unclear: 'Unclear',
  no_competitors: 'Says there are no competitors',
  top_down_market: 'Top-down market size',
  outsourced: 'Built by non-founders',
  weak_proof: 'No proof',
  grammar: 'Spelling or grammar',
};
const BATCH = 6;
const REST_MS = 3000;
const MAX_ATTEMPTS = 3;

const ANSWER_SYSTEM = [
  'You are a Y Combinator partner reading applications. You read about a hundred a day and you are immune to marketing speak: to you it is noise.',
  'Judge each answer only on what it says. What partners reward: plain words a stranger can repeat, specifics (numbers, names, dates, links), honesty about weaknesses, brevity ("every unnecessary word subtracts"), and evidence that the founders build things.',
  'What partners punish: buzzwords and hype, startup jargon (for example "wedge", "leverage", "synergy", "revolutionize", "seamless", "cutting-edge"), claims with no proof, the future described as if it already exists, market-size arithmetic instead of users, "no competitors", long answers, and text that reads machine-written (a punchy journalistic cadence, empty triads, em dashes).',
  'Reply with one JSON object and nothing else. Never use em dashes in any text you write.',
].join(' ');

function answerPrompt(items, ctxText) {
  const lines = [];
  lines.push('Company context (for relevance only; do not judge it here): ' + (ctxText || '(not written yet)'));
  lines.push('');
  lines.push('Review each answer below. For each one return an object with:');
  lines.push('  "key": the key given,');
  lines.push('  "restated": one plain sentence: what a smart stranger understands from the answer,');
  lines.push('  "clear": true if a stranger could repeat it correctly,');
  lines.push('  "answers_question": true if it answers what was asked,');
  lines.push('  "strength": 0 (weak) to 3 (what a partner wants to read),');
  lines.push('  "issues": up to 6 objects {"type": one of ' + JSON.stringify(ISSUES) + ', "quote": the exact words from the answer (at most 12 words, copied exactly), "fix": what to do instead, at most 20 plain words},');
  lines.push('  "missing": the parts of the question the answer leaves out (short phrases, may be empty),');
  lines.push('  "shorter": only when the answer is longer than it needs to be: the same answer cut down, using only the founder\'s own facts and mostly their own words, adding nothing new; otherwise "".');
  lines.push('Return {"answers": [ ... ]} with one object per key, in the same order.');
  lines.push('');
  for (const it of items) {
    lines.push('KEY: ' + it.key);
    lines.push('QUESTION: ' + it.label);
    if (it.limit) lines.push('HARD LIMIT: ' + it.limit + ' characters');
    if (it.words) lines.push('LENGTH: about ' + it.words + ' words is plenty');
    lines.push('WHAT PARTNERS LOOK FOR: ' + (it.rubric || ''));
    lines.push('ANSWER:');
    lines.push(it.value);
    lines.push('---');
  }
  return lines.join('\n');
}

function str(v, max) {
  return typeof v === 'string' ? L('lib_util').clip(v.trim(), max) : '';
}

function cleanAnswer(raw, value) {
  const issues = [];
  for (const i of Array.isArray(raw.issues) ? raw.issues : []) {
    if (!i || ISSUES.indexOf(i.type) < 0) continue;
    issues.push({ type: i.type, label: ISSUE_LABEL[i.type], quote: str(i.quote, 160), fix: str(i.fix, 200) });
    if (issues.length >= 6) break;
  }
  const missing = [];
  for (const m of Array.isArray(raw.missing) ? raw.missing : []) {
    const t = str(m, 160);
    if (t !== '') missing.push(t);
    if (missing.length >= 4) break;
  }
  let shorter = str(raw.shorter, 60000);
  if (shorter.length >= String(value).length) shorter = '';
  let strength = Math.round(Number(raw.strength));
  if (!(strength >= 0 && strength <= 3)) strength = 1;
  return {
    restated: str(raw.restated, 300),
    clear: raw.clear === true,
    answers_question: raw.answers_question !== false,
    strength: strength,
    issues: issues,
    missing: missing,
    shorter: shorter,
  };
}

function companyContext(vals) {
  const parts = [];
  if (vals.c_name) parts.push('Name: ' + vals.c_name);
  if (vals.c_desc) parts.push('One-liner: ' + vals.c_desc);
  if (vals.c_what) parts.push('What it makes: ' + L('lib_util').clip(vals.c_what, 600));
  return parts.join(' | ');
}

function ask(prompt, system) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const raw = bridge.callLLM(prompt, system, { json: true });
  if (raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function down(app, seconds) {
  app.store().set('yc_llm_down_until', Date.now() + seconds * 1000);
}

function isDown(app) {
  const t = app.store().get('yc_llm_down_until');
  return typeof t === 'number' && t > Date.now();
}

/** PocketBase's datetime text for a moment (what autodate fields hold). */
function pbTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** Review up to BATCH queued answers. Returns how many were reviewed (0 when none waited). */
function judgeBatch(app) {
  const U = L('lib_util');
  const Q = L('lib_questions');
  const S = L('lib_store');
  const recs = app.findRecordsByFilter('answers', "(judge_state = 'queued' || judge_state = 'offline') && updated < {:t}", 'updated', BATCH, 0, { t: pbTime(Date.now() - REST_MS) });
  if (recs.length === 0) return 0;
  const vals = S.values(app);
  const items = [];
  for (const old of recs) {
    const r = app.findRecordById('answers', old.id);
    const def = Q.definition(r.getString('key'));
    const value = r.getString('value');
    if (def === null || !def.judge || value === '') {
      r.set('judge_state', 'none');
      app.save(r);
      continue;
    }
    items.push({ rec: r, key: def.key, label: def.label, limit: def.limit || 0, words: def.words || 0, rubric: def.rubric || '', value: value, hash: U.hash(value) });
    r.set('judge_state', 'running');
    app.save(r);
  }
  if (items.length === 0) return recs.length;
  L('lib_bus').flush(app);
  const reply = ask(answerPrompt(items, companyContext(vals)), ANSWER_SYSTEM);
  const byKey = {};
  if (reply && Array.isArray(reply.answers)) for (const a of reply.answers) if (a && typeof a.key === 'string') byKey[a.key] = a;
  for (const it of items) {
    const r = app.findRecordById('answers', it.rec.id);
    const now = r.getString('value');
    const raw = byKey[it.key];
    if (U.hash(now) !== it.hash) {
      r.set('judge_state', 'queued');
    } else if (reply === null) {
      r.set('judge_state', 'offline');
    } else if (raw === undefined) {
      const prev = U.json(r, 'judge', null);
      const attempts = (prev && prev.attempts ? prev.attempts : 0) + 1;
      r.set('judge', Object.assign({}, prev || {}, { attempts: attempts }));
      r.set('judge_state', attempts >= MAX_ATTEMPTS ? 'error' : 'offline');
    } else {
      r.set('judge', cleanAnswer(raw, now));
      r.set('judge_state', 'done');
      r.set('judged_hash', it.hash);
      r.set('judged_at', U.now());
    }
    app.save(r);
  }
  if (reply === null || reply === undefined) down(app, 60);
  return items.length;
}

/* -------------------------------------------------- whole-application review */

const APP_SYSTEM = [
  'You are a Y Combinator partner deciding whether to interview a team. Partners read the team first and look for technical excellence, founders who build things, founder-market fit, a clear idea, evidence that people want it, and honesty.',
  'Score only from what the application says. Do not reward polish; reward specifics and proof. Reply with one JSON object and nothing else. Never use em dashes in any text you write.',
].join(' ');

function appSnapshot(app) {
  const A = L('lib_answers');
  const S = L('lib_store');
  const items = A.all(app).filter((a) => a.open && a.value !== '');
  const founders = S.founders(app).map((f) => ({ id: f.id, name: f.name, role: f.role, technical: f.technical, full_time: f.full_time, equity: f.equity, education: f.education, work: f.work }));
  const answers = items.map((a) => ({ key: a.key, question: a.label, founder: a.founder_name || undefined, answer: a.value }));
  return { founders: founders, answers: answers };
}

function snapshotHash(app) {
  const U = L('lib_util');
  const s = L('lib_store').settings(app);
  return U.hash(JSON.stringify(appSnapshot(app)) + '|' + s.getBool('recommended'));
}

function appPrompt(snap) {
  const lines = [];
  lines.push('Read this YC application and return:');
  lines.push('{');
  lines.push('  "one_liner_restated": what the company does, in one plain sentence, as a stranger would say it after reading,');
  lines.push('  "one_liner_clear": true if the company can be explained in one sentence from what is written,');
  lines.push('  "founder_signal": 0-3, how impressive the founders\' past achievements are (3 = exceptional, proven with numbers or rank),');
  lines.push('  "founder_signal_why": one sentence,');
  lines.push('  "founder_market_fit": 0-3, why these founders for this problem (domain expertise, personal pain),');
  lines.push('  "founder_market_fit_why": one sentence,');
  lines.push('  "insight": 0-3, a non-obvious insight about the market or competitors (3 = something partners would not have thought of),');
  lines.push('  "insight_why": one sentence,');
  lines.push('  "demand": 0-3, evidence that people want this (0 = none, 1 = conversations, 2 = real usage, 3 = paying users growing),');
  lines.push('  "demand_why": one sentence,');
  lines.push('  "team_history": 0-2, how well the founders know each other (0 = just met, 1 = know each other, 2 = built or worked together for years),');
  lines.push('  "builders_are_founders": true if the founders build the product themselves,');
  lines.push('  "trend_chasing": true if it reads like a generic version of this year\'s most popular idea with no special angle,');
  lines.push('  "flaws_disclosed": true if the application admits its weaknesses or risks somewhere,');
  lines.push('  "overclaims": up to 4 {"key": answer key, "what": what looks exaggerated or stated as done when it is not},');
  lines.push('  "inconsistencies": up to 4 {"keys": [answer keys], "what": what does not agree, for example numbers that differ},');
  lines.push('  "summary": two plain sentences: how a partner would see this application,');
  lines.push('  "top_fixes": up to 3 short instructions, the changes that would most improve the odds');
  lines.push('}');
  lines.push('');
  lines.push('FOUNDERS: ' + JSON.stringify(snap.founders));
  lines.push('ANSWERS: ' + JSON.stringify(snap.answers));
  return lines.join('\n');
}

function n03(v, max) {
  const n = Math.round(Number(v));
  return n >= 0 && n <= max ? n : null;
}

function cleanReview(raw, keys) {
  const pairs = [];
  for (const o of Array.isArray(raw.overclaims) ? raw.overclaims : []) {
    if (o && keys.indexOf(o.key) >= 0) pairs.push({ key: o.key, what: str(o.what, 240) });
    if (pairs.length >= 4) break;
  }
  const inc = [];
  for (const o of Array.isArray(raw.inconsistencies) ? raw.inconsistencies : []) {
    const ks = (Array.isArray(o && o.keys) ? o.keys : []).filter((k) => keys.indexOf(k) >= 0);
    if (ks.length > 0) inc.push({ keys: ks, what: str(o.what, 240) });
    if (inc.length >= 4) break;
  }
  const fixes = [];
  for (const f of Array.isArray(raw.top_fixes) ? raw.top_fixes : []) {
    const t = str(f, 200);
    if (t !== '') fixes.push(t);
    if (fixes.length >= 3) break;
  }
  return {
    one_liner_restated: str(raw.one_liner_restated, 300),
    one_liner_clear: raw.one_liner_clear === true,
    founder_signal: n03(raw.founder_signal, 3),
    founder_signal_why: str(raw.founder_signal_why, 300),
    founder_market_fit: n03(raw.founder_market_fit, 3),
    founder_market_fit_why: str(raw.founder_market_fit_why, 300),
    insight: n03(raw.insight, 3),
    insight_why: str(raw.insight_why, 300),
    demand: n03(raw.demand, 3),
    demand_why: str(raw.demand_why, 300),
    team_history: n03(raw.team_history, 2),
    builders_are_founders: raw.builders_are_founders !== false,
    trend_chasing: raw.trend_chasing === true,
    flaws_disclosed: raw.flaws_disclosed !== false,
    overclaims: pairs,
    inconsistencies: inc,
    summary: str(raw.summary, 600),
    top_fixes: fixes,
  };
}

/** Read the whole application when anything changed since the last read. Returns true when it ran. */
function reviewApp(app) {
  const U = L('lib_util');
  const S = L('lib_store');
  const s = S.settings(app);
  const snap = appSnapshot(app);
  if (snap.answers.length < 3) {
    if (s.getString('review_state') !== 'none') {
      s.set('review_state', 'none');
      s.set('review', {});
      s.set('review_hash', '');
      app.save(s);
    }
    return false;
  }
  const h = snapshotHash(app);
  if (s.getString('review_hash') === h && s.getString('review_state') === 'done') return false;
  const last = app.store().get('yc_review_tried');
  if (typeof last === 'number' && Date.now() - last < 20000) return false;
  app.store().set('yc_review_tried', Date.now());
  s.set('review_state', 'running');
  app.save(s);
  L('lib_bus').flush(app);
  const reply = ask(appPrompt(snap), APP_SYSTEM);
  const fresh = S.settings(app);
  if (reply === null || reply === undefined) {
    fresh.set('review_state', 'offline');
    app.save(fresh);
    down(app, 60);
    return true;
  }
  fresh.set('review', cleanReview(reply, snap.answers.map((a) => a.key)));
  fresh.set('review_state', 'done');
  fresh.set('review_hash', h);
  fresh.set('review_at', U.now());
  app.save(fresh);
  return true;
}

/** Is everything reviewed and the whole-application read current? (for the screens) */
function progress(app) {
  const queued = app.findRecordsByFilter('answers', "judge_state = 'queued' || judge_state = 'running'", '', 0, 0).length;
  const offline = app.findRecordsByFilter('answers', "judge_state = 'offline'", '', 0, 0).length;
  const s = L('lib_store').settings(app);
  return { queued: queued, offline: offline, review_state: s.getString('review_state') || 'none', llm_down: isDown(app) };
}

/**
 * The worker loop: review queued answers, then the whole application, until
 * `budgetMs` runs out. Waits on the in-memory wake flag between rounds, so a
 * saved answer is picked up within about a second.
 */
function work(app, budgetMs) {
  const store = app.store();
  const lock = store.get('yc_judge_lock');
  if (typeof lock === 'number' && Date.now() - lock < 150000) return;
  store.set('yc_judge_lock', Date.now());
  const until = Date.now() + budgetMs;
  try {
    while (Date.now() < until) {
      store.set('yc_judge_lock', Date.now());
      if (isDown(app)) {
        sleep(1000);
        continue;
      }
      let did = 0;
      try {
        did = judgeBatch(app);
        if (did === 0) did = reviewApp(app) ? 1 : 0;
      } catch (err) {
        console.error('[yc] review worker failed:', err);
        did = 0;
        sleep(2000);
      }
      L('lib_bus').flush(app);
      if (did > 0) continue;
      for (let i = 0; i < 8 && Date.now() < until; i++) {
        if (store.get('yc_judge_wake') === true) break;
        sleep(250);
      }
      store.set('yc_judge_wake', false);
    }
  } finally {
    store.remove('yc_judge_lock');
  }
}

module.exports = { ISSUES: ISSUES, ISSUE_LABEL: ISSUE_LABEL, judgeBatch: judgeBatch, reviewApp: reviewApp, progress: progress, work: work, snapshotHash: snapshotHash };
