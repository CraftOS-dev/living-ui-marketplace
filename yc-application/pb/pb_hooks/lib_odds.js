/// <reference path="../pb_data/types.d.ts" />
/**
 * The odds: an estimated chance of getting into the batch.
 *
 * YC publishes no model ("There's no secret machine learning model"), so
 * this is a transparent one built from public evidence (research note
 * yc_do_it_right_checklist.md, section 3.5):
 *
 *   A Team structure and commitment   15   two or three founders, full-time,
 *                                          history together, fair equity and vesting
 *   B Builds in-house                 15   a technical founder wrote the product
 *   C Founder signal                  20   the most impressive thing, things built, the hack story
 *   D Progress and traction           20   stage, growth, evidence of demand
 *   E Idea and insight                10   insight, competitors, founder-market fit, money
 *   F Communication                   15   one-liner, restate test, specifics,
 *                                          concise and human, consistent numbers
 *   G Completeness                     5   the video by YC's rules, a demo, every field
 *
 * Caps follow the sum (no video 54, no technical founder 59, inconsistent or
 * overstated claims 44, a part-time founder not committed to full-time 44),
 * then modifiers (reapplying with progress +5 or without -5, a genuine
 * recommendation +3, late -3, evidence of building with AI +2). The score
 * maps to five bands anchored on YC's own figures: about 1% of applications
 * are funded (2023-2024 batch posts), and historically about 28% of
 * interviewed teams were funded, which bounds the top band at 35%.
 * Confidence is low: no 2025-2026 applicant data exists to calibrate it.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const BANDS = [
  { min: 90, label: 'Exceptional', lo: 15, hi: 35, rank: 'Top 2% of applicants' },
  { min: 75, label: 'Strong', lo: 5, hi: 15, rank: 'Top 10% of applicants' },
  { min: 60, label: 'Above the base rate', lo: 1.5, hi: 5, rank: 'Top 25% of applicants' },
  { min: 45, label: 'Near the base rate', lo: 0.5, hi: 1.5, rank: 'Like most applicants' },
  { min: 0, label: 'Long shot', lo: 0.2, hi: 0.5, rank: 'Bottom half of applicants' },
];

function bandOf(score) {
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    if (score >= b.min) {
      const top = i === 0 ? 100 : BANDS[i - 1].min - 1;
      const t = top === b.min ? 1 : (score - b.min) / (top - b.min);
      const pct = Math.exp(Math.log(b.lo) + t * (Math.log(b.hi) - Math.log(b.lo)));
      return { band: b.label, lo: b.lo, hi: b.hi, rank: b.rank, percent: Math.round(pct * 10) / 10 };
    }
  }
  return { band: 'Long shot', lo: 0.2, hi: 0.5, rank: 'Bottom half of applicants', percent: 0.2 };
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
  const judged = F.items.filter((a) => a.open && a.value !== '' && a.judged && a.judge_current && a.judge && Array.isArray(a.judge.issues));
  const issueCount = (types) => judged.filter((a) => a.judge.issues.some((i) => types.indexOf(i.type) >= 0)).length;
  const strengthOf = (key) => {
    const a = F.a[key];
    return a && a.judge_current && a.judge ? a.judge.strength : null;
  };

  /* A. Team structure and commitment (15) */
  const A = g('team', 'Team', 15);
  A('size', n === 1 ? 'Solo founder' : n >= 4 ? n + ' founders' : n === 0 ? 'No founders yet' : n + ' cofounders', n >= 2 && n <= 3 ? 6 : n >= 4 ? 4 : n === 1 ? 2 : 0, 6, 'Two or three founders is what YC sees most', false, 'team_size');
  const allFull = n > 0 && fs.every((f) => f.full_time === true);
  const knownPart = fs.some((f) => f.full_time === false);
  const ftUnknown = fs.some((f) => f.full_time === null);
  A('full_time', allFull ? 'All full-time' : cf.full_time_if_accepted ? 'Full-time if accepted' : knownPart ? 'Not all full-time' : 'Full-time not given', allFull ? 4 : cf.full_time_if_accepted ? 2 : 0, 4, !allFull && !knownPart && ftUnknown ? 'Say on the team page who works on it full-time' : '', false, 'team_full_time');
  const knownEmpty = F.v('f_known') === '';
  if (n >= 2 && knownEmpty) A('history', 'History together', 0, 3, 'How you met is not answered yet', false, 'team_history');
  else if (n >= 2) A('history', 'History together', pend(R && R.team_history) ? 0 : [0, 2, 3][R.team_history], 3, pend(R && R.team_history) ? 'Waiting for the review' : ['Just met', 'Know each other', 'Built or worked together'][R.team_history], pend(R && R.team_history), 'team_history');
  else A('history', 'History together', 0, 3, n === 1 ? 'Solo' : '', false, 'team_history');
  const eqs = fs.filter((f) => f.equity > 0).map((f) => f.equity);
  const fair = eqs.length >= 2 && Math.min.apply(null, eqs) >= 10 && Math.max.apply(null, eqs) / Math.min.apply(null, eqs) <= 3;
  A('equity', 'Fair equity and vesting', (fair || (n === 1 && eqs.length === 1) ? 1 : 0) + (cf.vesting ? 1 : 0), 2, '', false, 'team_equity_fair');

  /* B. Builds in-house (15) */
  const B = g('build', 'Builds in-house', 15);
  const tech = fs.some((f) => f.technical === true);
  const noTech = n > 0 && !tech && fs.every((f) => f.technical === false);
  const outsourced = issueCount(['outsourced']) > 0 || (R !== null && R.builders_are_founders === false);
  B('builders', tech ? (outsourced ? 'Technical founder, code by others' : 'A founder writes the code') : noTech ? 'No technical founder' : 'Who writes the code is not given', !tech ? 0 : outsourced ? 7 : 15, 15, 'Partners read the team first, for technical excellence', false, 'team_technical');

  /* C. Founder signal (20) */
  const Cg = g('signal', 'Founder signal', 20);
  const impressive = fs.map((f) => F.a['fp.' + f.id + '.impressive']).filter((a) => a && a.value !== '');
  if (impressive.length === 0) Cg('impressive', 'Most impressive thing', 0, 10, 'No founder has written it yet', false, 'team_signal');
  else Cg('impressive', 'Most impressive thing', pend(R && R.founder_signal) ? 0 : [0, 4, 7, 10][R.founder_signal], 10, pend(R && R.founder_signal) ? 'Waiting for the review' : R.founder_signal_why, pend(R && R.founder_signal), 'team_signal');
  const built = fs.map((f) => F.a['fp.' + f.id + '.built']).filter((a) => a && a.value !== '');
  const builtStrength = built.reduce((m, a) => Math.max(m, a.judge_current && a.judge ? a.judge.strength : 1), -1);
  Cg('built', 'Things built before', built.length === 0 ? 0 : builtStrength >= 2 ? 6 : 3, 6, built.length === 0 ? 'Not given' : '', false, 'founder_things_built');
  const hacks = fs.map((f) => F.a['fp.' + f.id + '.hack']).filter((a) => a && a.value !== '');
  const hackStrength = hacks.reduce((m, a) => Math.max(m, a.judge_current && a.judge ? a.judge.strength : 1), -1);
  Cg('hack', 'The hack story', hacks.length === 0 ? 0 : hackStrength >= 2 ? 4 : 2, 4, hacks.length === 0 ? 'Not given' : '', false, 'team_hack');

  /* D. Progress and traction (20) */
  const D = g('progress', 'Progress', 20);
  const using = F.v('p_using') === 'yes';
  const hasLink = F.v('c_product') !== '' || F.v('c_demo') !== '';
  const series = C.revenueSeries(F);
  const last = series.length > 0 ? series[series.length - 1].value : 0;
  const paying = F.v('p_revenue') === 'yes' && series.some((s) => s.value > 0);
  const stage = paying && last >= 10000 ? 12 : paying ? 9 : using ? 6 : hasLink ? 3 : 0;
  D('stage', paying && last >= 10000 ? '$' + L('lib_util').thousands(last) + ' last month' : paying ? 'Paying customers' : using ? 'Launched, with users' : hasLink ? 'Prototype' : 'Idea', stage, 12, '', false, 'has_users');
  const gr = C.growth(series);
  D('growth', 'Growth', gr === null ? 0 : gr >= 0.2 ? 5 : gr > 0 ? 3 : 0, 5, gr === null ? 'Not measurable yet' : Math.round(gr * 100) + '% a month', false, 'growth');
  D('demand', 'Evidence of demand', pend(R && R.demand) ? 0 : R.demand, 3, pend(R && R.demand) ? 'Waiting for the review' : R.demand_why, pend(R && R.demand), 'has_users');

  /* E. Idea and insight (10) */
  const E = g('idea', 'Idea', 10);
  E('insight', 'Insight', pend(R && R.insight) ? 0 : [0, 1, 3, 4][R.insight], 4, pend(R && R.insight) ? 'Waiting for the review' : R.insight_why, pend(R && R.insight), 'insight');
  const compOk = F.v('i_competitors') !== '' && issueCount(['no_competitors']) === 0;
  E('competitors', 'Competitors named', compOk ? 2 : 0, 2, '', false, 'competitors');
  E('fit', 'Founder-market fit', pend(R && R.founder_market_fit) ? 0 : [0, 1, 2, 2][R.founder_market_fit], 2, pend(R && R.founder_market_fit) ? 'Waiting for the review' : R.founder_market_fit_why, pend(R && R.founder_market_fit), 'founder_market_fit');
  const moneyOk = F.v('i_money') !== '' && issueCount(['top_down_market']) === 0;
  E('money', 'How it makes money', moneyOk ? 2 : 0, 2, '', false, 'bottom_up');

  /* F. Communication (15) */
  const Fg = g('writing', 'Writing', 15);
  const descS = strengthOf('c_desc');
  const desc = F.a.c_desc;
  const descClear = desc && desc.value !== '' && desc.measures.chars <= 50 && desc.judge_current && desc.judge && desc.judge.clear && !desc.judge.issues.some((i) => i.type === 'marketing' || i.type === 'jargon' || i.type === 'vague');
  Fg('one_liner', 'Concrete one-liner', descClear ? 4 : desc && desc.value !== '' && descS === null ? 0 : desc && desc.value !== '' ? 1 : 0, 4, '', desc && desc.value !== '' && !desc.judge_current, 'one_liner_clear');
  Fg('restate', 'Explained in one sentence', pend(R) ? 0 : R.one_liner_clear ? 3 : 0, 3, R !== null ? R.one_liner_restated : 'Waiting for the review', pend(R), 'one_sentence');
  const vague = issueCount(['vague', 'no_numbers', 'weak_proof']);
  Fg('specific', 'Specific', judged.length === 0 ? 0 : vague === 0 ? 3 : vague <= 2 ? 2 : 1, 3, vague > 0 ? vague + ' vague answers' : '', judged.length === 0, 'specific');
  const tells = F.items.filter((a) => a.open && a.value !== '' && (a.measures.em_dashes > 0 || a.measures.long)).length + issueCount(['marketing', 'jargon', 'ai_voice']);
  Fg('human', 'Concise, plain, human', judged.length === 0 ? 0 : Math.max(0, 3 - tells), 3, tells > 0 ? tells + ' answers with hype, length or AI tells' : '', judged.length === 0, 'no_marketing');
  const bad = R === null ? 0 : R.inconsistencies.length + R.overclaims.length;
  Fg('consistent', 'Consistent and honest', pend(R) ? 0 : bad === 0 ? 2 : 0, 2, bad > 0 ? bad + ' found' : '', pend(R), 'consistent');

  /* G. Completeness (5) */
  const G = g('complete', 'Complete', 5);
  const video = F.v('f_video') !== '';
  const rules = ['one_minute', 'all_founders', 'unscripted', 'no_extras'].every((k) => cf[k] === true);
  G('video', 'Founder video by YC\'s rules', (video ? 2 : 0) + (video && rules ? 1 : 0), 3, video ? (rules ? '' : 'Rules not all confirmed') : 'No video', false, 'video');
  G('demo', 'Demo or product link', hasLink ? 1 : 0, 1, '', false, 'demo');
  G('fields', 'Every field filled', F.counts.missing === 0 && F.counts.answered > 0 ? 1 : 0, 1, F.counts.missing > 0 ? F.counts.missing + ' missing' : '', false, 'complete');

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
  if (!video) cap(54, 'No founder video', 'video');
  if (noTech) cap(59, 'No technical founder', 'team_technical');
  if (bad > 0) cap(44, 'Inconsistent or overstated claims', 'consistent');
  if (knownPart && !cf.full_time_if_accepted) cap(44, 'A founder is part-time and not committed to full-time', 'team_full_time');
  for (const c of caps) score = Math.min(score, c.limit);

  /* modifiers */
  const mods = [];
  const mod = (delta, why) => {
    mods.push({ delta: delta, why: why });
    score += delta;
  };
  if (F.v('p_prev') === 'yes') {
    if (F.v('p_prev_change') !== '') mod(5, 'Reapplying with progress');
    else mod(-5, 'Reapplying without showing what changed');
  }
  if (F.settings.recommended) mod(3, 'Recommended by a YC founder');
  const deadline = F.settings.deadline ? Date.parse(F.settings.deadline) : NaN;
  if (Number.isFinite(deadline) && Date.now() > deadline && F.settings.status === 'preparing') mod(-3, 'After the deadline');
  if (F.v('p_session') !== '') mod(2, 'Evidence of building with AI');
  score = Math.max(0, Math.min(100, Math.round(score)));

  const pending = groups.reduce((s, grp) => s + grp.items.filter((i) => i.pending).length, 0);
  const unscorable = F.v('c_desc') !== '' && F.a.c_desc.measures.chars > 50;
  const b = bandOf(score);

  /* The moves worth most: the biggest gaps between points held and points possible. */
  const gaps = [];
  for (const grp of groups) for (const it of grp.items) if (!it.pending && it.max - it.got >= 1) gaps.push({ id: it.id, label: it.label, gain: Math.round((it.max - it.got) * 10) / 10, check: it.check, group: grp.label });
  for (const c of caps) gaps.push({ id: 'cap_' + c.check, label: c.why, gain: Math.round(raw - c.limit), check: c.check, group: 'Cap' });
  gaps.sort((x, y) => y.gain - x.gain);

  return {
    // Too little is known for a number until there is a team and a few answers.
    ready: n > 0 && F.counts.answered >= 5,
    score: score,
    raw: raw,
    percent: unscorable ? null : b.percent,
    range: [b.lo, b.hi],
    band: unscorable ? 'Not scorable' : b.band,
    rank: unscorable ? 'Fit the one-liner in 50 characters first' : b.rank,
    base_percent: 1,
    confidence: 'low',
    pending: pending,
    groups: groups,
    caps: caps,
    modifiers: mods,
    moves: gaps.slice(0, 3),
    all_moves: gaps,
    unit: 'Scores and gains are points out of 100.',
    note: 'Estimated from public YC statements and batch statistics. YC publishes no scoring model; treat this as a rough guide, not a prediction.',
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

module.exports = { BANDS: BANDS, compute: compute, shown: shown, get: get };
