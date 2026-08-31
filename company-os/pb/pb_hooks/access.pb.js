/// <reference path="../pb_data/types.d.ts" />
/**
 * Signup guard. A new account MUST start pending — a client can never approve
 * itself or grant a role. The exception is bootstrapping: when the install has
 * no approved owner yet, the next account to sign up becomes the owner
 * (approved) so there is always someone who can approve everyone else. Keying
 * on "no owner exists" (rather than "the users table is empty") means the first
 * real person can never be locked out by a stray/pending row created before
 * them. All later access changes go through the /api/ops/member-access
 * endpoint (owner/admin only).
 */
onRecordCreateRequest((e) => {
  // Force safe defaults regardless of what the client sent.
  e.record.set('role', 'member');
  e.record.set('approved', false);
  // So the owner/admin can see WHO to approve (email is otherwise hidden to
  // anyone but the account itself). Only owner/admin can view users at all.
  e.record.set('emailVisibility', true);

  // Does an approved owner already exist? (-1 = couldn't determine.)
  let ownerCount = -1;
  try {
    ownerCount = e.app.countRecords('users', $dbx.hashExp({ role: 'owner', approved: true }));
  } catch (_) {
    ownerCount = -1;
  }

  let bootstrap;
  if (ownerCount >= 0) {
    // Normal path: no owner yet → this account claims ownership.
    bootstrap = ownerCount === 0;
  } else {
    // Fallback if the owner query failed: bootstrap only on an empty table,
    // and otherwise fail closed (stay pending) so ownership isn't handed out.
    try {
      bootstrap = e.app.countRecords('users') === 0;
    } catch (__) {
      bootstrap = false;
    }
  }

  if (bootstrap) {
    e.record.set('role', 'owner');
    e.record.set('approved', true);
  }

  e.next();
}, 'users');
