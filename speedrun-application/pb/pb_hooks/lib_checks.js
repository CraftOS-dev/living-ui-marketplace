/// <reference path="../pb_data/types.d.ts" />
/**
 * The checks: did the founders do everything right? Each check comes from
 * speedrun's own guidance (the apply form, the FAQ, the "What we look for in
 * applications" and "What founders ask us before applying" roundtables on
 * speedrun.substack.com, partners' posts; research note of 2026-10-30) and is
 * decided one of two ways:
 *
 *   - from structured facts: founder count, technical and full-time flags,
 *     links, yes/no answers, numbers, character and word counts;
 *   - from the reviewer's structured verdicts (lib_judge): marketing speak,
 *     a buried lede, overclaims, founder signal, earned insight, inconsistencies.
 *
 * Nothing here matches words in the founders' text. A check whose verdict
 * is still being reviewed reads "wait". Checks marked `first` are things to
 * do before applying (find a co-founder, get a design partner, record the
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
  { key: 'idea', label: 'Insight' },
  { key: 'traction', label: 'Momentum' },
  { key: 'video', label: 'Video' },
  { key: 'form', label: 'Form' },
];
const SEVERITY = { blocker: 0, warning: 1, tip: 2 };

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
  const savedReview = U.json(srec, 'review', null);
  const review = savedReview && savedReview.summary ? savedReview : null;
  return {
    founders: S.founders(app),
    items: items,
    a: byKey,
    v: (k) => (byKey[k] && byKey[k].open ? byKey[k].value : ''),
    n: (k) => {
      const s = byKey[k] && byKey[k].open ? byKey[k].value : '';
      return s === '' ? null : Number(s);
    },
    settings: settings,
    review: review,
    reviewState: srec.getString('review_state') || 'none',
    counts: A.counts(items),
    progress: L('lib_judge').progress(app),
  };
}

/** Answers reviewed and current, with their issues. */
function judged(F) {
  return F.items.filter((a) => a.open && a.value !== '' && a.judged && a.judge && Array.isArray(a.judge.issues));
}

function pendingJudges(F) {
  return F.items.filter((a) => a.open && a.value !== '' && a.judged && !a.judge && a.judge_state !== 'error').length;
}

function withIssue(F, types) {
  return judged(F).filter((a) => a.judge.issues.some((i) => types.indexOf(i.type) >= 0));
}

/** A question by its short name ("One-liner", "Jane Chen: Relevant experience"). */
function labelOf(a) {
  const short = L('lib_questions').shortOf(a.key);
  return a.founder_name ? a.founder_name + ': ' + short : short;
}

function keysText(list) {
  return list.slice(0, 4).map(labelOf).join('; ') + (list.length > 4 ? '; and ' + (list.length - 4) + ' more' : '');
}

const METRIC_KEYS = ['x_arr', 'x_acv', 'x_ndr', 'x_rev_growth', 'x_dau', 'x_wau', 'x_mau', 'x_user_growth', 'x_d1', 'x_d7', 'x_d30', 'x_m1'];

/** The traction numbers given (open questions only), by key. */
function metrics(F) {
  const out = {};
  for (const k of METRIC_KEYS) {
    const n = F.n(k);
    if (n !== null) out[k] = n;
  }
  return out;
}

/**
 * Numbers that cannot all be true together, from the numbers alone: bounded
 * retention falls over time (D1 >= D7 >= D30), active users grow with the
 * window (DAU <= WAU <= MAU), retention is a share of users, and a D30 of
 * 60% or more is very rare (speedrun: "If your D30 is 80%, you're either
 * measuring it wrong or you're not being truthful").
 */
function metricProblems(F) {
  const m = metrics(F);
  const out = [];
  const pct = ['x_d1', 'x_d7', 'x_d30', 'x_m1'];
  for (const k of pct) if (m[k] !== undefined && m[k] > 100) out.push({ keys: [k], what: L('lib_questions').shortOf(k) + ' is ' + m[k] + '%: retention is a share of users, at most 100%.' });
  const order = [
    ['x_d1', 'x_d7'],
    ['x_d7', 'x_d30'],
  ];
  for (const [a, b] of order) if (m[a] !== undefined && m[b] !== undefined && m[b] > m[a]) out.push({ keys: [a, b], what: 'D' + b.slice(3) + ' (' + m[b] + '%) is above D' + a.slice(3) + ' (' + m[a] + '%): bounded retention falls over time.' });
  const users = [
    ['x_dau', 'x_wau'],
    ['x_wau', 'x_mau'],
    ['x_dau', 'x_mau'],
  ];
  for (const [a, b] of users) if (m[a] !== undefined && m[b] !== undefined && m[a] > m[b]) out.push({ keys: [a, b], what: L('lib_questions').shortOf(a) + ' (' + L('lib_util').thousands(m[a]) + ') is above ' + L('lib_questions').shortOf(b).toLowerCase() + ' (' + L('lib_util').thousands(m[b]) + ').' });
  if (m.x_d30 !== undefined && m.x_d30 >= 60 && m.x_d30 <= 100) out.push({ keys: ['x_d30'], what: 'D30 of ' + m.x_d30 + '% is very rare: check it counts users who return on day 30 exactly.' });
  if (m.x_arr !== undefined && m.x_acv !== undefined && m.x_arr > 0 && m.x_acv > m.x_arr) out.push({ keys: ['x_arr', 'x_acv'], what: 'The average contract ($' + L('lib_util').thousands(m.x_acv) + ') is larger than all recurring revenue ($' + L('lib_util').thousands(m.x_arr) + ').' });
  return out;
}

