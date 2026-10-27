/**
 * The YC application, question by question, in the order of YC's form
 * (Founders, Company, Progress, Idea, Equity, Curious) plus each founder's
 * profile. Wording follows the most recent published application (Spring
 * 2025) and YC's own wording where it is longer; YC trims questions between
 * batches, so your AI agent compares this set with the live form before it
 * fills it (the fill recipe leaves a field that differs empty and says so).
 *
 * Plain data: no PocketBase globals, so Node tools can read it too.
 *
 *   key       stable id (answers.key)
 *   section   founders | company | progress | idea | equity | curious
 *   label     the question as YC asks it
 *   type      long | short | url | yesno | number | choice | months
 *   limit     hard character limit (only the one-liner has one)
 *   required  YC needs an answer (when its gate is open)
 *   gate      { key, is }: asked only when another answer is yes or no
 *   by        fill    your AI agent fills it from the founders' material
 *             draft   your AI agent drafts it; a founder rewrites it in their own words
 *             founder only a founder knows; your AI agent asks for it
 *   judge     reviewed answer by answer (marketing speak, vagueness, length)
 *   words     the length past which every extra word costs (PG: "every
 *             unnecessary word subtracts"); a count, never a hard limit
 *   tip       what a strong answer has (shown on hover)
 *   rubric    what the reviewer looks for: a strong answer, then failure modes
 */

const SECTIONS = [
  { key: 'founders', label: 'Founders' },
  { key: 'company', label: 'Company' },
  { key: 'progress', label: 'Progress' },
  { key: 'idea', label: 'Idea' },
  { key: 'equity', label: 'Equity' },
  { key: 'curious', label: 'Curious' },
];

const CATEGORIES = ['B2B', 'Consumer', 'Developer tools', 'Education', 'Fintech', 'Government', 'Healthcare', 'Industrials', 'Real estate and construction', 'Other'];

