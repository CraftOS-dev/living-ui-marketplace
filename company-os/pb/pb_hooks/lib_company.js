/// <reference path="../pb_data/types.d.ts" />
/**
 * Company OS domain library (plain module, require() it INSIDE handlers).
 * Holds the data tables (vocab packs, journey templates, starter packs,
 * module recommendation matrix) and the deterministic engines (autocheck,
 * stage suggestion, seeding). No LLM calls here; AI lives in ops.pb.js via
 * the bridge and degrades gracefully.
 */

const STAGES = ['validate', 'setup', 'first_customers', 'grow', 'scale'];

const MODULE_KEYS = [
  'customers',
  'money',
  'kanban',
  'goals',
  'team',
  'meetings',
  'processes',
  'marketing',
];

/** Vocabulary packs, structural derivation from company_type (no free-text
 *  matching anywhere; the pack is stored on the company record). */
const VOCAB = {
  services: {
    customer_one: 'Client',
    customer_many: 'Clients',
    pipeline: ['Lead', 'Contacted', 'Proposal', 'Active', 'Past'],
    project_word: 'Project',
  },
  retail_ecommerce: {
    customer_one: 'Customer',
    customer_many: 'Customers',
    pipeline: ['Lead', 'Interested', 'Ordered', 'Repeat', 'Inactive'],
    project_word: 'Order',
  },
  food_hospitality: {
    customer_one: 'Guest',
    customer_many: 'Guests',
    pipeline: ['New', 'Regular', 'VIP', 'Lapsed'],
    project_word: 'Event',
  },
  software_digital: {
    customer_one: 'Customer',
    customer_many: 'Customers',
    pipeline: ['Lead', 'Trial', 'Active', 'Churned'],
    project_word: 'Project',
  },
  other: {
    customer_one: 'Customer',
    customer_many: 'Customers',
    pipeline: ['Lead', 'Active', 'Past'],
    project_word: 'Project',
  },
};

/** Modules active/suggested per stage (cumulative). Stage index maps STAGES. */
const MODULES_BY_STAGE = {
  validate: { active: [], suggested: ['customers', 'kanban'] },
  setup: { active: ['customers', 'money'], suggested: ['kanban', 'marketing'] },
  first_customers: {
    active: ['customers', 'money', 'kanban', 'marketing'],
    suggested: ['goals', 'team', 'meetings', 'processes'],
  },
  grow: { active: MODULE_KEYS, suggested: [] },
  scale: { active: MODULE_KEYS, suggested: [] },
};

/** Starter scorecard metrics per company type. */
const METRIC_PACKS = {
  services: [
    ['New leads', 'up', ''],
    ['Quotes sent', 'up', ''],
    ['Jobs delivered', 'up', ''],
    ['Hours billed', 'up', 'h'],
  ],
  retail_ecommerce: [
    ['Orders', 'up', ''],
    ['Average order value', 'up', ''],
    ['Store visitors', 'up', ''],
    ['Returns', 'down', ''],
  ],
  food_hospitality: [
    ['Guests served', 'up', ''],
    ['Average spend', 'up', ''],
    ['Food cost share', 'down', '%'],
    ['New reviews', 'up', ''],
  ],
  software_digital: [
    ['Signups', 'up', ''],
    ['Active users', 'up', ''],
    ['Demos booked', 'up', ''],
    ['Cancellations', 'down', ''],
  ],
  other: [
    ['Sales conversations', 'up', ''],
    ['New customers', 'up', ''],
    ['Money in', 'up', ''],
    ['Money out', 'down', ''],
  ],
};

