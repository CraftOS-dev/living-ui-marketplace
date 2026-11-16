/**
 * Catalog: sign-in, the approval PIN, members, roles, settings, audit,
 * exchange rates and imports.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const MEMBER = S('Member id or email', { required: true });
const PAGE = { limit: N('Rows (default 100)'), offset: N('Rows to skip') };

module.exports = [
  /* sign-in */
  { name: 'auth.login', method: 'POST', fn: 'lib_auth.login', perm: 'public', agent: 'deny', effect: 'write', desc: 'Sign in with email and password; answers a session token and the member.', params: { email: S('Email', { required: true }), password: S('Password', { required: true, secret: true }) } },
  { name: 'auth.logout', method: 'POST', fn: 'lib_auth.logout', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Sign out (the page forgets its token).' },
  { name: 'auth.me', method: 'GET', fn: 'lib_auth.getMe', perm: 'signed', effect: 'read', desc: 'Who is calling: member, role and levels, linked employee and employments, entities in scope, whether a PIN is set, company basics.' },
  { name: 'auth.refresh', method: 'POST', fn: 'lib_auth.refresh', perm: 'signed', agent: 'deny', effect: 'write', desc: 'A fresh session token.' },
  { name: 'auth.accept-invite', method: 'POST', fn: 'lib_auth.acceptInvite', perm: 'public', agent: 'deny', effect: 'write', desc: 'Join with the invite code an administrator gave: set a password and sign in.', params: { email: S('Email', { required: true }), code: S('Invite code, e.g. ABCDE-FGHJK', { required: true, secret: true }), password: S('New password (8 or more characters)', { required: true, secret: true }), name: S('Your name (optional change)') } },
  { name: 'auth.change-password', method: 'POST', fn: 'lib_auth.changePassword', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Change your password (signs out other sessions).', params: { current: S('Current password', { required: true, secret: true }), password: S('New password', { required: true, secret: true }) } },
  { name: 'auth.update-profile', method: 'POST', fn: 'lib_auth.updateProfile', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Change your own name, title or screen preferences.', params: { name: S('Name'), title: S('Title'), prefs: S('JSON object of preferences to merge') } },
  { name: 'auth.recover', method: 'POST', fn: 'lib_auth.recover', perm: 'public', agent: 'deny', effect: 'write', desc: 'An owner who lost the password signs in with the recovery code, sets a new password (and optionally a new PIN) and gets a new recovery code.', params: { email: S('Owner email', { required: true }), recovery_code: S('Recovery code', { required: true, secret: true }), password: S('New password', { required: true, secret: true }), new_pin: S('New six-digit PIN (optional)', { secret: true }) } },

  /* the approval PIN */
  { name: 'pin.status', method: 'GET', fn: 'lib_auth.pinStatus', perm: 'signed', agent: 'deny', effect: 'read', desc: 'Whether you have an approval PIN, when it was set, whether it is locked.' },
  { name: 'pin.verify', method: 'POST', fn: 'lib_auth.pinVerify', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Check your approval PIN before a step that needs it: ok true, or ok false with wrong_pin and attempts_left, pin_locked or pin_not_set. Wrong tries count.', params: { pin: S('Your six-digit PIN', { required: true, secret: true }) } },
  { name: 'pin.set', method: 'POST', fn: 'lib_auth.pinSet', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Set your first approval PIN (six digits), proving it is you with your password.', params: { password: S('Your password', { required: true, secret: true }), new_pin: S('Six digits', { required: true, secret: true }) } },
  { name: 'pin.change', method: 'POST', fn: 'lib_auth.pinChange', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Change your approval PIN.', params: { current_pin: S('Current PIN', { required: true, secret: true }), new_pin: S('New six digits', { required: true, secret: true }) } },
  { name: 'pin.reset', method: 'POST', fn: 'lib_auth.pinReset', perm: 'admin:edit', agent: 'deny', effect: 'confirm', desc: "Clear someone's approval PIN (they set a new one with their password). Needs your PIN.", params: { member: MEMBER } },
  { name: 'pin.recover', method: 'POST', fn: 'lib_auth.pinRecover', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Owner: set a new PIN with the recovery code (a new recovery code is shown once).', params: { recovery_code: S('Recovery code', { required: true, secret: true }), new_pin: S('New six digits', { required: true, secret: true }) } },
  { name: 'pin.recovery-new', method: 'POST', fn: 'lib_auth.recoveryNew', perm: 'signed', agent: 'deny', effect: 'confirm', desc: 'Owner: replace the recovery code (shown once). Needs your PIN.' },

  /* members */
  { name: 'members.list', method: 'GET', fn: 'lib_auth.listMembers', perm: 'admin:view', effect: 'read', desc: 'Team members with role, linked employee, entities in scope, PIN set, last seen.', params: Object.assign({ q: S('Name or email contains'), status: S('invited | active | disabled', { enum: ['invited', 'active', 'disabled'] }), role: S('Role code or id') }, PAGE) },
  { name: 'members.get', method: 'GET', fn: 'lib_auth.getMember', perm: 'admin:view', effect: 'read', desc: 'One member.', params: { member: MEMBER } },
  {
    name: 'members.invite',
    method: 'POST',
    fn: 'lib_auth.invite',
    perm: 'admin:edit',
    agent: 'deny',
    effect: 'confirm',
    desc: 'Invite a person: answers an invite code (valid 7 days) to hand them. Optionally link their employee record and limit them to some entities. Needs a PIN.',
    params: { email: S('Email', { required: true }), name: S('Name', { required: true }), role: S('Role code: owner, hr_admin, payroll_admin, finance, manager, recruiter, employee', { required: true }), title: S('Title'), employee: S('Employee to link (number or id)'), entities: S('JSON list of entity ids or names they may see (empty = all)') },
  },
  { name: 'members.update', method: 'POST', fn: 'lib_auth.updateMember', perm: 'admin:edit', agent: 'deny', effect: 'confirm', desc: "Change a member's name, email, title, role, entities or linked employee. Needs your PIN.", params: { member: MEMBER, name: S('Name'), email: S('Email'), title: S('Title'), role: S('Role code or id'), employee: S('Employee to link (empty to unlink)'), entities: S('JSON list of entity ids or names (empty list = all)') } },
  { name: 'members.disable', method: 'POST', fn: 'lib_auth.disable', perm: 'admin:edit', agent: 'deny', effect: 'confirm', desc: 'Disable a member (signs them out everywhere). Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.enable', method: 'POST', fn: 'lib_auth.enable', perm: 'admin:edit', agent: 'deny', effect: 'confirm', desc: 'Enable a disabled member. Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.reset', method: 'POST', fn: 'lib_auth.resetMember', perm: 'admin:edit', agent: 'deny', effect: 'confirm', desc: 'A new invite code for a member (expired invite or forgotten password). Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.signout', method: 'POST', fn: 'lib_auth.signoutEverywhere', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Sign a member (yourself by default) out of every session.', params: { member: S('Member id or email (default: you)') } },
  { name: 'members.delete', method: 'POST', fn: 'lib_auth.deleteMember', perm: 'admin:edit', agent: 'deny', effect: 'confirm', destructive: true, desc: 'Remove an invite that was never used (people who used the app are disabled instead). Needs your PIN.', params: { member: MEMBER } },

  /* roles */
  { name: 'roles.list', method: 'GET', fn: 'lib_auth.listRoles', perm: 'admin:view', effect: 'read', desc: 'Roles with their level per module (people, time, leave, expenses, payroll, hiring, performance, reports, admin), team scope and member counts.' },
  { name: 'roles.add', method: 'POST', fn: 'lib_auth.addRole', perm: 'admin:full', agent: 'deny', effect: 'confirm', desc: 'Add a role. Needs your PIN.', params: { name: S('Role name', { required: true }), code: S('Code (lower case, default from the name)'), levels: S('JSON object {module: none|view|edit|full}'), team_scope: B('Sees and approves for their reports'), description: S('Description') } },
  { name: 'roles.update', method: 'POST', fn: 'lib_auth.updateRole', perm: 'admin:full', agent: 'deny', effect: 'confirm', desc: 'Change a role (not Owner). Needs your PIN.', params: { role: S('Role code or id', { required: true }), name: S('Name'), levels: S('JSON object {module: level}'), team_scope: B('Team scope'), description: S('Description') } },
  { name: 'roles.delete', method: 'POST', fn: 'lib_auth.deleteRole', perm: 'admin:full', agent: 'deny', effect: 'confirm', destructive: true, desc: 'Delete a role nobody has (built-in roles stay). Needs your PIN.', params: { role: S('Role code or id', { required: true }) } },

  /* settings, audit, rates, imports */
  { name: 'settings.get', method: 'GET', fn: 'lib_settings.get', perm: 'admin:view', effect: 'read', desc: "Company settings: name, reporting currency, date style, your AI agent's autonomy per kind, pay visibility, email notifications, payslip publication hour, sign-in limits." },
  { name: 'settings.update', method: 'POST', fn: 'lib_settings.update', perm: 'admin:full', agent: 'deny', effect: 'write', desc: 'Change company settings.', params: { company_name: S('Company name'), reporting_currency: S('Reporting currency code'), date_style: S('entity | iso | dmy | mdy | ymd', { enum: ['entity', 'iso', 'dmy', 'mdy', 'ymd'] }), agent_sees_pay: B('Your AI agent may read pay figures'), managers_see_pay: B('Managers see the pay of their team'), email_notifications: B('Also email notifications (through your AI agent\'s Gmail)'), payslip_publish_hour: N('Local hour payslips are published (0 to 23)'), rate_limits: S('JSON {login_fails, lock_minutes, pin_fails, pin_lock_minutes}') } },
  { name: 'settings.logo', method: 'GET', fn: 'lib_settings.logo', perm: 'public', agent: 'deny', effect: 'read', desc: 'The company logo (an image). Public: the sign-in screen shows it. --dark true: the dark-mode logo (the light one when there is none).', params: { dark: B('The dark-mode logo'), v: S('A cache key the app adds (the stored file name); ignored') } },
  { name: 'settings.logo-set', method: 'POST', fn: 'lib_settings.logoSet', perm: 'admin:full', agent: 'deny', effect: 'write', files: ['logo'], desc: 'Upload the company logo in the logo field (PNG, JPEG, SVG or WebP, up to 1 MB). --dark true sets the logo for dark mode.', params: { dark: B('Set the dark-mode logo') } },
  { name: 'settings.logo-remove', method: 'POST', fn: 'lib_settings.logoRemove', perm: 'admin:full', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove the company logo (--dark true: the dark-mode one). The app shows its plain icon again.', params: { dark: B('Remove the dark-mode logo') } },
  { name: 'settings.autonomy', method: 'POST', fn: 'lib_settings.autonomy', perm: 'admin:full', agent: 'deny', effect: 'write', desc: "Your AI agent's autonomy per kind of change: ask (a proposal you accept) or auto (it runs).", params: { autonomy: S('JSON {people|time|leave|expenses|payroll|hiring|performance|packs: ask|auto}', { required: true }) } },
  { name: 'settings.automatic', method: 'POST', fn: 'lib_settings.automatic', perm: 'admin:full', agent: 'deny', effect: 'write', desc: 'Switch Automatic work on or off: the sources that may ask your AI agent without a click (all off by default). agent.triggers lists them.', params: { automatic: S('JSON, e.g. {"weekly_timesheet_check":true,"monthly_rule_checks":false}', { required: true }) } },
  { name: 'audit.list', method: 'GET', fn: 'lib_audit.list', perm: 'admin:view', effect: 'read', desc: 'The audit trail, newest first: who (person, your AI agent, the app) did what to which record, with before and after.', params: Object.assign({ collection: S('Collection name'), record: S('Record id'), member: S('Member id or email'), actor: S('person | agent | system', { enum: ['person', 'agent', 'system'] }), op: S('Operation name'), q: S('Summary contains'), from: S('From day'), to: S('To day') }, PAGE) },
  { name: 'fx.list', method: 'GET', fn: 'lib_fx.list', perm: 'reports:view|payroll:view|admin:view', effect: 'read', desc: 'Stored exchange rates (latest first) and the currencies in use.', params: { limit: N('Rows (default 60)') } },
  { name: 'fx.refresh', method: 'POST', fn: 'lib_fx.refreshOp', perm: 'admin:edit|payroll:edit', effect: 'write', desc: "Fetch today's exchange rates for the currencies in use (ECB via Frankfurter, then currency-api)." },
  { name: 'fx.set', method: 'POST', fn: 'lib_fx.setOp', perm: 'admin:full|payroll:full', agent: 'deny', effect: 'write', desc: 'Set an exchange rate by hand from a day.', params: { base: S('From currency', { required: true }), quote: S('To currency', { required: true }), rate: N('How many quote units one base unit buys', { required: true }), day: S('From day (default today)') } },
  { name: 'imports.list', method: 'GET', fn: 'lib_files.importsList', perm: 'people:full|admin:view', effect: 'read', desc: 'CSV imports (checks and commits) with their reports.', params: { kind: S('people | holidays | a module kind'), limit: N('Rows (default 30)') } },
];