const REQUIRED_FIELDS = [
  { k: 'first_name', label: 'first name' },
  { k: 'last_name', label: 'last name' },
  { k: 'email', label: 'email' },
  { k: 'country', label: 'country' },
  { k: 'city', label: 'city' },
  { k: 'citizenship', label: 'citizenship' },
  { k: 'technical', label: 'technical end-to-end' },
];
/** The CEO's block of the form also requires these. */
const LEAD_FIELDS = [
  { k: 'phone', label: 'phone' },
  { k: 'college', label: 'college' },
  { k: 'years', label: 'years of experience' },
  { k: 'linkedin', label: 'LinkedIn' },
];

/** Each founder's form fields still empty: [{ founder, name, missing: [labels] }]. */
function founderGaps(F) {
  const out = [];
  F.founders.forEach((f, i) => {
    const need = i === 0 ? REQUIRED_FIELDS.concat(LEAD_FIELDS) : REQUIRED_FIELDS;
    const missing = need.filter((x) => f[x.k] === '' || f[x.k] === null || f[x.k] === undefined).map((x) => x.label);
    if (missing.length > 0) out.push({ founder: f.id, name: f.name, missing: missing });
  });
  return out;
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
  const pending = pendingJudges(F);
  const judgedCount = judged(F).length;

  /* ---------------------------------------------------------------- team */
  add({
    id: 'team_founders',
    group: 'team',
    title: 'Every founder is on the team page, CEO first',
    severity: 'blocker',
    status: n > 0 ? 'pass' : 'fail',
    detail: n > 0 ? n + (n === 1 ? ' founder' : ' founders') + ', ' + fs[0].name + ' applies' : 'No founders yet',
    fix: 'Add each founder (your AI agent can add them from your links and files). The first one is the CEO who applies.',
    why: 'speedrun\'s form: "Start with the CEO, then add any co-founders." A co-founder left off reads as a solo founder.',
    target: { kind: 'team' },
  });
  add({
    id: 'team_size',
    group: 'team',
    title: 'Co-founders with complementary skills',
    severity: n >= 5 ? 'tip' : 'warning',
    status: n === 0 ? 'na' : n >= 2 && n <= 4 ? 'pass' : 'fail',
    detail: n === 1 ? 'Solo founder' : n + ' founders',
    fix: n >= 5 ? 'With five or more founders, make each role obvious in the team answer.' : 'speedrun takes solo founders with a strong track record, but prefers teams. If a co-founder is joining, add them and say it is in progress.',
    first: n === 1,
    why: 'speedrun FAQ: "we generally prefer teams with multiple founders who bring complementary skills. If you\'re a solo founder with a strong track record of execution, we strongly encourage you to apply."',
    target: { kind: 'team' },
  });
  const tech = fs.filter((f) => f.technical === true);
  const techUnknown = fs.filter((f) => f.technical === null);
  const noTech = n > 0 && tech.length === 0 && techUnknown.length === 0;
  add({
    id: 'team_technical',
    group: 'team',
    title: 'A founder can build the product end-to-end',
    severity: noTech ? 'blocker' : 'warning',
    status: n === 0 ? 'na' : tech.length > 0 ? 'pass' : 'fail',
    detail: tech.length > 0 ? tech.map((f) => f.name).join(', ') : noTech ? 'No founder builds it end-to-end' : 'Not given for ' + techUnknown.map((f) => f.name).join(', '),
    fix: noTech ? 'Bring in a co-founder who can build it end-to-end. speedrun backs teams that build and iterate themselves.' : 'Say on the team page which founders can build the product end-to-end.',
    first: noTech,
    why: 'speedrun FAQ: "We back teams that can build and iterate on their product themselves, which usually means having a technical cofounder or equivalent expertise on the founding team."',
    target: { kind: 'team' },
  });
  const part = fs.filter((f) => f.full_time === false);
  const ftUnknown = fs.filter((f) => f.full_time === null);
  add({
    id: 'team_full_time',
    group: 'team',
    title: 'Founders are full-time, or say when they will be',
    severity: 'warning',
    status: n === 0 ? 'na' : ftUnknown.length > 0 ? 'fail' : part.length === 0 || (F.settings.confirms || {}).full_time_if_accepted === true ? 'pass' : 'fail',
    detail: part.length > 0 ? 'Part-time: ' + part.map((f) => f.name).join(', ') : ftUnknown.length > 0 ? 'Not given for ' + ftUnknown.map((f) => f.name).join(', ') : 'All full-time',
    fix: ftUnknown.length > 0 ? 'Say on the team page whether each founder is full-time.' : 'You can apply with a job, but speedrun expects full-time building during the residency. Say when each part-time founder goes full-time, and tick it under Before you apply.',
    why: 'Kenan Saleh (speedrun): "The most important thing is that you\'re fully bought in ... willing to leave your job and do it full time."',
    target: { kind: 'team' },
  });
  const noExp = fs.filter((f) => F.v('fp.' + f.id + '.experience') === '');
  add({
    id: 'team_experience',
    group: 'team',
    title: 'Each founder\'s relevant experience is written',
    severity: 'blocker',
    status: n === 0 ? 'na' : noExp.length === 0 ? 'pass' : 'fail',
    detail: noExp.length === 0 ? '' : 'Missing for ' + noExp.map((f) => f.name).join(', '),
    fix: 'A few sentences per founder: track record, domain expertise and past wins, with numbers and links.',
    keys: noExp.map((f) => 'fp.' + f.id + '.experience'),
    why: 'speedrun FAQ: "We spend most of our time on the team and bio section, so tell us who you are."',
    target: { kind: 'team' },
  });
  add({
    id: 'team_signal',
    group: 'team',
    title: 'Track records read as exceptional',
    severity: 'warning',
    status: n === 0 || noExp.length === n || !reviewable ? 'na' : waitReview || review.founder_signal === null ? 'wait' : review.founder_signal >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.founder_signal_why : '',
    fix: 'Brag with numbers: what each founder built, grew, sold or won, with magnitude and links. Outlier projects count: a repo with stars, a channel with subscribers, a top rank.',
    why: 'Seeam Noor (speedrun): "We do really mean it when we say the team has the highest weight ... This is not the place to be humble."',
    target: { kind: 'team' },
  });
  add({
    id: 'team_history',
    group: 'team',
    title: 'The founders have built together',
    severity: 'warning',
    status: n < 2 || F.v('t_team') === '' ? 'na' : waitReview || review.team_history === null ? 'wait' : review.team_history === 0 ? 'fail' : 'pass',
    detail: F.v('t_team') === '' ? 'The team answer is not written yet' : review !== null && review.team_history === 0 ? 'Reads as founders who just met' : '',
    fix: 'Say how long you have known each other and what you made together. Met online recently? Spend a week building in the same room before you apply.',
    why: 'speedrun FAQ: "What matters most is the time you\'ve spent building together, so tell us about what you\'ve made as a team."',
    target: { kind: 'answer', key: 't_team' },
  });
  add({
    id: 'team_complementary',
    group: 'team',
    title: 'Skills cover building and selling',
    severity: 'warning',
    status: n === 0 || !reviewable ? 'na' : waitReview || review.complementary === null ? 'wait' : review.complementary ? 'pass' : 'fail',
    detail: review !== null ? review.complementary_why : '',
    fix: 'Show who builds and who sells. For B2B, name the founder or key hire who is commercial; if nobody is, say who you will bring in first.',
    why: 'speedrun FAQ: "We care about complementary skills on the team." Emily Bennett: for B2B "it\'s helpful to have someone who\'s commercial."',
    target: { kind: 'answer', key: 't_team' },
  });
  const noLinkedIn = fs.filter((f) => f.linkedin === '');
  const leadNoLinkedIn = n > 0 && fs[0].linkedin === '';
  add({
    id: 'founder_linkedin',
    group: 'team',
    title: 'Every founder\'s LinkedIn is given and current',
    severity: leadNoLinkedIn ? 'blocker' : 'warning',
    status: n === 0 ? 'na' : noLinkedIn.length === 0 ? 'pass' : 'fail',
    detail: noLinkedIn.length === 0 ? '' : 'Missing for ' + noLinkedIn.map((f) => f.name).join(', '),
    fix: 'Add each founder\'s LinkedIn on the team page and bring it up to date. The CEO\'s is required on the form.',
    why: 'Joshua Lu (speedrun): "the application consists of the text you put in there, the deck, and also your social media accounts. Do a pass on your LinkedIn to make sure it\'s up to date."',
    target: { kind: 'team' },
  });
  const techNoLinks = tech.filter((f) => f.github === '' && f.website === '');
  add({
    id: 'founder_ship_links',
    group: 'team',
    title: 'Builders link to what they shipped',
    severity: 'tip',
    status: tech.length === 0 ? 'na' : techNoLinks.length === 0 ? 'pass' : 'fail',
    detail: techNoLinks.length === 0 ? '' : 'No GitHub or portfolio for ' + techNoLinks.map((f) => f.name).join(', '),
    fix: 'Add a GitHub or portfolio link for each founder who builds: real projects with users or stars.',
    why: 'Andrew Chen (speedrun): "That could be a GitHub repo with thousands of stars growing fast". speedrun asks for "evidence that you know how to ship".',
    target: { kind: 'team' },
  });

  /* ------------------------------------------------------------- clarity */
  const one = F.a.s_oneliner;
  const oneLen = one ? one.measures.chars : 0;
  add({
    id: 'one_liner_limit',
    group: 'clarity',
    title: 'The one-liner fits in 100 characters',
    severity: 'blocker',
    status: F.v('s_oneliner') === '' ? 'fail' : oneLen <= 100 ? 'pass' : 'fail',
    detail: F.v('s_oneliner') === '' ? 'Not written yet' : oneLen + ' of 100 characters',
    fix: 'What you do and for whom, in one sentence under 100 characters: "X for Y".',
    target: { kind: 'answer', key: 's_oneliner' },
  });
  const oneJudge = one ? one.judge : null;
  add({
    id: 'one_liner_clear',
    group: 'clarity',
    title: 'The one-liner is plain, with no buzzwords',
    severity: 'warning',
    status: F.v('s_oneliner') === '' ? 'na' : oneJudge === null ? 'wait' : oneJudge.clear && !oneJudge.issues.some((i) => i.type === 'marketing' || i.type === 'jargon' || i.type === 'vague') ? 'pass' : 'fail',
    detail: oneJudge !== null ? 'Reads as: ' + oneJudge.restated : '',
    fix: 'Name the product and the customer in plain words. speedrun\'s example: "AI-powered therapist for Gen Z".',
    why: 'Nexxa was turned down with "a pioneering process automation platform that applies intelligent reasoning..." and accepted with "We build industrial AI agents for operations and heavy industries." (speedrun Substack)',
    target: { kind: 'answer', key: 's_oneliner' },
  });
  add({
    id: 'one_sentence',
    group: 'clarity',
    title: 'The startup can be explained in one sentence',
    severity: 'blocker',
    status: F.v('s_desc') === '' && F.v('s_oneliner') === '' ? 'fail' : !reviewable ? 'na' : waitReview ? 'wait' : review.one_liner_clear ? 'pass' : 'fail',
    detail: review !== null ? 'A stranger would say: ' + review.one_liner_restated : '',
    fix: 'Write two sentences about what you do, hand them to someone outside tech, and ask them to explain it back. If they cannot, rewrite.',
    why: 'Sam Shank (speedrun): "You need to describe your company in a very pithy, condensed way, in one sentence. If you can\'t do that already, it\'s a question about your ability to be a great founder."',
    target: { kind: 'answer', key: 's_desc' },
  });
  const overLimit = F.items.filter((a) => a.open && a.value !== '' && a.key !== 's_oneliner' && a.measures.over_limit);
  add({
    id: 'within_limits',
    group: 'clarity',
    title: 'Every answer fits the form\'s limit',
    severity: 'blocker',
    status: F.counts.answered === 0 ? 'na' : overLimit.length === 0 ? 'pass' : 'fail',
    detail: overLimit.map((a) => labelOf(a) + ' ' + a.measures.chars + ' of ' + a.limit).join('; '),
    fix: 'Cut each one to its limit (800 for the description, 1000 for the rest). The form stops typing at the limit, so the end is lost.',
    keys: overLimit.map((a) => a.key),
    target: overLimit.length > 0 ? { kind: 'answer', key: overLimit[0].key } : null,
  });
  const issueCheck = (id, title, types, fix, why, severity, group) => {
    const hits = withIssue(F, types);
    add({
      id: id,
      group: group || 'clarity',
      title: title,
      severity: severity || 'warning',
      status: hits.length > 0 ? 'fail' : pending > 0 ? 'wait' : judgedCount === 0 ? 'na' : 'pass',
      detail: hits.length > 0 ? hits.length + (hits.length === 1 ? ' answer: ' : ' answers: ') + keysText(hits) : pending > 0 ? pending + ' answers need a review; click Review again when ready' : '',
      fix: fix,
      why: why || '',
      keys: hits.map((a) => a.key),
      target: hits.length > 0 ? { kind: 'answer', key: hits[0].key } : null,
    });
  };
  issueCheck('bottom_line_first', 'The best news comes first', ['buried_lede'], 'Open each answer with its strongest fact: a design partner, revenue, a past win. Context after.', 'Fareed Mosavat (speedrun): "Tell me what\'s important in the first three sentences, because if that\'s not good, we\'re out."');
  issueCheck('no_marketing', 'Zero buzzwords', ['marketing'], 'Replace every hype word with what the product actually does.', 'Troy Kirwin on the accepted reapplication of Nexxa: "no more buzzwords".');
  issueCheck('no_jargon', 'Plain words, no startup jargon', ['jargon'], 'Say it the way you would to a friend who is not in tech.');
  issueCheck('specific', 'Specific: numbers, names and dates', ['vague', 'no_numbers', 'weak_proof'], 'Put a number, a name or a date where the answer now makes a claim.', 'Andrew Chen (speedrun): "If you started a successful company before, tell us you went from zero to X million in revenue ... Specific facts and figures help."');
  issueCheck('full_size', 'Wins stated at full size', ['undersold'], 'Give each achievement its real magnitude: users, revenue, rank, followers, the outcome.', 'Troy Kirwin (speedrun): have a friend read your bio and ask "Why didn\'t you mention that research paper, or that you have 30,000 Twitter followers?"');
  issueCheck('answers_on_point', 'Each answer answers the question asked', ['off_question', 'unclear'], 'Answer the question first, in the first sentence.');
  issueCheck('honest', 'No claim goes beyond the facts', ['overclaim'], 'State what exists today as today, and what is planned as planned. speedrun calls customers and investors for references.', 'speedrun checks references, and "called Nexxa\'s customers" before investing.', 'blocker');
  issueCheck('clean_writing', 'No typos', ['grammar'], 'Fix the typos and broken sentences; a friend reading it once catches most.', 'speedrun partners name typos among the common mistakes.', 'warning');
  const longOnes = F.items.filter((a) => a.open && a.value !== '' && a.measures.long);
  add({
    id: 'concise',
    group: 'clarity',
    title: 'Short answers',
    severity: 'warning',
    status: F.counts.answered === 0 ? 'na' : longOnes.length === 0 ? 'pass' : 'fail',
    detail: longOnes.length > 0 ? longOnes.length + (longOnes.length === 1 ? ' answer runs long: ' : ' answers run long: ') + keysText(longOnes) : '',
    fix: 'Cut every word that does not carry a fact. Use the shorter version your AI agent offers.',
    why: 'Andrew Chen (speedrun) on what sinks founders: being "long-winded and vague when you talk about yourselves".',
    keys: longOnes.map((a) => a.key),
    target: longOnes.length > 0 ? { kind: 'answer', key: longOnes[0].key } : null,
  });
  const dashes = F.items.filter((a) => a.open && a.value !== '' && a.measures.em_dashes > 0);
  const aiVoice = withIssue(F, ['ai_voice']);
  const tells = dashes.concat(aiVoice.filter((a) => dashes.indexOf(a) < 0));
  add({
    id: 'own_voice',
    group: 'clarity',
    title: 'Your own insights, in your own voice',
    severity: 'tip',
    status: tells.length > 0 ? 'fail' : pending > 0 ? 'wait' : judgedCount === 0 ? 'na' : 'pass',
    detail: tells.length > 0 ? (dashes.length > 0 ? dashes.length + ' with em dashes; ' : '') + (aiVoice.length > 0 ? aiVoice.length + ' that read machine-written; ' : '') + keysText(tells) : '',
    fix: 'Keep the insights personal and the words yours. Drop em dashes and stock phrases.',
    why: 'Emily Bennett (speedrun): "The insights are personal; the delivery can be AI-assisted." Live interviews then test you without AI.',
    keys: tells.map((a) => a.key),
    target: tells.length > 0 ? { kind: 'answer', key: tells[0].key } : null,
  });
  const inc = review !== null ? review.inconsistencies : [];
  add({
    id: 'consistent',
    group: 'clarity',
    title: 'Answers and numbers agree',
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

  /* ---------------------------------------------------------------- idea */
  add({
    id: 'earned_insight',
    group: 'idea',
    title: 'An earned secret about your market',
    severity: 'warning',
    status: F.v('s_desc') === '' || !reviewable ? 'na' : waitReview || review.insight === null ? 'wait' : review.insight >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.insight_why : '',
    fix: 'Say one thing you learned firsthand about this market that others miss: from building in it, selling into it or meeting its players.',
    why: 'speedrun: "We want to know about your earned secrets, things you understand about your chosen market that other people don\'t."',
    target: { kind: 'answer', key: 's_desc' },
  });
  add({
    id: 'founder_market_fit',
    group: 'idea',
    title: 'Why you: experience tied to this idea',
    severity: 'warning',
    status: n === 0 || !reviewable ? 'na' : waitReview || review.founder_market_fit === null ? 'wait' : review.founder_market_fit >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.founder_market_fit_why : '',
    fix: 'Connect each founder\'s experience to this problem. New to the industry? Show the work: customers interviewed, the players you met, an insider on the team.',
    why: 'Joshua Lu (speedrun): "You need to show experience in something directly related to the idea for the company."',
    target: n > 0 ? { kind: 'answer', key: 'fp.' + fs[0].id + '.experience' } : { kind: 'team' },
  });
  add({
    id: 'differentiation',
    group: 'idea',
    title: 'How you differ, said plainly',
    severity: 'warning',
    status: F.v('s_desc') === '' || !reviewable ? 'na' : waitReview || review.differentiation === null ? 'wait' : review.differentiation >= 2 ? 'pass' : 'fail',
    detail: review !== null ? review.differentiation_why : '',
    fix: 'Name the closest alternative and say in one sentence why you are different. Do not leave the comparison to the reader.',
    why: 'Kenan Saleh (speedrun): "say \'we\'re different from XYZ because of this,\' rather than making the reader do that exercise themselves."',
    target: { kind: 'answer', key: 's_desc' },
  });
  add({
    id: 'not_trend',
    group: 'idea',
    title: 'Not a crowded copy of this year\'s idea',
    severity: 'warning',
    status: !reviewable ? 'na' : waitReview ? 'wait' : review.trend_chasing ? 'fail' : 'pass',
    detail: '',
    fix: 'Show the angle only you have: a customer, a dataset, a skill, an insight.',
    why: 'Fareed Mosavat (speedrun): "We see a lot of ideas in the same space, over and over again. My instinct is that those are tar pits."',
    target: { kind: 'answer', key: 's_desc' },
  });
  issueCheck('no_inflated_market', 'No inflated market size', ['top_down_market'], 'Drop the "1% of a $100B market" line. Show who pays and how much, from your own numbers.', 'Marcus Segal (speedrun) on common mistakes: "Too much time spent on the TAM ... overblown TAMs".', 'warning', 'idea');
  add({
    id: 'ai_why_now',
    group: 'idea',
    title: 'A why-now that is more than "AI got good"',
    severity: 'tip',
    status: !reviewable ? 'na' : waitReview ? 'wait' : review.ai_why_now ? 'fail' : 'pass',
    detail: '',
    fix: 'Name the specific shift that opens this market now: a cost that fell, a rule that changed, a behavior that moved.',
    why: 'speedrun\'s SR008 investor roundtable lists it among common mistakes: "AI is not your why now".',
    target: { kind: 'answer', key: 's_desc' },
  });

  /* ------------------------------------------------------------ momentum */
  const launched = F.v('x_has_traction') === 'yes';
  add({
    id: 'momentum',
    group: 'traction',
    title: 'Signs people want it',
    severity: 'warning',
    status: !reviewable ? 'na' : waitReview || review.demand === null ? 'wait' : review.demand >= 1 ? 'pass' : 'fail',
    detail: review !== null ? review.demand_why : '',
    fix: 'Traction does not have to be a number: a design partner, users coming back, a waitlist, respected people in the space backing it. Get one and say it with names and dates.',
    first: review !== null && review.demand === 0,
    why: 'speedrun FAQ: "Traction doesn\'t have to be a number. We\'re looking for momentum of any kind: users coming back, a design partner, a growing waitlist, or how quickly you\'re shipping."',
    target: { kind: 'answer', key: launched ? 'x_traction_notes' : 's_other' },
  });
  const m = metrics(F);
  const metricCount = Object.keys(m).length;
  add({
    id: 'traction_data',
    group: 'traction',
    title: 'Launched? The traction section shows the data',
    severity: 'warning',
    status: !launched ? 'na' : metricCount > 0 || F.v('x_traction_notes') !== '' ? 'pass' : 'fail',
    detail: launched ? metricCount + (metricCount === 1 ? ' metric' : ' metrics') + ' given' : '',
    fix: 'Share the revenue or usage numbers you measure: ARR, active users, growth, retention. Add a line of commentary.',
    why: 'speedrun\'s form: "If you\'ve launched and started measuring traction, we\'d love to see the data."',
    target: { kind: 'answer', key: 'x_share_revenue' },
  });
  const probs = metricProblems(F);
  add({
    id: 'metrics_sane',
    group: 'traction',
    title: 'The metrics hold together',
    severity: 'warning',
    status: metricCount === 0 ? 'na' : probs.length === 0 ? 'pass' : 'fail',
    detail: probs.map((x) => x.what).join(' '),
    fix: 'Recheck how each number is measured: bounded retention on that exact day, active users not signups, ARR from recurring revenue only.',
    why: 'Robin Guo (speedrun): "If your D30 is 80%, you\'re either measuring it wrong or you\'re not being truthful."',
    keys: probs.reduce((acc, x) => acc.concat(x.keys.filter((k) => acc.indexOf(k) < 0)), []),
    target: probs.length > 0 ? { kind: 'answer', key: probs[0].keys[0] } : null,
  });
  const cf = F.settings.confirms || {};
  add({
    id: 'metrics_confirmed',
    group: 'traction',
    title: 'A founder confirms the metrics are measured, not projected',
    severity: 'warning',
    status: metricCount === 0 ? 'na' : cf.metrics_true === true ? 'pass' : 'fail',
    detail: cf.metrics_true === true ? 'Confirmed' : 'Not confirmed',
    fix: 'Check ARR is recurring revenue today, active users are active, and retention is bounded, then tick it.',
    why: 'speedrun reads ARR as "predictable revenue per year from subscriptions or contracts (exclude one-time fees)" and retention as users who "return exactly at that interval".',
    confirm: 'metrics_true',
    target: { kind: 'confirm', key: 'metrics_true' },
  });
  const growthGiven = F.n('x_rev_growth') !== null || F.n('x_user_growth') !== null;
  const sharing = F.v('x_share_revenue') === 'yes' || F.v('x_share_usage') === 'yes';
  add({
    id: 'growth_shown',
    group: 'traction',
    title: 'The growth rate is given',
    severity: 'tip',
    status: !sharing ? 'na' : growthGiven ? 'pass' : 'fail',
    detail: growthGiven ? (F.n('x_rev_growth') !== null ? 'Revenue ' + F.n('x_rev_growth') + '% a month' : 'Users ' + F.n('x_user_growth') + '% a month') : '',
    fix: 'Give the month-over-month growth of revenue or active users over the last three to six months.',
    why: 'Kenan Saleh (speedrun): "We\'re looking for the slope of the team."',
    target: { kind: 'answer', key: F.v('x_share_revenue') === 'yes' ? 'x_rev_growth' : 'x_user_growth' },
  });
  const investors = L('lib_answers').rowsOf(F.v('x_investors'));
  const noEmail = investors.filter((r) => !r.email);
  add({
    id: 'investor_contacts',
    group: 'traction',
    title: 'Every investor has an email for references',
    severity: 'warning',
    status: F.v('x_raised') !== 'yes' || investors.length === 0 ? 'na' : noEmail.length === 0 ? 'pass' : 'fail',
    detail: noEmail.length > 0 ? 'No email for ' + noEmail.map((r) => r.name || 'a row').join(', ') : investors.length + (investors.length === 1 ? ' investor' : ' investors'),
    fix: 'Give an email that reaches each investor.',
    why: 'speedrun\'s form: "This helps us contact them for a reference check if necessary."',
    target: { kind: 'answer', key: 'x_investors' },
  });
  add({
    id: 'website',
    group: 'traction',
    title: 'A website or product partners can open',
    severity: 'tip',
    status: F.v('s_website') !== '' ? 'pass' : 'fail',
    detail: F.v('s_website') !== '' ? '' : 'No website',
    fix: 'Put up a page that shows the product working, even a short demo video with a sign-up.',
    why: 'speedrun looks for "evidence that you know how to ship".',
    target: { kind: 'answer', key: 's_website' },
  });
  add({
    id: 'deck',
    group: 'traction',
    title: 'A short deck with a team slide',
    severity: 'tip',
    status: F.v('x_deck') !== '' ? 'pass' : 'fail',
    detail: F.v('x_deck') !== '' ? '' : 'No deck attached',
    fix: 'Seven to ten slides in large type: traction charts, the product, the market map, and always a team slide. Upload the PDF under Links and files.',
    why: 'speedrun: "Include visuals in the deck that cannot be properly conveyed in the application fields ... A deck should always have a team slide."',
    target: { kind: 'answer', key: 'x_deck' },
  });

  /* --------------------------------------------------------------- video */
  add({
    id: 'video',
    group: 'video',
    title: 'A team video of up to 3 minutes',
    severity: 'warning',
    status: F.v('x_video') !== '' ? 'pass' : 'fail',
    detail: F.v('x_video') !== '' ? '' : 'No video yet',
    fix: 'Record up to 3 minutes on your phone: at least half on you and your team, the rest on what you build, why it is big and your progress. Save it as MP4.',
    first: F.v('x_video') === '',
    why: 'speedrun: "there\'s an optional video upload right in the application. It almost always helps. And polish isn\'t what we\'re grading for."',
    target: { kind: 'answer', key: 'x_video' },
  });
  const rules = ['under_3_min', 'half_on_team', 'covers_rest', 'own_voice'];
  const ticked = rules.filter((r) => cf[r] === true);
  add({
    id: 'video_rules',
    group: 'video',
    title: 'The video follows speedrun\'s guide',
    severity: 'warning',
    status: F.v('x_video') === '' ? 'na' : ticked.length === rules.length ? 'pass' : 'fail',
    detail: ticked.length + ' of 4 confirmed',
    fix: 'Three minutes or less; at least half on the team; the rest on product, market and progress; your own voices, no AI voice.',
    target: { kind: 'answer', key: 'x_video' },
  });

  /* ------------------------------------------------------ before you apply */
  const declare = (key, title, severity, fix, why, first) =>
    add({ id: 'confirm_' + key, group: 'before', title: title, severity: severity, status: cf[key] === true ? 'pass' : 'fail', detail: cf[key] === true ? 'Confirmed' : 'Not confirmed', fix: fix, why: why, first: first && cf[key] !== true, confirm: key, target: { kind: 'confirm', key: key } });
  declare('residency', 'We can join the residency in San Francisco', 'warning', 'The residency is in person in San Francisco: about one day a week at the office, plus the founder retreat and Demo Day. speedrun helps international founders with visas.', 'speedrun FAQ: "The twelve weeks happen in person at our San Francisco office ... You don\'t need to move your company permanently."', true);
  declare('full_time_if_accepted', 'Every founder builds full-time during the residency', n > 0 && part.length > 0 ? 'warning' : 'tip', 'Agree that every founder builds full-time from the start of the residency.', 'speedrun FAQ: "Outside of that, we expect you to be building your startup full-time."', true);
  declare('one_application', 'One application, on your strongest idea', 'warning', 'Send one application for one company, from the CEO.', 'Marcus Segal (speedrun) on applications for several companies: "We\'re not here to pick from your list of ideas."', false);
  declare('ip_clear', 'No employer or school can claim the code or the idea', 'warning', 'Build on your own time and equipment, and check your employment contract.', 'Employer IP claims are a common blocker to investment.', true);
  declare('goals_aligned', 'Founders agree on roles, goals and who is CEO', 'tip', 'Settle roles and the CEO before writing the answers; the form starts with the CEO.', 'Joshua Lu (speedrun) looks for "clear, defined roles" in the interview.', true);

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
  const gaps = founderGaps(F);
  add({
    id: 'founder_fields',
    group: 'form',
    title: 'Every founder\'s form fields are filled',
    severity: 'blocker',
    status: n === 0 ? 'na' : gaps.length === 0 ? 'pass' : 'fail',
    detail: gaps.map((g) => g.name + ': ' + g.missing.join(', ')).join('; '),
    fix: 'Fill each founder\'s details on the team page: name, email, location, citizenship, and for the CEO phone, college, years of experience and LinkedIn.',
    target: { kind: 'team' },
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
    title: 'Sent early, before the deadline',
    severity: days !== null && days < 0 ? 'warning' : 'tip',
    status: days === null ? 'na' : F.settings.status !== 'preparing' ? 'pass' : days >= 0 ? 'pass' : 'fail',
    detail: days === null ? '' : days >= 0 ? (days < 1 ? Math.max(0, Math.floor(days * 24)) + ' hours left (' + F.settings.cohort + ')' : Math.floor(days) + ' days left (' + F.settings.cohort + ')') : 'The ' + F.settings.cohort + ' deadline passed ' + Math.ceil(-days) + ' days ago',
    fix: days !== null && days < 0 ? 'Apply anyway: speedrun reviews year-round and considers you for the next residency.' : 'Send it as soon as it is ready: "Early apps get the first look", and last-minute ones take longer to read.',
    why: 'speedrun: "Don\'t be the founder hitting submit 30 seconds before the deadline."',
    target: { kind: 'settings' },
  });
  add({
    id: 'referral',
    group: 'form',
    title: 'Someone speedrun trusts refers you',
    severity: 'tip',
    status: F.v('x_referred') === 'yes' ? 'pass' : 'fail',
    detail: '',
    fix: 'Optional. If a speedrun founder, scout or someone at a16z knows your work, ask them to refer you. If not, focus on the rest.',
    why: 'speedrun (2025): "Having a referral helps ... In-network: founder > employee > other ppl we respect/admire." and "if you don\'t have that, just focus on the fundamentals".',
    target: { kind: 'answer', key: 'x_referred' },
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

module.exports = { GROUPS: GROUPS, METRIC_KEYS: METRIC_KEYS, facts: facts, run: run, summary: summary, list: list, metrics: metrics, metricProblems: metricProblems, founderGaps: founderGaps };
