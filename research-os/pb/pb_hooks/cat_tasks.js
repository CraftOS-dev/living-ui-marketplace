/**
 * Catalog: each project's to-do list (research tasks).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const STATUS = ['todo', 'doing', 'waiting', 'done'];
const PRIORITY = ['none', 'low', 'medium', 'high', 'urgent'];
const RECUR = ['none', 'daily', 'weekly', 'monthly'];
const LINKS = 'JSON list of the project\'s records: [{"kind":"work","id":"<paper>"},{"kind":"node","id":"<claim>"}] (kinds: work, node, manuscript, board, note, experiment)';
const CHECKLIST = 'JSON list of steps: ["Re-run the baseline", {"text":"Plot the results","done":true}] (keep an item\'s "id" to keep it)';

module.exports = [
  {
    name: 'tasks.list',
    method: 'GET',
    fn: 'lib_tasks.list',
    effect: 'read',
    desc: "A project's to-do list (or every project's when --project is left out), open tasks by default; filter by status, who it is for, when it is due, a label or words.",
    params: { project: S('Project'), status: S('Which', { enum: ['open', 'all', 'todo', 'doing', 'waiting', 'done'] }), assignee: S('For whom', { enum: ['person', 'agent'] }), due: S('When', { enum: ['overdue', 'today', 'week', 'none'] }), label: S('Label'), q: S('Words in the title or notes'), limit: N('Rows'), offset: N('Skip') },
  },
  { name: 'tasks.get', method: 'GET', fn: 'lib_tasks.get', effect: 'read', desc: 'One task with its checklist, labels and linked records.', params: { task: S('Task', { required: true }) } },
  {
    name: 'tasks.summary',
    method: 'GET',
    fn: 'lib_tasks.summary',
    effect: 'read',
    desc: 'Open tasks across active projects (or one project): counts by due day (overdue, today, this week), in progress, waiting, for your AI agent, per project, and what comes next (in one project: every open task, by day then priority).',
    params: { project: S('Project'), limit: N('How many next tasks (default 12)') },
  },
  {
    name: 'tasks.create',
    method: 'POST',
    fn: 'lib_tasks.create',
    effect: 'capture',
    desc: "Add a task to a project's to-do list. --assignee agent hands it to your AI agent (not in confidential projects).",
    params: {
      project: S('Project', { required: true }),
      title: S('What to do', { required: true }),
      notes: S('Notes'),
      status: S('Status', { enum: STATUS }),
      priority: S('Priority', { enum: PRIORITY }),
      due: S('Due day YYYY-MM-DD'),
      assignee: S('For whom', { enum: ['person', 'agent'] }),
      labels: S('JSON list of labels'),
      checklist: S(CHECKLIST),
      links: S(LINKS),
      recur: S('Repeat when completed', { enum: RECUR }),
      after: S('"start" puts it at the top'),
    },
  },
  {
    name: 'tasks.update',
    method: 'POST',
    fn: 'lib_tasks.update',
    effect: 'capture',
    desc: 'Change a task: title, notes, status, priority, due day ("" clears it), who it is for, labels, checklist, links or repeat.',
    params: {
      task: S('Task', { required: true }),
      title: S('Title'),
      notes: S('Notes'),
      status: S('Status', { enum: STATUS }),
      priority: S('Priority', { enum: PRIORITY }),
      due: S('Due day YYYY-MM-DD ("" clears it)'),
      assignee: S('For whom', { enum: ['person', 'agent'] }),
      labels: S('JSON list of labels'),
      checklist: S(CHECKLIST),
      links: S(LINKS),
      recur: S('Repeat', { enum: RECUR }),
    },
  },
  { name: 'tasks.complete', method: 'POST', fn: 'lib_tasks.complete', effect: 'capture', desc: 'Tick a task off (--done false reopens it). A repeating task makes its next one.', params: { task: S('Task', { required: true }), done: B('Done (default true)') } },
  { name: 'tasks.move', method: 'POST', fn: 'lib_tasks.move', effect: 'capture', desc: 'Move a task to a status column and place it ("start", after a task id, or at the end).', params: { task: S('Task', { required: true }), status: S('Status', { enum: STATUS }), after: S('"start", "end" or a task id') } },
  { name: 'tasks.check', method: 'POST', fn: 'lib_tasks.check', effect: 'capture', desc: 'Tick or untick one checklist item (--item), or add an item (--text).', params: { task: S('Task', { required: true }), item: S('Checklist item id'), text: S('A new item'), done: B('Done') } },
  { name: 'tasks.delete', method: 'POST', fn: 'lib_tasks.remove', effect: 'change', destructive: true, desc: 'Delete a task (Activity can undo it).', params: { task: S('Task', { required: true }), preview: B('Only show the task') } },
];
