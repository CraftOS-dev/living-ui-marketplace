/**
 * Catalog: sign-in, the approval PIN, members and roles.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const MEMBER = S('Member id or email', { required: true });
const PAGE = { limit: N('Rows (default 100)'), offset: N('Rows to skip') };
const ROLES = 'owner, partner, principal, analyst, platform, finance, venture_partner, scout (or a custom role)';

module.exports = [
  /* sign-in */
  { name: 'auth.login', method: 'POST', fn: 'lib_auth.login', perm: 'public', agent: 'deny', effect: 'write', track: false, desc: 'Sign in with email and password; answers a session token (30 days) and the member.', params: { email: S('Email', { required: true }), password: S('Password', { required: true, secret: true }) } },
  { name: 'auth.logout', method: 'POST', fn: 'lib_auth.logout', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Sign out (the page forgets its token).' },
  { name: 'auth.me', method: 'GET', fn: 'lib_auth.getMe', perm: 'signed', effect: 'read', desc: 'Who is calling: member, role and levels per module, funds in scope, whether a PIN is set, the firm (name, base currency, zone, date style), whether LP data is visible.' },
  { name: 'auth.refresh', method: 'POST', fn: 'lib_auth.refresh', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'A fresh session token.' },
  { name: 'auth.accept-invite', method: 'POST', fn: 'lib_auth.acceptInvite', perm: 'public', agent: 'deny', effect: 'write', track: false, desc: 'Join with the invite code the owner gave: set a password and sign in.', params: { email: S('Email', { required: true }), code: S('Invite code, e.g. ABCDE-FGHJK', { required: true, secret: true }), password: S('New password (8 or more characters)', { required: true, secret: true }), name: S('Your name (optional change)') } },
  { name: 'auth.change-password', method: 'POST', fn: 'lib_auth.changePassword', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Change your password (signs out other sessions).', params: { current: S('Current password', { required: true, secret: true }), password: S('New password', { required: true, secret: true }) } },
  { name: 'auth.update-profile', method: 'POST', fn: 'lib_auth.updateProfile', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Change your own name, title, time zone or screen preferences.', params: { name: S('Name'), title: S('Title'), zone: S('Your IANA time zone (for your digest)'), prefs: S('JSON object of preferences to merge') } },
  { name: 'auth.recover', method: 'POST', fn: 'lib_auth.recover', perm: 'public', agent: 'deny', effect: 'write', track: false, desc: 'An owner who lost the password signs in with the recovery code, sets a new password (and optionally a new PIN) and gets a new recovery code.', params: { email: S('Owner email', { required: true }), recovery_code: S('Recovery code', { required: true, secret: true }), password: S('New password', { required: true, secret: true }), new_pin: S('New six-digit PIN (optional)', { secret: true }) } },

  /* the approval PIN */
  { name: 'pin.status', method: 'GET', fn: 'lib_auth.pinStatus', perm: 'signed', agent: 'deny', effect: 'read', desc: 'Whether you have an approval PIN, when it was set, whether it is locked.' },
  { name: 'pin.verify', method: 'POST', fn: 'lib_auth.pinVerify', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Check your approval PIN before a step that needs it: ok true, or ok false with wrong_pin and attempts_left, pin_locked or pin_not_set. Wrong tries count.', params: { pin: S('Your six-digit PIN', { required: true, secret: true }) } },
  { name: 'pin.set', method: 'POST', fn: 'lib_auth.pinSet', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Set your first approval PIN (six digits), proving it is you with your password.', params: { password: S('Your password', { required: true, secret: true }), new_pin: S('Six digits', { required: true, secret: true }) } },
  { name: 'pin.change', method: 'POST', fn: 'lib_auth.pinChange', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Change your approval PIN.', params: { current_pin: S('Current PIN', { required: true, secret: true }), new_pin: S('New six digits', { required: true, secret: true }) } },
  { name: 'pin.reset', method: 'POST', fn: 'lib_auth.pinReset', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: "Clear someone's approval PIN (they set a new one with their password). Needs your PIN.", params: { member: MEMBER } },
  { name: 'pin.recover', method: 'POST', fn: 'lib_auth.pinRecover', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Owner: set a new PIN with the recovery code (a new recovery code is shown once).', params: { recovery_code: S('Recovery code', { required: true, secret: true }), new_pin: S('New six digits', { required: true, secret: true }) } },
  { name: 'pin.recovery-new', method: 'POST', fn: 'lib_auth.recoveryNew', perm: 'signed', agent: 'deny', effect: 'confirm', track: false, desc: 'Owner: replace the recovery code (shown once). Needs your PIN.' },

  /* members */
  { name: 'members.list', method: 'GET', fn: 'lib_auth.listMembers', perm: 'settings:view', effect: 'read', desc: 'Team members with role, funds in scope, PIN set, last seen.', params: Object.assign({ q: S('Name or email contains'), status: S('invited | active | disabled', { enum: ['invited', 'active', 'disabled'] }), role: S('Role code or id') }, PAGE) },
  { name: 'members.get', method: 'GET', fn: 'lib_auth.getMember', perm: 'settings:view', effect: 'read', desc: 'One member.', params: { member: MEMBER } },
  {
    name: 'members.invite',
    method: 'POST',
    fn: 'lib_auth.invite',
    perm: 'settings:full',
    agent: 'deny',
    effect: 'confirm',
    track: false,
    desc: 'Invite a person: answers an invite code (valid 7 days, groups of 5) to hand them. Optionally limit them to some funds. Needs your PIN.',
    params: { email: S('Email', { required: true }), name: S('Name', { required: true }), role: S('Role code: ' + ROLES, { required: true }), title: S('Title'), funds: S('JSON list of fund ids or names they may see (empty = all)') },
  },
  { name: 'members.update', method: 'POST', fn: 'lib_auth.updateMember', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: "Change a member's name, email, title, role or funds in scope. Needs your PIN.", params: { member: MEMBER, name: S('Name'), email: S('Email'), title: S('Title'), role: S('Role code or id'), funds: S('JSON list of fund ids or names (empty list = all)') } },
  { name: 'members.disable', method: 'POST', fn: 'lib_auth.disable', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Disable a member (signs them out everywhere). Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.enable', method: 'POST', fn: 'lib_auth.enable', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Enable a disabled member. Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.reset', method: 'POST', fn: 'lib_auth.resetMember', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: 'A new sign-in code for a member (expired invite or forgotten password). Needs your PIN.', params: { member: MEMBER } },
  { name: 'members.signout', method: 'POST', fn: 'lib_auth.signoutEverywhere', perm: 'signed', agent: 'deny', effect: 'write', track: false, desc: 'Sign a member (yourself by default) out of every session.', params: { member: S('Member id or email (default: you)') } },
  { name: 'members.delete', method: 'POST', fn: 'lib_auth.deleteMember', perm: 'settings:full', agent: 'deny', effect: 'confirm', destructive: true, track: false, desc: 'Remove an invite that was never used (people who used the app are disabled instead). Needs your PIN.', params: { member: MEMBER } },

  /* roles */
  { name: 'roles.list', method: 'GET', fn: 'lib_auth.listRoles', perm: 'settings:view', effect: 'read', desc: 'Roles with their level per module (network, intake, pipeline, diligence, committee, portfolio, funds, lps, markets, settings), whether they vote, and member counts.' },
  { name: 'roles.add', method: 'POST', fn: 'lib_auth.addRole', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Add a role. Needs your PIN.', params: { name: S('Role name', { required: true }), code: S('Code (lower case, default from the name)'), levels: S('JSON object {module: none|view|edit|full}'), votes: B('Votes in committee'), own_items: B('Sees only the items its members submitted'), description: S('Description') } },
  { name: 'roles.update', method: 'POST', fn: 'lib_auth.updateRole', perm: 'settings:full', agent: 'deny', effect: 'confirm', track: false, desc: 'Change a role (not Owner). Needs your PIN.', params: { role: S('Role code or id', { required: true }), name: S('Name'), levels: S('JSON object {module: level}'), votes: B('Votes in committee'), own_items: B('Own items only'), description: S('Description') } },
  { name: 'roles.delete', method: 'POST', fn: 'lib_auth.deleteRole', perm: 'settings:full', agent: 'deny', effect: 'confirm', destructive: true, track: false, desc: 'Delete a role nobody has (built-in roles stay). Needs your PIN.', params: { role: S('Role code or id', { required: true }) } },
];
