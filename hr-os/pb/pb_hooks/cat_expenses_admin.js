/**
 * Catalog: expenses home, the employee's own view, spend, and the settings
 * (categories and the policy of each entity).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const ENTITY = S('Entity (id or name)');
const MONEY = (what) => S(what + ', major units in the entity currency (0 for none)');

module.exports = [
  { name: 'expenses.home', method: 'GET', fn: 'lib_expenses_admin.home', perm: 'signed', effect: 'read', desc: 'Expenses home for HR, finance and managers: claims waiting (and waiting for you), flagged, approved and not yet paid, advances to pay and settle, receipts being read, spend this month.', params: { entity: ENTITY, month: S('Month for the spend, YYYY-MM (default this month)') } },
  { name: 'expenses.me', method: 'GET', fn: 'lib_expenses_admin.me', perm: 'self', effect: 'read', desc: "A person's own expenses: employments with their categories and open draft, drafts with their lines, recent claims with status, amount awaiting reimbursement, advances and trips." },
  { name: 'expenses.spend', method: 'GET', fn: 'lib_expenses_admin.spend', perm: 'signed', effect: 'read', desc: 'Spend from submitted, approved and paid claims by day of spending, grouped by category, department, entity, employee or day, in one currency (the entity\'s, or reporting at stored rates).', params: { entity: ENTITY, month: S('YYYY-MM'), from: S('First day'), to: S('Last day'), group_by: S('category (default) | department | entity | employee | day', { enum: ['category', 'department', 'entity', 'employee', 'day'] }) } },
  { name: 'expenses.policy', method: 'GET', fn: 'lib_expenses_admin.policyGet', perm: 'signed', effect: 'read', desc: "The expenses policy of an entity: finance approves at or above an amount, how old an expense may be, weekend flags, how claims and advances are paid, when advances are recovered.", params: { entity: ENTITY } },
  {
    name: 'expenses.policy-save',
    method: 'POST',
    fn: 'lib_expenses_admin.policySave',
    perm: 'expenses:full',
    agent: 'propose',
    kind: 'expenses',
    preview: 'lib_expenses_admin.previewPolicy',
    effect: 'write',
    desc: 'Change the expenses policy of an entity (only the fields given change).',
    params: {
      entity: S('Entity (id or name)', { required: true }),
      finance_over: MONEY('Finance also approves claims at or above'),
      max_age_days: N('Flag expenses older than this many days (0 = never)'),
      flag_weekends: B('Flag expenses on weekend days'),
      pay_via: S('Claims are paid with the pay run (payroll) or by transfer (bank)', { enum: ['payroll', 'bank'] }),
      advance_pay_via: S('Advances are paid by transfer (bank) or with the pay run (payroll)', { enum: ['payroll', 'bank'] }),
      advance_recover_via: S('Advances are settled by later claims (claim) or recovered from pay (payroll)', { enum: ['payroll', 'claim'] }),
      recover_after_days: N('Days after the trip (or the advance) when recovery from pay starts'),
      note: S('Policy note shown to people adding expenses'),
    },
  },

  { name: 'expense-categories.list', method: 'GET', fn: 'lib_expenses_admin.categoriesList', perm: 'signed', effect: 'read', desc: "An entity's expense categories (default: your own entity) with limits, receipt rules, mileage rate, pay component and GL account, and the entity's policy.", params: { entity: ENTITY, archived: B('Include categories no longer used') } },
  {
    name: 'expense-categories.save',
    method: 'POST',
    fn: 'lib_expenses_admin.categoriesSave',
    perm: 'expenses:full',
    agent: 'propose',
    kind: 'expenses',
    preview: 'lib_expenses_admin.previewCategory',
    effect: 'write',
    desc: 'Add or change (--category) an entity\'s expense category: limits per expense and per day, receipt rule, mileage rate, taxable, pay component, GL account. --archived true ends it.',
    params: {
      category: S('Category id to change (empty to add one)'),
      entity: S('Entity of a new category'),
      name: S('Name'),
      code: S('Code (default from the name), e.g. client_meals'),
      description: S('What counts, shown when adding an expense'),
      icon: S('A lucide icon name, e.g. Utensils'),
      kind: S('standard | mileage', { enum: ['standard', 'mileage'] }),
      limit: MONEY('Flag one expense over'),
      per_day_limit: MONEY('Flag a day of this category over'),
      receipt_rule: S('always | over | never', { enum: ['always', 'over', 'never'] }),
      receipt_over: MONEY('With receipt_rule over: a receipt is needed from'),
      mileage_rate: S('Mileage: amount per unit in the entity currency, e.g. 0.725'),
      unit: S('km | mile', { enum: ['km', 'mile'] }),
      taxable: B('Reimbursed as taxable pay'),
      component: S('Pay component code (default REIMB)'),
      gl_account: S('General ledger account for the journal'),
      sort: N('Order in lists'),
      archived: B('No longer used for new expenses'),
    },
  },
  { name: 'expense-categories.seed', method: 'POST', fn: 'lib_expenses_admin.categoriesSeed', perm: 'expenses:full', agent: 'propose', kind: 'expenses', effect: 'write', desc: 'Add the standard categories an entity lacks: meals, travel, lodging, mileage at the country\'s usual rate, phone and internet, training, office supplies, entertainment, other.', params: { entity: S('Entity (id or name)', { required: true }) } },
  { name: 'expense-categories.delete', method: 'POST', fn: 'lib_expenses_admin.categoriesDelete', perm: 'expenses:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete an expense category no expense uses (archive a used one instead).', params: { category: S('Category id', { required: true }) } },
];
