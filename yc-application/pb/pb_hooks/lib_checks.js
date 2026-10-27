/// <reference path="../pb_data/types.d.ts" />
/**
 * The checks: did the founders do everything right? Each check comes from
 * YC's own guidance (the apply page, the FAQ, the video page, Paul Graham's
 * "How to Apply", partners' talks) and is decided one of two ways:
 *
 *   - from structured facts: founder count, technical and full-time flags,
 *     equity, yes/no answers, numbers, character and word counts;
 *   - from the reviewer's structured verdicts (lib_judge): marketing speak,
 *     vagueness, overclaims, founder signal, inconsistencies.
 *
 * Nothing here matches words in the founders' text. A check whose verdict
 * is still being reviewed reads "wait". Checks marked `first` are things to
 * do before applying (find a technical cofounder, get users, record the
 * video), and they make the "Do these first" list.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const GROUPS = [
  { key: 'before', label: 'Before you apply' },
  { key: 'team', label: 'Team' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'progress', label: 'Progress' },
  { key: 'idea', label: 'Idea' },
  { key: 'video', label: 'Video' },
  { key: 'form', label: 'Form' },
];
const SEVERITY = { blocker: 0, warning: 1, tip: 2 };
const COFOUNDER_MATCHING = 'https://www.ycombinator.com/cofounder-matching';

/** Everything the checks and the odds read, gathered once. */
function facts(app) {
  const S = L('lib_store');
  const A = L('lib_answers');
  const U = L('lib_util');
  const items = A.all(app);
  const byKey = {};
  for (const a of items) byKey[a.key] = a;
  const srec = S.settings(app);
  const settings = S.settingsView(srec);
  const review = srec.getString('review_state') === 'done' ? U.json(srec, 'review', null) : null;
  return {
    founders: S.founders(app),
    items: items,
    a: byKey,
    v: (k) => (byKey[k] ? byKey[k].value : ''),
    settings: settings,
    review: review,
    reviewState: srec.getString('review_state') || 'none',
    counts: A.counts(items),
    progress: L('lib_judge').progress(app),
  };
}

/** Answers reviewed and current, with their issues. */
function judged(F) {
  return F.items.filter((a) => a.open && a.value !== '' && a.judged && a.judge_current && a.judge && Array.isArray(a.judge.issues));
}

function pendingJudges(F) {
  return F.items.filter((a) => a.open && a.value !== '' && a.judged && !a.judge_current && a.judge_state !== 'error').length;
}

function withIssue(F, types) {
  return judged(F).filter((a) => a.judge.issues.some((i) => types.indexOf(i.type) >= 0));
}

/** A question by its short name ("One-liner", "Jane Chen: Hack story"). */
function labelOf(a) {
  const short = L('lib_questions').shortOf(a.key);
  return a.founder_name ? a.founder_name + ': ' + short : short;
}

function keysText(list) {
  return list.slice(0, 4).map(labelOf).join('; ') + (list.length > 4 ? '; and ' + (list.length - 4) + ' more' : '');
}

function money(n) {
  return '$' + L('lib_util').thousands(n);
}

/** Monthly revenue values, oldest first. */
function revenueSeries(F) {
  const raw = F.v('p_revenue_months');
  if (raw === '') return [];
  let o = {};
  try {
    o = JSON.parse(raw);
  } catch {
    return [];
  }
  return Object.keys(o)
    .sort()
    .map((k) => ({ month: k, value: Number(o[k]) || 0 }));
}

/** Average month-over-month growth across the months with revenue (null when it cannot be measured). */
function growth(series) {
  const s = series.filter((m) => m.value > 0);
  if (s.length < 3) return null;
  const first = s[0].value;
  const last = s[s.length - 1].value;
  const steps = s.length - 1;
  return Math.pow(last / first, 1 / steps) - 1;
}

