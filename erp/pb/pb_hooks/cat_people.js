/**
 * Catalog: people (departments, employees, org chart), leave, expense
 * claims and payroll.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const rb = (desc) => ({ type: 'boolean', required: true, desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const EMP = 'Employee: number (EMP-0001), email, exact name or id';
const CLAIM = 'Claim number (EXP-00001) or id';
const RUN = 'Pay run number (PR-0001), month (2026-11) or id';
const ICONS = ['sun', 'thermometer', 'calendar-off', 'baby', 'heart', 'plane', 'graduation-cap', 'briefcase', 'home', 'umbrella'];
const CLAIM_LINES =
  'JSON list: [{"account":"6400","description":"Taxi to client","amount":"21.80","tax":"SR9","date":"2026-11-03","project":"PRJ-0001"}]. account: an expense account code or name; amount includes tax; tax: a purchase tax code (optional). On update, keep a line (and its receipt) by giving its "id".';
const SLIP_LINES =
  'JSON list of the whole payslip: [{"basic":true,"amount":"3000.00"},{"component":"Transport allowance","amount":"200.00"},{"name":"One-off bonus","kind":"earning","amount":"500.00"}]. Amounts are money text; a line without a component needs name and kind (account optional).';

const deptFields = {
  name: s('Name'),
  code: s('Short code'),
  parent: s('Parent department (empty for none)'),
  manager: s('Head of the department (an employee)'),
  sort: n('Order'),
};

const employeeFields = {
  name: s('Full name'),
  number: s('Employee number (automatic when empty)'),
  email: s('Work email'),
  phone: s('Phone'),
  job_title: s('Job title'),
  department: s('Department (code or name; empty for none)'),
  manager: s('Manager (an employee; empty for none)'),
  start_date: s('Start date YYYY-MM-DD (default today)'),
  end_date: s('End date YYYY-MM-DD'),
  status: e('Status', ['active', 'on_leave', 'left']),
  employment: e('Contract type', ['full_time', 'part_time', 'contractor', 'intern', 'temporary']),
  pay_basic: s('Basic pay per pay period, e.g. 4500.00 (needs edit access to Payroll or full access to People)'),
  pay_frequency: e('Pay period', ['monthly', 'semi_monthly', 'biweekly', 'weekly']),
  hourly_cost: s('Cost per hour for project costing, e.g. 35.00'),
  bank_details: s('Bank account for salary'),
  national_id: s('National id number'),
  tax_number: s('Personal tax number'),
  address: s('Home address'),
  birthday: s('Birthday YYYY-MM-DD'),
  emergency_contact: s('Emergency contact'),
  notes: s('Notes'),
  remove_photo: b('Remove the photo'),
};

const typeFields = {
  name: s('Name'),
  days_per_year: s('Days given each year (0: no limit, e.g. unpaid leave)'),
  paid: b('Paid leave'),
  needs_approval: b('Needs the manager to approve (false: approved at once)'),
  carry_over_max: s('Most days that may carry into the next year'),
  icon: e('Line icon', ICONS),
  sort: n('Order'),
};

const componentFields = {
  name: s('Name'),
  kind: e('earning (adds to gross), deduction (taken from pay) or employer (a cost on top, e.g. employer pension)', ['earning', 'deduction', 'employer']),
  calc: e('fixed amount or percent of basic pay', ['fixed', 'percent']),
  amount: s('Fixed amount per month, e.g. 200.00'),
  percent: s('Percent of basic pay, e.g. 17 or 7.5'),
  account: s('Account it posts to (default: salaries for earnings, payroll deductions payable for deductions, employer contributions for employer)'),
  liability_account: s('Employer contributions: the liability it is owed to (default payroll deductions payable)'),
  applies: e('all employees, or only those it is assigned to (selected)', ['all', 'selected']),
  active: b('In use'),
  sort: n('Order'),
};

module.exports = [
  /* departments */
  { name: 'departments.list', method: 'GET', fn: 'lib_people.listDepartments', perm: 'self', desc: 'Departments with their head, parent and number of current employees.', params: { archived: b('Include archived departments') } },
  { name: 'departments.add', method: 'POST', fn: 'lib_people.addDepartment', perm: 'people:edit', desc: 'Add a department.', params: Object.assign({}, deptFields, { name: r('Name', 'Engineering') }) },
  { name: 'departments.update', method: 'POST', fn: 'lib_people.updateDepartment', perm: 'people:edit', desc: 'Change a department.', params: Object.assign({ department: r('Department code or name') }, deptFields, { archived: b('Archived') }) },
  { name: 'departments.delete', method: 'POST', fn: 'lib_people.deleteDepartment', perm: 'people:edit', destructive: true, desc: 'Delete a department nobody is in and no entry uses (archive the others). Its sub-departments move up.', params: { department: r('Department code or name'), preview: b('Only say what would happen') } },

  /* employees */
  {
    name: 'employees.list',
    method: 'GET',
    fn: 'lib_people.listEmployees',
    perm: 'self',
    desc: 'The employee directory (everyone sees names, titles, departments, managers, photos and contacts; more with People or Payroll rights), with counts per status and department.',
    params: Object.assign({ q: s('Search name, number, email, job title'), department: s('Department (none: without one)'), manager: s('Direct reports of this employee'), status: e('active, on_leave, left, current (default: not left) or all', ['active', 'on_leave', 'left', 'current', 'all']) }, page),
  },
  { name: 'employees.get', method: 'GET', fn: 'lib_people.getEmployee', perm: 'self', desc: 'One employee: details the caller may see, direct reports, the manager chain, and (for themselves, their managers and HR) leave balances and recent claims.', params: { employee: r(EMP) } },
  { name: 'employees.add', method: 'POST', fn: 'lib_people.addEmployee', perm: 'people:edit', files: ['photo'], desc: 'Add an employee (the number is automatic). Pay fields need edit access to Payroll or full access to People.', params: Object.assign({}, employeeFields, { name: r('Full name', '"Sam Lee"') }) },
  { name: 'employees.update', method: 'POST', fn: 'lib_people.updateEmployee', perm: 'people:edit', files: ['photo'], desc: 'Change an employee (status left records that they left). Pay fields need edit access to Payroll or full access to People.', params: Object.assign({ employee: r(EMP) }, employeeFields) },
  { name: 'employees.delete', method: 'POST', fn: 'lib_people.deleteEmployee', perm: 'people:full', destructive: true, desc: 'Delete an employee with no leave, claims, time, payslips or entries (set status left for the others). Their reports move to their manager.', params: { employee: r(EMP), preview: b('Only say what would happen') } },
  { name: 'employees.org', method: 'GET', fn: 'lib_people.org', perm: 'self', desc: 'The org chart as a tree: people without a manager at the top, each with title, department, photo and reports.', params: { include_left: b('Include people who left') } },

  /* leave */
  { name: 'leave.types', method: 'GET', fn: 'lib_leave.listTypes', perm: 'self', desc: 'Leave types (days per year, paid, needs approval, carry-over, icon) and the icons they can wear.', params: { archived: b('Include archived types') } },
  { name: 'leave.type-add', method: 'POST', fn: 'lib_leave.addType', perm: 'people:full', desc: 'Add a leave type.', params: Object.assign({}, typeFields, { name: r('Name', '"Study leave"') }) },
  { name: 'leave.type-update', method: 'POST', fn: 'lib_leave.updateType', perm: 'people:full', desc: 'Change a leave type (requests already made keep their days).', params: Object.assign({ type: r('Leave type name or id') }, typeFields) },
  { name: 'leave.type-archive', method: 'POST', fn: 'lib_leave.archiveType', perm: 'people:full', desc: 'Archive a leave type (no new requests) or restore it.', params: { type: r('Leave type name or id'), archived: b('true archives (default), false restores') } },
  { name: 'leave.holidays', method: 'GET', fn: 'lib_leave.listHolidays', perm: 'self', desc: 'Public holidays of a year (they are not counted as leave days) and the working days of the week.', params: { year: n('Year (default this year)') } },
  { name: 'leave.holiday-add', method: 'POST', fn: 'lib_leave.addHoliday', perm: 'people:edit', desc: 'Add a public holiday.', params: { date: r('Date YYYY-MM-DD'), name: r('Name', '"National Day"') } },
  { name: 'leave.holiday-delete', method: 'POST', fn: 'lib_leave.deleteHoliday', perm: 'people:edit', destructive: true, desc: 'Delete a public holiday.', params: { holiday: r('Holiday date (YYYY-MM-DD), name or id'), preview: b('Only say what would happen') } },
  {
    name: 'leave.request',
    method: 'POST',
    fn: 'lib_leave.request',
    perm: 'self',
    agent: 'deny',
    desc: 'Request leave (working days from..to less holidays; a half day is one day). Types that need approval wait for the manager; others are approved at once. Refused when it overlaps other leave or goes over the balance.',
    params: { type: r('Leave type', '"Annual leave"'), from: r('First day YYYY-MM-DD'), to: s('Last day YYYY-MM-DD (default: from)'), half_day: b('Half a day (from and to the same day)'), reason: s('Reason'), employee: s('For another employee (needs edit access to People)') },
  },
  {
    name: 'leave.list',
    method: 'GET',
    fn: 'lib_leave.listLeave',
    perm: 'self',
    desc: 'Leave requests: mine, my team (everyone below me), or all (People view), with counts per status.',
    params: Object.assign({ scope: e('mine (default), team or all', ['mine', 'team', 'all']), status: e('Status', ['submitted', 'approved', 'rejected', 'cancelled']), employee: s(EMP), type: s('Leave type'), from: s('Overlapping from YYYY-MM-DD'), to: s('Overlapping to YYYY-MM-DD') }, page),
  },
  { name: 'leave.get', method: 'GET', fn: 'lib_leave.getRequest', perm: 'self', desc: 'One leave request.', params: { request: r('Leave request id') } },
  { name: 'leave.calendar', method: 'GET', fn: 'lib_leave.calendar', perm: 'self', desc: "A month of leave (approved and waiting) the caller may see, with that month's holidays.", params: { month: s('Month YYYY-MM (default this month)'), scope: e('visible (default: everything the caller may see), mine, team or all', ['visible', 'mine', 'team', 'all']) } },
  { name: 'leave.balances', method: 'GET', fn: 'lib_leave.balances', perm: 'self', desc: 'Leave balances per type for a year: entitled, carried (adjustments), taken, pending and remaining.', params: { employee: s('Employee (default: yourself)'), year: n('Year (default this year)') } },
  { name: 'leave.cancel', method: 'POST', fn: 'lib_leave.cancel', perm: 'self', agent: 'deny', desc: 'Cancel your own waiting leave, or approved leave that has not started (People edit: anyone\'s).', params: { request: r('Leave request id'), note: s('Why') } },
  { name: 'leave.decide', method: 'POST', fn: 'lib_leave.decide', perm: 'self', agent: 'deny', desc: "Approve or reject a leave request (the employee's manager or full People rights; never your own).", params: { request: r('Leave request id'), approve: rb('true approves, false rejects'), note: s('Note to the employee') } },
  { name: 'leave.adjust', method: 'POST', fn: 'lib_leave.adjust', perm: 'people:full', desc: "Adjust an employee's leave balance for a year (carried-over days, corrections; a minus takes days away).", params: { employee: r(EMP), type: r('Leave type'), year: n('Year (default this year)'), days: r('Days, e.g. 3 or -1.5'), reason: s('Why') } },

  /* expense claims */
  {
    name: 'claims.list',
    method: 'GET',
    fn: 'lib_claims.list',
    perm: 'self',
    desc: 'Expense claims: mine, my team, or all (People or Accounting view), with totals and counts per status.',
    params: Object.assign({ scope: e('mine (default), team or all', ['mine', 'team', 'all']), status: e('Status', ['draft', 'submitted', 'approved', 'rejected', 'posted', 'paid']), employee: s(EMP), q: s('Search title or number'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') }, page),
  },
  { name: 'claims.expense-types', method: 'GET', fn: 'lib_claims.expenseTypes', perm: 'self', desc: 'The kinds of expense a claim line can use (postable expense accounts; your own most used first). Anyone who files claims may read it.', params: { q: s('Search code or name') } },
  { name: 'claims.get', method: 'GET', fn: 'lib_claims.get', perm: 'self', desc: 'One expense claim with its lines, receipts and entries.', params: { claim: r(CLAIM) } },
  { name: 'claims.receipt', method: 'GET', fn: 'lib_claims.receipt', perm: 'self', desc: "Open a claim line's receipt (your AI agent gets its file path).", params: { line: r('Claim line id (see claims.get)'), download: b('As a download') } },
  { name: 'claims.create', method: 'POST', fn: 'lib_claims.create', perm: 'self', desc: 'Draft an expense claim (your own; for others needs edit access to People).', params: { title: r('What it was for', '"Client visit, Penang"'), date: s('Date YYYY-MM-DD (default today)'), project: s('Project'), employee: s('For another employee'), lines: s(CLAIM_LINES) } },
  { name: 'claims.update', method: 'POST', fn: 'lib_claims.update', perm: 'self', desc: 'Change a draft or rejected claim (lines replace all lines).', params: { claim: r(CLAIM), title: s('Title'), date: s('Date YYYY-MM-DD'), project: s('Project (empty for none)'), lines: s(CLAIM_LINES) } },
  { name: 'claims.add-receipt', method: 'POST', fn: 'lib_claims.addReceipt', perm: 'self', files: ['file'], desc: 'Attach the receipt of one claim line (screens upload file; your AI agent gives --path).', params: { claim: r(CLAIM), line: r('Claim line id'), path: s('Absolute path of the receipt (your AI agent)') } },
  { name: 'claims.submit', method: 'POST', fn: 'lib_claims.submit', perm: 'self', agent: 'deny', desc: 'Submit a draft or rejected claim for approval.', params: { claim: r(CLAIM) } },
  { name: 'claims.decide', method: 'POST', fn: 'lib_claims.decide', perm: 'self', agent: 'deny', desc: "Approve or reject a submitted claim (the employee's manager or full People rights; never your own).", params: { claim: r(CLAIM), approve: rb('true approves, false rejects'), note: s('Note to the employee') } },
  {
    name: 'claims.post',
    method: 'POST',
    fn: 'lib_claims.post',
    perm: 'accounting:full|people:full',
    agent: 'propose',
    preview: 'lib_claims.previewPost',
    desc: 'Post an approved claim to the books (full Accounting or People rights): expenses and recoverable tax against what is owed to the employee. From your AI agent this is a proposal.',
    params: { claim: r(CLAIM) },
  },
  {
    name: 'claims.pay',
    method: 'POST',
    fn: 'lib_claims.pay',
    perm: 'banking:full',
    agent: 'propose',
    preview: 'lib_claims.previewPay',
    desc: 'Pay posted claims from a bank account in one entry (one or many employees). From your AI agent this is always a proposal.',
    params: { claims: s('JSON list of claims, e.g. ["EXP-00001","EXP-00002"]'), claim: s('One claim'), bank: s('Bank account (default: the default bank)'), date: s('Date paid YYYY-MM-DD (default today)') },
  },
  { name: 'claims.preview-post', method: 'GET', fn: 'lib_claims.previewPost', perm: 'accounting:full|people:full', desc: 'What posting an approved claim would write (the journal lines and its date), without posting.', params: { claim: r(CLAIM) } },
  {
    name: 'claims.preview-pay',
    method: 'GET',
    fn: 'lib_claims.previewPay',
    perm: 'banking:full',
    desc: 'What paying posted claims would write (one entry, a line per employee), without paying.',
    params: { claims: s('JSON list of claims, e.g. ["EXP-00001","EXP-00002"]'), claim: s('One claim'), bank: s('Bank account (default: the default bank)'), date: s('Date paid YYYY-MM-DD (default today)') },
  },
  { name: 'claims.delete', method: 'POST', fn: 'lib_claims.remove', perm: 'self', destructive: true, desc: 'Delete a draft claim.', params: { claim: r(CLAIM), preview: b('Only say what would happen') } },

  /* payroll */
  { name: 'payroll.components', method: 'GET', fn: 'lib_payroll.listComponents', perm: 'payroll:view', desc: 'Pay components: earnings, deductions and employer contributions, fixed or a percent of basic pay, with their accounts.', params: { active: b('Only components in use') } },
  { name: 'payroll.component-add', method: 'POST', fn: 'lib_payroll.addComponent', perm: 'payroll:full', desc: 'Add a pay component.', params: Object.assign({}, componentFields, { name: r('Name', '"Transport allowance"'), kind: re('earning, deduction or employer', ['earning', 'deduction', 'employer']) }) },
  { name: 'payroll.component-update', method: 'POST', fn: 'lib_payroll.updateComponent', perm: 'payroll:full', desc: 'Change a pay component (approved and posted runs keep what they computed).', params: Object.assign({ component: r('Component name or id') }, componentFields) },
  { name: 'payroll.component-delete', method: 'POST', fn: 'lib_payroll.deleteComponent', perm: 'payroll:full', destructive: true, desc: 'Delete a pay component no posted payslip used (switch the others off).', params: { component: r('Component name or id'), preview: b('Only say what would happen') } },
  {
    name: 'payroll.assign',
    method: 'POST',
    fn: 'lib_payroll.assign',
    perm: 'payroll:edit',
    desc: 'Give an employee a pay component (needed for "selected" components), optionally with their own amount or percent; active=false takes it away.',
    params: { employee: r(EMP), component: r('Component name or id'), amount: s('Their own amount per month, e.g. 150.00'), percent: s('Their own percent of basic pay'), active: b('false removes it (default true)') },
  },
  {
    name: 'payroll.run-create',
    method: 'POST',
    fn: 'lib_payroll.createRun',
    perm: 'payroll:edit',
    desc: 'Draft the pay run of a month: a payslip per employee from their basic pay and the components (default: everyone current with pay). One run per month.',
    params: { month: r('Month YYYY-MM'), pay_date: s('Pay date YYYY-MM-DD (default the last day of the month)'), employees: s('JSON list of employees (default: everyone current with basic pay or components)'), note: s('Note') },
  },
  { name: 'payroll.runs', method: 'GET', fn: 'lib_payroll.listRuns', perm: 'payroll:view', desc: 'Pay runs with their totals.', params: Object.assign({ status: e('Status', ['draft', 'approved', 'posted', 'paid']), year: n('Year') }, page) },
  {
    name: 'payroll.run-get',
    method: 'GET',
    fn: 'lib_payroll.getRun',
    perm: 'payroll:view',
    desc: 'One pay run with its payslips and their lines, and its entries. Give limit (and offset, q) to page through the payslips of a big run; payslips_total then says how many match.',
    params: { run: r(RUN), q: s('Only payslips of people whose name, number or department matches'), limit: n('How many payslips (default: all)'), offset: n('Skip this many payslips') },
  },
  { name: 'payroll.payslip-update', method: 'POST', fn: 'lib_payroll.payslipUpdate', perm: 'payroll:edit', desc: 'Adjust a payslip of a draft run (its lines replace all lines; totals follow).', params: { payslip: r('Payslip id (see payroll.run-get)'), lines: s(SLIP_LINES), note: s('Note on the payslip') } },
  { name: 'payroll.run-recompute', method: 'POST', fn: 'lib_payroll.runRecompute', perm: 'payroll:edit', desc: 'Rebuild the payslips of a draft run from current pay and components (adjustments are lost).', params: { run: r(RUN), employees: s('JSON list of employees (default: the same people)') } },
  { name: 'payroll.run-approve', method: 'POST', fn: 'lib_payroll.runApprove', perm: 'payroll:full', desc: 'Approve a draft pay run (it can then be posted).', params: { run: r(RUN) } },
  {
    name: 'payroll.run-post',
    method: 'POST',
    fn: 'lib_payroll.runPost',
    perm: 'payroll:full',
    agent: 'propose',
    preview: 'lib_payroll.previewRunPost',
    desc: 'Post an approved pay run as one entry on its pay date (salaries, components and employer costs against salaries payable and the liabilities). From your AI agent this is a proposal.',
    params: { run: r(RUN) },
  },
  {
    name: 'payroll.run-pay',
    method: 'POST',
    fn: 'lib_payroll.runPay',
    perm: 'payroll:full',
    agent: 'propose',
    preview: 'lib_payroll.previewRunPay',
    desc: 'Pay the net salaries of a posted run from a bank account (needs full Banking too). From your AI agent this is always a proposal.',
    params: { run: r(RUN), bank: s('Bank account (default: the default bank)'), date: s('Date paid YYYY-MM-DD (default today)') },
  },
  { name: 'payroll.preview-post', method: 'GET', fn: 'lib_payroll.previewRunPost', perm: 'payroll:full', desc: 'What posting an approved pay run would write (one entry on its pay date), without posting.', params: { run: r(RUN) } },
  { name: 'payroll.preview-pay', method: 'GET', fn: 'lib_payroll.previewRunPay', perm: 'payroll:full', desc: 'What paying the net salaries of a posted run would write, without paying.', params: { run: r(RUN), bank: s('Bank account (default: the default bank)'), date: s('Date paid YYYY-MM-DD (default today)') } },
  { name: 'payroll.run-delete', method: 'POST', fn: 'lib_payroll.runDelete', perm: 'payroll:edit', destructive: true, desc: 'Delete a draft pay run and its payslips.', params: { run: r(RUN), preview: b('Only say what would happen') } },
  { name: 'payroll.my-payslips', method: 'GET', fn: 'lib_payroll.myPayslips', perm: 'self', desc: 'Your own payslips of posted and paid runs, newest first.', params: page },
  { name: 'payroll.payslip-get', method: 'GET', fn: 'lib_payroll.payslipGet', perm: 'self', desc: 'One payslip with its lines (your own once the run is posted; any with view access to Payroll).', params: { payslip: r('Payslip id') } },
];
