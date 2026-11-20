/**
 * Catalog: goals and OKRs (personal, team, company), key results,
 * alignment, check-ins, CSV import and export.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const GOAL = S('Goal id', { required: true });
const KINDS = ['goal', 'kra', 'okr'];
const OPEN = ['on_track', 'at_risk', 'off_track'];
const ALL = ['on_track', 'at_risk', 'off_track', 'done', 'dropped'];
const KRS = S('JSON list of key results [{key, title, start, target, current, unit}] (unit like %, count, USD; progress fills from them)');

const FIELDS = {
  description: S('What the goal is about'),
  kind: S('goal | kra (key result area) | okr (objective with key results)', { enum: KINDS }),
  key_results: KRS,
  weight: N('Weight 0 to 100 in the review'),
  start_day: S('Start day (default today)'),
  due: S('Due day'),
  cycle: S('Review cycle id the goal belongs to'),
  parent: S('Goal id this one aligns to (a team or company goal)'),
};

const LIST = {
  view: S('mine | team (my reports and my department) | company | all (default, everything I may see)', { enum: ['mine', 'team', 'company', 'all'] }),
  employee: S('Only this person (number, id or email)'),
  department: S('Only this department (team goals)'),
  cycle: S('Only goals of this review cycle'),
  scope: S('personal | team | company | any', { enum: ['personal', 'team', 'company', 'any'] }),
  status: S('open (default) | done | dropped | closed | all | on_track | at_risk | off_track', { enum: ['open', 'done', 'dropped', 'closed', 'all'].concat(OPEN) }),
  parent: S('Goals aligned to this goal id, or none for top-level goals'),
  needs_update: B('Only goals that need an update (at risk, off track, overdue, due soon or no check-in for a while)'),
  q: S('Title or description contains'),
};

module.exports = [
  { name: 'goals.list', method: 'GET', fn: 'lib_performance_goals.list', perm: 'signed', effect: 'read', desc: 'Goals the caller may see, open and troubled first: owner, key results with progress, weight, status, due day, last check-in, why a goal needs an update. Who sees what: app.guide --module performance.', params: Object.assign({}, LIST, { limit: N('Rows (default 50)'), offset: N('Rows to skip') }) },
  { name: 'goals.get', method: 'GET', fn: 'lib_performance_goals.get', perm: 'signed', effect: 'read', desc: 'One goal with its key results, check-in history, the goals aligned to it and the chain of goals above it.', params: { goal: GOAL } },
  { name: 'goals.tree', method: 'GET', fn: 'lib_performance_goals.tree', perm: 'signed', effect: 'read', desc: 'The alignment tree: every goal the caller may see as a node with its parent, owner, progress and status; roots are the goals that align to nothing.', params: { cycle: S('Review cycle'), entity: S('Entity'), include_closed: B('Include done goals') } },
  {
    name: 'goals.create',
    method: 'POST',
    fn: 'lib_performance_goals.create',
    perm: 'self',
    agent: 'propose',
    kind: 'performance',
    preview: 'lib_performance_goals.previewCreate',
    effect: 'write',
    desc: 'Add a goal for you (default), a person (--employee; manager or HR), a team (--department) or the company (--company true; HR). --key_results drive progress; --parent aligns.',
    params: Object.assign({ title: S('Goal title', { required: true, example: '"Cut onboarding time to 5 days"' }), employee: S('Owner (number, id or email; default you)'), department: S('A team goal for this department'), company: B('A company goal'), entity: S('Entity of a team or company goal'), status: S('on_track (default) | at_risk | off_track', { enum: OPEN }), progress: N('Progress 0 to 100 (goals without key results)') }, FIELDS),
  },
  {
    name: 'goals.update',
    method: 'POST',
    fn: 'lib_performance_goals.update',
    perm: 'self',
    agent: 'propose',
    kind: 'performance',
    diff: { collection: 'goals', id: 'goal', fields: { title: 'title', description: 'description', kind: 'kind', key_results: 'key_results', weight: 'weight', status: 'status', start_day: 'start_day', due: 'due', cycle: 'cycle', parent: 'parent' } },
    effect: 'write',
    desc: 'Change a goal: title, description, key results (the list replaces the old; same keys keep their values), weight, status (done or dropped closes it), days, cycle, parent.',
    params: Object.assign({ goal: GOAL, title: S('Goal title'), status: S('on_track | at_risk | off_track | done | dropped', { enum: ALL }) }, FIELDS),
  },
  {
    name: 'goals.checkin',
    method: 'POST',
    fn: 'lib_performance_goals.checkin',
    perm: 'self',
    agent: 'propose',
    kind: 'performance',
    preview: 'lib_performance_goals.previewCheckin',
    effect: 'write',
    desc: 'Check in on a goal: a note, new key result values (JSON {"kr1": 40}) or the progress (no key results), and the status. Goals above it update their progress.',
    params: { goal: GOAL, note: S('What happened since the last check-in'), key_results: S('JSON {"<key>": <current value>} or [{key, current}]'), progress: N('Progress 0 to 100 (goals without key results)'), status: S('on_track | at_risk | off_track | done', { enum: OPEN.concat(['done']) }) },
  },
  { name: 'goals.delete', method: 'POST', fn: 'lib_performance_goals.remove', perm: 'self', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a goal and its check-ins; goals aligned to it move up to its parent. Usually mark it dropped instead (goals.update --status dropped).', params: { goal: GOAL } },
  { name: 'goals.export', method: 'GET', fn: 'lib_performance_goals.exportCsv', perm: 'signed', agent: 'deny', effect: 'read', desc: 'A CSV of the goals the caller sees (one row per key result), with the same filters as goals.list.', params: LIST },
  { name: 'goals.import-check', method: 'POST', fn: 'lib_performance_goals.importCheck', perm: 'performance:edit', effect: 'write', files: ['file'], desc: 'Check a goals CSV row by row, changing nothing (columns in app.guide --module performance). Rows with the same owner and title become one goal with several key results.', params: { csv: S('CSV text (or upload a file)'), path: S('Your AI agent: a CSV file on this machine') } },
  { name: 'goals.import', method: 'POST', fn: 'lib_performance_goals.importCommit', perm: 'performance:edit', agent: 'propose', kind: 'performance', effect: 'write', files: ['file'], desc: 'Import a goals CSV (all rows or none; run goals.import-check first). Your AI agent passes --csv text.', params: { csv: S('CSV text (or upload a file)'), path: S('A CSV file on this machine') } },
];
