/**
 * Catalog: the app, setup, sign-in, members and roles, settings, and the
 * record activity shared by every module (notes, attachments, audit).
 * Plain data: read by lib_catalog.js in PocketBase and by tools/gen.mjs in Node.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const ENTITIES = ['documents', 'payments', 'parties', 'items', 'stock_changes', 'journals', 'accounts', 'banks', 'employees', 'expense_claims', 'leave_requests', 'payroll_runs', 'projects', 'project_tasks', 'builds', 'boms', 'assets', 'warehouses'];

module.exports = [
  { name: 'app.guide', method: 'POST', fn: 'lib_guide.guide', perm: 'self', desc: 'START HERE: what this ERP holds, conventions (names, money, dates, statuses), the setup (currency, modules, warehouses, banks, taxes) and ready-to-run recipes for the jobs people hand over.', params: {} },

  /* setup and sign-in */
  { name: 'setup.status', method: 'GET', fn: 'lib_setup.status', perm: 'public', desc: 'Whether the company is set up and has members (the first screen).', params: {} },
  { name: 'setup.presets', method: 'GET', fn: 'lib_setup.presets', perm: 'public', desc: 'Country presets (currency, fiscal year, starting taxes) and business types for setup.', params: {} },
  {
    name: 'setup.complete',
    method: 'POST',
    fn: 'lib_setup.complete',
    perm: 'public',
    agent: 'deny',
    desc: "First-run setup (only while the app has no members): the company, country preset, currency, fiscal year, business type and the owner's account.",
    params: {
      company_name: r('Company name', '"Acme Trading"'),
      legal_name: s('Registered name'),
      country: s('Country preset code (MY, SG, GB, US, ...; XX for another)'),
      currency: s('Base currency (ISO code)'),
      fiscal_start_month: n('First month of the fiscal year, 1 to 12'),
      business_type: e('Which modules start on', ['services', 'trading', 'manufacturing', 'other']),
      company_email: s('Company email'),
      company_phone: s('Company phone'),
      company_address: s('Company address'),
      tax_id: s('Company tax number'),
      prices_include_tax: b('Prices include tax by default'),
      owner_name: r("Owner's name"),
      owner_email: r("Owner's email"),
      owner_title: s("Owner's job title"),
      password: r("Owner's password (8 or more characters)"),
      owner_is_employee: b('Also add the owner as an employee (default true)'),
    },
  },
  { name: 'auth.login', method: 'POST', fn: 'lib_auth.login', perm: 'public', agent: 'deny', desc: 'Sign in with email and password; returns a session token.', params: { email: r('Email'), password: r('Password') } },
  { name: 'auth.logout', method: 'POST', fn: 'lib_auth.logout', perm: 'self', desc: 'Sign out (the screen forgets its token).', params: {} },
  { name: 'auth.me', method: 'GET', fn: 'lib_auth.getMe', perm: 'self', desc: 'Who is calling: their role, rights per module, employee record, the company and switched-on modules.', params: {} },
  { name: 'auth.refresh', method: 'POST', fn: 'lib_auth.refresh', perm: 'self', agent: 'deny', desc: 'A fresh session token.', params: {} },
  { name: 'auth.accept-invite', method: 'POST', fn: 'lib_auth.acceptInvite', perm: 'public', agent: 'deny', desc: 'Use an invite (or reset) code to set a password and sign in.', params: { email: r('Email'), code: r('The code from the administrator'), password: r('New password (8 or more characters)'), name: s('Your name') } },
  { name: 'auth.change-password', method: 'POST', fn: 'lib_auth.changePassword', perm: 'self', agent: 'deny', desc: 'Change your own password.', params: { current: r('Current password'), password: r('New password') } },
  { name: 'auth.update-profile', method: 'POST', fn: 'lib_auth.updateProfile', perm: 'self', agent: 'deny', desc: 'Change your own name, title and screen preferences.', params: { name: s('Your name'), title: s('Your job title'), prefs: s('JSON object of preferences') } },

  /* members and roles */
  { name: 'members.list', method: 'GET', fn: 'lib_auth.listMembers', perm: 'admin', desc: 'Members with their role and status.', params: Object.assign({ q: s('Search name or email'), status: e('Filter by status', ['invited', 'active', 'disabled']), role: s('Filter by role') }, page) },
  { name: 'members.get', method: 'GET', fn: 'lib_auth.getMember', perm: 'admin', desc: 'One member.', params: { member: r('Member email, name or id') } },
  { name: 'members.invite', method: 'POST', fn: 'lib_auth.invite', perm: 'admin', agent: 'deny', desc: 'Invite a person: returns a code (shown once, valid 7 days) they use to set their password.', params: { name: r('Their name'), email: r('Their email'), role: r('Role name', 'Accountant'), title: s('Job title'), employee: s('Link to an employee record') } },
  { name: 'members.update', method: 'POST', fn: 'lib_auth.updateMember', perm: 'admin', agent: 'deny', desc: "Change a member's name, email, title, role or linked employee.", params: { member: r('Member'), name: s('Name'), email: s('Email'), title: s('Title'), role: s('Role'), employee: s('Employee (empty to unlink)') } },
  { name: 'members.disable', method: 'POST', fn: 'lib_auth.disable', perm: 'admin', agent: 'deny', desc: 'Disable a member (they are signed out everywhere).', params: { member: r('Member') } },
  { name: 'members.enable', method: 'POST', fn: 'lib_auth.enable', perm: 'admin', agent: 'deny', desc: 'Enable a disabled member.', params: { member: r('Member') } },
  { name: 'members.reset', method: 'POST', fn: 'lib_auth.resetMember', perm: 'admin', agent: 'deny', desc: 'A new sign-in code for a member (forgotten password or expired invite).', params: { member: r('Member') } },
  { name: 'members.signout', method: 'POST', fn: 'lib_auth.signoutEverywhere', perm: 'self', agent: 'deny', desc: 'Sign a member (or yourself) out on every device.', params: { member: s('Member (empty: yourself)') } },
  { name: 'members.delete', method: 'POST', fn: 'lib_auth.deleteMember', perm: 'admin', agent: 'deny', destructive: true, desc: 'Remove an invite that was never used.', params: { member: r('Member'), preview: b('Only say what would happen') } },
  { name: 'roles.list', method: 'GET', fn: 'lib_auth.listRoles', perm: 'admin', desc: 'Roles with their level per module (none, view, edit, full).', params: {} },
  { name: 'roles.add', method: 'POST', fn: 'lib_auth.addRole', perm: 'admin', agent: 'deny', desc: 'Add a role.', params: { name: r('Role name'), levels: s('JSON object module -> none|view|edit|full'), admin: b('Administration right'), approval_limit: s('Largest amount this role approves (0: no limit)'), description: s('What the role is for') } },
  { name: 'roles.update', method: 'POST', fn: 'lib_auth.updateRole', perm: 'admin', agent: 'deny', desc: 'Change a role (the Owner role never changes).', params: { role: r('Role'), name: s('Name'), levels: s('JSON object module -> level'), admin: b('Administration right'), approval_limit: s('Largest amount this role approves'), description: s('Description') } },
  { name: 'roles.delete', method: 'POST', fn: 'lib_auth.deleteRole', perm: 'admin', agent: 'deny', destructive: true, desc: 'Delete a custom role nobody has.', params: { role: r('Role'), preview: b('Only say what would happen') } },

  /* settings */
  { name: 'settings.get', method: 'GET', fn: 'lib_settings.get', perm: 'self', desc: 'Company settings (administrators and accountants also see numbering, default accounts and agent autonomy).', params: {} },
  {
    name: 'settings.update',
    method: 'POST',
    fn: 'lib_settings.update',
    perm: 'admin',
    agent: 'deny',
    files: ['logo'],
    desc: 'Change company details and defaults.',
    params: {
      company_name: s('Company name'), legal_name: s('Registered name'), tax_id: s('Tax number'), registration_no: s('Registration number'), address: s('Address'), email: s('Email'), phone: s('Phone'), website: s('Website'),
      fiscal_start_month: n('First month of the fiscal year'), prices_include_tax: b('Prices include tax by default'), allow_negative_stock: b('Allow stock below zero'), invoice_footer: s('Footer on invoices'), quote_terms: s('Terms on quotes'),
      quote_validity_days: n('Days a quote is valid'), working_days: s('JSON list of working days 1 (Mon) to 7 (Sun)'), remove_logo: b('Remove the logo'),
    },
  },
  { name: 'settings.modules', method: 'POST', fn: 'lib_settings.setModules', perm: 'admin', agent: 'deny', desc: 'Switch modules on or off.', params: { modules: r('JSON object module -> true|false', '\'{"manufacturing":true}\'') } },
  { name: 'settings.numbering', method: 'POST', fn: 'lib_settings.setNumbering', perm: 'admin', agent: 'deny', desc: 'Change the prefix and width of a number series, or move its next number forward.', params: { series: r('Series (invoice, bill, ...)'), prefix: s('Prefix'), width: n('Digits'), next: n('Next number (forward only)') } },
  { name: 'settings.defaults', method: 'POST', fn: 'lib_settings.setDefaults', perm: 'admin', agent: 'deny', desc: 'Default accounts, warehouse, bank, taxes and payment terms.', params: { accounts: s('JSON object key -> account code'), warehouse: s('Default warehouse'), bank: s('Default bank account'), sale_tax: s('Default sales tax'), purchase_tax: s('Default purchase tax'), terms: s('Default payment terms') } },
  { name: 'settings.agent', method: 'POST', fn: 'lib_settings.setAgent', perm: 'admin', agent: 'deny', desc: "Your AI agent's autonomy: which kinds it may post without approval, under what amount.", params: { auto: s('JSON object kind -> true|false'), limit: s('Amount ceiling for posting alone (0: no ceiling)'), chase_overdue: b('Let it draft reminders for overdue invoices'), auto_reorder: b('Let it draft purchase orders when stock runs low') } },
  { name: 'settings.locks', method: 'POST', fn: 'lib_settings.setLocks', perm: 'admin', agent: 'deny', desc: 'Lock dates: closed through (only full Accounting rights post) and locked through (nobody posts).', params: { soft_lock_date: s('YYYY-MM-DD or empty'), hard_lock_date: s('YYYY-MM-DD or empty') } },

  /* activity on any record */
  { name: 'activity.list', method: 'GET', fn: 'lib_audit.activity', perm: 'self', desc: "A record's notes, history, attachments and the fields your AI agent filled.", params: { entity: e('Kind of record', ENTITIES), ref: r('Record id, number or name'), limit: n('How many') } },
  { name: 'notes.add', method: 'POST', fn: 'lib_audit.addNote', perm: 'self', desc: 'Add a note to a record.', params: { entity: e('Kind of record', ENTITIES), ref: r('Record'), body: r('The note') } },
  { name: 'notes.delete', method: 'POST', fn: 'lib_audit.deleteNote', perm: 'self', destructive: true, desc: 'Delete your own note.', params: { note: r('Note id'), preview: b('Only say what would happen') } },
  { name: 'attachments.list', method: 'GET', fn: 'lib_audit.listAttachments', perm: 'self', desc: "A record's attachments (with file paths for your AI agent).", params: { entity: e('Kind of record', ENTITIES), ref: r('Record') } },
  { name: 'attachments.add', method: 'POST', fn: 'lib_audit.addAttachment', perm: 'self', files: ['file'], desc: 'Attach files to a record (screens upload; your AI agent gives --path).', params: { entity: e('Kind of record', ENTITIES), ref: r('Record'), path: s('Absolute path of a local file') } },
  { name: 'attachments.get', method: 'GET', fn: 'lib_audit.getAttachment', perm: 'self', desc: 'Download an attachment (your AI agent gets its file path).', params: { attachment: r('Attachment id'), download: b('As a download') } },
  { name: 'attachments.delete', method: 'POST', fn: 'lib_audit.deleteAttachment', perm: 'self', destructive: true, desc: 'Remove an attachment.', params: { attachment: r('Attachment id'), preview: b('Only say what would happen') } },
  { name: 'audit.list', method: 'GET', fn: 'lib_audit.list', perm: 'self', desc: 'The audit trail: who did what, when (administrators and accountants).', params: Object.assign({ entity: s('Kind of record'), ref: s('Record id'), actor: e('Who', ['person', 'agent', 'system']), kind: s('Kind of event'), member: s('Member'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD'), q: s('Search') }, page) },
];