const QUESTIONS = [
  /* Founders */
  {
    key: 'f_tech',
    section: 'founders',
    label: 'Who writes code, or does other technical work on your product? Was any of it done by a non-founder? Please explain.',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 80,
    tip: 'Name the founders who build it. Disclose any contractor or agency and who owns the code.',
    rubric: 'Strong: names which founders built what, and discloses any non-founder work with IP clarity. Failure modes: the core product built by contractors or an agency; vague about who built what; no technical founder.',
  },
  {
    key: 'f_looking',
    section: 'founders',
    label: 'Are you looking for a cofounder?',
    type: 'yesno',
    required: true,
    by: 'founder',
    judge: false,
    tip: 'Say yes if you are a solo founder or missing a technical cofounder. YC runs Co-Founder Matching.',
  },
  {
    key: 'f_known',
    section: 'founders',
    label: 'How long have the founders known one another and how did you meet? Have any of the founders not met in person?',
    type: 'long',
    required: true,
    by: 'founder',
    judge: true,
    words: 70,
    tip: 'Years, where you met, and what you built or did together. Teams that already worked together are a plus.',
    rubric: 'Strong: concrete history (years, where, a shared project or job). Failure modes: founders who met recently with no shared work and no acknowledgement of it; vague "we are old friends".',
  },
  {
    key: 'f_video',
    section: 'founders',
    label: 'Founder video: a one minute video of all the founders talking (link)',
    type: 'url',
    required: true,
    by: 'founder',
    judge: false,
    tip: 'One minute, every founder on camera, just talking: no demo, no music, not read from a script (ycombinator.com/video).',
  },

  /* Company */
  { key: 'c_name', section: 'company', label: 'Company name', type: 'short', required: true, by: 'fill', judge: false, tip: 'The name you use with users today.' },
  {
    key: 'c_desc',
    section: 'company',
    label: 'Describe what your company does in 50 characters or less.',
    type: 'short',
    limit: 50,
    required: true,
    by: 'draft',
    judge: true,
    words: 10,
    tip: 'A concrete "X for Y" a parent would understand: what it is and who it is for. No buzzwords.',
    rubric: 'Strong: a concrete "X for Y" that names the product and the customer, understandable by a non-technical parent. Failure modes: buzzwords ("AI-powered platform revolutionizing"), an obscure analogy, a vision instead of a product, over 50 characters.',
  },
  { key: 'c_url', section: 'company', label: 'Company URL, if any', type: 'url', required: false, by: 'fill', judge: false, tip: 'Your website or product page.' },
  {
    key: 'c_demo',
    section: 'company',
    label: 'If you have a demo, what is the URL? (a short product video or a live demo)',
    type: 'url',
    required: false,
    by: 'fill',
    judge: false,
    tip: 'A short screen recording of the product working beats a promo. Optional but strong.',
  },
  {
    key: 'c_product',
    section: 'company',
    label: 'Please provide a link to the product, if any. (with a login and password if it needs one)',
    type: 'url',
    required: false,
    by: 'fill',
    judge: false,
    tip: 'Partners look at what you have built. Give them a way in.',
  },
  {
    key: 'c_what',
    section: 'company',
    label: 'What is your company going to make? Please describe your product and what it does or will do.',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 120,
    tip: 'Two to four plain sentences: what it does today, for whom, and where it goes. A stranger should be able to repeat it.',
    rubric: 'Strong: 2-4 plain sentences on what it does today, for whom, and the long-term version; comparative framing ("Wikipedia, but within an organization") is fine. Failure modes: marketing speak; abstractions with no content; features without a user; the future described as if it exists today.',
  },
  {
    key: 'c_location',
    section: 'company',
    label: 'Where do you live now, and where would the company be based after YC?',
    type: 'short',
    required: true,
    by: 'fill',
    judge: false,
    tip: 'City and country for each founder now, and where the company will be after the batch.',
  },
  {
    key: 'c_location_why',
    section: 'company',
    label: 'Explain your decision regarding location.',
    type: 'long',
    required: false,
    by: 'draft',
    judge: true,
    words: 60,
    tip: 'One or two sentences: where your users, hires or market are.',
    rubric: 'Strong: one concrete reason tied to users, hiring or the market. Failure modes: generic praise of a city; no reason.',
  },

  /* Progress */
  {
    key: 'p_far',
    section: 'progress',
    label: 'How far along are you?',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 100,
    tip: 'Dated facts: what is built, when it launched, users, revenue, growth. No predictions.',
    rubric: 'Strong: dated facts such as the launch date, what is built, users, revenue and growth. Failure modes: predictions instead of progress; cumulative or vanity numbers; hiding that it is only an idea (40% of funded companies are just an idea, so say so plainly).',
  },
  {
    key: 'p_time',
    section: 'progress',
    label: 'How long have each of you been working on this? How much of that has been full-time? Please explain.',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 70,
    tip: 'Per founder: since when, and since when full-time. Part-time is fine to state; hiding it is not.',
    rubric: 'Strong: per founder, the start date and the full-time date. Failure modes: hiding part-time status; no dates.',
  },
  {
    key: 'p_stack',
    section: 'progress',
    label: 'What tech stack are you using, or planning to use, to build this product? Include AI models and AI coding tools you use.',
    type: 'long',
    required: true,
    by: 'fill',
    judge: true,
    words: 70,
    tip: 'The languages, frameworks, infrastructure, models and AI coding tools you actually use.',
    rubric: 'Strong: a concrete list of what is actually used (languages, frameworks, infrastructure, models, AI coding tools). Failure modes: buzzword lists; tools not actually used.',
  },
  {
    key: 'p_session',
    section: 'progress',
    label: 'Optional: attach a coding agent session you are particularly proud of (.md or .txt, up to 10MB). Give its file path or link.',
    type: 'url',
    required: false,
    by: 'founder',
    judge: false,
    tip: 'A real session on this product that shows you steering, checking and shipping. Never a toy task or an edited transcript.',
  },
  { key: 'p_using', section: 'progress', label: 'Are people using your product?', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Yes if anyone outside the team uses it, even for free.' },
  {
    key: 'p_users',
    section: 'progress',
    label: 'How many active users or customers do you have? How many are paying? Who is paying you the most, and how much do they pay you?',
    type: 'long',
    required: true,
    gate: { key: 'p_using', is: 'yes' },
    by: 'fill',
    judge: true,
    words: 80,
    tip: 'Active (not signed up) users, paying users, and your biggest customer with the amount.',
    rubric: 'Strong: active users (not total signups), paying users, the largest customer and what they pay. Failure modes: signups or waitlists counted as users; letters of intent counted as customers; no numbers.',
  },
  {
    key: 'p_launch',
    section: 'progress',
    label: 'When will you have a version people can use?',
    type: 'short',
    required: true,
    gate: { key: 'p_using', is: 'no' },
    by: 'draft',
    judge: false,
    tip: 'A date, and what will be in it.',
  },
  { key: 'p_revenue', section: 'progress', label: 'Do you have revenue?', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Revenue means money received, not letters of intent or GMV.' },
  {
    key: 'p_revenue_months',
    section: 'progress',
    label: 'Your revenue in each of the last six months, in US dollars (monthly, not cumulative, and not GMV).',
    type: 'months',
    required: true,
    gate: { key: 'p_revenue', is: 'yes' },
    by: 'fill',
    judge: false,
    tip: 'Each month on its own, not a running total. For marketplaces and ecommerce, gross profit rather than GMV. Enter 0 for empty months.',
  },
  {
    key: 'p_find',
    section: 'progress',
    label: 'How do users find your product? How did you get the users you have now? If you run paid ads, what is your cost of acquisition?',
    type: 'long',
    required: true,
    gate: { key: 'p_using', is: 'yes' },
    by: 'draft',
    judge: true,
    words: 80,
    tip: 'The real channels with rough shares, and the cost per customer if you pay for them.',
    rubric: 'Strong: the actual channels with a rough split and the real cost of acquisition. Failure modes: "it will go viral" with no data; listing channels you have not used.',
  },
  { key: 'p_prev', section: 'progress', label: 'Have you applied to YC before?', type: 'yesno', required: true, by: 'founder', judge: false, tip: 'About half of each batch applied more than once. Reapplying is normal.' },
  {
    key: 'p_prev_change',
    section: 'progress',
    label: 'If you are applying with the same idea as a previous batch, did anything change? If you applied with a different idea, why did you pivot and what did you learn from the last idea?',
    type: 'long',
    required: true,
    gate: { key: 'p_prev', is: 'yes' },
    by: 'draft',
    judge: true,
    words: 90,
    tip: 'What measurably changed since last time (users, revenue, product, team), or what the last idea taught you.',
    rubric: 'Strong: a measurable change since the last application, or a clear lesson from the pivot. Failure modes: "nothing changed"; repeating the old answers; no lesson.',
  },
  {
    key: 'p_accel',
    section: 'progress',
    label: 'If you have already participated or committed to participate in an incubator, accelerator or pre-accelerator program, please tell us about it.',
    type: 'long',
    required: false,
    by: 'founder',
    judge: true,
    words: 60,
    tip: 'Name the program, the dates and any terms (equity, money). Leave empty if none.',
    rubric: 'Strong: program names, dates and terms. Failure modes: leaving out a program you joined.',
  },

  /* Idea */
  {
    key: 'i_why',
    section: 'idea',
    label: 'Why did you pick this idea to work on? Do you have domain expertise in this area? How do you know people need what you are making?',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 120,
    tip: 'Your own pain or insider experience, and evidence of demand: named conversations, usage, payments.',
    rubric: 'Strong: personal pain or insider experience (founder-market fit) plus evidence of demand such as named user conversations, usage or payments. Failure modes: market-size claims instead of user evidence; no link between the founders and the problem; chasing whatever idea is popular this year.',
  },
  {
    key: 'i_new',
    section: 'idea',
    label: 'What is new about what you are making? What substitutes do people resort to because it does not exist yet (or they do not know about it)?',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 100,
    tip: 'What people do today instead (spreadsheets, agencies, nothing) and why that is worse.',
    rubric: 'Strong: names the substitutes people use today and why they are worse. Failure modes: "nothing like this exists"; no substitutes named.',
  },
  {
    key: 'i_competitors',
    section: 'idea',
    label: 'Who are your competitors? What do you understand about your business that they do not?',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 120,
    tip: 'Name incumbents, startups and alternatives, then one non-obvious insight (Dropbox: competitors "work at the wrong layer of abstraction").',
    rubric: 'Strong: names incumbents, alternatives and startups, plus one non-obvious insight (the Dropbox "wrong layer of abstraction" pattern). Failure modes: "no competitors"; "better UX" or "easier to use" as the insight; leaving out obvious players.',
  },
  {
    key: 'i_money',
    section: 'idea',
    label: 'How do or will you make money? How much could you make?',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 90,
    tip: 'Who pays, how much, how often, and a bottom-up size: customers times price.',
    rubric: 'Strong: who pays, the price, and a bottom-up model (number of customers times price). Failure modes: top-down "1% of a $100B market"; no price.',
  },
  { key: 'i_category', section: 'idea', label: 'Which category best applies to your company?', type: 'choice', choices: CATEGORIES, required: true, by: 'fill', judge: false, tip: 'The category your customers would put you in.' },
  {
    key: 'i_other',
    section: 'idea',
    label: 'If you had any other ideas you considered applying with, please list them. One may be something we have been waiting for.',
    type: 'long',
    required: false,
    by: 'founder',
    judge: true,
    words: 80,
    tip: 'One to three one-line ideas. YC: "Often when we fund people it is to do something they list here."',
    rubric: 'Strong: one to three crisp alternative one-liners. Failure modes: near-duplicates of the main idea; vague themes.',
  },

  /* Equity */
  { key: 'e_entity', section: 'equity', label: 'Have you formed ANY legal entity yet?', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Any company, in any country, counts.' },
  {
    key: 'e_entities',
    section: 'equity',
    label: 'Please list all legal entities you have and in what state or country each was formed (e.g. Delaware C Corp, Singapore Pvt Ltd).',
    type: 'long',
    required: true,
    gate: { key: 'e_entity', is: 'yes' },
    by: 'fill',
    judge: false,
    tip: 'Every entity, its type and where it was formed.',
  },
  {
    key: 'e_breakdown',
    section: 'equity',
    label: 'Please describe the breakdown of the equity ownership in percentages among the founders, employees and any other stockholders. Give each founder\'s ownership and title.',
    type: 'long',
    required: true,
    by: 'fill',
    judge: false,
    tip: 'Written from the team page: each founder, title and percent, plus anyone else who owns shares.',
  },
  { key: 'e_invested', section: 'equity', label: 'Have you taken any investment yet?', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Include SAFEs, convertible notes and money from friends and family.' },
  {
    key: 'e_investments',
    section: 'equity',
    label: 'List each investment: investor, amount in US dollars, valuation or cap, security type and date.',
    type: 'long',
    required: true,
    gate: { key: 'e_invested', is: 'yes' },
    by: 'fill',
    judge: false,
    tip: 'Every SAFE and note. An undisclosed SAFE found later is a serious problem.',
  },
  { key: 'e_raising', section: 'equity', label: 'Are you currently fundraising?', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Yes if you are talking to investors now.' },
  {
    key: 'e_raising_detail',
    section: 'equity',
    label: 'Tell us about the round you are raising: how much, on what terms, and how much is committed.',
    type: 'long',
    required: false,
    gate: { key: 'e_raising', is: 'yes' },
    by: 'fill',
    judge: true,
    words: 60,
    tip: 'Amount, instrument, cap and what is already committed.',
    rubric: 'Strong: amount, instrument, cap and commitments so far. Failure modes: vague "raising a seed".',
  },
  { key: 'e_burn', section: 'equity', label: 'How much money do you spend per month? (US dollars)', type: 'number', required: true, by: 'fill', judge: false, tip: 'Average monthly spend, salaries included.' },
  { key: 'e_cash', section: 'equity', label: 'How much money does your company have in the bank now? (US dollars)', type: 'number', required: true, by: 'fill', judge: false, tip: 'Cash on hand today.' },
  { key: 'e_runway', section: 'equity', label: 'How long is your runway? (months)', type: 'number', required: true, by: 'fill', judge: false, tip: 'Cash divided by monthly spend. The review checks the arithmetic.' },

  /* Curious */
  {
    key: 'q_convinced',
    section: 'curious',
    label: 'What convinced you to apply to Y Combinator? Did someone encourage you to apply? Have you been to any YC events?',
    type: 'long',
    required: true,
    by: 'founder',
    judge: true,
    words: 60,
    tip: 'Specific and honest: a person, an event, an essay. Name a YC founder who encouraged you.',
    rubric: 'Strong: specific and honest (a person, an event, an essay). Failure modes: flattery; generic "the network and the brand".',
  },
  { key: 'q_heard', section: 'curious', label: 'How did you hear about Y Combinator?', type: 'short', required: true, by: 'founder', judge: false, tip: 'One line.' },
];

/** Each founder's profile, answered once per founder (answers.key fp.<founder>.<field>). */
const PROFILE = [
  {
    field: 'impressive',
    label: 'Please tell us in one or two sentences about the most impressive thing other than this startup that you have built or achieved.',
    type: 'long',
    required: true,
    by: 'draft',
    judge: true,
    words: 60,
    tip: 'Paul Graham calls this the most important question. One or two sentences with magnitude and proof: numbers, links, rank.',
    rubric: 'This is the most important question on the application (Paul Graham). Strong: one or two sentences per founder with magnitude and proof (numbers, users, links, rank). Failure modes: job titles or duties; adjectives ("exceptionally dedicated"); a team achievement with no personal role.',
  },
  {
    field: 'hack',
    label: 'Tell us about the time you most successfully hacked some (non-computer) system to your advantage.',
    type: 'long',
    required: true,
    by: 'founder',
    judge: true,
    words: 90,
    tip: 'A short, true, specific story of beating a system. Not a computer hack, not a hard-work story.',
    rubric: 'Strong: a short, true, specific story of beating a system (a rule, an institution, a market). Failure modes: a computer hack; a generic hard-work story; an embellished or invented anecdote.',
  },
  {
    field: 'built',
    label: 'Tell us about things you have built before (apps, websites, open source, hardware), with links.',
    type: 'long',
    required: false,
    by: 'fill',
    judge: true,
    words: 90,
    tip: 'Real things with links and numbers: users, stars, revenue.',
    rubric: 'Strong: real built things with links and numbers (users, stars, revenue). Failure modes: course projects presented as products; no links.',
  },
  {
    field: 'awards',
    label: 'List any competitions or awards you have won, or papers you have published.',
    type: 'long',
    required: false,
    by: 'fill',
    judge: false,
    words: 60,
    tip: 'Name, year and rank. Leave empty if none.',
  },
];

/**
 * What only the founders can confirm: the founder video rules and the
 * things YC expects to be settled before applying. Each is a tick on the
 * screens and a boolean of settings.update.
 */
const CONFIRMS = [
  { key: 'one_minute', group: 'video', label: 'One minute long', tip: 'YC: "The video should be 1 minute long."' },
  { key: 'all_founders', group: 'video', label: 'Every founder is in it', tip: 'YC: "If you have more than one founder, have all of your founders in the video."' },
  { key: 'unscripted', group: 'video', label: 'Talking, not reading a script', tip: 'YC: "Do not recite a written script: Use bullet points instead."' },
  { key: 'no_extras', group: 'video', label: 'No demo, music or effects', tip: 'YC: "nothing except the founders talking"; "This is not the place to submit a demo or promotional video."' },
  { key: 'full_time_if_accepted', group: 'before', label: 'Every founder works on it full-time if accepted', tip: 'YC expects founders to work full-time during the batch and afterwards.' },
  { key: 'one_application', group: 'before', label: 'This is our only application this batch', tip: 'One company applies once per batch.' },
  { key: 'vesting', group: 'before', label: 'Founder shares vest (four years, one-year cliff)', tip: 'Vesting protects the company if a founder leaves; YC recommends it.' },
  { key: 'ip_clear', group: 'before', label: 'No employer or school can claim the code or the idea', tip: 'Build on your own time and equipment; employer IP claims block investment.' },
  { key: 'goals_aligned', group: 'before', label: 'We agree on roles, goals and who is CEO', tip: 'Settle it before writing the answers; partners ask.' },
  { key: 'revenue_monthly', group: 'revenue', label: 'Each month on its own: not cumulative, not GMV', tip: 'YC asks for revenue per month, never running totals or gross merchandise value.' },
];

/** Short names for the screens (the full YC wording shows when a question is open). */
const SHORT = {
  f_tech: 'Who builds it',
  f_looking: 'Looking for a cofounder?',
  f_known: 'How you met',
  f_video: 'Founder video',
  c_name: 'Company name',
  c_desc: 'One-liner',
  c_url: 'Website',
  c_demo: 'Demo link',
  c_product: 'Product link',
  c_what: 'What you make',
  c_location: 'Where you are',
  c_location_why: 'Why there',
  p_far: 'How far along',
  p_time: 'Time on it',
  p_stack: 'Tech stack',
  p_session: 'Coding agent session',
  p_using: 'People using it?',
  p_users: 'Users and customers',
  p_launch: 'Launch date',
  p_revenue: 'Revenue?',
  p_revenue_months: 'Monthly revenue',
  p_find: 'How users find you',
  p_prev: 'Applied before?',
  p_prev_change: 'What changed',
  p_accel: 'Other programs',
  i_why: 'Why this idea',
  i_new: 'What is new',
  i_competitors: 'Competitors',
  i_money: 'How you make money',
  i_category: 'Category',
  i_other: 'Other ideas',
  e_entity: 'Company formed?',
  e_entities: 'Legal entities',
  e_breakdown: 'Equity split',
  e_invested: 'Investment taken?',
  e_investments: 'Investments',
  e_raising: 'Raising now?',
  e_raising_detail: 'The round',
  e_burn: 'Monthly spend',
  e_cash: 'Cash in bank',
  e_runway: 'Runway',
  q_convinced: 'Why YC',
  q_heard: 'How you heard of YC',
  impressive: 'Most impressive thing',
  hack: 'Hack story',
  built: 'Things built',
  awards: 'Awards',
};

function shortOf(key) {
  const prof = profileOf(key);
  if (prof !== null) return SHORT[prof.q.field] || prof.q.label;
  return SHORT[key] || key;
}

function byKey(key) {
  for (const q of QUESTIONS) if (q.key === key) return q;
  return null;
}

/** The profile question a key such as fp.<founder>.impressive refers to (null otherwise). */
function profileOf(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3 || parts[0] !== 'fp') return null;
  for (const p of PROFILE) if (p.field === parts[2]) return { founder: parts[1], q: Object.assign({ key: key, section: 'profile' }, p) };
  return null;
}

/** The question definition for any answer key (form question or founder profile). */
function definition(key) {
  const q = byKey(key);
  if (q !== null) return q;
  const p = profileOf(key);
  return p === null ? null : p.q;
}

module.exports = { SECTIONS: SECTIONS, QUESTIONS: QUESTIONS, PROFILE: PROFILE, CATEGORIES: CATEGORIES, CONFIRMS: CONFIRMS, SHORT: SHORT, shortOf: shortOf, byKey: byKey, profileOf: profileOf, definition: definition };
