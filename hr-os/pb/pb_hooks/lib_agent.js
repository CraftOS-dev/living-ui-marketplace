/// <reference path="../pb_data/types.d.ts" />
/**
 * Asking your AI agent for one piece of work (the platform's trigger model).
 *
 * Every task that needs your AI agent's judgment is its own trigger
 * (triggers.json, written by tools/gen_triggers.mjs from TRIGGERS below and
 * the instructions in guide_*.js). The op where a person asks for the work
 * (or an Automatic work source the company switched on, all off by default)
 * fires that trigger with the record's id in its params: one fire, one piece
 * of work. There is no job queue and nothing asks again on its own.
 *
 * The app remembers each ask on the record itself, in its `agent_asks` JSON
 * field keyed by trigger: { request, asked_at, by, by_name, note, source,
 * ended_at, outcome }. Hooks never read the platform's request rows; screens
 * follow `request` with the kit's useAgentRequest.
 *
 *   ask(ctx or app, rec, trigger, o)   fire once, unless an ask of that trigger on that record is still open
 *   end(app, rec, trigger, outcome)    the work arrived (the agent's op on the record), the ask is closed
 *   retry (agent.retry op)             a person asks again for the request they saw end, refused or unanswered
 *   sendDeferred(app)                  the minute job: sends, once, an ask the cooldown refused
 *
 * An ask is open while it is not ended and younger than OPEN_HOURS; after
 * that it is unanswered and only a person's Retry fires again.
 */

const OPEN_HOURS = 24;

/**
 * The triggers. param names the record (its id); collection holds it (record
 * is its name in words); may
 * is 'lib_x.fn(ctx, rec)' that throws when the caller may not ask about the
 * record (agent.retry); title(app, rec) a short line for the activity log.
 * label, description and fires are what Settings and the consent modal show.
 */
const TRIGGERS = {
  receipt_review: {
    param: 'claim_id',
    collection: 'claims',
    record: 'claim',
    label: 'Receipts',
    description: 'Your AI agent reads the receipts waiting on one expense claim and suggests what is on them',
    fires: 'Adding a receipt photo to an expense, or Read again',
    cooldown: 30,
    may: 'lib_expenses_claims.mayAskReceipts',
  },
  payrun_review: {
    param: 'payrun_id',
    collection: 'payruns',
    record: 'pay run',
    label: 'Pay run reviews',
    description: 'Your AI agent reviews one calculated pay run and writes its findings as notes; it never approves',
    fires: 'Ask your AI agent to review, on a pay run',
    cooldown: 30,
    may: 'lib_payroll_runs.mayAsk',
  },
  variance_explain: {
    param: 'payslip_id',
    collection: 'payslips',
    record: 'payslip',
    label: 'Pay change explanations',
    description: "Your AI agent explains why one person's pay changed against the last run",
    fires: 'Ask why, on a person in a pay run',
    cooldown: 30,
    may: 'lib_payroll_runs.mayAskSlip',
  },
  pack_update_draft: {
    param: 'pack_id',
    collection: 'rule_packs',
    record: 'rule pack',
    label: 'Rule pack updates',
    description: 'Your AI agent checks the official sources of one payroll rule pack and drafts an update for a person to review',
    fires: 'Check for updates or Ask for an update, on a rule pack',
    cooldown: 30,
    may: 'lib_payroll_out_packs.mayAsk',
  },
  rule_update_check: {
    param: 'pack_id',
    collection: 'rule_packs',
    record: 'rule pack',
    label: 'Monthly rule checks',
    description: 'Your AI agent checks the official sources of one rule pack in use for changes, on the monthly schedule the company switched on',
    fires: 'Monthly payroll rule checks (Automatic work): one pack a day at most',
    cooldown: 72000,
    may: 'lib_payroll_out_packs.mayAsk',
  },
  letter_draft: {
    param: 'letter_id',
    collection: 'letters',
    record: 'letter',
    label: 'Letters',
    description: 'Your AI agent writes the text of one letter HR asked for, as a proposal',
    fires: 'Ask your AI agent to write a letter',
    cooldown: 30,
    may: 'lib_lifecycle_letters.mayAsk',
  },
  job_post_draft: {
    param: 'opening_id',
    collection: 'openings',
    record: 'opening',
    label: 'Job posts',
    description: 'Your AI agent drafts or improves the job post of one opening, as a proposal',
    fires: 'Ask your AI agent to draft the post, on an opening',
    cooldown: 30,
    may: 'lib_hiring_jobs.mayAsk',
  },
  interview_summary: {
    param: 'interview_id',
    collection: 'interviews',
    record: 'interview',
    label: 'Interview summaries',
    description: 'Your AI agent summarises the submitted scorecards of one interview, neutrally, as a proposal',
    fires: 'Summarise, on an interview with scorecards in',
    cooldown: 30,
    may: 'lib_hiring_interviews.mayAsk',
  },
  timesheet_review: {
    param: 'review_id',
    collection: 'timesheet_reviews',
    record: 'timesheet check',
    label: 'Timesheet checks',
    description: 'Your AI agent checks one week of timesheets for missed punches and proposes fixes; it never approves',
    fires: 'Ask your AI agent to check a week, on Timesheets',
    cooldown: 30,
    may: 'lib_time_sheet.mayAskReview',
  },
  timesheet_check: {
    param: 'review_id',
    collection: 'timesheet_reviews',
    record: 'timesheet check',
    label: 'Weekly timesheet checks',
    description: 'Your AI agent checks last week of one entity for missed punches and proposes fixes, on the weekly schedule the company switched on',
    fires: 'Weekly timesheet check (Automatic work): weeks with a missed punch only',
    cooldown: 72000,
    may: 'lib_time_sheet.mayAskReview',
  },
  review_summary_draft: {
    param: 'summary_id',
    collection: 'review_summaries',
    record: 'summary request',
    label: 'Review summaries',
    description: "Your AI agent writes a neutral summary of a person's period for the reviewer; it never rates",
    fires: 'Ask for a summary, on a performance review',
    cooldown: 30,
    may: 'lib_performance_reviews.mayAskSummary',
  },
  onboarding_help: {
    param: 'checklist_id',
    collection: 'checklists',
    record: 'checklist',
    label: 'Checklist tasks',
    description: 'Your AI agent does the tasks assigned to it on one onboarding or offboarding checklist',
    fires: 'Ask your AI agent on a checklist, giving it a task, or checklists that open with its tasks (Automatic work)',
    cooldown: 30,
    may: 'lib_lifecycle_checklists.mayAsk',
  },
  question_asked: {
    param: 'question_id',
    collection: 'agent_questions',
    record: 'question',
    label: 'Questions',
    description: 'Your AI agent answers one question a person asked about HR in this company',
    fires: 'Asking your AI agent a question',
    cooldown: 15,
    may: 'lib_agent.mayAskQuestion',
  },
};

