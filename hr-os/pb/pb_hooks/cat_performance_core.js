/**
 * Catalog: performance Home, the profile tab and the module settings
 * (company values for praise, HR sign-off of reviews per entity, the
 * praise wall switch, when goals need an update, review reminders).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

module.exports = [
  {
    name: 'perf.home',
    method: 'GET',
    fn: 'lib_performance.home',
    perm: 'signed',
    effect: 'read',
    desc: 'Performance home for the caller: active cycles and phases, reviews owed (with due days) and to acknowledge, feedback requests, goals needing an update, praise, trainings due; managers get team counts.',
    params: {},
  },
  {
    name: 'perf.profile',
    method: 'GET',
    fn: 'lib_performance.profile',
    perm: 'signed',
    effect: 'read',
    desc: 'A person\'s performance tab: goals, reviews the caller may open (with the rating when allowed), feedback and praise the caller may see, skills against the job title, trainings and required ones.',
    params: { employee: S('Employee number (E0001), id or work email', { required: true }) },
  },
  { name: 'perf.inbox', method: 'GET', fn: 'lib_performance.inbox', perm: 'signed', effect: 'read', desc: "The caller's own open performance items for the Inbox: reviews to write (with due days), shared reviews to acknowledge, feedback requests to answer.", params: {} },
  { name: 'perf.settings', method: 'GET', fn: 'lib_performance.settingsGet', perm: 'signed', effect: 'read', desc: 'Performance settings: company values (praise tags), praise wall on or off, days before a goal needs an update, reminder days before a phase ends, and which entities require HR sign-off.', params: {} },
  {
    name: 'perf.settings-update',
    method: 'POST',
    fn: 'lib_performance.settingsUpdate',
    perm: 'performance:full',
    agent: 'deny',
    effect: 'write',
    desc: 'Change performance settings: values, praise wall, check-in and reminder days, default sign-off. --entity sets only --signoff (HR sign-off of its reviews).',
    params: {
      values: S('JSON list of company values [{code, name, description, icon}] (icon: a lucide name from perf.settings value_icons)'),
      praise_wall: B('Public praise wall on'),
      signoff: B('HR signs off reviews after the employee acknowledges them'),
      checkin_days: N('A goal needs an update after this many days without a check-in (default 14)'),
      reminder_days: N('Remind reviewers this many days before a phase ends (default 3)'),
      entity: S('Entity whose sign-off rule to set'),
    },
  },
];
