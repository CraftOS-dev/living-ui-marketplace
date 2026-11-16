/**
 * Catalog: staffing plans (planned headcount and budget per department
 * against today's headcount) and requisitions (approval kind requisition).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

const REQ = {
  entity: S('Entity id or name'),
  title: S('Role title, e.g. "Backend engineer"'),
  job_title: S('Job title from the list (name or id)'),
  department: S('Department (name or id)'),
  plan_line: S('Staffing plan line it fills'),
  headcount: N('How many people'),
  reason: S('new_role | replacement | growth', { enum: ['new_role', 'replacement', 'growth'] }),
  replaces: S('Employee it replaces (number or id)'),
  employment_type: S('Employment type (code or id)'),
  location: S('Location (name or id)'),
  remote: S('onsite | hybrid | remote', { enum: ['onsite', 'hybrid', 'remote'] }),
  budget: S('Budget in the entity currency, major units'),
  pay_min: S('Pay range low, major units'),
  pay_max: S('Pay range high, major units'),
  pay_per: S('year | month | week | day | hour', { enum: ['year', 'month', 'week', 'day', 'hour'] }),
  hiring_manager: S('Hiring manager (member id or email)'),
  target_start_day: S('When the person should start'),
  justification: S('Why the role is needed'),
};

module.exports = [
  { name: 'staffing-plans.list', method: 'GET', fn: 'lib_hiring_plans.plansList', perm: 'hiring:view', effect: 'read', desc: 'Staffing plans per entity with totals: planned headcount, people today, requested in requisitions, hired and the gap.', params: { entity: S('Entity'), status: S('draft | active | closed | all', { enum: ['draft', 'active', 'closed', 'all'] }) } },
  { name: 'staffing-plans.get', method: 'GET', fn: 'lib_hiring_plans.plansGet', perm: 'hiring:view', effect: 'read', desc: 'One staffing plan with its lines: department, job title, planned, people today (from the job records in effect), requested, hired, gap and budget.', params: { plan: S('Plan id', { required: true }) } },
  { name: 'staffing-plans.save', method: 'POST', preview: 'lib_hiring_plans.previewPlan', fn: 'lib_hiring_plans.plansSave', perm: 'hiring:full', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change a staffing plan of an entity (name, period, currency, status).', params: { plan: S('Plan id (empty to add)'), entity: S('Entity'), name: S('Name, e.g. "2027 plan"'), from_day: S('First day'), to_day: S('Last day'), currency: S('Currency of the budgets'), status: S('draft | active | closed', { enum: ['draft', 'active', 'closed'] }), note: S('Note') } },
  { name: 'staffing-plans.line-save', method: 'POST', preview: 'lib_hiring_plans.previewLine', fn: 'lib_hiring_plans.lineSave', perm: 'hiring:full', agent: 'propose', kind: 'hiring', effect: 'write', desc: 'Add or change a line of a staffing plan: department and job title, planned headcount and budget.', params: { line: S('Line id (empty to add)'), plan: S('Plan id (to add)'), department: S('Department'), job_title: S('Job title'), title: S('Label'), planned: N('Planned headcount at the end of the period'), budget: S('Budget for the line, major units'), note: S('Note'), sort: N('Order') } },
  { name: 'staffing-plans.line-delete', method: 'POST', fn: 'lib_hiring_plans.lineDelete', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a staffing plan line no requisition uses.', params: { line: S('Line id', { required: true }) } },
  { name: 'staffing-plans.delete', method: 'POST', fn: 'lib_hiring_plans.plansDelete', perm: 'hiring:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a staffing plan no requisition is linked to.', params: { plan: S('Plan id', { required: true }) } },

  { name: 'requisitions.list', method: 'GET', fn: 'lib_hiring_plans.reqsList', perm: 'hiring:view', effect: 'read', desc: 'Requisitions (requests for new people) the caller may see; managers see the ones they asked for or manage.', params: { status: S('open (default) | all | draft | pending | approved | rejected | filled | closed'), entity: S('Entity'), q: S('Title or number contains'), limit: N('Rows'), offset: N('Rows to skip') } },
  { name: 'requisitions.get', method: 'GET', fn: 'lib_hiring_plans.reqsGet', perm: 'hiring:view', effect: 'read', desc: 'One requisition with its approval, openings made from it and hires so far.', params: { requisition: S('Requisition id or number (R0001)', { required: true }) } },
  { name: 'requisitions.save', method: 'POST', fn: 'lib_hiring_plans.reqsSave', perm: 'hiring:edit', effect: 'write', desc: 'Draft or change a requisition (only a draft or a rejected one changes). Send it for approval with requisitions.submit.', params: Object.assign({ requisition: S('Requisition id or number (empty to add)') }, REQ) },
  { name: 'requisitions.submit', method: 'POST', fn: 'lib_hiring_plans.reqsSubmit', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Send a requisition for approval (kind requisition); the approver decides in the Inbox.', params: { requisition: S('Requisition id or number', { required: true }) } },
  { name: 'requisitions.close', method: 'POST', fn: 'lib_hiring_plans.reqsClose', perm: 'hiring:full', agent: 'deny', effect: 'write', desc: 'Close a requisition that is no longer needed (a pending approval is cancelled).', params: { requisition: S('Requisition id or number', { required: true }), reason: S('Why') } },
  { name: 'requisitions.delete', method: 'POST', fn: 'lib_hiring_plans.reqsDelete', perm: 'hiring:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a draft or rejected requisition with no openings.', params: { requisition: S('Requisition id or number', { required: true }) } },
];
