/// <reference path="../pb_data/types.d.ts" />
/**
 * The reviewer: your AI agent reads each answer the way a speedrun investor
 * would, and then the whole application.
 *
 * Answer review. Only an explicit Review again action queues a saved snapshot
 * (lib_answers). A background worker (hooks.pb.js, every minute, waking on
 * an in-memory flag) takes up to six queued answers that have rested for a
 * few seconds and asks the host LLM, in JSON mode, for a structured verdict
 * per answer: what a stranger understands, whether it answers the question,
 * a strength from 0 to 3, issues of fixed types with the words they are
 * about, the parts of the question left out, and a shorter version in the
 * founder's own words when the answer runs long.
 *
 * Whole-application review. After the explicitly requested field reviews,
 * the worker reads the same frozen application snapshot once:
 * founder signal, founder-market fit, earned insight, differentiation,
 * momentum, how long the founders have built together, complementary skills,
 * whether the founders build the product, inconsistencies between answers,
 * and the fixes that matter most. The odds and the checks read this.
 *
 * Outside CraftBot the host LLM is unreachable: answers stay "offline" and
 * are retried, never judged by anything else.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const ISSUES = ['marketing', 'jargon', 'vague', 'no_numbers', 'overclaim', 'ai_voice', 'too_long', 'off_question', 'unclear', 'no_competitors', 'top_down_market', 'outsourced', 'weak_proof', 'grammar', 'buried_lede', 'undersold'];
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
  buried_lede: 'Best news buried',
  undersold: 'Undersold',
};
const BATCH = 6;
const REST_MS = 3000;
const MAX_ATTEMPTS = 3;

const ANSWER_SYSTEM = [
  'You are an a16z speedrun investor reading applications. Fewer than 0.4% of applicants get in; you spend most of your time on the team and bio section, and you are immune to marketing speak: to you it is noise.',
  'Judge each answer only on what it says. What speedrun rewards: the bottom line in the first sentences (the best news first), plain words a stranger can repeat, specifics (numbers, names, dates, links), achievements stated at full size ("this is not the place to be humble"), earned insight about the market, evidence that the founders ship, and honesty.',
  'What speedrun punishes: buzzwords and hype, startup jargon (for example "wedge", "leverage", "synergy", "revolutionize", "seamless", "cutting-edge"), a buried lede, being long-winded and vague about yourselves, claims with no proof, the future described as if it already exists, overblown market sizes, inflated metrics, "no competitors", typos, and text that reads machine-written (a punchy journalistic cadence, empty triads, em dashes).',
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
  lines.push('  "issues": up to 6 objects {"type": one of ' + JSON.stringify(ISSUES) + ', "quote": the exact words from the answer (at most 12 words, copied exactly), "fix": what to do instead, at most 20 plain words}. buried_lede: the strongest fact sits late in the answer. undersold: an achievement is stated without its size (users, revenue, rank, outcome) or humbly,');
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
  if (vals.s_name) parts.push('Name: ' + vals.s_name);
  if (vals.s_oneliner) parts.push('One-liner: ' + vals.s_oneliner);
  if (vals.s_desc) parts.push('Description: ' + L('lib_util').clip(vals.s_desc, 600));
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
  app.store().set('sr_llm_down_until', Date.now() + seconds * 1000);
}

function isDown(app) {
  const t = app.store().get('sr_llm_down_until');
  return typeof t === 'number' && t > Date.now();
}

/** PocketBase's datetime text for a moment (what autodate fields hold). */
function pbTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** Only explicit requests authorize LLM work. Edits never mutate this snapshot. */
function request(app) {
  return L('lib_util').json(L('lib_store').settings(app), 'review_request', null);
}
function active(job) {
  return !!job && (job.status === 'queued' || job.status === 'running');
}
function requestReview(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  let out;
  ctx.app.runInTransaction((app) => {
    const s = S.settings(app);
    const existing = U.json(s, 'review_request', null);
    if (active(existing)) {
      out = { queued: 0, already_running: true, request: existing.id };
      return;
    }
    const A = L('lib_answers');
    const Q = L('lib_questions');
    if (p.key && Q.definition(p.key) === null) throw U.fail(404, 'Unknown question: ' + p.key, 'not_found');
    const selected = A.all(app).filter((a) => a.open && a.judged && a.value !== '' && (!p.key || a.key === p.key));
    const snap = appSnapshot(app);
    if (selected.length === 0 && snap.answers.length < 3) {
      out = { queued: 0, nothing_to_review: true, message: 'Write an answer before asking for a review.' };
      return;
    }
    const items = selected.map((a) => {
      const d = Q.definition(a.key);
      return { key: a.key, label: a.label, limit: a.limit || 0, words: a.words_hint || 0, rubric: d ? d.rubric || '' : '', value: a.value, hash: U.hash(a.value) };
    });
    const job = { id: U.now() + ':' + Math.random().toString(36).slice(2), status: 'queued', at: U.now(), snapshot: snap, hash: snapshotHash(app), items: items };
    s.set('review_request', job);
    s.set('review_state', 'queued');
    app.save(s);
    for (const it of items) {
      const r = app.findFirstRecordByFilter('answers', 'key = {:key}', { key: it.key });
      r.set('judge_state', 'queued');
      app.save(r);
    }
    out = { queued: items.length, request: job.id, already_running: false };
    S.log(app, ctx.isAgent ? 'agent' : 'person', 'Requested a review of saved inputs', p.key || 'application');
  });
  S.wake(ctx.app);
  return out;
}

