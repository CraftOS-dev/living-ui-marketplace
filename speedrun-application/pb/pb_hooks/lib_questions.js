/**
 * The a16z speedrun application, question by question, in the order of the
 * SR008 form at speedrun.a16z.com/apply/form (read 2026-10-30): Team,
 * Startup Details, then Additional Information (team video, pitch deck,
 * traction, funding history, the active round, referral, where you heard of
 * speedrun). Each founder's details live on the team page; their "Relevant
 * experience" is a profile answer. speedrun changes its form between
 * cohorts, so your AI agent compares this set with the live form before it
 * fills it (the fill recipe leaves a field that differs empty and says so).
 *
 * Plain data: no PocketBase globals, so Node tools can read it too.
 *
 *   key       stable id (answers.key)
 *   section   team | startup | traction | funding | more
 *   label     the question as speedrun asks it
 *   type      long | short | url | yesno | number | choice | month | date | rows
 *   unit      for numbers: usd | percent | count | months
 *   columns   for rows: [{ key, label, num }]
 *   limit     hard character limit, as the form enforces it
 *   required  speedrun needs an answer (when its gate is open)
 *   gate      { key, is }: asked only when another answer is yes or no;
 *             gates nest (a gated question's own gate must be open too)
 *   by        fill    your AI agent fills it from the founders' material
 *             draft   your AI agent drafts it; a founder rewrites it in their own words
 *             founder only a founder knows; your AI agent asks for it
 *   derived   written from the team page while no one has written it by hand
 *   judge     reviewed answer by answer (marketing speak, vagueness, length)
 *   words     the length past which every extra word costs; a count, never a hard limit
 *   tip       what a strong answer has (shown on hover)
 *   rubric    what the reviewer looks for: a strong answer, then failure modes
 */

const SECTIONS = [
  { key: 'team', label: 'Team' },
  { key: 'startup', label: 'Startup' },
  { key: 'traction', label: 'Traction' },
  { key: 'funding', label: 'Funding' },
  { key: 'more', label: 'Video and more' },
];

const CATEGORIES = ['B2B / Enterprise Applications', 'Consumer Applications', 'Deep Tech', 'Gaming / Entertainment Studio', 'Infrastructure / Dev Tools', 'Healthcare', 'GovTech', 'Crypto', 'Other'];
const EMPLOYMENT = ['Full-time', 'Part-time'];
const EDUCATION = ['High School Degree', "Bachelor's Degree (BA, BS)", "Master's / Professional Degree (MD, MBA, JD, etc.)", 'Doctoral Degree (PhD)'];
const HEARD = ['X / Twitter', 'LinkedIn', 'Speedrun Newsletter / Substack', 'Speedrun Alumni', 'Speedrun Scout', 'Friend', 'Investor', 'Event', 'a16z Team', 'Other'];

/** The country list of the form's selects (founder location, citizenship, where you build). */
const COUNTRIES = [
  'United States of America', 'Andorra', 'Afghanistan', 'Antigua and Barbuda', 'United Arab Emirates', 'Algeria', 'Angola', 'Argentina', 'Armenia', 'Austria', 'Australia', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Belarus', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Cook Islands', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macao', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Kingdom', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe', 'Other',
];