/** SOP starter templates per company type (offered in the Processes UI). */
const PROCESS_PACKS = {
  services: [
    ['Onboard a new client', ['Confirm scope and price', 'Sign agreement', 'Kickoff conversation', 'Set follow-up dates']],
    ['Deliver the work', ['Plan the job', 'Do the work', 'Quality check', 'Hand over and confirm satisfaction']],
    ['Invoice and get paid', ['Send invoice', 'Record it in Money', 'Chase politely after due date', 'Mark paid']],
  ],
  retail_ecommerce: [
    ['Fulfill an order', ['Confirm payment', 'Pick and pack', 'Ship and share tracking', 'Follow up for a review']],
    ['Restock', ['Check stock levels', 'Order from supplier', 'Receive and count', 'Update prices if needed']],
    ['Handle a return', ['Confirm the issue', 'Approve return', 'Refund or replace', 'Record the cost']],
  ],
  food_hospitality: [
    ['Open the day', ['Check prep list', 'Confirm staffing', 'Check stock', 'Open service']],
    ['Close the day', ['Count the till', 'Record the numbers', 'Clean and prep', 'Lock up']],
    ['Handle a complaint', ['Listen fully', 'Fix it on the spot if possible', 'Log what happened', 'Follow up']],
  ],
  software_digital: [
    ['Onboard a new customer', ['Welcome message', 'Setup call or guide', 'First-value check-in', 'Ask for feedback']],
    ['Ship a change', ['Write down the change', 'Build it', 'Test it', 'Tell customers']],
    ['Handle a support request', ['Acknowledge fast', 'Reproduce and fix or answer', 'Confirm resolution', 'Log the cause']],
  ],
  other: [
    ['Deliver for a customer', ['Confirm what they need', 'Do the work', 'Check quality', 'Confirm they are happy']],
    ['Get paid', ['Agree the price', 'Invoice or collect', 'Record it in Money', 'Follow up if late']],
  ],
};

/**
 * Journey step templates. Each: [stage, title, why, kind, module_key, auto_rule].
 * kind: 'form' (onboarding artifact), 'module' (links into a module page),
 * 'attest' (done outside the app; user marks it done).
 * Titles use {customer}/{customers} placeholders resolved against the vocab pack.
 */