/** Review only the requested values, never text saved after the click. */
function judgeBatch(app) {
  const U = L('lib_util');
  const job = request(app);
  if (!active(job)) return 0;
  const items = [];
  for (const it of job.items || []) {
    let r;
    try { r = app.findFirstRecordByFilter('answers', 'key = {:key}', { key: it.key }); } catch { continue; }
    if (r.getString('judge_state') !== 'queued') continue;
    r.set('judge_state', 'running');
    app.save(r);
    items.push(Object.assign({}, it, { rec: r }));
    if (items.length >= BATCH) break;
  }
  if (items.length === 0) return 0;
  const s = L('lib_store').settings(app);
  job.status = 'running';
  s.set('review_request', job);
  app.save(s);
  L('lib_bus').flush(app);
  const vals = {};
  for (const a of job.snapshot.answers) vals[a.key] = a.answer;
  let reply;
  try { reply = ask(answerPrompt(items, companyContext(vals)), ANSWER_SYSTEM); } catch { reply = null; }
  const byKey = {};
  if (reply && Array.isArray(reply.answers)) for (const a of reply.answers) if (a && typeof a.key === 'string') byKey[a.key] = a;
  for (const it of items) {
    let r;
    try { r = app.findRecordById('answers', it.rec.id); } catch { continue; }
    if (!byKey[it.key]) {
      r.set('judge_state', 'error');
    } else {
      r.set('judge', cleanAnswer(byKey[it.key], it.value));
      r.set('judge_state', 'done');
      r.set('judged_hash', it.hash);
      r.set('judged_at', U.now());
    }
    app.save(r);
  }
  return items.length;
}

/* -------------------------------------------------- whole-application review */

const APP_SYSTEM = [
  'You are an a16z speedrun investor deciding whether to invite a team to an interview. speedrun spends most of its time on the team and bio section and looks for founders who go from zero to one without waiting for permission, move quickly and have earned insight into their market; complementary skills; teams that can build the product themselves; founder-market fit; clear differentiation; and early signs that people want it (traction is not required: a design partner, users coming back or a waitlist count).',
  'Score only from what the application says. Do not reward polish; reward specifics and proof. Reply with one JSON object and nothing else. Never use em dashes in any text you write.',
].join(' ');

function appSnapshot(app) {
  const A = L('lib_answers');
  const S = L('lib_store');
  const items = A.all(app).filter((a) => a.open && a.value !== '');
  const founders = S.founders(app).map((f, i) => ({ id: f.id, name: f.name, role: f.role, applies_as_ceo: i === 0, technical_end_to_end: f.technical, full_time: f.full_time, years_of_experience: f.years, college: f.college, education: f.education, country: f.country, linkedin: f.linkedin !== '', github: f.github !== '' }));
  const answers = items.map((a) => ({ key: a.key, question: a.label, founder: a.founder_name || undefined, answer: a.value }));
  return { founders: founders, answers: answers };
}

function snapshotHash(app) {
  const U = L('lib_util');
  const s = L('lib_store').settings(app);
  return U.hash(JSON.stringify(appSnapshot(app)) + '|' + s.getString('cohort'));
}

