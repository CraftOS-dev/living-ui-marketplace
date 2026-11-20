/**
 * Catalog: Home for each kind of viewer (home-reports module). app.home
 * (kernel) carries the shell counts; these carry the page.
 */
module.exports = [
  {
    name: 'home.admin',
    method: 'GET',
    fn: 'lib_home.admin',
    perm: 'people:view|payroll:view|reports:view',
    effect: 'read',
    desc: 'Home for HR, payroll and finance: to-dos (approvals, proposals, pay run blockers, expiring documents, movers, probations), readouts, headcount and cost trends, your work, and the office globe.',
  },
  {
    name: 'home.manager',
    method: 'GET',
    fn: 'lib_home.manager',
    perm: 'signed',
    effect: 'read',
    desc: "Home for a manager: the team (direct and all reports), who is out today, leave days this month, probations ending in 30 days and approvals waiting. Empty for someone without reports.",
  },
  {
    name: 'home.me',
    method: 'GET',
    fn: 'lib_home.me',
    perm: 'self',
    effect: 'read',
    desc: 'The caller\'s own Home: employments, documents to acknowledge, latest requests, answers from your AI agent, today\'s clock. --places adds every module\'s profile facts and the Me place counts.',
    params: { places: { type: 'boolean', desc: 'Add the profile facts and the Me place counts (the Me page)' } },
  },
  {
    name: 'home.directory',
    method: 'GET',
    fn: 'lib_home.directory',
    perm: 'signed',
    effect: 'read',
    desc: 'The company directory every signed-in person may read: people in work today with work details only (name, title, department, location, entity, work email, manager). Search with q.',
    params: {
      q: { type: 'string', desc: 'Name, title, department, location or email contains' },
      entity: { type: 'string', desc: 'Entity id or name' },
      department: { type: 'string', desc: 'Department id or name (sub-departments too)' },
      location: { type: 'string', desc: 'Location id or name' },
      limit: { type: 'number', desc: 'Rows (default 60)' },
      offset: { type: 'number', desc: 'Rows to skip' },
    },
  },
];
