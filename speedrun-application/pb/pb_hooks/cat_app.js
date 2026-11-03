/**
 * Catalog: the guide, the pipeline, the settings and the activity trail.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  { name: 'app.guide', method: 'GET', fn: 'lib_guide.guide', effect: 'read', desc: 'START HERE: how this a16z speedrun application app works, the rules for writing answers, and the step-by-step recipes for gathering, answering a founder and filling speedrun\'s form.', params: {} },
  { name: 'app.status', method: 'GET', fn: 'lib_pipeline.status', effect: 'read', desc: 'Where the application stands: each pipeline step (with the screen it is on), the estimated odds, fix_next (what to fix in the application, most important first: blockers before warnings before tips, then by odds points), do_first (things to do before applying, outside the form), and the questions waiting for a founder.', params: {} },
  { name: 'app.founder-todo', method: 'GET', fn: 'lib_pipeline.todo', effect: 'read', desc: 'Everything waiting on the founders in one list: your open questions (on answers and on founders), answers to read and confirm, questions only founders answer, and the switches only founders turn on. Use it to tell the founders what is left for them.', params: {} },
  { name: 'pipeline.get', method: 'GET', fn: 'lib_pipeline.get', effect: 'read', desc: 'Everything the pipeline page shows: steps, odds with factors, failing checks, the do-first list, sources and recent activity.', params: {} },
  { name: 'settings.get', method: 'GET', fn: 'lib_pipeline.settingsGet', effect: 'read', desc: 'The cohort, the deadline, the status, the founders\' confirmations and the state of your AI agent\'s work.', params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_pipeline.settingsUpdate',
    effect: 'write',
    desc: 'Change the cohort and its deadline (verify the date on speedrun.a16z.com/apply). A new cohort given without --deadline takes speedrun\'s date when the app knows it, otherwise none: then read it on speedrun.a16z.com/apply and set it. settings.get lists the cohorts to pick from (cohorts) and the confirmations only founders make (confirm_list).',
    params: {
      cohort: S('Cohort, e.g. "SR009"'),
      deadline: S('Deadline as ISO date-time in UTC, e.g. 2027-05-03T06:59:00Z ("" clears it)'),
      deadline_note: S('Where the deadline comes from, e.g. "SR009: May 2 at 11:59 PM PT (speedrun.a16z.com/apply)"'),
    },
  },
  {
    name: 'confirms.set',
    method: 'POST',
    fn: 'lib_pipeline.confirmsSet',
    effect: 'confirm',
    agent: 'deny',
    press: 'the switches under "Before you apply" on the Polish step, or under "Team video" on the Submit step',
    desc: 'A founder confirms what only founders can: the team video points, the residency, full-time, one application, IP, roles, and that the metrics are measured.',
    params: {
      under_3_min: B('Team video: three minutes or less, MP4'),
      half_on_team: B('Team video: at least half on the founders and the team'),
      covers_rest: B('Team video: the rest on product, market and progress'),
      own_voice: B('Team video: the founders speak on camera themselves, no AI voice'),
      residency: B('A founder confirms: the team can join the residency in San Francisco'),
      full_time_if_accepted: B('A founder confirms: every founder builds full-time during the residency'),
      one_application: B('A founder confirms: this is the company\'s only application this cohort'),
      ip_clear: B('A founder confirms: no employer or school can claim the code or the idea'),
      goals_aligned: B('A founder confirms: the founders agree on roles, goals and who is CEO'),
      metrics_true: B('A founder confirms: the traction metrics are measured (recurring ARR, active users, bounded retention), not projected'),
    },
  },
  { name: 'activity.list', method: 'GET', fn: 'lib_pipeline.activityList', effect: 'read', desc: 'Who changed what, newest first.', params: { limit: N('Rows (default 30)') } },
  {
    name: 'app.reset',
    method: 'POST',
    fn: 'lib_pipeline.reset',
    effect: 'write',
    desc: 'Reset the application to a clean preparing state (clears answers, chat messages including queued messages and replies, activity, the review and the gather and fill state). Requires confirm=true.',
    params: { confirm: B('Must be true to execute the reset') },
  },
];