function journeySteps(companyType) {
  const steps = [
    // --- Validate ---
    ['validate', 'Tell us about your company', 'Everything else builds on knowing what you do and for whom.', 'form', '', 'onboarded'],
    ['validate', 'Write down the problem you solve', 'A clear problem statement beats a long business plan.', 'module', 'profile', 'plan_started'],
    ['validate', 'Talk to five potential {customers}', 'Real conversations beat guesses. Ask what they struggle with and what they would pay.', 'attest', '', ''],
    ['validate', 'Sketch your offer and a price', 'You need something concrete to react to. A rough price forces clarity.', 'module', 'profile', 'offer_filled'],
    ['validate', 'Estimate what it costs to launch', 'Knowing the number makes the decision honest.', 'attest', '', ''],
    // --- Set Up ---
    ['setup', 'Register your business', 'Make it official in your country or region. This app gives general guidance, not legal advice.', 'attest', '', ''],
    ['setup', 'Open a business bank account', 'Keeping company money separate from personal money saves you real pain later.', 'attest', '', ''],
    ['setup', 'Get basic insurance if you need it', 'Some businesses need cover before the first sale. Check what applies to yours.', 'attest', '', ''],
    ['setup', 'Set your starting cash on hand', 'Cash is the one number a young company cannot ignore.', 'module', 'money', 'cash_set'],
    ['setup', 'Record your setup costs', 'Money out counts from day one. Start the habit now.', 'module', 'money', 'first_expense'],
    ['setup', 'Make your offer public', 'A site, storefront, menu, or listing: somewhere a stranger can find and buy from you.', 'attest', '', ''],
    // --- First Customers ---
    ['first_customers', 'Add your first {customer}', 'The moment it stops being an idea. Keep every {customer} in one place.', 'module', 'customers', 'first_customer'],
    ['first_customers', 'Record your first sale', 'Money in is the strongest signal you have something real.', 'module', 'money', 'first_sale'],
    ['first_customers', 'Set follow-up dates for your {customers}', 'Most repeat business is lost by forgetting to follow up, not by being refused.', 'module', 'customers', 'follow_up_set'],
    ['first_customers', 'Write down how you deliver, start to finish', 'Your first process. It makes quality repeatable and lets others help later.', 'module', 'processes', 'first_process'],
    ['first_customers', 'Start a weekly review', 'Fifteen minutes a week: numbers, priorities, problems. The habit that keeps you honest.', 'module', 'meetings', 'meeting_ritual'],
  ];

  // The sixth first-customers step differs by business shape.
  if (companyType === 'retail_ecommerce' || companyType === 'food_hospitality') {
    steps.push(['first_customers', 'Plan your first promotion', 'Pick one channel, one message, one date. Small and real beats big and vague.', 'module', 'marketing', 'promo_planned']);
  } else {
    steps.push(['first_customers', 'Send your first invoice', 'Getting paid on time starts with invoicing on time.', 'module', 'money', 'invoice_sent']);
  }

  steps.push(
    // --- Grow ---
    ['grow', 'Add your team', 'Who is working with you? Put everyone in one place.', 'module', 'team', 'first_team'],
    ['grow', 'Define seats and who owns what', 'Every area needs exactly one accountable owner, even if one person holds several seats.', 'module', 'team', 'seats_defined'],
    ['grow', 'Set this quarter’s priorities', 'Three to seven things that matter most in the next 90 days, each with an owner.', 'module', 'goals', 'priorities_set'],
    ['grow', 'Start your weekly numbers', 'A handful of numbers, filled in weekly, tells you the truth faster than any report.', 'module', 'goals', 'metrics_week'],
    ['grow', 'Hold a weekly team meeting', 'Same day, same time, same agenda: numbers, priorities, issues.', 'module', 'meetings', 'meeting_habit'],
    ['grow', 'Document your core processes', 'The three to five processes your business runs on, written down simply.', 'module', 'processes', 'three_processes'],
    ['grow', 'Start hiring with a pipeline', 'Track candidates by stage so hiring stops being a scramble.', 'module', 'team', 'hiring_started'],
    // --- Scale ---
    ['scale', 'Set goals for the year', 'Where should the company be in a year? Write it down and check quarterly.', 'module', 'goals', 'goals_set'],
    ['scale', 'Give each area its own numbers', 'Each seat should watch a number its owner can move.', 'module', 'goals', 'metrics_five'],
    ['scale', 'Plan quarterly, every quarter', 'A recurring planning rhythm turns strategy from an event into a habit.', 'module', 'meetings', 'quarterly_defined'],
    ['scale', 'Keep three months of money history', 'Monthly in/out history makes your runway and trends real, not guessed.', 'module', 'money', 'money_three_months'],
    ['scale', 'Write down how you hire and onboard', 'Growth without a hiring process burns the team you already have.', 'attest', '', ''],
    ['scale', 'Review seats: one owner per area', 'As the team grows, make sure no area has zero owners and none has two.', 'attest', '', ''],
  );
  return steps;
}

function resolveVocab(text, vocab) {
  return String(text)
    .replaceAll('{customer}', vocab.customer_one.toLowerCase())
    .replaceAll('{customers}', vocab.customer_many.toLowerCase());
}

// ---------------------------------------------------------------------------
// Data access helpers
// ---------------------------------------------------------------------------

function getCompany(app) {
  const rows = app.findRecordsByFilter('company', "id != ''", '-created', 1, 0);
  return rows.length > 0 ? rows[0] : null;
}