const QUESTIONS = [
  /* Team */
  {
    key: 't_employment',
    section: 'team',
    label: 'Are you full-time or part-time on the startup?',
    type: 'choice',
    choices: EMPLOYMENT,
    required: true,
    by: 'fill',
    derived: true,
    judge: false,
    tip: 'Written from the team page (the first founder is the one applying). Part-time is fine to state; hiding it is not.',
  },
  {
    key: 't_ft_founders',
    section: 'team',
    label: 'Number of Full-Time Founders: how many founders are working full-time on your startup? Founders are individuals with over 10% equity. If you are part-time or not yet incorporated, enter 0 and add all co-founders below.',
    type: 'number',
    unit: 'count',
    required: true,
    by: 'fill',
    derived: true,
    judge: false,
    tip: 'Counted from the team page (0 when the founder applying is part-time). speedrun also asks for 0 when you are not incorporated yet: write 0 here by hand if so.',
  },
  {
    key: 't_fte',
    section: 'team',
    label: 'Total FTE Employees: how many full-time equivalent employees (including founders) are currently at your startup? Part-time staff count proportionally (two half-time employees = 1 FTE).',
    type: 'number',
    unit: 'count',
    required: true,
    by: 'fill',
    judge: false,
    tip: 'Founders included. Two half-time people count as one.',
  },
  {
    key: 't_team',
    section: 'team',
    label: 'Tell us more about the team: how does the team know each other? Is there anyone else on the team? Why is this the best team to win? Do you have any key advisors?',
    type: 'long',
    limit: 1000,
    required: true,
    by: 'draft',
    judge: true,
    words: 140,
    tip: 'How long you have known each other and what you built together, who else is on the team, the one reason this team wins this market, and named advisors.',
    rubric: 'Strong: concrete history (years, where, a shared project or job), who else works on it, one specific reason this team wins this market (an unfair advantage: domain access, a past exit, a technical edge), and named advisors with why they matter. Failure modes: founders who met recently with no shared work and no acknowledgement of it; "passionate and hardworking" instead of proof; adjectives instead of track record; advisors named with no role.',
  },

  /* Startup details */
  { key: 's_name', section: 'startup', label: 'Startup Name', type: 'short', required: true, by: 'fill', judge: false, tip: 'The name you use with users today.' },
  {
    key: 's_oneliner',
    section: 'startup',
    label: 'Pitch your startup in one sentence. What do you do and for whom? (e.g. "AI-powered therapist for Gen Z")',
    type: 'short',
    limit: 100,
    required: true,
    by: 'draft',
    judge: true,
    words: 16,
    tip: 'What you do and for whom, in one plain sentence under 100 characters: "X for Y". No buzzwords.',
    rubric: 'Strong: one plain sentence naming the product and the customer ("X for Y"), concrete enough that a stranger could repeat it, under 100 characters. Failure modes: buzzwords ("AI-powered platform revolutionizing"), a vision instead of a product, no customer named, two sentences, over 100 characters.',
  },
  {
    key: 's_desc',
    section: 'startup',
    label: 'Startup Description: what problem are you solving? What are you building?',
    type: 'long',
    limit: 800,
    required: true,
    by: 'draft',
    judge: true,
    words: 120,
    tip: 'The problem in one or two sentences (who has it, how they cope today), then what you build and what it does today. Specific, with numbers where you have them.',
    rubric: 'Strong: the problem (who has it, how painful, what they do today) and the product (what it does today, for whom, how it is different), in plain words with specifics, within 800 characters. Failure modes: marketing speak; abstractions with no content; features without a user; the future described as if it exists today; market-size arithmetic instead of the problem.',
  },
  { key: 's_category', section: 'startup', label: 'Primary Category: select the closest match for your startup. If none apply, choose Other.', type: 'choice', choices: CATEGORIES, required: true, by: 'fill', judge: false, tip: 'The category your customers would put you in.' },
  { key: 's_category2', section: 'startup', label: 'Secondary Category (optional): if your startup fits more than one category, select a second one.', type: 'choice', choices: CATEGORIES, required: false, by: 'fill', judge: false, tip: 'Only when a second category truly fits.' },
  { key: 's_country', section: 'startup', label: 'Where do you intend to build your startup? (country)', type: 'choice', choices: COUNTRIES, required: true, by: 'fill', judge: false, tip: 'Where the company will be built, as the form lists the country.' },
  { key: 's_state', section: 'startup', label: 'State (United States only)', type: 'short', required: false, gate: { key: 's_country', is: 'United States of America' }, by: 'fill', judge: false, tip: 'The US state, when you build in the United States.' },
  { key: 's_city', section: 'startup', label: 'Startup Location (City)', type: 'short', required: true, by: 'fill', judge: false, tip: 'The city you will build in.' },
  { key: 's_founded', section: 'startup', label: 'When was your startup founded? (year and month)', type: 'month', required: true, by: 'fill', judge: false, tip: 'The month you started working on it as a company.' },
  { key: 's_website', section: 'startup', label: 'Company Website (optional)', type: 'url', required: false, by: 'fill', judge: false, tip: 'Your website or product page. A live product partners can open is strong.' },
  {
    key: 's_other',
    section: 'startup',
    label: 'Anything else we should know? (optional) If there is something that does not fit elsewhere, drop it here.',
    type: 'long',
    limit: 1000,
    required: false,
    by: 'draft',
    judge: true,
    words: 100,
    tip: 'Only what changes the picture: a demo link with a login, a notable customer, a waitlist with numbers, a press mention. Leave it empty rather than repeat yourself.',
    rubric: 'Strong: one or two facts that add to the rest (a demo link, a named customer, a launch result) with numbers or links. Failure modes: repeating earlier answers; a second pitch; marketing speak; filler.',
  },

  /* Traction (Additional Information) */
  { key: 'x_has_traction', section: 'traction', label: 'Have you launched and started measuring traction? (opens the Traction section)', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Yes once a working version is with users and you measure something. speedrun: "we\'d love to see the data".' },
  { key: 'x_launch', section: 'traction', label: 'Product Launch Date: when did you first launch a working version to users?', type: 'month', required: true, gate: { key: 'x_has_traction', is: 'yes' }, by: 'fill', judge: false, tip: 'The month real users first got a working version.' },
  {
    key: 'x_traction_notes',
    section: 'traction',
    label: 'Any general commentary on your traction?',
    type: 'long',
    limit: 1000,
    required: false,
    gate: { key: 'x_has_traction', is: 'yes' },
    by: 'draft',
    judge: true,
    words: 110,
    tip: 'Dated facts: users, paying customers, growth, retention, the biggest customer. Not cumulative signups, not predictions.',
    rubric: 'Strong: dated facts such as active users, paying customers, revenue, month-over-month growth, retention and the largest customer, with the time window stated. Failure modes: predictions instead of progress; cumulative or vanity numbers (signups, waitlists, impressions) presented as usage; letters of intent counted as customers; no numbers.',
  },
  { key: 'x_share_revenue', section: 'traction', label: 'Share revenue metrics (ARR, contract value, net dollar retention, growth)?', type: 'yesno', required: true, gate: { key: 'x_has_traction', is: 'yes' }, by: 'fill', judge: false, tip: 'Yes if you have revenue. Real money received, not letters of intent.' },
  { key: 'x_arr', section: 'traction', label: 'Annual Recurring Revenue (USD)', type: 'number', unit: 'usd', required: true, gate: { key: 'x_share_revenue', is: 'yes' }, by: 'fill', judge: false, tip: 'Recurring revenue today times 12. Not one-off fees, not GMV.' },
  { key: 'x_acv', section: 'traction', label: 'Avg. Annual Contract Value (USD)', type: 'number', unit: 'usd', required: false, gate: { key: 'x_share_revenue', is: 'yes' }, by: 'fill', judge: false, tip: 'What an average customer pays a year.' },
  { key: 'x_ndr', section: 'traction', label: 'Net Dollar Retention (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_revenue', is: 'yes' }, by: 'fill', judge: false, tip: 'Revenue this year from last year\'s customers, divided by their revenue last year. Leave empty if under a year of data.' },
  { key: 'x_rev_growth', section: 'traction', label: 'Monthly revenue growth rate (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_revenue', is: 'yes' }, by: 'fill', judge: false, tip: 'Average month-over-month growth over the last three to six months.' },
  { key: 'x_share_usage', section: 'traction', label: 'Share usage metrics (active users, growth, retention)?', type: 'yesno', required: true, gate: { key: 'x_has_traction', is: 'yes' }, by: 'fill', judge: false, tip: 'Yes if you measure active users.' },
  { key: 'x_dau', section: 'traction', label: 'Daily Active Users', type: 'number', unit: 'count', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'People who used it on an average day. Active, not signed up.' },
  { key: 'x_wau', section: 'traction', label: 'Weekly Active Users', type: 'number', unit: 'count', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'People who used it in an average week.' },
  { key: 'x_mau', section: 'traction', label: 'Monthly Active Users', type: 'number', unit: 'count', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'People who used it in the last month.' },
  { key: 'x_user_growth', section: 'traction', label: 'Monthly user growth rate (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'Average month-over-month growth of active users.' },
  { key: 'x_d1', section: 'traction', label: 'Day 1 retention, D1 (%): users who return exactly one day after signup', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'Bounded retention: the share who come back on day 1 exactly.' },
  { key: 'x_d7', section: 'traction', label: 'Day 7 retention, D7 (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'The share who come back on day 7 exactly.' },
  { key: 'x_d30', section: 'traction', label: 'Day 30 retention, D30 (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'The share who come back on day 30 exactly.' },
  { key: 'x_m1', section: 'traction', label: 'Month 1 retention, M1 (%)', type: 'number', unit: 'percent', required: false, gate: { key: 'x_share_usage', is: 'yes' }, by: 'fill', judge: false, tip: 'The share still active in their second month.' },

  /* Funding history and the active round (Additional Information) */
  { key: 'x_raised', section: 'funding', label: 'Have you raised money? (opens the Funding History section)', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Include SAFEs, convertible notes, grants with equity, and friends and family.' },
  { key: 'x_total_raised', section: 'funding', label: 'Total Funding Raised (USD)', type: 'number', unit: 'usd', required: true, gate: { key: 'x_raised', is: 'yes' }, by: 'fill', judge: false, tip: 'Everything raised to date.' },
  { key: 'x_post_money', section: 'funding', label: 'Post-Money Valuation (USD)', type: 'number', unit: 'usd', required: false, gate: { key: 'x_raised', is: 'yes' }, by: 'fill', judge: false, tip: 'The post-money valuation or cap of your last round.' },
  { key: 'x_last_round', section: 'funding', label: 'When did you raise your last round / investment?', type: 'date', required: true, gate: { key: 'x_raised', is: 'yes' }, by: 'fill', judge: false, tip: 'The date the last money came in.' },
  { key: 'x_burn', section: 'funding', label: 'Monthly Burn Rate (USD)', type: 'number', unit: 'usd', required: false, gate: { key: 'x_raised', is: 'yes' }, by: 'fill', judge: false, tip: 'Average monthly spend, salaries included.' },
  { key: 'x_runway', section: 'funding', label: 'Runway (months)', type: 'number', unit: 'months', required: false, gate: { key: 'x_raised', is: 'yes' }, by: 'fill', judge: false, tip: 'Cash in the bank divided by monthly burn.' },
  {
    key: 'x_investors',
    section: 'funding',
    label: 'List your current investors (name or firm, email, amount raised in USD). This helps speedrun contact them for a reference check if necessary.',
    type: 'rows',
    columns: [
      { key: 'name', label: 'Name or firm' },
      { key: 'email', label: 'Email' },
      { key: 'amount', label: 'Amount (USD)', num: true },
    ],
    required: true,
    gate: { key: 'x_raised', is: 'yes' },
    by: 'fill',
    judge: false,
    tip: 'Every investor, with an email that reaches them: speedrun may ask them for a reference.',
  },
  { key: 'x_raising', section: 'funding', label: 'Are you raising a round now? (opens the Active Fundraising Round section)', type: 'yesno', required: true, by: 'fill', judge: false, tip: 'Yes if you are talking to investors now.' },
  { key: 'x_target', section: 'funding', label: 'How much are you raising? Target amount for this round (USD)', type: 'number', unit: 'usd', required: true, gate: { key: 'x_raising', is: 'yes' }, by: 'fill', judge: false, tip: 'The round you are raising, in US dollars.' },
  { key: 'x_raise_start', section: 'funding', label: 'When did you start your fundraise?', type: 'date', required: true, gate: { key: 'x_raising', is: 'yes' }, by: 'fill', judge: false, tip: 'The day you started talking to investors for this round.' },
  { key: 'x_raise_deadline', section: 'funding', label: 'Are there any fundraising deadlines we should be aware of? (optional)', type: 'short', required: false, gate: { key: 'x_raising', is: 'yes' }, by: 'founder', judge: false, tip: 'A real date and why (a term sheet that expires, a close). Leave empty if none.' },

  /* Team video, deck, referral, source (Additional Information) */
  {
    key: 'x_video',
    section: 'more',
    label: 'Team Video (MP4, up to 3 minutes): the file on this computer (its full path) or a link to it',
    type: 'url',
    required: false,
    by: 'founder',
    judge: false,
    tip: 'Three minutes at most. At least half on you and your team (backgrounds, biggest accomplishments, why you win this market); the rest on what you build, why it is big and your progress.',
  },
  { key: 'x_deck', section: 'more', label: 'Pitch Deck (PDF): your latest deck, its file on this computer (full path) or a link', type: 'url', required: false, by: 'fill', judge: false, tip: 'PDF only, up to 500 MB. Upload it under Links and files and your AI agent attaches it.' },
  { key: 'x_referred', section: 'more', label: 'Were you referred? (opens the Referral section)', type: 'yesno', required: true, by: 'founder', judge: false, tip: 'Yes only if someone actually referred you, and they know it.' },
  {
    key: 'x_referrals',
    section: 'more',
    label: 'If you were referred, please provide their contact information (name, email, LinkedIn URL).',
    type: 'rows',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'linkedin', label: 'LinkedIn URL' },
    ],
    required: true,
    gate: { key: 'x_referred', is: 'yes' },
    by: 'founder',
    judge: false,
    tip: 'Each person who referred you, with an email and LinkedIn that reach them.',
  },
  { key: 'x_heard', section: 'more', label: 'Where did you learn about speedrun? (X, event, friend, etc.)', type: 'choice', choices: HEARD, required: true, by: 'founder', judge: false, tip: 'Pick the closest source.' },
  { key: 'x_heard_detail', section: 'more', label: 'Additional info (optional): provide the name, handle, post, event, etc.', type: 'short', required: false, by: 'founder', judge: false, tip: 'The person, handle, post or event, in a few words.' },
];

/** Each founder's profile, answered once per founder (answers.key fp.<founder>.<field>). */
const PROFILE = [
  {
    field: 'experience',
    label: 'Relevant experience: in a few sentences, highlight your most relevant professional, startup, or industry experience. Focus on track record, domain expertise, and past wins.',
    type: 'long',
    limit: 1000,
    required: true,
    by: 'draft',
    judge: true,
    words: 120,
    tip: 'Track record, domain expertise and past wins, with magnitude and proof: what you built or ran, the numbers, the outcome, links.',
    rubric: 'Strong: a few sentences with track record (what this founder built, shipped, sold or grew), domain expertise tied to this startup, and past wins with magnitude and proof (numbers, users, revenue, exits, rank, links). Failure modes: job titles or duties with no outcome; adjectives ("exceptionally driven"); a team achievement with no personal role; a resume list with no link to this startup.',
  },
];

/**
 * What only the founders can confirm: the team video rules and the things
 * worth settling before applying. Each is a tick on the screens and a
 * boolean of confirms.set.
 */
const CONFIRMS = [
  { key: 'under_3_min', group: 'video', label: 'Three minutes or less, MP4', tip: 'speedrun takes a team video of up to 3 minutes, as an MP4 file.' },
  { key: 'half_on_team', group: 'video', label: 'At least half on you and your team', tip: 'speedrun: "Spend at least half on you and your team: your backgrounds and biggest accomplishments, professional or personal; what makes you exceptional, and why you\'re the team to win this market."' },
  { key: 'covers_rest', group: 'video', label: 'The rest on product, market and progress', tip: 'speedrun: "The rest on your product, market, and traction: what you\'re building and the problem it solves; why this is a big, underserved opportunity; the progress you\'ve made so far."' },
  { key: 'own_voice', group: 'video', label: 'We speak on camera ourselves, no AI voice', tip: 'speedrun FAQ: "please speak to the camera yourselves rather than using an AI-generated voice." Polish is not graded.' },
  { key: 'residency', group: 'before', label: 'We can join the residency in San Francisco', tip: 'The residency runs about twelve weeks in person in San Francisco (SR008: February 1 to April 16, 2027): about one day a week at the office, plus the founder retreat and Demo Day.' },
  { key: 'full_time_if_accepted', group: 'before', label: 'Every founder builds full-time during the residency', tip: 'speedrun FAQ: "Outside of that, we expect you to be building your startup full-time."' },
  { key: 'one_application', group: 'before', label: 'This is our only application this cohort', tip: 'One application per company, on your strongest idea: applications for several companies count against you.' },
  { key: 'ip_clear', group: 'before', label: 'No employer or school can claim the code or the idea', tip: 'Build on your own time and equipment; employer IP claims block investment.' },
  { key: 'goals_aligned', group: 'before', label: 'We agree on roles, goals and who is CEO', tip: 'speedrun starts the form with the CEO. Settle it before writing the answers.' },
  { key: 'metrics_true', group: 'traction', label: 'Metrics are real and measured, not projected', tip: 'ARR is recurring revenue today; active users are active, not signups; retention is bounded (exactly day 1, 7, 30).' },
];

/** Short names for the screens (the full wording shows when a question is open). */
const SHORT = {
  t_employment: 'Full-time or part-time',
  t_ft_founders: 'Full-time founders',
  t_fte: 'FTE employees',
  t_team: 'About the team',
  s_name: 'Startup name',
  s_oneliner: 'One-liner',
  s_desc: 'Startup description',
  s_category: 'Primary category',
  s_category2: 'Secondary category',
  s_country: 'Country',
  s_state: 'State',
  s_city: 'City',
  s_founded: 'Founded',
  s_website: 'Website',
  s_other: 'Anything else',
  x_has_traction: 'Launched with traction?',
  x_launch: 'Launch date',
  x_traction_notes: 'Traction notes',
  x_share_revenue: 'Share revenue?',
  x_arr: 'ARR',
  x_acv: 'Annual contract value',
  x_ndr: 'Net dollar retention',
  x_rev_growth: 'Revenue growth',
  x_share_usage: 'Share usage?',
  x_dau: 'Daily active users',
  x_wau: 'Weekly active users',
  x_mau: 'Monthly active users',
  x_user_growth: 'User growth',
  x_d1: 'D1 retention',
  x_d7: 'D7 retention',
  x_d30: 'D30 retention',
  x_m1: 'M1 retention',
  x_raised: 'Raised money?',
  x_total_raised: 'Total raised',
  x_post_money: 'Post-money valuation',
  x_last_round: 'Last round date',
  x_burn: 'Monthly burn',
  x_runway: 'Runway',
  x_investors: 'Investors',
  x_raising: 'Raising now?',
  x_target: 'Round target',
  x_raise_start: 'Fundraise started',
  x_raise_deadline: 'Fundraise deadline',
  x_video: 'Team video',
  x_deck: 'Pitch deck',
  x_referred: 'Referred?',
  x_referrals: 'Referrals',
  x_heard: 'Where you heard of speedrun',
  x_heard_detail: 'Who or where',
  experience: 'Relevant experience',
};

/** Names people write for a country, mapped to the form's own option. */
const COUNTRY_ALIASES = {
  usa: 'United States of America',
  us: 'United States of America',
  'u.s.': 'United States of America',
  'u.s.a.': 'United States of America',
  'united states': 'United States of America',
  america: 'United States of America',
  uk: 'United Kingdom',
  'great britain': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  korea: 'South Korea',
  'republic of korea': 'South Korea',
  'czech republic': 'Czechia',
  "côte d'ivoire": 'Ivory Coast',
  uae: 'United Arab Emirates',
  'hong kong sar': 'Hong Kong',
  'cape verde': 'Cabo Verde',
  turkiye: 'Turkey',
  'türkiye': 'Turkey',
};

/**
 * A country as the form lists it: { country } when it is one (or a common
 * other name for one), else { near } with the closest option ('' if none).
 */
function countryOf(raw, nearest) {
  const low = String(raw).trim().toLowerCase();
  for (const c of COUNTRIES) if (c.toLowerCase() === low) return { country: c };
  if (COUNTRY_ALIASES[low] !== undefined) return { country: COUNTRY_ALIASES[low] };
  const near = nearest(String(raw).trim(), COUNTRIES.concat(Object.keys(COUNTRY_ALIASES)));
  return { country: null, near: near === '' ? '' : COUNTRY_ALIASES[near] || near };
}

function shortOf(key) {
  const prof = profileOf(key);
  if (prof !== null) return SHORT[prof.q.field] || prof.q.label;
  return SHORT[key] || key;
}

function byKey(key) {
  for (const q of QUESTIONS) if (q.key === key) return q;
  return null;
}

/** The profile question a key such as fp.<founder>.experience refers to (null otherwise). */
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

module.exports = {
  SECTIONS: SECTIONS,
  QUESTIONS: QUESTIONS,
  PROFILE: PROFILE,
  CATEGORIES: CATEGORIES,
  EMPLOYMENT: EMPLOYMENT,
  EDUCATION: EDUCATION,
  HEARD: HEARD,
  COUNTRIES: COUNTRIES,
  countryOf: countryOf,
  CONFIRMS: CONFIRMS,
  SHORT: SHORT,
  shortOf: shortOf,
  byKey: byKey,
  profileOf: profileOf,
  definition: definition,
};