/**
 * Automatic work: sources that may ask your AI agent without a click, each
 * off until the company switches it on (settings.automatic). label and tip
 * are what Settings shows; trigger is the one it fires.
 */
const AUTOMATIC = {
  checklist_tasks: {
    label: "Start your AI agent's checklist tasks",
    tip: 'When an onboarding or offboarding checklist opens with tasks assigned to your AI agent, it is asked to do them.',
    trigger: 'onboarding_help',
  },
  weekly_timesheet_check: {
    label: 'Weekly timesheet check',
    tip: "On each entity's first workday at 07:00, last week's missed punches go to your AI agent, which proposes fixes.",
    trigger: 'timesheet_check',
  },
  monthly_rule_checks: {
    label: 'Monthly payroll rule checks',
    tip: 'Each rule pack in use is checked against its official sources once a month, one pack a day at most; changes come back as drafts for you.',
    trigger: 'rule_update_check',
  },
};

/**
 * Ops your AI agent calls that deliver the work of an ask: when the call
 * succeeds (run, or stored as a proposal) the ask on that record is closed.
 * { trigger, param } closes the record named by that param; fn is
 * 'lib_x.fn(app, params) -> [{ rec, trigger }]' for the ops that need more.
 */
const DELIVER = {
  'letters.update': [{ trigger: 'letter_draft', param: 'letter' }],
  'openings.update': [{ trigger: 'job_post_draft', param: 'opening', when: 'description' }],
  'interviews.summary': [{ trigger: 'interview_summary', param: 'interview' }],
  'packs.draft': [{ fn: 'lib_payroll_out_packs.deliveredBy' }],
  'payruns.note': [{ fn: 'lib_payroll_runs.deliveredBy' }],
};

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function call(ref, a, b) {
  const i = ref.lastIndexOf('.');
  return L(ref.slice(0, i))[ref.slice(i + 1)](a, b);
}

