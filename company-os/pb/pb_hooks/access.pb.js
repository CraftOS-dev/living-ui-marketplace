/// <reference path="../pb_data/types.d.ts" />
/**
 * Signup guard. A new account MUST start pending — a client can never approve
 * itself or grant a role. The single exception is the very first account on a
 * fresh install: it becomes the owner (approved) so there is someone who can
 * approve everyone else. All later access changes go through the
 * /api/ops/member-access endpoint (owner/admin only).
 */
onRecordCreateRequest((e) => {
  // Force safe defaults regardless of what the client sent.
  e.record.set('role', 'member');
  e.record.set('approved', false);
  // So the owner/admin can see WHO to approve (email is otherwise hidden to
  // anyone but the account itself). Only owner/admin can view users at all.
  e.record.set('emailVisibility', true);

  let count = 1;
  try {
    count = e.app.countRecords('users');
  } catch (_) {
    try {
      count = e.app.findRecordsByFilter('users', "id != ''", '', 0, 0).length;
    } catch (__) {
      count = 1; // fail closed: if we can't tell, treat as "not first" (pending)
    }
  }

  if (count === 0) {
    // First account on this install bootstraps as the owner.
    e.record.set('role', 'owner');
    e.record.set('approved', true);
  }

  e.next();
}, 'users');
