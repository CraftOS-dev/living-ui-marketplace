/**
 * Committee rules: vote scales, the tally and the decision rule. Pure
 * functions over plain objects (no PocketBase globals), so Node tests load
 * this file directly.
 *
 * Scales (per fund; default no_three, Sapphire and Connect: 1 to 5 without
 * 3): every choice is a string; `for` lists the choices that count for
 * investing, `neutral` the ones that count neither way.
 *
 * Rules (REPORT Table 5): consensus (every vote cast is for, no veto),
 * champion (the champion votes for, no veto), majority (more than half of
 * the votes cast are for, no veto). A veto blocks every rule. The rule's
 * answer is what the screen preselects; the facilitator records the
 * decision.
 */

const SCALES = {
  no_three: { key: 'no_three', label: '1 to 5, no 3', choices: ['1', '2', '4', '5'], for: ['4', '5'], neutral: [], top: '5' },
  one_to_five: { key: 'one_to_five', label: '1 to 5', choices: ['1', '2', '3', '4', '5'], for: ['4', '5'], neutral: ['3'], top: '5' },
  ten_no_mid: { key: 'ten_no_mid', label: '1 to 10, no 5 or 6', choices: ['1', '2', '3', '4', '7', '8', '9', '10'], for: ['7', '8', '9', '10'], neutral: [], top: '10' },
  yes_no: { key: 'yes_no', label: 'Yes or no', choices: ['yes', 'no'], for: ['yes'], neutral: [], top: 'yes' },
};

const RULES = ['consensus', 'champion', 'majority'];
const OUTCOMES = ['invest', 'pass', 'more_diligence', 'hold'];

function bad(message, code, extra) {
  const err = new Error(message);
  err.status = 400;
  err.code = code || 'invalid';
  if (extra !== undefined) err.extra = extra;
  return err;
}

function scale(key) {
  const s = SCALES[key];
  if (s === undefined) throw bad('Unknown vote scale ' + key + '. Scales: ' + Object.keys(SCALES).join(', '), 'invalid_scale', { allowed: Object.keys(SCALES) });
  return s;
}

/** The choice as stored ('4', 'yes'), or a 400 naming the allowed ones. */
function choiceOf(scaleKey, raw) {
  const s = scale(scaleKey);
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (s.choices.indexOf(v) < 0) throw bad('choice must be one of ' + s.choices.join(', ') + ' on this scale (' + s.label + ').', 'invalid_choice', { allowed: s.choices });
  return v;
}

/** for | against | neutral */
function lean(scaleKey, choice) {
  const s = scale(scaleKey);
  if (s.for.indexOf(choice) >= 0) return 'for';
  if (s.neutral.indexOf(choice) >= 0) return 'neutral';
  return 'against';
}