function def(trigger) {
  const t = TRIGGERS[trigger];
  if (t === undefined) throw u().fail(400, 'Unknown trigger ' + trigger + '. Triggers: ' + Object.keys(TRIGGERS).join(', '), 'invalid_param', { param: 'trigger' });
  return t;
}

function asksOf(rec) {
  const a = u().jsonOf(rec, 'agent_asks', {});
  return a !== null && typeof a === 'object' && !Array.isArray(a) ? a : {};
}

/** The stored ask of a trigger on a record, or null. */
function stateOf(rec, trigger) {
  const a = asksOf(rec)[trigger];
  return a !== undefined && a !== null && typeof a === 'object' ? a : null;
}

function ageHours(iso) {
  const ms = Date.parse(String(iso || '').replace(' ', 'T'));
  return isNaN(ms) ? 1e9 : (Date.now() - ms) / 3600000;
}

/** Open: asked, not ended, and younger than OPEN_HOURS. */
function isOpen(a) {
  return a !== null && a.ended_at === '' && ageHours(a.asked_at) < OPEN_HOURS;
}

/** What screens show about an ask (null when your AI agent was never asked about this record). */
function view(rec, trigger) {
  const a = stateOf(rec, trigger);
  if (a === null) return null;
  return {
    trigger: trigger,
    record: rec.id,
    request: a.request || '',
    asked_at: a.asked_at || '',
    by_name: a.by_name || '',
    note: a.note || '',
    source: a.source || 'person',
    ended_at: a.ended_at || '',
    outcome: a.outcome || '',
    result: a.result || '',
    waiting: (a.request || '') === '' && (a.ended_at || '') === '',
    open: isOpen(a),
    unanswered: (a.ended_at || '') === '' && !isOpen(a),
  };
}

/** The first open ask among triggers on a record, as a view (null when none). */
function openView(rec, triggers) {
  for (const t of triggers) {
    const a = stateOf(rec, t);
    if (isOpen(a)) return view(rec, t);
  }
  return null;
}

function store(app, rec, trigger, a) {
  const all = asksOf(rec);
  all[trigger] = a;
  rec.set('agent_asks', all);
  app.save(rec);
}

function fireOnce(app, trigger, rec) {
  const params = {};
  params[def(trigger).param] = rec.id;
  return require(`${__hooks}/_triggers_lib.js`).fire(app, trigger, params, 'hook');
}

function refusedWords(code, message) {
  if (code === 'cooldown') return 'Your AI agent was asked for this kind of work a moment ago. Try again in a few seconds.';
  if (code === 'rate_capped') return 'Your AI agent was asked for this kind of work many times this hour. Try again later.';
  return 'Your AI agent could not be asked right now' + (message ? ': ' + message : '.');
}

/**
 * Ask your AI agent about one record.
 *   who: a ctx (a person asks: their name is kept) or an app (an Automatic work source)
 *   o.note       what the person wants (shown to your AI agent on the record)
 *   o.source     'person' (default) or the Automatic work key
 *   o.defer      a cooldown or hourly cap does not fail the call: the minute job sends it once
 *   o.later      inside a transaction (an event): stored now, sent once by the minute job
 *   o.retry      the request id the person asks again for (agent.retry)
 * Returns { asked: true, request } for a fire, { asked: false, request, open: true } when an ask of
 * the same trigger on the record is still open (nothing fires), or { asked: false, waiting: true }
 * when it waits for the cooldown (o.defer). A person's ask refused by the cooldown answers 409.
 */