function count(app, collection, filter) {
  return app.findRecordsByFilter(collection, filter || "id != ''", '', 0, 0).length;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Seeding (called by onboarding.complete)
// ---------------------------------------------------------------------------

function seedCompany(app, payload, ownerId) {
  const type = VOCAB[payload.company_type] ? payload.company_type : 'other';
  const vocab = VOCAB[type];
  const stage = STAGES.includes(payload.stage) ? payload.stage : 'validate';

  const companyCol = app.findCollectionByNameOrId('company');
  const company = new Record(companyCol);
  company.set('name', payload.name || 'My company');
  company.set('what_it_does', payload.what_it_does || '');
  company.set('company_type', type);
  company.set('stage', stage);
  company.set('team_size', payload.team_size || 'solo');
  company.set('focus', payload.focus || []);
  company.set('vocab', vocab);
  company.set('onboarding_done', true);
  if (ownerId) company.set('owner', ownerId);
  app.save(company);

  // Modules: rows for every key; active per stage matrix (user can change).
  const plan = MODULES_BY_STAGE[stage];
  const modulesCol = app.findCollectionByNameOrId('modules');
  for (const key of MODULE_KEYS) {
    const row = new Record(modulesCol);
    row.set('key', key);
    row.set('active', plan.active.includes(key));
    row.set('suggested', plan.suggested.includes(key));
    if (plan.active.includes(key)) row.set('activated_at', todayStr());
    app.save(row);
  }

  // Journey: all stages seeded; the onboarding step lands done (endowed
  // progress, the user really did complete it by finishing the wizard).
  const stepsCol = app.findCollectionByNameOrId('journey_steps');
  const templates = journeySteps(type);
  let order = 0;
  for (const t of templates) {
    order += 1;
    const row = new Record(stepsCol);
    row.set('stage', t[0]);
    row.set('order', order);
    row.set('title', resolveVocab(t[1], vocab));
    row.set('why', resolveVocab(t[2], vocab));
    row.set('kind', t[3]);
    row.set('module_key', t[4]);
    row.set('auto_rule', t[5]);
    const done = t[5] === 'onboarded';
    row.set('status', done ? 'done' : 'open');
    if (done) {
      row.set('done_at', todayStr());
      row.set('auto_done', true);
    }
    app.save(row);
  }

  // Starter metrics (definitions only; entries are the user's).
  const metricsCol = app.findCollectionByNameOrId('metrics');
  const pack = METRIC_PACKS[type];
  for (let i = 0; i < pack.length; i++) {
    const m = new Record(metricsCol);
    m.set('name', pack[i][0]);
    m.set('direction', pack[i][1]);
    m.set('unit', pack[i][2]);
    m.set('order', i + 1);
    m.set('active', true);
    app.save(m);
  }

  // Default meeting ritual: solo founders get a Weekly Review, teams a
  // Weekly Team Meeting, same numbers/priorities/issues backbone.
  const meetingsCol = app.findCollectionByNameOrId('meetings');
  const solo = (payload.team_size || 'solo') === 'solo';
  const meeting = new Record(meetingsCol);
  meeting.set('name', solo ? 'Weekly Review' : 'Weekly Team Meeting');
  meeting.set('cadence', 'weekly');
  meeting.set(
    'agenda',
    solo
      ? ['Look at your numbers', 'Check priorities', 'List and solve issues', 'Plan the week']
      : ['Good news', 'Numbers', 'Priorities check', 'Issues: identify, discuss, solve', 'Actions for the week'],
  );
  app.save(meeting);

  return company;
}

// ---------------------------------------------------------------------------
// Journey autocheck, every rule reads real records; no rule self-invents.
// ---------------------------------------------------------------------------

function ruleSatisfied(app, rule, company) {
  switch (rule) {
    case 'onboarded':
      return true;
    case 'plan_started':
      return (
        String(company.getString('mission')).trim() !== '' ||
        String(company.getString('who_we_serve')).trim() !== ''
      );
    case 'offer_filled':
      return String(company.getString('offer')).trim() !== '';
    case 'cash_set':
      return company.getFloat('cash_on_hand') > 0 || count(app, 'money_entries') > 0;
    case 'first_expense':
      return count(app, 'money_entries', "kind = 'out'") > 0;
    case 'first_customer':
      return count(app, 'customers') > 0;
    case 'first_sale':
      return count(app, 'money_entries', "kind = 'in'") > 0;
    case 'follow_up_set':
      return count(app, 'customers', "follow_up != ''") > 0;
    case 'first_process':
      return count(app, 'processes') > 0;
    case 'three_processes':
      return count(app, 'processes') >= 3;
    case 'meeting_ritual':
      return count(app, 'meeting_notes') > 0;
    case 'meeting_habit':
      return count(app, 'meeting_notes') >= 2;
    case 'promo_planned':
      return count(app, 'promos') > 0;
    case 'invoice_sent':
      return count(app, 'invoices', "status = 'sent' || status = 'paid'") > 0;
    case 'first_team':
      return count(app, 'team_members') > 0;
    case 'seats_defined':
      return count(app, 'seats') > 0;
    case 'priorities_set':
      return count(app, 'priorities') > 0;
    case 'metrics_week':
      return count(app, 'metric_entries') > 0;
    case 'hiring_started':
      return count(app, 'candidates') > 0;
    case 'goals_set':
      return count(app, 'goals') > 0;
    case 'metrics_five':
      return count(app, 'metrics', 'active = true') >= 5;
    case 'quarterly_defined':
      return count(app, 'meetings', "cadence = 'quarterly'") > 0;
    case 'money_three_months': {
      const rows = app.findRecordsByFilter('money_entries', "id != ''", '', 0, 0);
      const months = {};
      for (const r of rows) {
        const d = r.getString('date');
        if (d.length >= 7) months[d.slice(0, 7)] = true;
      }
      return Object.keys(months).length >= 3;
    }
    default:
      return false;
  }
}

function runAutocheck(app) {
  const company = getCompany(app);
  if (company === null) return { completed: [] };
  const open = app.findRecordsByFilter('journey_steps', "status = 'open' && auto_rule != ''", 'order', 0, 0);
  const completed = [];
  for (const step of open) {
    if (ruleSatisfied(app, step.getString('auto_rule'), company)) {
      step.set('status', 'done');
      step.set('done_at', todayStr());
      step.set('auto_done', true);
      app.save(step);
      completed.push(step.getString('title'));
    }
  }
  return { completed: completed };
}

// ---------------------------------------------------------------------------
// Stage engine, suggests, never applies. stage.advance applies on confirm.
// ---------------------------------------------------------------------------

function suggestedStage(app, company) {
  const current = company.getString('stage');
  const idx = STAGES.indexOf(current);
  if (idx < 0 || idx >= STAGES.length - 1) return current;

  const customers = count(app, 'customers');
  const sales = count(app, 'money_entries', "kind = 'in'");
  const team = count(app, 'team_members');
  const size = company.getString('team_size');

  let next = current;
  if (current === 'validate' && (customers > 0 || sales > 0 || count(app, 'money_entries') > 0)) {
    next = 'setup';
  } else if (current === 'setup' && (sales > 0 || customers >= 3)) {
    next = 'first_customers';
  } else if (current === 'first_customers') {
    const rows = app.findRecordsByFilter('money_entries', "kind = 'in'", '', 0, 0);
    const months = {};
    for (const r of rows) {
      const d = r.getString('date');
      if (d.length >= 7) months[d.slice(0, 7)] = true;
    }
    if (team >= 2 || Object.keys(months).length >= 3) next = 'grow';
  } else if (current === 'grow' && (team >= 10 || size === 'sixteen_fifty' || size === 'fifty_plus')) {
    next = 'scale';
  }
  return next;
}

const STAGE_LABELS = {
  validate: 'Validate',
  setup: 'Set Up',
  first_customers: 'First Customers',
  grow: 'Grow',
  scale: 'Scale',
};

function runStageCheck(app) {
  const company = getCompany(app);
  if (company === null) return { suggested: null };
  const current = company.getString('stage');
  const next = suggestedStage(app, company);
  if (next === current) return { suggested: null };

  // One open stage suggestion at a time.
  const existing = app.findRecordsByFilter(
    'suggestions',
    "kind = 'stage_advance' && status = 'open'",
    '',
    0,
    0,
  );
  if (existing.length === 0) {
    const col = app.findCollectionByNameOrId('suggestions');
    const s = new Record(col);
    s.set('kind', 'stage_advance');
    s.set('title', 'Ready for the ' + STAGE_LABELS[next] + ' stage?');
    s.set(
      'body',
      'Your records suggest the company has outgrown the ' +
        STAGE_LABELS[current] +
        ' stage. Advancing unlocks the next Journey steps and suggests new modules. Nothing changes until you confirm.',
    );
    s.set('payload', { stage: next });
    s.set('status', 'open');
    app.save(s);
  }
  return { suggested: next };
}

function advanceStage(app, stage) {
  if (!STAGES.includes(stage)) throw new Error('Unknown stage: ' + stage);
  const company = getCompany(app);
  if (company === null) throw new Error('No company yet');
  company.set('stage', stage);
  app.save(company);

  // Newly recommended modules become one-click suggestions, never silent
  // activations (the user confirms each in Settings or from the card).
  const plan = MODULES_BY_STAGE[stage];
  const rows = app.findRecordsByFilter('modules', "id != ''", '', 0, 0);
  for (const row of rows) {
    const key = row.getString('key');
    const shouldBeOn = plan.active.includes(key) || plan.suggested.includes(key);
    if (shouldBeOn && !row.getBool('active') && !row.getBool('suggested')) {
      row.set('suggested', true);
      app.save(row);
    }
  }

  // Close any accepted/open stage suggestion for this stage.
  const open = app.findRecordsByFilter('suggestions', "kind = 'stage_advance' && status = 'open'", '', 0, 0);
  for (const s of open) {
    s.set('status', 'accepted');
    app.save(s);
  }
  return { stage: stage };
}

// ---------------------------------------------------------------------------
// Attention sweep, suggestion cards only; nothing outward, nothing silent.
// ---------------------------------------------------------------------------

function runAttentionSweep(app) {
  const company = getCompany(app);
  if (company === null) return { created: 0 };
  let created = 0;
  const col = app.findCollectionByNameOrId('suggestions');

  // Overdue follow-ups.
  const overdue = app.findRecordsByFilter(
    'customers',
    "follow_up != '' && follow_up < {:today}",
    '',
    0,
    0,
    { today: todayStr() },
  );
  if (overdue.length > 0) {
    const existing = app.findRecordsByFilter('suggestions', "kind = 'follow_up' && status = 'open'", '', 0, 0);
    if (existing.length === 0) {
      const vocab = company.get('vocab') || {};
      const noun = (vocab.customer_many || 'customers').toLowerCase();
      const s = new Record(col);
      s.set('kind', 'follow_up');
      s.set('title', String(overdue.length) + ' overdue follow-up' + (overdue.length === 1 ? '' : 's'));
      s.set('body', 'Some ' + noun + ' have follow-up dates in the past. A quick call or message keeps the relationship warm.');
      s.set('payload', { count: overdue.length });
      s.set('status', 'open');
      app.save(s);
      created += 1;
    }
  }

  // Runway: average net monthly burn over the last 90 days vs cash on hand.
  const cash = company.getFloat('cash_on_hand');
  if (cash > 0) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = app.findRecordsByFilter('money_entries', 'date >= {:since}', '', 0, 0, { since: since });
    let net = 0;
    for (const r of rows) {
      const amt = r.getFloat('amount');
      net += r.getString('kind') === 'in' ? amt : -amt;
    }
    const monthlyNet = net / 3;
    if (monthlyNet < 0) {
      const months = cash / -monthlyNet;
      if (months < 4) {
        const existing = app.findRecordsByFilter('suggestions', "kind = 'runway' && status = 'open'", '', 0, 0);
        if (existing.length === 0) {
          const s = new Record(col);
          s.set('kind', 'runway');
          s.set('title', 'About ' + months.toFixed(1) + ' months of cash left');
          s.set('body', 'At the current pace of money in and out, cash on hand runs low soon. Worth a look at the Money page.');
          s.set('payload', { months: Number(months.toFixed(1)) });
          s.set('status', 'open');
          app.save(s);
          created += 1;
        }
      }
    }
  }
  return { created: created };
}