/** Junior first: lower seniority first, then the member who joined last, then by name. */
function juniorFirst(votes) {
  return votes.slice().sort((a, b) => (a.seniority || 0) - (b.seniority || 0) || String(b.joined || '').localeCompare(String(a.joined || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * tally({ scale, rule, champion, eligible, votes: [{ member, name, choice, veto, rationale, seniority, joined, cast_at }] })
 *   -> { scale, scale_label, rule, choices: [{ choice, n, lean }], for, against, neutral, vetoes,
 *        voted, eligible, missing, champion, champion_choice, result: invest|pass|none, reason, votes (junior first) }
 */
function tally(o) {
  const s = scale(o.scale);
  const rule = o.rule || 'consensus';
  if (RULES.indexOf(rule) < 0) throw bad('rule must be one of ' + RULES.join(', '), 'invalid_rule');
  const votes = (o.votes || []).map((v) => Object.assign({}, v, { choice: choiceOf(s.key, v.choice), veto: v.veto === true }));
  const counts = {};
  for (const c of s.choices) counts[c] = 0;
  let nFor = 0;
  let nAgainst = 0;
  let nNeutral = 0;
  let vetoes = 0;
  for (const v of votes) {
    counts[v.choice]++;
    const l = lean(s.key, v.choice);
    v.lean = l;
    if (l === 'for') nFor++;
    else if (l === 'neutral') nNeutral++;
    else nAgainst++;
    if (v.veto) vetoes++;
  }
  const eligible = Math.max(Number(o.eligible) || 0, votes.length);
  const champ = o.champion ? votes.filter((v) => v.member === o.champion)[0] || null : null;
  let result = 'none';
  let reason = 'no_votes';
  if (votes.length > 0) {
    if (vetoes > 0) {
      result = 'pass';
      reason = 'vetoed';
    } else if (rule === 'consensus') {
      result = nFor === votes.length ? 'invest' : 'pass';
      reason = result === 'invest' ? 'all_for' : 'not_unanimous';
    } else if (rule === 'champion') {
      if (!o.champion) reason = 'no_champion';
      else if (champ === null) reason = 'champion_missing';
      else {
        result = champ.lean === 'for' ? 'invest' : 'pass';
        reason = result === 'invest' ? 'champion_for' : 'champion_against';
      }
    } else {
      result = nFor * 2 > votes.length ? 'invest' : 'pass';
      reason = result === 'invest' ? 'majority_for' : 'no_majority';
    }
  }
  return {
    scale: s.key,
    scale_label: s.label,
    rule: rule,
    choices: s.choices.map((c) => ({ choice: c, n: counts[c], lean: lean(s.key, c) })),
    for: nFor,
    against: nAgainst,
    neutral: nNeutral,
    vetoes: vetoes,
    voted: votes.length,
    eligible: eligible,
    missing: eligible - votes.length,
    champion: o.champion || '',
    champion_choice: champ !== null ? champ.choice : null,
    result: result,
    reason: reason,
    votes: juniorFirst(votes).map((v) => ({ member: v.member, name: v.name || '', choice: v.choice, lean: v.lean, veto: v.veto, rationale: v.rationale || '', seniority: v.seniority || 0, joined: v.joined || '', cast_at: v.cast_at || '' })),
  };
}

/**
 * Memo text markup (the same for people and your AI agent): `[n]` cites
 * the block's n-th citation (1-based); `[?]` marks a figure without a
 * source. markers(text) -> { cites: [n...], uncited, chars } where chars
 * is the visible length (markers left out), used by the AI-use counters.
 */
function markers(text) {
  const t = String(text || '');
  const cites = [];
  let uncited = 0;
  let hidden = 0;
  const re = /\[(\d{1,3}|\?)\]/g;
  let m = re.exec(t);
  while (m !== null) {
    if (m[1] === '?') uncited++;
    else cites.push(Number(m[1]));
    hidden += m[0].length;
    m = re.exec(t);
  }
  return { cites: cites, uncited: uncited, chars: t.length - hidden };
}

/**
 * The characters a person changed: the middle between the common prefix
 * and suffix of the old and new text. -> { removed, added }
 */
function changed(before, after) {
  const a = String(before || '');
  const b = String(after || '');
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { removed: a.length - p - s, added: b.length - p - s };
}

/**
 * New AI-use counters after a person's edit: the removed characters leave
 * the typed, pasted and agent shares in proportion; the added ones count
 * as pasted (up to what the screen reports pasted) and typed for the rest.
 */
function recount(counts, before, after, pasted) {
  const c = { typed: Math.max(0, counts.typed || 0), pasted: Math.max(0, counts.pasted || 0), agent: Math.max(0, counts.agent || 0) };
  const d = changed(before, after);
  const total = c.typed + c.pasted + c.agent;
  if (d.removed > 0 && total > 0) {
    const take = Math.min(d.removed, total);
    const ta = Math.round((take * c.agent) / total);
    const tp = Math.round((take * c.pasted) / total);
    const tt = Math.max(0, take - ta - tp);
    c.agent = Math.max(0, c.agent - ta);
    c.pasted = Math.max(0, c.pasted - tp);
    c.typed = Math.max(0, c.typed - tt);
  }
  const p = Math.max(0, Math.min(d.added, Number(pasted) || 0));
  c.pasted += p;
  c.typed += d.added - p;
  return c;
}

/** Share of typed, pasted and agent-written characters in percent (whole numbers). */
function shares(t) {
  const all = (t.typed || 0) + (t.pasted || 0) + (t.agent || 0);
  const pct = (x) => (all === 0 ? 0 : Math.round((100 * x) / all));
  return { typed: pct(t.typed || 0), pasted: pct(t.pasted || 0), agent: pct(t.agent || 0), chars: all };
}

module.exports = { SCALES: SCALES, RULES: RULES, OUTCOMES: OUTCOMES, scale: scale, choiceOf: choiceOf, lean: lean, juniorFirst: juniorFirst, tally: tally, markers: markers, changed: changed, recount: recount, shares: shares };
