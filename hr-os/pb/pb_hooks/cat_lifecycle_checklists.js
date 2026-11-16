/**
 * Catalog: lifecycle home, profile tab, welcome page, checklist templates,
 * checklists and their tasks.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PAGE = { limit: N('Rows (default 50)'), offset: N('Rows to skip') };
const KIND = S('onboarding | offboarding | custom', { enum: ['onboarding', 'offboarding', 'custom'] });
const TEMPLATE = S('Template id or name', { required: true });
const CHECKLIST = S('Checklist id', { required: true });
const TASK = S('Task id', { required: true });
const ASSIGNEE = S('hr | manager | it | employee | agent | member:<member id or email>');

module.exports = [
  { name: 'lifecycle.home', method: 'GET', fn: 'lib_lifecycle.home', perm: 'signed', effect: 'read', desc: 'Lifecycle at a glance: people starting and leaving soon with checklist progress, the caller\'s open and overdue tasks, letters to issue, separations waiting, open grievances (HR only).', params: { days: N('Days ahead (default 30)') } },
  { name: 'lifecycle.profile', method: 'GET', fn: 'lib_lifecycle.profile', perm: 'signed', effect: 'read', desc: 'The Lifecycle tab of a person: checklists with progress, open tasks, assets held, letters, separations and handbook pages they still have to acknowledge.', params: { employee: S('Employee number (E0001), id or work email', { required: true }) } },
  { name: 'lifecycle.welcome', method: 'GET', fn: 'lib_lifecycle.welcome', perm: 'self', effect: 'read', desc: 'The signed-in person\'s onboarding: first-day details (day, time, place, contact, what to bring), their tasks, documents and letters to acknowledge, handbook pages to read.' },

  { name: 'checklist-templates.list', method: 'GET', fn: 'lib_lifecycle_checklists.templatesList', perm: 'people:view', effect: 'read', desc: 'Checklist templates (onboarding, offboarding, custom) with their tasks: title, assignee lane, due offset in days from the first or last day, kind (task, document, signature).', params: { kind: KIND, entity: S('Entity (its own and company-wide templates)'), archived: B('Include archived templates') } },
  { name: 'checklist-templates.get', method: 'GET', fn: 'lib_lifecycle_checklists.templatesGet', perm: 'people:view', effect: 'read', desc: 'One checklist template with its tasks.', params: { template: TEMPLATE } },
  {
    name: 'checklist-templates.save',
    method: 'POST',
    fn: 'lib_lifecycle_checklists.templatesSave',
    perm: 'people:edit',
    agent: 'propose',
    kind: 'people',
    diff: { collection: 'checklist_templates', id: 'template', fields: { name: 'name', description: 'description', tasks: 'tasks', is_default: 'is_default', archived: 'archived' } },
    effect: 'write',
    desc: 'Add or change a checklist template; --tasks replaces the list in order (shape: app.guide --module lifecycle). A kind\'s default template starts on each hire or approved separation.',
    params: { template: S('Template id or name (empty to add one)'), kind: KIND, name: S('Name'), entity: S('Entity (empty = every entity)'), description: S('What it is for'), tasks: S('JSON list of tasks [{title, assignee, due_offset_days, kind, description, document_category}]'), is_default: B('Make it the default of its kind for its entity'), archived: B('Archived templates are not offered') },
  },
  { name: 'checklist-templates.copy', method: 'POST', fn: 'lib_lifecycle_checklists.templatesCopy', perm: 'people:edit', agent: 'propose', kind: 'people', effect: 'write', desc: 'Copy a checklist template (for another entity or a variant).', params: { template: TEMPLATE, name: S('Name of the copy'), entity: S('Entity of the copy (empty = every entity)') } },
  { name: 'checklist-templates.delete', method: 'POST', fn: 'lib_lifecycle_checklists.templatesDelete', perm: 'people:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a checklist template that never started a checklist (archive a used one instead).', params: { template: TEMPLATE } },
  { name: 'checklist-templates.seed', method: 'POST', fn: 'lib_lifecycle_checklists.templatesSeed', perm: 'people:edit', agent: 'propose', kind: 'people', effect: 'write', desc: 'Add the country defaults an entity lacks: onboarding and offboarding templates with its country\'s documents and deadlines, letter templates, exit interview form, grievance types.', params: { entity: S('Entity', { required: true }) } },

  { name: 'checklists.list', method: 'GET', fn: 'lib_lifecycle_checklists.checklistsList', perm: 'signed', effect: 'read', desc: 'Checklists the caller may see (HR: their entities; managers: their reports; everyone: their own) with progress (done, open, overdue).', params: Object.assign({ status: S('open (default) | done | cancelled | all', { enum: ['open', 'done', 'cancelled', 'all'] }), kind: KIND, employee: S('Employee'), entity: S('Entity') }, PAGE) },
  { name: 'checklists.get', method: 'GET', fn: 'lib_lifecycle_checklists.checklistsGet', perm: 'signed', effect: 'read', desc: 'One checklist: the person, first-day details, progress and its tasks (the person sees only theirs).', params: { checklist: CHECKLIST } },
  { name: 'checklists.start', method: 'POST', fn: 'lib_lifecycle_checklists.checklistsStart', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_lifecycle_checklists.previewStart', effect: 'write', desc: 'Start a checklist from a template (default the entity\'s default of the kind). Due days count from --anchor_day (default: the first day, the last day for offboarding, else today).', params: { employment: S('Employment or employee number', { required: true }), kind: KIND, template: S('Template id or name'), anchor_day: S('Day the due offsets count from'), name: S('Name (default: the template name)') } },
  { name: 'checklists.cancel', method: 'POST', fn: 'lib_lifecycle_checklists.checklistsCancel', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Cancel an open checklist (its tasks leave everyone\'s lists).', params: { checklist: CHECKLIST, note: S('Why') } },
  { name: 'checklists.first-day', method: 'POST', fn: 'lib_lifecycle_checklists.checklistsFirstDay', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_lifecycle_checklists.previewFirstDay', effect: 'write', desc: 'First-day details the new hire sees on their welcome page: arrival time, place, contact person, what to bring, a note.', params: { checklist: CHECKLIST, time: S('Arrival time HH:MM'), place: S('Where to go'), contact: S('Who to ask for (employee)'), bring: S('What to bring'), note: S('A welcome note') } },
  { name: 'checklists.ask-agent', method: 'POST', fn: 'lib_lifecycle_checklists.checklistsAskAgent', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Ask your AI agent now to do the open tasks assigned to it on a checklist (the onboarding_help trigger with the checklist). Asked once while that ask is open.', params: { checklist: CHECKLIST } },

  { name: 'tasks.list', method: 'GET', fn: 'lib_lifecycle_checklists.listTasks', perm: 'signed', effect: 'read', desc: 'Checklist tasks: assigned to the caller (view mine, default) or all the caller may see (view all). Your AI agent: its own tasks.', params: Object.assign({ view: S('mine | all', { enum: ['mine', 'all'] }), status: S('open (default) | done | skipped | closed | all', { enum: ['open', 'done', 'skipped', 'closed', 'all'] }), employee: S('Employee'), checklist: S('Checklist id'), checklist_kind: KIND, overdue: B('Only overdue tasks'), due_before: S('Due on or before this day') }, PAGE) },
  { name: 'tasks.complete', method: 'POST', fn: 'lib_lifecycle_checklists.tasksComplete', perm: 'signed', effect: 'write', files: ['file'], desc: 'Mark a task done with a note. A document task needs the file (an upload, --path for your AI agent, or --document); it is stored with the person. Your AI agent completes only tasks assigned to it.', params: { task: TASK, note: S('What was done (your AI agent: the draft or result)'), document: S('An existing document id of the person'), path: S('Your AI agent: the file on this machine') } },
  { name: 'tasks.reopen', method: 'POST', fn: 'lib_lifecycle_checklists.tasksReopen', perm: 'signed', effect: 'write', desc: 'Reopen a done or skipped task.', params: { task: TASK, note: S('Why') } },
  { name: 'tasks.skip', method: 'POST', fn: 'lib_lifecycle_checklists.tasksSkip', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Skip a task that does not apply to this person.', params: { task: TASK, note: S('Why') } },
  { name: 'tasks.add', method: 'POST', fn: 'lib_lifecycle_checklists.tasksAdd', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_lifecycle_checklists.previewTaskAdd', effect: 'write', desc: 'Add a task to a checklist: for a lane (hr, manager, it, employee, agent) or a named member, due on a day or at an offset from the checklist\'s first or last day.', params: { checklist: CHECKLIST, title: S('What to do', { required: true }), assignee: ASSIGNEE, due: S('Due day'), due_offset_days: N('Days from the anchor day (when no due day)'), kind: S('task | document | signature', { enum: ['task', 'document', 'signature'] }), description: S('Details'), document_category: S('Document category for a document task') } },
  { name: 'tasks.update', method: 'POST', fn: 'lib_lifecycle_checklists.tasksUpdate', perm: 'people:edit', agent: 'propose', kind: 'people', diff: { collection: 'tasks', id: 'task', fields: { title: 'title', description: 'description', due: 'due', kind: 'kind' } }, effect: 'write', desc: 'Change a task: title, details, assignee, due day, kind or order.', params: { task: TASK, title: S('What to do'), description: S('Details'), assignee: ASSIGNEE, due: S('Due day (empty for none)'), kind: S('task | document | signature', { enum: ['task', 'document', 'signature'] }), document_category: S('Document category'), sort: N('Order') } },
  { name: 'tasks.delete', method: 'POST', fn: 'lib_lifecycle_checklists.tasksDelete', perm: 'people:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a task from a checklist.', params: { task: TASK } },
];