// ---------------------------------------------------------------------------
// Weekly digest, deterministic aggregation into a Note. The optional LLM
// paragraph is appended by the caller (ops.pb.js) when the bridge is up.
// ---------------------------------------------------------------------------

function buildDigest(app) {
  const company = getCompany(app);
  if (company === null) throw new Error('No company yet');
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  let moneyIn = 0;
  let moneyOut = 0;
  const entries = app.findRecordsByFilter('money_entries', 'date >= {:since}', '', 0, 0, { since: since });
  for (const r of entries) {
    if (r.getString('kind') === 'in') moneyIn += r.getFloat('amount');
    else moneyOut += r.getFloat('amount');
  }

  const metricLines = [];
  const metricRows = app.findRecordsByFilter('metrics', 'active = true', 'order', 0, 0);
  for (const m of metricRows) {
    const es = app.findRecordsByFilter(
      'metric_entries',
      'metric = {:id} && week_start >= {:since}',
      '-week_start',
      1,
      0,
      { id: m.id, since: since },
    );
    if (es.length > 0) {
      const v = es[0].getFloat('value');
      const goal = m.getFloat('goal');
      const suffix = goal > 0 ? ' (goal ' + goal + ')' : '';
      metricLines.push('- ' + m.getString('name') + ': ' + v + suffix);
    }
  }

  const prios = app.findRecordsByFilter('priorities', "id != ''", '', 0, 0);
  let onTrack = 0;
  let atRisk = 0;
  let doneP = 0;
  for (const p of prios) {
    const st = p.getString('status');
    if (st === 'on_track') onTrack += 1;
    else if (st === 'at_risk') atRisk += 1;
    else doneP += 1;
  }

  const openIssues = app.findRecordsByFilter('issues', "status = 'open'", '', 0, 0);
  const stepsDone = app.findRecordsByFilter(
    'journey_steps',
    "status = 'done' && done_at >= {:since}",
    '',
    0,
    0,
    { since: since },
  );

  const lines = [];
  lines.push('## Money (last 7 days)');
  lines.push('- In: ' + moneyIn.toFixed(2) + '  |  Out: ' + moneyOut.toFixed(2) + '  |  Net: ' + (moneyIn - moneyOut).toFixed(2));
  if (metricLines.length > 0) {
    lines.push('');
    lines.push('## Numbers this week');
    for (const l of metricLines) lines.push(l);
  }
  if (prios.length > 0) {
    lines.push('');
    lines.push('## Priorities');
    lines.push('- On track: ' + onTrack + '  |  At risk: ' + atRisk + '  |  Done: ' + doneP);
  }
  lines.push('');
  lines.push('## Issues');
  if (openIssues.length === 0) lines.push('- No open issues. Nice.');
  else for (const i of openIssues.slice(0, 10)) lines.push('- ' + i.getString('title'));
  if (stepsDone.length > 0) {
    lines.push('');
    lines.push('## Journey progress this week');
    for (const s of stepsDone) lines.push('- Done: ' + s.getString('title'));
  }
  return lines.join('\n');
}