function run(app) {
  const F = facts(app);
  const out = [];
  const add = (c) => out.push(Object.assign({ first: false, link: '', target: null, detail: '' }, c));
  const fs = F.founders;
  const n = fs.length;
  const review = F.review;
  const waitReview = review === null;
  // The whole-application read starts once there are a few answers.
  const reviewable = F.counts.answered >= 3;

  /* ---------------------------------------------------------------- team */
  add({
    id: 'team_founders',
    group: 'team',
    title: 'Every founder is on the team page',
    severity: 'blocker',
    status: n > 0 ? 'pass' : 'fail',
    detail: n > 0 ? n + (n === 1 ? ' founder' : ' founders') : 'No founders yet',
    fix: 'Add each founder (your AI agent can add them from your links and files).',
    target: { kind: 'team' },
  });
  add({
    id: 'team_size',
    group: 'team',
    title: 'Two or three cofounders',
    severity: 'warning',
    status: n === 0 ? 'na' : n >= 2 && n <= 3 ? 'pass' : 'fail',
    detail: n === 1 ? 'Solo founder' : n + ' founders',
    fix: n >= 4 ? 'With four or more founders, make each role and the equity split obvious.' : 'Find a cofounder you trust, ideally one you have built something with. YC accepts solo founders (about one in ten funded companies), but most funded teams have two or three.',
    first: n === 1,
    link: n === 1 ? COFOUNDER_MATCHING : '',
    why: 'YC FAQ: "We regularly accept solo founders", yet most funded teams have two or three founders.',
    target: { kind: 'team' },
  });
  if (n >= 4) out[out.length - 1].severity = 'tip';
  const tech = fs.filter((f) => f.technical === true);
  const techUnknown = fs.filter((f) => f.technical === null);
  const noTech = n > 0 && tech.length === 0 && techUnknown.length === 0;
  add({
    id: 'team_technical',
    group: 'team',
    title: 'A technical founder builds the product',
    severity: noTech ? 'blocker' : 'warning',
    status: n === 0 ? 'na' : tech.length > 0 ? 'pass' : 'fail',
    detail: tech.length > 0 ? tech.map((f) => f.name).join(', ') : noTech ? 'No founder writes the code' : 'Not given for ' + techUnknown.map((f) => f.name).join(', '),
    fix: noTech ? 'Find a technical cofounder who writes the code. Partners read the team first and look for technical excellence.' : 'Say on the team page which founders write the code.',
    first: noTech,
    link: noTech ? COFOUNDER_MATCHING : '',
    why: 'Dalton Caldwell: "The first thing I look at when I read an application is the team. What I\'m looking for is technical excellence on the team."',
    target: { kind: 'team' },
  });
  const part = fs.filter((f) => f.full_time === false);
  const ftUnknown = fs.filter((f) => f.full_time === null);
  add({
    id: 'team_full_time',
    group: 'team',
    title: 'Every founder works on it full-time',
    severity: 'warning',
    status: n === 0 ? 'na' : part.length === 0 && ftUnknown.length === 0 ? 'pass' : 'fail',
    detail: part.length > 0 ? 'Part-time: ' + part.map((f) => f.name).join(', ') : ftUnknown.length > 0 ? 'Not given for ' + ftUnknown.map((f) => f.name).join(', ') : 'All full-time',
    fix: part.length > 0 ? 'Go full-time before you apply, or say exactly when you will. Partners see part-time teams as not yet committed.' : 'Say on the team page whether each founder works on it full-time.',
    first: part.length > 0,
    why: 'Dalton Caldwell lists "The team doesn\'t seem committed or serious about doing a startup" as a red flag.',
    target: { kind: 'team' },
  });
  const noEq = fs.filter((f) => !(f.equity > 0));
  let total = 0;
  for (const f of fs) total += f.equity > 0 ? f.equity : 0;
  add({
    id: 'team_equity',
    group: 'team',
    title: 'Each founder\'s equity is given and adds up',
    severity: total > 100.01 ? 'blocker' : 'warning',
    status: n === 0 ? 'na' : noEq.length === 0 && total <= 100.01 ? 'pass' : 'fail',
    detail: total > 100.01 ? 'Equity adds up to ' + Math.round(total * 100) / 100 + '%' : noEq.length > 0 ? 'Missing for ' + noEq.map((f) => f.name).join(', ') : 'Founders hold ' + Math.round(total * 100) / 100 + '%',
    fix: 'Give every founder\'s percent on the team page; together they cannot pass 100%.',
    target: { kind: 'team' },
  });
  const eqs = fs.filter((f) => f.equity > 0).map((f) => f.equity);
  const minEq = eqs.length > 0 ? Math.min.apply(null, eqs) : 0;
  const maxEq = eqs.length > 0 ? Math.max.apply(null, eqs) : 0;
  add({
    id: 'team_equity_fair',
    group: 'team',
    title: 'The equity split is fair between founders',
    severity: 'warning',
    status: eqs.length < 2 ? 'na' : minEq >= 10 && maxEq / minEq <= 3 ? 'pass' : 'fail',
    detail: eqs.length < 2 ? '' : 'From ' + minEq + '% to ' + maxEq + '%',
    fix: 'Founders should each hold a meaningful share (at least 10%). If the split is very uneven, say why in the equity answer.',
    why: 'A 2023 alum walkthrough reports "Founders must have at least 10% equity"; partners ask about lopsided splits.',
    target: { kind: 'team' },
  });
  const outsourced = withIssue(F, ['outsourced']);
  add({
    id: 'team_builders',
    group: 'team',
    title: 'The founders build the product themselves',
    severity: 'warning',
    status: n === 0 || F.v('f_tech') === '' ? 'na' : outsourced.length > 0 || (review !== null && review.builders_are_founders === false) ? 'fail' : waitReview && pendingJudges(F) > 0 ? 'wait' : 'pass',
    detail: F.v('f_tech') === '' ? 'Who writes the code is not answered yet' : outsourced.length > 0 ? 'Reads as built by non-founders' : '',
    fix: 'A product built by contractors is a red flag. Founders should write the code; disclose any outside work and who owns it.',
    first: outsourced.length > 0,
    target: { kind: 'answer', key: 'f_tech' },
  });
  add({
    id: 'team_history',
    group: 'team',
    title: 'The founders know each other well',
    severity: 'warning',
    status: n < 2 || F.v('f_known') === '' ? 'na' : waitReview ? 'wait' : review.team_history === 0 ? 'fail' : 'pass',
    detail: F.v('f_known') === '' ? 'How you met is not answered yet' : review !== null && review.team_history === 0 ? 'Reads as founders who just met' : '',
    fix: 'Say how long you have known each other and what you built together. Teams who just met are a known risk; work on something together first.',
    target: { kind: 'answer', key: 'f_known' },
  });
  const noImpressive = fs.filter((f) => F.v('fp.' + f.id + '.impressive') === '');
  add({
    id: 'team_impressive',
    group: 'team',
    title: 'Each founder names the most impressive thing they built or achieved',
    severity: 'blocker',
    status: n === 0 ? 'na' : noImpressive.length === 0 ? 'pass' : 'fail',
    detail: noImpressive.length === 0 ? '' : 'Missing for ' + noImpressive.map((f) => f.name).join(', '),
    fix: 'One or two sentences per founder with proof: numbers, users, rank, links.',
    keys: noImpressive.map((f) => 'fp.' + f.id + '.impressive'),
    why: 'Paul Graham calls it "the most important question on the application".',
    target: { kind: 'team' },
  });
  const noHack = fs.filter((f) => F.v('fp.' + f.id + '.hack') === '');
  add({
    id: 'team_hack',
    group: 'team',
    title: 'Each founder tells a true "hacked a non-computer system" story',
    severity: 'warning',
    status: n === 0 ? 'na' : noHack.length === 0 ? 'pass' : 'fail',
    detail: noHack.length === 0 ? '' : 'Missing for ' + noHack.map((f) => f.name).join(', '),
    fix: 'A short, true, specific story of beating a system: a rule, an institution, a market. Never invent one.',
    keys: noHack.map((f) => 'fp.' + f.id + '.hack'),
    target: { kind: 'team' },
  });
  const techNoBuilt = fs.filter((f) => f.technical === true && F.v('fp.' + f.id + '.built') === '');
  add({
    id: 'founder_things_built',
    group: 'team',
    title: 'Technical founders show things they built before',
    severity: 'warning',
    status: tech.length === 0 ? 'na' : techNoBuilt.length === 0 ? 'pass' : 'fail',
    detail: techNoBuilt.length === 0 ? '' : 'Missing for ' + techNoBuilt.map((f) => f.name).join(', '),
    fix: 'List real things with links and numbers: apps, open source, hardware. If there is nothing public yet, ship something you can link to.',
    keys: techNoBuilt.map((f) => 'fp.' + f.id + '.built'),
    first: techNoBuilt.length > 0,
    why: 'Garry Tan: partners read for "what have the founders built in the past?"',
    target: { kind: 'team' },
  });
  add({
    id: 'team_signal',
    group: 'team',
    title: 'Past achievements read as strong',
    severity: 'warning',
    status: n === 0 || !reviewable ? 'na' : waitReview || review.founder_signal === null ? 'wait' : review.founder_signal >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.founder_signal_why : '',
    fix: 'Lead each founder profile with the most impressive thing they did, with numbers or rank, not job titles.',
    target: { kind: 'team' },
  });

  /* ------------------------------------------------------------- clarity */
  const desc = F.a.c_desc;
  const descLen = desc ? desc.measures.chars : 0;
  add({
    id: 'one_liner_limit',
    group: 'clarity',
    title: 'The one-liner fits in 50 characters',
    severity: 'blocker',
    status: F.v('c_desc') === '' ? 'fail' : descLen <= 50 ? 'pass' : 'fail',
    detail: F.v('c_desc') === '' ? 'Not written yet' : descLen + ' of 50 characters',
    fix: 'Write what you make and for whom, in 50 characters: "X for Y".',
    target: { kind: 'answer', key: 'c_desc' },
  });
  const descJudge = desc && desc.judge_current ? desc.judge : null;
  add({
    id: 'one_liner_clear',
    group: 'clarity',
    title: 'The one-liner is concrete, with no buzzwords',
    severity: 'warning',
    status: F.v('c_desc') === '' ? 'na' : descJudge === null ? 'wait' : descJudge.clear && !descJudge.issues.some((i) => i.type === 'marketing' || i.type === 'jargon' || i.type === 'vague') ? 'pass' : 'fail',
    detail: descJudge !== null ? 'Reads as: ' + descJudge.restated : '',
    fix: 'Name the product and the customer in words a parent understands. Write 20 versions and keep the plainest.',
    target: { kind: 'answer', key: 'c_desc' },
  });
  add({
    id: 'one_sentence',
    group: 'clarity',
    title: 'The startup can be explained in one sentence',
    severity: 'blocker',
    status: F.v('c_what') === '' && F.v('c_desc') === '' ? 'fail' : !reviewable ? 'na' : waitReview ? 'wait' : review.one_liner_clear ? 'pass' : 'fail',
    detail: review !== null ? 'A stranger would say: ' + review.one_liner_restated : '',
    fix: 'Michael Seibel\'s test: write two sentences about what you do, hand them to someone, and ask them to explain it back. If they cannot, rewrite.',
    why: 'The most common interview problem: a minute in, partners still do not know what the company does.',
    target: { kind: 'answer', key: 'c_what' },
  });
  const pending = pendingJudges(F);
  const judgedCount = judged(F).length;
  const issueCheck = (id, title, types, fix, why, severity) => {
    const hits = withIssue(F, types);
    add({
      id: id,
      group: 'clarity',
      title: title,
      severity: severity || 'warning',
      status: hits.length > 0 ? 'fail' : pending > 0 ? 'wait' : judgedCount === 0 ? 'na' : 'pass',
      detail: hits.length > 0 ? hits.length + (hits.length === 1 ? ' answer: ' : ' answers: ') + keysText(hits) : pending > 0 ? pending + ' answers still being read' : '',
      fix: fix,
      why: why || '',
      keys: hits.map((a) => a.key),
      target: hits.length > 0 ? { kind: 'answer', key: hits[0].key } : null,
    });
  };
  issueCheck('no_marketing', 'Zero marketing speak', ['marketing'], 'Replace every hype word with what the product actually does.', 'Paul Graham: "We\'re immune to marketing-speak; to us it\'s just noise."');
  issueCheck('no_jargon', 'Plain words, no startup jargon', ['jargon'], 'Say it the way you would to a friend who is not in tech.', 'Michael Seibel: "Explain it like you would to your grandmother."');
  issueCheck('specific', 'Specific: numbers, names and dates', ['vague', 'no_numbers', 'weak_proof'], 'Put a number, a name or a date where the answer now makes a claim.');
  issueCheck('answers_on_point', 'Each answer answers the question asked', ['off_question', 'unclear'], 'Answer the question first, in the first sentence.', 'Dalton Caldwell: "Cut to the chase. Get to the point."');
  issueCheck('honest', 'No claim goes beyond the facts', ['overclaim'], 'State what exists today as today, and what is planned as planned. An exaggeration found later sinks the application.', 'Dalton Caldwell names lying as a red flag; Paul Graham: disclose the flaws.', 'blocker');
  issueCheck('clean_writing', 'Clean spelling and grammar', ['grammar'], 'Fix the typos and broken sentences; partners read a hundred applications a day.', '', 'tip');
  const longOnes = F.items.filter((a) => a.open && a.value !== '' && a.measures.long);
  add({
    id: 'concise',
    group: 'clarity',
    title: 'Short answers',
    severity: 'warning',
    status: F.counts.answered === 0 ? 'na' : longOnes.length === 0 ? 'pass' : 'fail',
    detail: longOnes.length > 0 ? longOnes.length + (longOnes.length === 1 ? ' answer runs long: ' : ' answers run long: ') + keysText(longOnes) : '',
    fix: 'Cut every word that does not carry a fact. Use the shorter version your AI agent offers.',
    why: 'Paul Graham: "Every unnecessary word in your application subtracts from the effect of the necessary ones." YC partners report applications 60% longer than three years ago.',
    keys: longOnes.map((a) => a.key),
    target: longOnes.length > 0 ? { kind: 'answer', key: longOnes[0].key } : null,
  });
  const dashes = F.items.filter((a) => a.open && a.value !== '' && a.measures.em_dashes > 0);
  const aiVoice = withIssue(F, ['ai_voice']);
  const tells = dashes.concat(aiVoice.filter((a) => dashes.indexOf(a) < 0));
  add({
    id: 'own_voice',
    group: 'clarity',
    title: 'Written in your own voice, not machine-written',
    severity: 'warning',
    status: tells.length > 0 ? 'fail' : pending > 0 ? 'wait' : judgedCount === 0 ? 'na' : 'pass',
    detail: tells.length > 0 ? (dashes.length > 0 ? dashes.length + ' with em dashes; ' : '') + (aiVoice.length > 0 ? aiVoice.length + ' that read machine-written; ' : '') + keysText(tells) : '',
    fix: 'Rewrite in the words you would say out loud. Drop em dashes and stock phrases.',
    why: 'YC partners track AI tells: over half of Summer 2025 applications had em dashes, and "wedge" rose from under 1% to over 20%. Paul Graham: AI-written founder writing "feels like being lied to".',
    keys: tells.map((a) => a.key),
    target: tells.length > 0 ? { kind: 'answer', key: tells[0].key } : null,
  });
  const inc = review !== null ? review.inconsistencies : [];
  add({
    id: 'consistent',
    group: 'clarity',
    title: 'Answers agree with each other',
    severity: 'blocker',
    status: !reviewable ? 'na' : waitReview ? 'wait' : inc.length === 0 ? 'pass' : 'fail',
    detail: inc.map((i) => i.what).join(' '),
    fix: 'Use the same numbers everywhere: users, revenue, dates and who does what.',
    keys: inc.length > 0 ? inc[0].keys : [],
    target: inc.length > 0 ? { kind: 'answer', key: inc[0].keys[0] } : null,
  });
  const over = review !== null ? review.overclaims : [];
  if (over.length > 0) {
    const h = out.filter((c) => c.id === 'honest')[0];
    if (h && h.status !== 'fail') {
      h.status = 'fail';
      h.detail = over.map((o) => o.what).join(' ');
      h.keys = over.map((o) => o.key);
      h.target = { kind: 'answer', key: over[0].key };
    }
  }
  const burn = Number(F.v('e_burn'));
  const cash = Number(F.v('e_cash'));
  const runway = Number(F.v('e_runway'));
  const haveMath = F.v('e_burn') !== '' && F.v('e_cash') !== '' && F.v('e_runway') !== '' && burn > 0;
  const expected = haveMath ? cash / burn : 0;
  add({
    id: 'runway_math',
    group: 'clarity',
    title: 'Cash, spend and runway add up',
    severity: 'warning',
    status: !haveMath ? 'na' : Math.abs(runway - expected) <= Math.max(1.5, expected * 0.2) ? 'pass' : 'fail',
    detail: haveMath ? money(cash) + ' / ' + money(burn) + ' a month = ' + Math.round(expected * 10) / 10 + ' months; the answer says ' + runway : '',
    fix: 'Runway is cash divided by monthly spend. Make the three numbers agree.',
    target: { kind: 'answer', key: 'e_runway' },
  });

  /* ------------------------------------------------------------ progress */
  const using = F.v('p_using');
  const hasLink = F.v('c_product') !== '' || F.v('c_demo') !== '';
  add({
    id: 'has_product',
    group: 'progress',
    title: 'Something people can use exists',
    severity: 'tip',
    status: using === 'yes' || hasLink ? 'pass' : using === '' ? 'na' : 'fail',
    detail: using === 'yes' ? 'People are using it' : hasLink ? 'Product or demo link given' : using === '' ? 'Not answered yet' : 'No product yet',
    fix: 'Build a first version people can use before you apply, even a rough one. PostHog built theirs in three days before the deadline.',
    first: using === 'no' && !hasLink,
    why: 'YC funds ideas too (40% of a batch is just an idea), but partners "look at what you\'ve built so far".',
    target: { kind: 'answer', key: 'p_using' },
  });
  add({
    id: 'has_users',
    group: 'progress',
    title: 'Real users, and evidence they want it',
    severity: 'warning',
    status: using === 'yes' ? (waitReview || review.demand === null ? 'pass' : review.demand >= 2 ? 'pass' : 'fail') : using === '' ? 'na' : 'fail',
    detail: using === 'yes' ? (review !== null ? review.demand_why : 'People are using it') : using === '' ? 'Not answered yet' : 'No users yet',
    fix: 'Talk to ten potential users this week and get them using it. Name them and what they said.',
    first: using === 'no' || (using === 'yes' && review !== null && review.demand !== null && review.demand < 2),
    why: 'Partners look for evidence of demand; PostHog had interest from developers at 10 companies before its deadline.',
    target: { kind: 'answer', key: using === 'yes' ? 'p_users' : 'p_using' },
  });
  const series = revenueSeries(F);
  const rev = F.v('p_revenue');
  add({
    id: 'revenue_months',
    group: 'progress',
    title: 'Monthly revenue given, month by month',
    severity: 'warning',
    status: rev !== 'yes' ? 'na' : series.length > 0 ? 'pass' : 'fail',
    detail: series.length > 0 ? series.map((m) => m.month + ' ' + money(m.value)).join(', ') : 'No months filled',
    fix: 'Each month on its own, not a running total, and gross profit rather than GMV for marketplaces.',
    target: { kind: 'answer', key: 'p_revenue_months' },
  });
  add({
    id: 'revenue_not_cumulative',
    group: 'progress',
    title: 'Revenue is per month, not cumulative, not GMV',
    severity: 'blocker',
    status: rev !== 'yes' || series.length === 0 ? 'na' : (F.settings.confirms || {}).revenue_monthly === true ? 'pass' : 'fail',
    detail: 'A founder confirms it under the revenue months',
    fix: 'Check each figure is that month alone, and gross profit rather than GMV for marketplaces, then tick the confirmation.',
    why: 'YC: "Not cumulative and not GMV". Running totals read as inflated numbers.',
    target: { kind: 'answer', key: 'p_revenue_months' },
  });
  const g = growth(series);
  if (g !== null) {
    add({
      id: 'growth',
      group: 'progress',
      title: 'Revenue grows month over month',
      severity: 'tip',
      status: g >= 0.1 ? 'pass' : 'fail',
      detail: 'About ' + Math.round(g * 100) + '% a month',
      fix: 'Growth is what partners look for in revenue. Lead the progress answer with the growth rate if it is strong.',
      target: { kind: 'answer', key: 'p_far' },
    });
  }
  add({
    id: 'demo',
    group: 'progress',
    title: 'A product or demo link partners can open',
    severity: 'tip',
    status: hasLink ? 'pass' : 'fail',
    detail: hasLink ? '' : 'No product or demo link',
    fix: 'Add a short screen recording of the product working, or a link with a login.',
    target: { kind: 'answer', key: 'c_demo' },
  });
  if (F.v('p_prev') === 'yes') {
    add({
      id: 'reapply',
      group: 'progress',
      title: 'Shows what changed since the last application',
      severity: 'warning',
      status: F.v('p_prev_change') !== '' ? 'pass' : 'fail',
      detail: '',
      fix: 'Give the measurable change since last time: users, revenue, product, team.',
      why: 'About half of each batch applied more than once; partners look for progress between applications.',
      target: { kind: 'answer', key: 'p_prev_change' },
    });
  }

  /* ---------------------------------------------------------------- idea */
  const noComp = withIssue(F, ['no_competitors']);
  add({
    id: 'competitors',
    group: 'idea',
    title: 'Competitors named honestly',
    severity: 'warning',
    status: F.v('i_competitors') === '' ? 'na' : noComp.length > 0 ? 'fail' : F.a.i_competitors.judge_current ? 'pass' : 'wait',
    detail: noComp.length > 0 ? 'Says there are no competitors' : '',
    fix: 'Name the incumbents, the startups and what people use instead today.',
    target: { kind: 'answer', key: 'i_competitors' },
  });
  add({
    id: 'insight',
    group: 'idea',
    title: 'A non-obvious insight',
    severity: 'warning',
    status: F.v('i_competitors') === '' || !reviewable ? 'na' : waitReview || review.insight === null ? 'wait' : review.insight >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.insight_why : '',
    fix: 'Say what you understand that competitors do not. Dropbox: competitors "work at the wrong layer of abstraction". "Better UX" is not an insight.',
    target: { kind: 'answer', key: 'i_competitors' },
  });
  add({
    id: 'founder_market_fit',
    group: 'idea',
    title: 'Why you: domain expertise or personal pain',
    severity: 'warning',
    status: F.v('i_why') === '' || !reviewable ? 'na' : waitReview || review.founder_market_fit === null ? 'wait' : review.founder_market_fit >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.founder_market_fit_why : '',
    fix: 'Explain what in your past makes you the people to build this.',
    why: 'Dalton Caldwell: "I like to see some kind of founder/market fit for what the idea is."',
    target: { kind: 'answer', key: 'i_why' },
  });
  const topDown = withIssue(F, ['top_down_market']);
  add({
    id: 'bottom_up',
    group: 'idea',
    title: 'Money: who pays, how much, bottom-up',
    severity: 'warning',
    status: F.v('i_money') === '' ? 'na' : topDown.length > 0 ? 'fail' : F.a.i_money.judge_current ? 'pass' : 'wait',
    detail: topDown.length > 0 ? 'Uses a top-down market size' : '',
    fix: 'Customers times price, from your own numbers. Not "1% of a $100B market".',
    target: { kind: 'answer', key: 'i_money' },
  });
  add({
    id: 'not_trend',
    group: 'idea',
    title: 'Not just this year\'s popular idea',
    severity: 'warning',
    status: !reviewable ? 'na' : waitReview ? 'wait' : review.trend_chasing ? 'fail' : 'pass',
    detail: '',
    fix: 'Show the special angle only you have: a customer, a dataset, a skill, an insight.',
    why: 'Dalton Caldwell flags "a generic, low-effort application... usually it\'s whatever the most popular idea is at that time".',
    target: { kind: 'answer', key: 'i_why' },
  });
  add({
    id: 'other_ideas',
    group: 'idea',
    title: 'Other ideas listed',
    severity: 'tip',
    status: F.v('i_other') !== '' ? 'pass' : 'fail',
    detail: '',
    fix: 'List one to three other ideas. YC: "Often when we fund people it\'s to do something they list here."',
    target: { kind: 'answer', key: 'i_other' },
  });

  add({
    id: 'builder_evidence',
    group: 'progress',
    title: 'Evidence of how you build (coding agent session)',
    severity: 'tip',
    status: F.v('p_session') !== '' ? 'pass' : 'fail',
    detail: '',
    fix: 'Optional: attach a real coding agent session on this product that shows you steering and shipping, or add a Paxel builder report.',
    why: 'YC added an optional coding agent session in 2026 and considers Paxel builder reports; neither is required.',
    target: { kind: 'answer', key: 'p_session' },
  });

  /* --------------------------------------------------------------- video */
  const vc = F.settings.confirms || {};
  add({
    id: 'video',
    group: 'video',
    title: 'One minute founder video',
    severity: 'blocker',
    status: F.v('f_video') !== '' ? 'pass' : 'fail',
    detail: F.v('f_video') !== '' ? '' : 'No video link',
    fix: 'Record one minute of all founders talking, upload it unlisted and paste the link.',
    first: F.v('f_video') === '',
    link: 'https://www.ycombinator.com/video',
    why: 'Paul Graham: "Statistically we\'re much more likely to interview people who submit a video."',
    target: { kind: 'answer', key: 'f_video' },
  });
  const rules = ['one_minute', 'all_founders', 'unscripted', 'no_extras'];
  const ticked = rules.filter((r) => vc[r] === true);
  add({
    id: 'video_rules',
    group: 'video',
    title: 'The video follows YC\'s rules',
    severity: 'warning',
    status: F.v('f_video') === '' ? 'na' : ticked.length === rules.length ? 'pass' : 'fail',
    detail: ticked.length + ' of 4 confirmed',
    fix: 'One minute; every founder on camera; talking, not reading a script; no demo, music or effects.',
    link: 'https://www.ycombinator.com/video',
    target: { kind: 'answer', key: 'f_video' },
  });

  /* ------------------------------------------------------ before you apply */
  const cf = F.settings.confirms || {};
  const declare = (key, title, severity, fix, why, first) =>
    add({ id: 'confirm_' + key, group: 'before', title: title, severity: severity, status: cf[key] === true ? 'pass' : 'fail', detail: cf[key] === true ? 'Confirmed' : 'Not confirmed', fix: fix, why: why, first: first && cf[key] !== true, confirm: key, target: { kind: 'confirm', key: key } });
  declare('full_time_if_accepted', 'Every founder works on it full-time if accepted', n > 0 && part.length > 0 ? 'blocker' : 'warning', 'Agree that every founder goes full-time for the batch and after. YC expects it.', 'YC FAQ: founders work on the company full-time during the batch and afterwards.', true);
  declare('one_application', 'One application for this company this batch', 'warning', 'Send one application per company per batch, from the founder who leads it.', 'YC reads one application per company; duplicates confuse the review.', false);
  declare('vesting', 'Founder shares vest', 'tip', 'Put founder shares on four-year vesting with a one-year cliff.', 'YC blog (2016): standard vesting is four years with a one-year cliff; it protects every founder.', true);
  declare('ip_clear', 'No employer or school can claim the code or the idea', 'warning', 'Build on your own time and equipment, and check your employment contract.', 'YC blog (2016): employer IP claims are a common blocker to investment.', true);
  declare('goals_aligned', 'Founders agree on roles, goals and who is CEO', 'tip', 'Settle roles and the CEO before writing the answers.', 'YC blog (2018): misaligned cofounders are a top reason startups die.', true);
  if (review !== null && review.flaws_disclosed === false) {
    add({
      id: 'flaws_disclosed',
      group: 'idea',
      title: 'Weaknesses are stated, not hidden',
      severity: 'tip',
      status: 'fail',
      detail: '',
      fix: 'Name the biggest risk and how you will handle it. Partners trust applications that disclose flaws.',
      why: 'Paul Graham: "It is for this reason better to disclose all the flaws in your idea than to try to conceal them."',
      target: { kind: 'answer', key: 'i_competitors' },
    });
  }

  /* ---------------------------------------------------------------- form */
  const missing = F.items.filter(L('lib_answers').isMissing);
  add({
    id: 'complete',
    group: 'form',
    title: 'Every required answer is filled',
    severity: 'blocker',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: missing.length === 0 ? '' : missing.length + ' missing: ' + keysText(missing),
    fix: 'Fill them, or tell your AI agent what it needs to know.',
    coverage: true,
    keys: missing.map((a) => a.key),
    target: missing.length > 0 ? { kind: 'answer', key: missing[0].key } : null,
  });
  const unconf = F.items.filter((a) => a.open && a.value !== '' && !a.confirmed);
  add({
    id: 'confirmed',
    group: 'form',
    title: 'Founders read and confirmed every answer',
    severity: 'blocker',
    status: F.counts.answered === 0 ? 'fail' : unconf.length === 0 ? 'pass' : 'fail',
    detail: unconf.length > 0 ? unconf.length + ' written by your AI agent and not confirmed yet' : '',
    fix: 'Read each answer your AI agent wrote. Edit it into your own words or press "Looks right".',
    coverage: true,
    keys: unconf.map((a) => a.key),
    target: unconf.length > 0 ? { kind: 'answer', key: unconf[0].key } : null,
  });
  const deadline = F.settings.deadline ? Date.parse(F.settings.deadline) : NaN;
  const days = Number.isFinite(deadline) ? (deadline - Date.now()) / 86400000 : null;
  add({
    id: 'deadline',
    group: 'form',
    title: 'Submitted before the deadline',
    severity: days !== null && days < 0 ? 'warning' : 'tip',
    status: days === null ? 'na' : F.settings.status !== 'preparing' ? 'pass' : days >= 0 ? 'pass' : 'fail',
    detail: days === null ? '' : days >= 0 ? Math.floor(days) + ' days left (' + F.settings.batch + ')' : 'The ' + F.settings.batch + ' deadline passed ' + Math.ceil(-days) + ' days ago',
    fix: days !== null && days < 0 ? 'YC still reads late applications, but decisions can take longer. Apply now or pick the next batch.' : 'Apply early: the deadline is not a target.',
    target: { kind: 'settings' },
  });
  add({
    id: 'recommended',
    group: 'form',
    title: 'A YC founder recommends you',
    severity: 'tip',
    status: F.settings.recommended ? 'pass' : 'fail',
    detail: '',
    fix: 'Optional. If a YC founder knows your work, ask them to recommend you; most funded founders had no recommendation.',
    why: 'Recommendations carry over between applications (YC FAQ); YC gives "extra consideration" to people with a strong recommendation from a YC founder they worked with.',
    target: { kind: 'settings' },
  });

  out.sort((x, y) => {
    const st = (c) => (c.status === 'fail' ? 0 : c.status === 'wait' ? 1 : c.status === 'pass' ? 2 : 3);
    return st(x) - st(y) || SEVERITY[x.severity] - SEVERITY[y.severity];
  });
  return { checks: out, facts: F };
}