function ask(who, rec, trigger, o) {
  const util = u();
  const opts = o || {};
  const app = who && who.app ? who.app : who;
  const ctx = who && who.app ? who : null;
  def(trigger);
  const fresh = app.findRecordById(rec.collection().name, rec.id);
  const prev = stateOf(fresh, trigger);
  if (opts.retry !== undefined) {
    if (prev === null || (prev.request || '') === '') throw util.fail(409, 'Your AI agent is about to be asked; nothing to ask again yet.', 'not_sent');
    if (opts.retry !== prev.request) throw util.fail(409, 'Your AI agent was already asked again.', 'already_asked', { request: prev.request });
  } else if (isOpen(prev)) {
    return { asked: false, open: true, request: prev.request || '', asked_at: prev.asked_at };
  }
  const a = {
    request: '',
    asked_at: util.nowIso(),
    by: ctx !== null ? ctx.memberId || '' : '',
    by_name: ctx !== null ? ctx.name || '' : '',
    note: opts.note !== undefined ? util.clip(String(opts.note || ''), 2000) : prev !== null && opts.retry !== undefined ? prev.note || '' : '',
    source: opts.source || (ctx !== null ? 'person' : 'automatic'),
    ended_at: '',
    outcome: '',
  };
  if (opts.later === true) {
    store(app, fresh, trigger, a);
    app.store().set(DEFERRED, true);
    return { asked: false, waiting: true, request: '', asked_at: a.asked_at };
  }
  const fired = fireOnce(app, trigger, fresh);
  if (fired && fired.ok === true) {
    a.request = fired.id;
    store(app, fresh, trigger, a);
    return { asked: true, request: fired.id, asked_at: a.asked_at };
  }
  const code = fired && fired.code ? fired.code : 'not_sent';
  if (opts.defer === true && (code === 'cooldown' || code === 'rate_capped' || code === 'fire_failed')) {
    store(app, fresh, trigger, a);
    app.store().set(DEFERRED, true);
    return { asked: false, waiting: true, request: '', asked_at: a.asked_at };
  }
  if (code !== 'cooldown' && code !== 'rate_capped') console.error('[hr] could not ask your AI agent (' + trigger + '): ' + code + ' ' + ((fired && fired.message) || ''));
  throw util.fail(409, refusedWords(code, fired && fired.message), code);
}

/** The work of an ask arrived: close it (outcome done, or another word; result a short line). Quietly nothing when no open ask. */
function end(app, rec, trigger, outcome, result) {
  const fresh = app.findRecordById(rec.collection().name, rec.id);
  const a = stateOf(fresh, trigger);
  if (a === null || (a.ended_at || '') !== '') return false;
  a.ended_at = u().nowIso();
  a.outcome = outcome || 'done';
  if (result !== undefined) a.result = u().clip(String(result || ''), 2000);
  store(app, fresh, trigger, a);
  return true;
}

/** Close every open ask of these triggers on a record (the record was cancelled, deleted or finished). */
function endAll(app, rec, triggers, outcome) {
  let n = 0;
  for (const t of triggers) if (end(app, rec, t, outcome)) n++;
  return n;
}

function resolve(app, collection, ref) {
  const util = u();
  const r = String(ref || '');
  if (r === '') return null;
  const byId = util.byId(app, collection, r);
  if (byId !== null) return byId;
  try {
    return util.findOne(app, collection, 'number = {:n}', { n: r.toUpperCase() });
  } catch {
    return null;
  }
}

/** The dispatcher, after your AI agent's write succeeded (run or proposed): close the asks it delivered. */
function delivered(ctx, opName, params) {
  const list = DELIVER[opName];
  if (list === undefined || !ctx.isAgent) return 0;
  let n = 0;
  for (const d of list) {
    if (d.fn !== undefined) {
      for (const x of call(d.fn, ctx.app, params) || []) if (end(ctx.app, x.rec, x.trigger, 'done')) n++;
      continue;
    }
    if (d.when !== undefined && (params[d.when] === undefined || params[d.when] === '')) continue;
    const rec = resolve(ctx.app, TRIGGERS[d.trigger].collection, params[d.param]);
    if (rec !== null && end(ctx.app, rec, d.trigger, 'done')) n++;
  }
  return n;
}

/* ----------------------------------------------------- deferred sends */

const DEFERRED = 'hr_agent_deferred';

/**
 * The minute job: an ask the cooldown or the hourly cap refused (an
 * Automatic work source, a receipt, a question) is sent once, oldest
 * first, one per trigger per minute. Nothing else ever fires from here.
 */
function sendDeferred(app) {
  const flag = app.store().get(DEFERRED);
  if (flag === false) return 0;
  const util = u();
  let sent = 0;
  let left = false;
  for (const t of Object.keys(TRIGGERS)) {
    const col = TRIGGERS[t].collection;
    if (!app.hasTable(col)) continue;
    const path = '$.' + t;
    const sel = "CASE WHEN json_valid(agent_asks) THEN json_extract(agent_asks, '" + path + "') END";
    const rows = util.rows(
      app,
      'SELECT id FROM ' + col + ' WHERE ' + sel + " IS NOT NULL AND COALESCE(json_extract(" + sel + ", '$.request'), '') = '' AND COALESCE(json_extract(" + sel + ", '$.ended_at'), '') = '' ORDER BY json_extract(" + sel + ", '$.asked_at') LIMIT 2",
      { id: '' },
    );
    if (rows.length === 0) continue;
    const rec = app.findRecordById(col, rows[0].id);
    const a = stateOf(rec, t);
    const fired = fireOnce(app, t, rec);
    if (fired && fired.ok === true) {
      a.request = fired.id;
      store(app, rec, t, a);
      sent++;
      if (rows.length > 1) left = true;
    } else left = true;
  }
  app.store().set(DEFERRED, left);
  return sent;
}