function appPrompt(snap) {
  const lines = [];
  lines.push('Read this a16z speedrun application and return:');
  lines.push('{');
  lines.push('  "one_liner_restated": what the company does, in one plain sentence, as a stranger would say it after reading,');
  lines.push('  "one_liner_clear": true if the company can be explained in one sentence from what is written,');
  lines.push('  "founder_signal": 0-3, how exceptional the founders\' track records are (3 = outlier achievements proven with numbers, rank or links; pedigree alone is not enough),');
  lines.push('  "founder_signal_why": one sentence,');
  lines.push('  "founder_market_fit": 0-3, why these founders for this problem (domain expertise, personal pain),');
  lines.push('  "founder_market_fit_why": one sentence,');
  lines.push('  "insight": 0-3, an earned secret: something the founders learned firsthand about this market that others miss (3 = partners would not have thought of it),');
  lines.push('  "insight_why": one sentence,');
  lines.push('  "differentiation": 0-2, how plainly the application says why it differs from the closest alternatives (0 = not at all, 1 = implied, 2 = named and explained),');
  lines.push('  "differentiation_why": one sentence,');
  lines.push('  "demand": 0-3, momentum: evidence that people want this (0 = none, 1 = conversations, advisors or a waitlist, 2 = design partners or real usage, 3 = paying customers or strong retention, growing),');
  lines.push('  "demand_why": one sentence,');
  lines.push('  "team_history": 0-2, how well the founders know each other (0 = just met, 1 = know each other, 2 = built or worked together for years); 0 for a solo founder,');
  lines.push('  "complementary": true if the founders\' skills cover building and selling (for B2B someone commercial), false if there is a glaring gap,');
  lines.push('  "complementary_why": one sentence,');
  lines.push('  "builders_are_founders": true if the founders build the product themselves,');
  lines.push('  "trend_chasing": true if it reads like a generic version of this year\'s most crowded idea with no special angle,');
  lines.push('  "ai_why_now": true if the only reason given for why now is that AI models got better,');
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
    differentiation: n03(raw.differentiation, 2),
    differentiation_why: str(raw.differentiation_why, 300),
    complementary: typeof raw.complementary === 'boolean' ? raw.complementary : null,
    complementary_why: str(raw.complementary_why, 300),
    ai_why_now: raw.ai_why_now === true,
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

/** Read the requested application snapshot once, keeping prior feedback visible. */
function reviewApp(app) {
  const U = L('lib_util');
  const S = L('lib_store');
  const job = request(app);
  if (!active(job)) return false;
  const snap = job.snapshot;
  const s = S.settings(app);
  s.set('review_state', 'running');
  app.save(s);
  L('lib_bus').flush(app);
  let reply;
  try { reply = snap.answers.length >= 3 ? ask(appPrompt(snap), APP_SYSTEM) : null; } catch { reply = null; }
  const fresh = S.settings(app);
  const failures = app.findRecordsByFilter('answers', "judge_state = 'error'", '', 0, 0).filter((r) => (job.items || []).some((it) => it.key === r.getString('key'))).length;
  if (snap.answers.length < 3) {
    fresh.set('review_state', 'none');
    job.status = failures ? 'failed' : 'done';
  } else if (!reply || typeof reply.summary !== 'string') {
    fresh.set('review_state', 'offline');
    job.status = 'failed';
  } else {
    fresh.set('review', cleanReview(reply, snap.answers.map((a) => a.key)));
    fresh.set('review_state', 'done');
    fresh.set('review_hash', job.hash);
    fresh.set('review_at', U.now());
    job.status = failures ? 'failed' : 'done';
  }
  // No automatic retries: the button is available again if a call failed.
  job.finished_at = U.now();
  fresh.set('review_request', job);
  app.save(fresh);
  return true;
}

/** Progress is separate from the retained review and its freshness. */
function progress(app) {
  const U = L('lib_util');
  const A = L('lib_answers');
  const s = L('lib_store').settings(app);
  const job = request(app);
  const busy = active(job);
  const review = U.json(s, 'review', null);
  const hasReview = !!(review && review.summary);
  const fieldsChanged = A.all(app).some((a) => a.open && a.judge && !a.judge_current);
  const queued = busy ? app.findRecordsByFilter('answers', "judge_state = 'queued' || judge_state = 'running'", '', 0, 0).length : 0;
  return { queued: queued, offline: 0, review_state: s.getString('review_state') || 'none', llm_down: false, active: busy, stale: fieldsChanged || (hasReview && s.getString('review_hash') !== snapshotHash(app)), has_review: hasReview, failed: !!job && job.status === 'failed', manual: true };
}

/**
 * The worker loop: review queued answers, then the whole application, until
 * `budgetMs` runs out. Waits on the in-memory wake flag between rounds, so a
 * saved answer is picked up within about a second.
 */
function work(app, budgetMs) {
  const store = app.store();
  const lock = store.get('sr_judge_lock');
  if (typeof lock === 'number' && Date.now() - lock < 150000) return;
  store.set('sr_judge_lock', Date.now());
  const until = Date.now() + budgetMs;
  try {
    while (Date.now() < until) {
      store.set('sr_judge_lock', Date.now());
      if (!active(request(app))) {
        sleep(1000);
        continue;
      }
      let did = 0;
      try {
        did = judgeBatch(app);
        if (did === 0) did = reviewApp(app) ? 1 : 0;
      } catch (err) {
        console.error('[speedrun] review worker failed:', err);
        did = 0;
        sleep(2000);
      }
      L('lib_bus').flush(app);
      if (did > 0) continue;
      for (let i = 0; i < 8 && Date.now() < until; i++) {
        if (store.get('sr_judge_wake') === true) break;
        sleep(250);
      }
      store.set('sr_judge_wake', false);
    }
  } finally {
    store.remove('sr_judge_lock');
  }
}

module.exports = { ISSUES: ISSUES, ISSUE_LABEL: ISSUE_LABEL, judgeBatch: judgeBatch, reviewApp: reviewApp, progress: progress, work: work, snapshotHash: snapshotHash, requestReview: requestReview };
