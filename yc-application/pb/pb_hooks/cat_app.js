/**
 * Catalog: the guide, the pipeline, the settings and the activity trail.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', effect: 'read', desc: 'START HERE: how this YC application app works, the rules for writing answers, and the step-by-step recipes for gathering, answering a founder and filling YC\'s form.', params: {} },
  { name: 'app.status', method: 'GET', fn: 'lib_pipeline.status', effect: 'read', desc: 'Where the application stands: each pipeline step (with the screen it is on), the estimated odds, fix_next (what to fix in the application, most important first: blockers before warnings before tips, then by odds points), do_first (things to do before applying, outside the form), and the questions waiting for a founder.', params: {} },
  { name: 'app.founder-todo', method: 'GET', fn: 'lib_pipeline.todo', effect: 'read', desc: 'Everything waiting on the founders in one list: your open questions (on answers and on founders), answers to read and confirm, questions only founders answer, and the switches only founders turn on. Use it to tell the founders what is left for them.', params: {} },
  { name: 'pipeline.get', method: 'GET', fn: 'lib_pipeline.get', effect: 'read', desc: 'Everything the pipeline page shows: steps, odds with factors, failing checks, the do-first list, sources and recent activity.', params: {} },
  { name: 'settings.get', method: 'GET', fn: 'lib_pipeline.settingsGet', effect: 'read', desc: 'The batch, the deadline, the status, the founder video confirmations and the state of your AI agent\'s work.', params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_pipeline.settingsUpdate',
    effect: 'write',
    desc: 'Change the batch and its deadline (verify the date on ycombinator.com/apply) and whether a YC founder recommended the team. A new batch given without --deadline takes YC\'s date when the app knows it, otherwise none: then read it on ycombinator.com/apply and set it. settings.get lists the batches to pick from (batches) and the confirmations only founders make (confirm_list).',
    params: {
      batch: S('Batch, e.g. "Spring 2027"'),
      deadline: S('Deadline as ISO date-time in UTC, e.g. 2027-02-10T04:00:00Z ("" clears it)'),
      deadline_note: S('Where the deadline comes from, e.g. "Spring 2027: February 9 at 8pm PT (ycombinator.com/apply)"'),
      recommended: B('A YC founder recommended the team'),
    },
  },
  {
    name: 'confirms.set',
    method: 'POST',
    fn: 'lib_pipeline.confirmsSet',
    effect: 'confirm',
    agent: 'deny',
    press: 'the switches under "Before you apply" on the Polish step, under "Founder video" on the Submit step, or "Each month on its own" under the revenue months question',
    desc: 'A founder confirms what only founders can: the founder video rules, full-time if accepted, one application, vesting, IP, roles, monthly revenue.',
    params: {
      one_minute: B('Founder video: one minute long'),
      all_founders: B('Founder video: every founder is in it'),
      unscripted: B('Founder video: talking, not reading a script'),
      no_extras: B('Founder video: no demo, music or effects'),
      full_time_if_accepted: B('A founder confirms: every founder works on it full-time if accepted'),
      one_application: B('A founder confirms: this is the company\'s only application this batch'),
      vesting: B('A founder confirms: founder shares vest'),
      ip_clear: B('A founder confirms: no employer or school can claim the code or the idea'),
      goals_aligned: B('A founder confirms: the founders agree on roles, goals and who is CEO'),
      revenue_monthly: B('A founder confirms: the revenue figures are monthly, not cumulative, not GMV'),
    },
  },
  { name: 'activity.list', method: 'GET', fn: 'lib_pipeline.activityList', effect: 'read', desc: 'Who changed what, newest first.', params: { limit: N('Rows (default 30)') } },
];