function saveDigestNote(app, body) {
  const col = app.findCollectionByNameOrId('notes');
  const note = new Record(col);
  note.set('title', 'Weekly review ' + todayStr());
  note.set('category', 'Weekly review');
  note.set('body', body);
  app.save(note);
  return note;
}

function recordRun(app, workflow, status, summary) {
  const col = app.findCollectionByNameOrId('workflow_runs');
  const r = new Record(col);
  r.set('workflow', workflow);
  r.set('status', status);
  r.set('summary', String(summary).slice(0, 2900));
  r.set('finished', new Date().toISOString().slice(0, 19).replace('T', ' '));
  app.save(r);
}

module.exports = {
  STAGES: STAGES,
  STAGE_LABELS: STAGE_LABELS,
  MODULE_KEYS: MODULE_KEYS,
  VOCAB: VOCAB,
  MODULES_BY_STAGE: MODULES_BY_STAGE,
  PROCESS_PACKS: PROCESS_PACKS,
  getCompany: getCompany,
  seedCompany: seedCompany,
  runAutocheck: runAutocheck,
  runStageCheck: runStageCheck,
  advanceStage: advanceStage,
  runAttentionSweep: runAttentionSweep,
  buildDigest: buildDigest,
  saveDigestNote: saveDigestNote,
  recordRun: recordRun,
};
