/// <reference path="../pb_data/types.d.ts" />
/**
 * The odds: an estimated chance of getting into the speedrun cohort.
 *
 * speedrun publishes no scoring model, so this is a transparent one built
 * from what speedrun says it reads (research of 2026-10-30): "We spend most
 * of our time on the team and bio section" (FAQ), "We probably spend 80% of
 * our time looking at the team and bio section" (Troy Kirwin), traction "isn't
 * required" but momentum counts, and the one-liner is a test in itself.
 *
 *   A Founders                   40   track record and signal, builds end-to-end,
 *                                     co-founders who built together, complementary
 *                                     skills, LinkedIn and shipped work linked
 *   B Insight                    15   earned secrets, founder-market fit, differentiation
 *   C Momentum                   20   stage, evidence people want it, growth
 *   D Communication              15   one-liner, the one-sentence test, specifics,
 *                                     the best news first and plain words, consistent numbers
 *   E Show us more               10   team video by speedrun's guide, deck, a website, every field
 *
 * Caps follow the sum (no founder can build it end-to-end 54, no founder
 * experience written 39, inconsistent or overstated claims 44, metrics that
 * cannot all be true 59, a part-time team not committed to the residency
 * 49), then modifiers (a referral +3). The score maps to five bands anchored
 * on speedrun's own figures: "Fewer than 0.4% of applicants are accepted"
 * (FAQ; over 19,000 pitches for SR006), so the middle of the field sits near
 * 0.4%. Confidence is low: no applicant-level data exists to calibrate it.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const BASE = 0.4;
const BANDS = [
  { min: 90, label: 'Exceptional', lo: 5, hi: 15, rank: 'Top 1% of applicants' },
  { min: 75, label: 'Strong', lo: 1.5, hi: 5, rank: 'Top 5% of applicants' },
  { min: 60, label: 'Above the base rate', lo: 0.5, hi: 1.5, rank: 'Top 20% of applicants' },
  { min: 45, label: 'Near the base rate', lo: 0.2, hi: 0.5, rank: 'Like most applicants' },
  { min: 0, label: 'Long shot', lo: 0.05, hi: 0.2, rank: 'Bottom half of applicants' },
];

function bandOf(score) {
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    if (score >= b.min) {
      const top = i === 0 ? 100 : BANDS[i - 1].min - 1;
      const t = top === b.min ? 1 : (score - b.min) / (top - b.min);
      const pct = Math.exp(Math.log(b.lo) + t * (Math.log(b.hi) - Math.log(b.lo)));
      return { band: b.label, lo: b.lo, hi: b.hi, rank: b.rank, percent: Math.round(pct * 100) / 100 };
    }
  }
  const last = BANDS[BANDS.length - 1];
  return { band: last.label, lo: last.lo, hi: last.hi, rank: last.rank, percent: last.lo };
}

function compute(F) {
  const C = L('lib_checks');
  const R = F.review;
  const fs = F.founders;
  const n = fs.length;
  const cf = F.settings.confirms || {};
  const pend = (x) => R === null || x === null || x === undefined;
  const groups = [];
  const g = (key, label, max) => {
    const grp = { key: key, label: label, max: max, got: 0, items: [] };
    groups.push(grp);
    return (id, text, got, of, note, pending, check) => {
      const v = Math.max(0, Math.min(of, got));
      grp.items.push({ id: id, label: text, got: Math.round(v * 10) / 10, max: of, note: note || '', pending: !!pending, check: check || '' });
      grp.got += v;
    };
  };
  const judged = F.items.filter((a) => a.open && a.value !== '' && a.judged && a.judge && Array.isArray(a.judge.issues));
  const issueCount = (types) => judged.filter((a) => a.judge.issues.some((i) => types.indexOf(i.type) >= 0)).length;

  /* A. Founders (40) */
  const A = g('team', 'Founders', 40);
  const exp = fs.map((f) => F.a['fp.' + f.id + '.experience']).filter((a) => a && a.value !== '');
  if (exp.length === 0) A('signal', 'Track record', 0, 16, 'No founder\'s experience is written yet', false, 'team_experience');
  else A('signal', 'Track record', pend(R && R.founder_signal) ? 0 : [2, 7, 12, 16][R.founder_signal], 16, pend(R && R.founder_signal) ? 'Waiting for the review' : R.founder_signal_why, pend(R && R.founder_signal), 'team_signal');
  const tech = fs.some((f) => f.technical === true);
  const noTech = n > 0 && !tech && fs.every((f) => f.technical === false);
  const outsourced = issueCount(['outsourced']) > 0 || (R !== null && R.builders_are_founders === false);
  A('builds', tech ? (outsourced ? 'Technical founder, built by others' : 'A founder builds it end-to-end') : noTech ? 'Nobody builds it end-to-end' : 'Who builds it is not given', !tech ? 0 : outsourced ? 4 : 8, 8, '', false, 'team_technical');
  const teamText = F.v('t_team') !== '';
  if (n >= 2) {
    const hist = !teamText ? 0 : pend(R && R.team_history) ? 0 : [1, 3, 5][R.team_history];
    A('together', 'Co-founders who built together', 2 + hist, 7, !teamText ? 'The team answer is not written yet' : pend(R && R.team_history) ? 'Waiting for the review' : ['Just met', 'Know each other', 'Built or worked together'][R.team_history], teamText && pend(R && R.team_history), 'team_history');
  } else A('together', n === 1 ? 'Solo founder' : 'Co-founders who built together', n === 1 ? 2 : 0, 7, n === 1 ? 'speedrun prefers teams, and takes solo founders with a strong record' : '', false, 'team_size');
  A('complementary', 'Complementary skills', pend(R && R.complementary) ? 0 : R.complementary ? 4 : 1, 4, pend(R && R.complementary) ? 'Waiting for the review' : R.complementary_why, pend(R && R.complementary), 'team_complementary');
  const linked = n > 0 && fs.every((f) => f.linkedin !== '');
  const shipped = fs.filter((f) => f.technical === true).every((f) => f.github !== '' || f.website !== '');
  A('links', 'LinkedIn and shipped work linked', (linked ? 3 : 0) + (tech && shipped ? 2 : 0), 5, linked ? '' : 'A founder has no LinkedIn', false, 'founder_linkedin');

  /* B. Insight (15) */
  const B = g('idea', 'Insight', 15);
  B('secret', 'Earned secret', pend(R && R.insight) ? 0 : [0, 2, 4, 6][R.insight], 6, pend(R && R.insight) ? 'Waiting for the review' : R.insight_why, pend(R && R.insight), 'earned_insight');
  B('fit', 'Founder-market fit', pend(R && R.founder_market_fit) ? 0 : [0, 2, 4, 5][R.founder_market_fit], 5, pend(R && R.founder_market_fit) ? 'Waiting for the review' : R.founder_market_fit_why, pend(R && R.founder_market_fit), 'founder_market_fit');
  B('different', 'Differentiation', pend(R && R.differentiation) ? 0 : [0, 2, 4][R.differentiation], 4, pend(R && R.differentiation) ? 'Waiting for the review' : R.differentiation_why, pend(R && R.differentiation), 'differentiation');

  /* C. Momentum (20) */
  const Cg = g('momentum', 'Momentum', 20);
  const launched = F.v('x_has_traction') === 'yes';
  const arr = F.n('x_arr') || 0;
  const users = Math.max(F.n('x_mau') || 0, F.n('x_wau') || 0, F.n('x_dau') || 0);
  const stage = arr >= 100000 ? 12 : arr > 0 ? 9 : launched && users > 0 ? 7 : launched ? 5 : F.v('s_website') !== '' ? 2 : 0;
  Cg('stage', arr >= 100000 ? '$' + L('lib_util').thousands(arr) + ' ARR' : arr > 0 ? 'Recurring revenue' : launched && users > 0 ? 'Launched, with active users' : launched ? 'Launched' : F.v('s_website') !== '' ? 'Prototype' : 'Idea', stage, 12, '', false, 'traction_data');
  Cg('demand', 'Signs people want it', pend(R && R.demand) ? 0 : [0, 2, 4, 5][R.demand], 5, pend(R && R.demand) ? 'Waiting for the review' : R.demand_why, pend(R && R.demand), 'momentum');
  const gr = Math.max(F.n('x_rev_growth') || 0, F.n('x_user_growth') || 0);
  const grGiven = F.n('x_rev_growth') !== null || F.n('x_user_growth') !== null;
  Cg('growth', 'Growth', !grGiven ? 0 : gr >= 20 ? 3 : gr >= 10 ? 2 : gr > 0 ? 1 : 0, 3, grGiven ? gr + '% a month' : 'Not given', false, 'growth_shown');

  /* D. Communication (15) */
  const Dg = g('writing', 'Writing', 15);
  const one = F.a.s_oneliner;
  const oneClear = one && one.value !== '' && one.measures.chars <= 100 && one.judge && one.judge.clear && !one.judge.issues.some((i) => i.type === 'marketing' || i.type === 'jargon' || i.type === 'vague');
  Dg('one_liner', 'Plain one-liner', oneClear ? 4 : one && one.value !== '' && one.judge ? 1 : 0, 4, '', one && one.value !== '' && !one.judge, 'one_liner_clear');
  Dg('restate', 'Explained in one sentence', pend(R) ? 0 : R.one_liner_clear ? 3 : 0, 3, R !== null ? R.one_liner_restated : 'Waiting for the review', pend(R), 'one_sentence');
  const vague = issueCount(['vague', 'no_numbers', 'weak_proof', 'undersold']);
  Dg('specific', 'Specific, at full size', judged.length === 0 ? 0 : vague === 0 ? 3 : vague <= 2 ? 2 : 1, 3, vague > 0 ? vague + ' answers vague or undersold' : '', judged.length === 0, 'specific');
  const tells = F.items.filter((a) => a.open && a.value !== '' && (a.measures.em_dashes > 0 || a.measures.long)).length + issueCount(['marketing', 'jargon', 'buried_lede']);
  Dg('plain', 'Best news first, plain words', judged.length === 0 ? 0 : Math.max(0, 3 - tells), 3, tells > 0 ? tells + ' answers with hype, length or the lede buried' : '', judged.length === 0, 'bottom_line_first');
  const bad = R === null ? 0 : R.inconsistencies.length + R.overclaims.length;
  Dg('consistent', 'Consistent and honest', pend(R) ? 0 : bad === 0 ? 2 : 0, 2, bad > 0 ? bad + ' found' : '', pend(R), 'consistent');

  /* E. Show us more (10) */
  const E = g('more', 'Show us more', 10);
  const video = F.v('x_video') !== '';
  const rules = ['under_3_min', 'half_on_team', 'covers_rest', 'own_voice'].every((k) => cf[k] === true);
  E('video', 'Team video by speedrun\'s guide', (video ? 3 : 0) + (video && rules ? 1 : 0), 4, video ? (rules ? '' : 'Guide not all confirmed') : 'No video', false, 'video');
  E('deck', 'Deck with a team slide', F.v('x_deck') !== '' ? 2 : 0, 2, '', false, 'deck');
  E('website', 'A website partners can open', F.v('s_website') !== '' ? 2 : 0, 2, '', false, 'website');
  const gaps = C.founderGaps(F);
  E('fields', 'Every field filled', F.counts.missing === 0 && F.counts.answered > 0 && gaps.length === 0 ? 2 : 0, 2, F.counts.missing > 0 ? F.counts.missing + ' missing' : gaps.length > 0 ? 'Founder details missing' : '', false, 'complete');

  let score = 0;
  for (const grp of groups) {
    grp.got = Math.round(grp.got * 10) / 10;
    score += grp.got;
  }
  const raw = Math.round(score);

  /* caps */
  const caps = [];
  const cap = (limit, why, check) => {
    if (score > limit) caps.push({ limit: limit, why: why, check: check });
  };
  if (n > 0 && exp.length === 0) cap(39, 'No founder\'s experience written', 'team_experience');
  if (noTech) cap(54, 'Nobody on the team builds it end-to-end', 'team_technical');
  if (bad > 0) cap(44, 'Inconsistent or overstated claims', 'consistent');
  if (C.metricProblems(F).length > 0) cap(59, 'Metrics that cannot all be true', 'metrics_sane');
  if (fs.some((f) => f.full_time === false) && cf.full_time_if_accepted !== true) cap(49, 'A part-time founder, not committed to the residency', 'team_full_time');
  for (const c of caps) score = Math.min(score, c.limit);

  /* modifiers */
  const mods = [];
  const mod = (delta, why) => {
    mods.push({ delta: delta, why: why });
    score += delta;
  };
  if (F.v('x_referred') === 'yes' && L('lib_answers').rowsOf(F.v('x_referrals')).length > 0) mod(3, 'Referred by someone speedrun trusts');
  score = Math.max(0, Math.min(100, Math.round(score)));

  const pending = groups.reduce((s, grp) => s + grp.items.filter((i) => i.pending).length, 0);
  const unscorable = one && one.value !== '' && one.measures.chars > 100;
  const b = bandOf(score);

  /* The moves worth most: the biggest gaps between points held and points possible. */
  const gaps2 = [];
  for (const grp of groups) for (const it of grp.items) if (!it.pending && it.max - it.got >= 1) gaps2.push({ id: it.id, label: it.label, gain: Math.round((it.max - it.got) * 10) / 10, check: it.check, group: grp.label });
  for (const c of caps) gaps2.push({ id: 'cap_' + c.check, label: c.why, gain: Math.round(raw - c.limit), check: c.check, group: 'Cap' });
  gaps2.sort((x, y) => y.gain - x.gain);

  return {
    // Too little is known for a number until there is a team and a few answers.
    ready: n > 0 && F.counts.answered >= 5,
    score: score,
    raw: raw,
    percent: unscorable ? null : b.percent,
    range: [b.lo, b.hi],
    band: unscorable ? 'Not scorable' : b.band,
    rank: unscorable ? 'Fit the one-liner in 100 characters first' : b.rank,
    base_percent: BASE,
    confidence: 'low',
    pending: pending,
    groups: groups,
    caps: caps,
    modifiers: mods,
    moves: gaps2.slice(0, 3),
    all_moves: gaps2,
    unit: 'Scores and gains are points out of 100.',
    note: 'Estimated from what speedrun publishes: fewer than 0.4% of applicants get in, and partners spend most of their time on the team and bio section. speedrun publishes no scoring model; treat this as a rough guide, not a prediction.',
  };
}

/** The odds as callers see them; the full move list stays internal (status orders fixes with it). */
function shown(odds) {
  const out = Object.assign({}, odds);
  delete out.all_moves;
  return out;
}

function get(ctx) {
  return shown(compute(L('lib_checks').facts(ctx.app)));
}

module.exports = { BANDS: BANDS, BASE: BASE, compute: compute, shown: shown, get: get };
