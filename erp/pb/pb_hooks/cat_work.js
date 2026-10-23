/**
 * Catalog: projects, tasks on a board, weekly timesheets with approval,
 * billing approved time to an invoice, and project profitability.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const PROJECT = 'Project: code (PRJ-0001), exact name or id';
const TASK = 'Task: id, or its exact title (give project too when titles repeat)';
const STATUS = ['active', 'on_hold', 'done', 'cancelled'];
const BILLING = ['fixed', 'time_materials', 'non_billable'];
const TASK_STATUS = ['todo', 'doing', 'done'];
const TS_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'invoiced'];
const ENTRIES =
  'JSON list of the week\'s time: [{"project":"PRJ-0001","task":"Design","date":"2026-10-19","hours":2.5,"billable":true,"description":"Homepage"}]. It REPLACES the week\'s draft and rejected entries; hours 0 removes; submitted, approved and invoiced time cannot change (send it unchanged or leave it out).';

const projectFields = {
  name: s('Name'),
  code: s('Code (automatic from the project numbering when empty)'),
  customer: s('Customer: name, code or id ("none" clears)'),
  manager: s('Project manager: an employee ("none" clears)'),
  status: e('Status', STATUS),
  start: s('Start YYYY-MM-DD ("none" clears)'),
  end: s('End YYYY-MM-DD ("none" clears)'),
  budget: s('Budget in the base currency, e.g. 25000.00'),
  billing: e('fixed (a price), time_materials (bill approved time) or non_billable (internal)', BILLING),
  rate: s('Hourly rate billed for time, e.g. 120.00'),
  description: s('Description'),
  color: n('Color 0 to 7'),
};

const taskFields = {
  title: s('Title'),
  status: e('Board column', TASK_STATUS),
  assignee: s('Assignee: an employee ("none" clears)'),
  due: s('Due YYYY-MM-DD ("none" clears)'),
  estimate_hours: s('Estimate in hours, e.g. 6'),
  notes: s('Notes'),
};

module.exports = [
  /* projects */
  {
    name: 'projects.list',
    method: 'GET',
    fn: 'lib_projects.list',
    perm: 'self',
    desc: 'Projects the caller may see (all with Projects view, else the ones they work on), each with budget, hours logged, time cost, revenue invoiced, spent from the books, budget used % and task progress.',
    params: Object.assign(
      {
        q: s('Search code, name, customer'),
        status: e('Status (open: active and on hold)', STATUS.concat(['open', 'all'])),
        customer: s('Customer'),
        manager: s('Project manager'),
        billing: e('Billing type', BILLING),
        mine: b('Only projects I work on'),
        sort: e('Sort', ['name', 'code', 'status', 'start', 'end', 'budget', 'created', 'updated']),
        desc: b('Descending'),
      },
      page,
    ),
  },
  { name: 'projects.get', method: 'GET', fn: 'lib_projects.get', perm: 'self', desc: 'One project: header, tasks by board column with assignees, hours by person, latest time, linked documents, time waiting to be approved and billed, profitability and budget used.', params: { project: r(PROJECT, 'PRJ-0001') } },
  { name: 'projects.add', method: 'POST', fn: 'lib_projects.add', perm: 'projects:edit', desc: 'Add a project (the code comes from the project numbering when empty).', params: Object.assign({}, projectFields, { name: r('Name', '"Website rebuild"') }) },
  { name: 'projects.update', method: 'POST', fn: 'lib_projects.update', perm: 'projects:edit', desc: 'Change a project.', params: Object.assign({ project: r(PROJECT, 'PRJ-0001') }, projectFields) },
  {
    name: 'projects.delete',
    method: 'POST',
    fn: 'lib_projects.remove',
    perm: 'projects:full',
    destructive: true,
    desc: 'Delete a project and its tasks. Refused when it has time, documents, journal lines or expense claims: set its status to done or cancelled instead.',
    params: { project: r(PROJECT, 'PRJ-0001'), preview: b('Only say what would happen') },
  },
  {
    name: 'projects.profit',
    method: 'GET',
    fn: 'lib_projects.profit',
    perm: 'self',
    desc: 'Profitability of a project: revenue (posted invoices less credit notes, net of tax), costs from the books (expense accounts with the project), time cost (hours x hourly cost), books margin and margin after time, budget used.',
    params: { project: r(PROJECT, 'PRJ-0001'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') },
  },
  { name: 'projects.summary', method: 'GET', fn: 'lib_projects.summary', perm: 'projects:view', desc: 'Projects at a glance: counts by status, hours this month, time waiting to be approved and billed, and the 5 projects most over budget.', params: {} },

  /* tasks */
  { name: 'tasks.list', method: 'GET', fn: 'lib_projects.listTasks', perm: 'self', desc: "A project's tasks in board order (todo, doing, done) with assignee, due date, estimate and hours logged.", params: { project: r(PROJECT, 'PRJ-0001'), status: e('Board column', TASK_STATUS), assignee: s('Assignee') } },
  { name: 'tasks.add', method: 'POST', fn: 'lib_projects.addTask', perm: 'self', desc: 'Add a task to a project (people on the project, or edit access to Projects).', params: Object.assign({ project: r(PROJECT, 'PRJ-0001') }, taskFields, { title: r('Title', '"Draft the homepage"') }) },
  { name: 'tasks.update', method: 'POST', fn: 'lib_projects.updateTask', perm: 'self', desc: 'Change a task (a new status puts it at the end of that column).', params: Object.assign({ task: r(TASK), project: s('Project, to find the task by title') }, taskFields) },
  { name: 'tasks.move', method: 'POST', fn: 'lib_projects.moveTask', perm: 'self', desc: 'Move a task on the board: to a column and a position in it (0 is the top); the column is renumbered.', params: { task: r(TASK), project: s('Project, to find the task by title'), status: re('Board column', TASK_STATUS), sort: n('Position in the column, 0 is the top (default the end)') } },
  { name: 'tasks.delete', method: 'POST', fn: 'lib_projects.removeTask', perm: 'projects:edit', destructive: true, desc: 'Delete a task. Refused when time was logged on it: mark it done instead.', params: { task: r(TASK), project: s('Project, to find the task by title'), preview: b('Only say what would happen') } },

  /* timesheets */
  {
    name: 'timesheets.week',
    method: 'GET',
    fn: 'lib_projects.week',
    perm: 'self',
    desc: "A week of time as a grid: rows of project and task with hours per day, totals per day and row, each entry's status, and the active projects (with open tasks) time can be logged to.",
    params: { employee: s('Employee (default yourself; others: their manager or Projects view)'), week: s('Any date in the week, YYYY-MM-DD (default this week; weeks start on Monday)') },
  },
  {
    name: 'timesheets.save-week',
    method: 'POST',
    fn: 'lib_projects.saveWeek',
    perm: 'self',
    desc: 'Save a week of time as drafts. At most 24 hours a day, on active projects; billable defaults from the project; the rate and the hourly cost are kept with each entry. Your AI agent saves time for an employee only when asked.',
    params: { employee: s('Employee (default yourself; others need People edit or Projects full)'), week: s('Any date in the week, YYYY-MM-DD (default this week)'), entries: r(ENTRIES) },
  },
  { name: 'timesheets.submit', method: 'POST', fn: 'lib_projects.submit', perm: 'self', desc: 'Submit your own week for approval (draft and rejected time becomes submitted).', params: { week: s('Any date in the week, YYYY-MM-DD (default this week)') } },
  {
    name: 'timesheets.decide',
    method: 'POST',
    fn: 'lib_projects.decide',
    perm: 'self',
    agent: 'deny',
    desc: "Approve or reject submitted time: the employee's manager (up the manager chain) or full access to Projects; never your own.",
    params: { ids: r('JSON list of time entry ids, e.g. ["abc123def456ghi"]'), approve: { type: 'boolean', required: true, desc: 'true approves, false rejects' }, note: s('Note (shown with rejected time)') },
  },
  {
    name: 'timesheets.list',
    method: 'GET',
    fn: 'lib_projects.listTime',
    perm: 'self',
    desc: 'Time entries with totals of hours, billable value and cost. scope mine (default), team (everyone you manage) or all (Projects view, or a project you manage).',
    params: Object.assign(
      {
        scope: e('Whose time', ['mine', 'team', 'all']),
        project: s(PROJECT),
        employee: s('Employee'),
        status: e('Status', TS_STATUS),
        from: s('From YYYY-MM-DD'),
        to: s('To YYYY-MM-DD'),
      },
      page,
    ),
  },
  {
    name: 'timesheets.bill',
    method: 'POST',
    fn: 'lib_projects.bill',
    perm: 'self',
    agent: 'allow',
    desc: "Bill a time-and-materials project's approved billable time up to a date: ONE draft invoice for its customer with a line per employee (hours x the project rate), and the time is marked invoiced. Deleting or voiding that invoice frees the time again. Needs full access to Projects or edit access to Sales.",
    params: { project: r(PROJECT, 'PRJ-0001'), through: s('Bill time up to this date, YYYY-MM-DD (default today)'), preview: b('Only show the lines it would bill') },
  },
];