/* ------------------------------------------------------------- ops */

/** agent.retry: a person asks again for the request they saw end, refused or unanswered (one fire). */
function retryOp(ctx, p) {
  const util = u();
  const trigger = util.str(p, 'trigger', '');
  const t = def(trigger);
  const rec = util.byId(ctx.app, t.collection, util.req(p, 'record'));
  if (rec === null) throw util.fail(404, 'No such record for ' + trigger + '.', 'not_found');
  call(t.may, ctx, rec);
  const r = ask(ctx, rec, trigger, { retry: util.req(p, 'request') });
  L('lib_audit').note(ctx, { collection: t.collection, record: rec.id, summary: 'Asked your AI agent again (' + t.label.toLowerCase() + ')', after: { trigger: trigger, request: r.request } });
  return { ask: view(ctx.app.findRecordById(t.collection, rec.id), trigger), asked: r.asked };
}

/** agent.triggers: what wakes your AI agent, in plain words, with the Automatic work switches. */
function triggersOp(ctx) {
  const auto = automaticOf(L('lib_settings').row(ctx.app));
  return {
    triggers: Object.keys(TRIGGERS).map((k) => ({ name: k, label: TRIGGERS[k].label, description: TRIGGERS[k].description, fires: TRIGGERS[k].fires, cooldown_seconds: TRIGGERS[k].cooldown, param: TRIGGERS[k].param })),
    automatic: Object.keys(AUTOMATIC).map((k) => ({ key: k, label: AUTOMATIC[k].label, tip: AUTOMATIC[k].tip, trigger: AUTOMATIC[k].trigger, on: auto[k] })),
    open_hours: OPEN_HOURS,
  };
}

/** The company's Automatic work switches from the settings row: { key: bool } (unset keys are off). */
function automaticOf(settingsRec) {
  const raw = u().jsonOf(settingsRec, 'automatic', {}) || {};
  const out = {};
  for (const k of Object.keys(AUTOMATIC)) out[k] = raw[k] === true;
  return out;
}

/** Is an Automatic work source switched on? */
function autoOn(app, key) {
  return automaticOf(L('lib_settings').row(app))[key] === true;
}

/* -------------------------------------------------------- questions */

function questionView(app, q) {
  return {
    id: q.id,
    question: q.getString('question'),
    context: q.getString('context'),
    status: q.getString('status'),
    answer: q.getString('answer'),
    answered_at: q.getString('answered_at'),
    asked_by: q.getString('asked_by'),
    asked_by_name: q.getString('asked_by_name'),
    asked_by_employee: q.getString('asked_by_employee'),
    ask: view(q, 'question_asked'),
    created: q.getString('created'),
  };
}

function questionRef(app, id) {
  const q = u().byId(app, 'agent_questions', String(id || ''));
  if (q === null) throw u().fail(404, 'No question ' + id + '. Run questions.list.', 'not_found');
  return q;
}

function mayAskQuestion(ctx, q) {
  if (ctx.isAgent || (q.getString('asked_by') !== ctx.memberId && !L('lib_auth').can(ctx, 'admin', 'edit'))) throw u().fail(403, 'Only the person who asked (or an administrator) asks again.', 'not_permitted');
}

/** questions.ask: a person asks your AI agent something (one question, one fire). */
function questionAsk(ctx, p) {
  const util = u();
  const question = util.text(p, 'question', 4000, '');
  if (util.squash(question) === '') throw util.fail(400, 'Write the question for your AI agent.', 'missing_param', { param: 'question' });
  const q = util.newRecord(ctx.app, 'agent_questions');
  q.set('question', question);
  q.set('context', util.text(p, 'context', 300, ''));
  q.set('status', 'asked');
  q.set('asked_by', ctx.memberId || '');
  q.set('asked_by_name', ctx.name || '');
  q.set('asked_by_employee', ctx.employeeId || '');
  q.set('agent_asks', {});
  ctx.app.save(q);
  const r = ask(ctx, q, 'question_asked', { defer: true });
  L('lib_audit').note(ctx, { collection: 'agent_questions', record: q.id, summary: 'Asked your AI agent: ' + util.clip(util.squash(question), 160), after: { trigger: 'question_asked', request: r.request } });
  return { question: questionView(ctx.app, ctx.app.findRecordById('agent_questions', q.id)) };
}