/** The checks, a summary, and the "do these first" list. */
function summary(app) {
  const r = run(app);
  const live = r.checks.filter((c) => c.status !== 'na');
  const count = (st, sev) => live.filter((c) => c.status === st && (sev === undefined || c.severity === sev)).length;
  const first = r.checks.filter((c) => c.first && c.status === 'fail').map((c) => ({ id: c.id, title: c.title, fix: c.fix, link: c.link, severity: c.severity }));
  return {
    groups: GROUPS,
    checks: r.checks,
    totals: { pass: count('pass'), fail: count('fail'), wait: count('wait'), blockers: count('fail', 'blocker'), warnings: count('fail', 'warning'), tips: count('fail', 'tip') },
    first: first,
    facts: r.facts,
  };
}

function list(ctx, p) {
  const s = summary(ctx.app);
  let checks = s.checks;
  if (p.status) checks = checks.filter((c) => c.status === p.status);
  if (p.group) checks = checks.filter((c) => c.group === p.group);
  if (p.brief === true) return { totals: s.totals, checks: checks.map((c) => ({ id: c.id, status: c.status, severity: c.severity, title: c.title, detail: c.detail, fix: c.status === 'fail' ? c.fix : undefined, keys: c.status === 'fail' && Array.isArray(c.keys) && c.keys.length > 0 ? c.keys : undefined, confirm: c.confirm })) };
  return { totals: s.totals, first: s.first, checks: checks, review: { state: s.facts.reviewState, progress: s.facts.progress } };
}

module.exports = { GROUPS: GROUPS, facts: facts, run: run, summary: summary, list: list, revenueSeries: revenueSeries, growth: growth };