function questionList(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['asked', 'answered', 'cancelled', 'all'], 'all');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const all = ctx.isAgent || (L('lib_auth').can(ctx, 'admin', 'view') && util.bool(p, 'everyone', false));
  if (!all) {
    where.push('asked_by = {:m}');
    bind.m = ctx.memberId || '-';
  }
  const pg = util.page(p, 30, 200);
  const rows = util.findMany(ctx.app, 'agent_questions', where.length > 0 ? where.join(' && ') : '1=1', '-created', pg.limit + pg.offset, bind).slice(pg.offset);
  return { questions: rows.map((q) => questionView(ctx.app, q)), total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM agent_questions' + (all ? '' : ' WHERE asked_by = {:m}'), { m: ctx.memberId || '-' }) };
}

function questionGet(ctx, p) {
  const q = questionRef(ctx.app, u().req(p, 'question'));
  if (!ctx.isAgent && q.getString('asked_by') !== ctx.memberId && !L('lib_auth').can(ctx, 'admin', 'view')) throw u().fail(403, 'You cannot see this question.', 'not_permitted');
  return { question: questionView(ctx.app, q) };
}

/** questions.answer (your AI agent): the answer goes to the person who asked. */
function questionAnswer(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'questions.answer is for your AI agent.', 'not_permitted');
  const q = questionRef(ctx.app, util.req(p, 'question'));
  if (q.getString('status') === 'cancelled') throw util.fail(409, 'The person cancelled this question.', 'conflict');
  const answer = util.text(p, 'answer', 20000, '');
  if (util.squash(answer) === '') throw util.fail(400, 'Write the answer.', 'missing_param', { param: 'answer' });
  q.set('answer', answer);
  q.set('status', 'answered');
  q.set('answered_at', util.nowIso());
  ctx.app.save(q);
  end(ctx.app, q, 'question_asked', 'done');
  if (q.getString('asked_by') !== '') L('lib_notify').notify(ctx.app, [q.getString('asked_by')], { kind: 'agent', title: 'Your AI agent answered: ' + util.clip(util.squash(q.getString('question')), 120), body: util.clip(answer, 600), link: '#/inbox?view=agent' });
  L('lib_audit').note(ctx, { collection: 'agent_questions', record: q.id, summary: 'Your AI agent answered: ' + util.clip(util.squash(q.getString('question')), 160) });
  return { question: questionView(ctx.app, ctx.app.findRecordById('agent_questions', q.id)) };
}

function questionCancel(ctx, p) {
  const util = u();
  const q = questionRef(ctx.app, util.req(p, 'question'));
  if (q.getString('asked_by') !== ctx.memberId && !L('lib_auth').can(ctx, 'admin', 'edit')) throw util.fail(403, 'Only the person who asked (or an administrator) cancels a question.', 'not_permitted');
  if (q.getString('status') !== 'asked') return { question: questionView(ctx.app, q) };
  q.set('status', 'cancelled');
  ctx.app.save(q);
  end(ctx.app, q, 'question_asked', 'cancelled');
  L('lib_audit').note(ctx, { collection: 'agent_questions', record: q.id, summary: 'Cancelled a question to your AI agent' });
  return { question: questionView(ctx.app, ctx.app.findRecordById('agent_questions', q.id)) };
}

module.exports = {
  OPEN_HOURS: OPEN_HOURS,
  TRIGGERS: TRIGGERS,
  AUTOMATIC: AUTOMATIC,
  DELIVER: DELIVER,
  stateOf: stateOf,
  isOpen: isOpen,
  view: view,
  openView: openView,
  ask: ask,
  end: end,
  endAll: endAll,
  delivered: delivered,
  sendDeferred: sendDeferred,
  automaticOf: automaticOf,
  autoOn: autoOn,
  retryOp: retryOp,
  triggersOp: triggersOp,
  mayAskQuestion: mayAskQuestion,
  questionAsk: questionAsk,
  questionList: questionList,
  questionGet: questionGet,
  questionAnswer: questionAnswer,
  questionCancel: questionCancel,
};
