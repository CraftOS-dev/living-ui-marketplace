/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot + membership policy + the "writes go through operations" guard.
 */

// Sync the check catalogue (code is the source of truth; user overrides kept).
// On a brand-new database the migrations have not created the collections yet
// at bootstrap (PocketBase runs them later, and the JS hooks have no serve
// hook); the scheduler's first tick then syncs within a minute. Evaluation
// never waits for it — missing catalogue rows fall back to the code defaults.
onBootstrap((e) => {
  e.next();
  try {
    $app.findCollectionByNameOrId('rules');
  } catch (_) {
    console.log('[netsentry] new database — the check catalogue syncs on the first scheduler tick');
    return;
  }
  try {
    require(`${__hooks}/lib/services/rulesconfig.js`).sync($app);
  } catch (err) {
    console.error('[netsentry] rule catalogue sync failed:', err);
  }
  try {
    const added = require(`${__hooks}/lib/services/assets.js`).backfillSources($app);
    if (added) console.log(`[netsentry] added ${added} source(s) for collectors new in this version`);
  } catch (err) {
    console.error('[netsentry] source backfill failed:', err);
  }
});

// Membership: the first account becomes admin; afterwards sign-up is closed
// unless an admin opened it, and new accounts start as viewers. The role a
// client sends is ignored.
onRecordCreateRequest((e) => {
  const repo = require(`${__hooks}/lib/infra/repo.js`);
  const existing = repo.find(e.app, 'users', 'id != ""', {}, '', 1).length;
  let superuser = false;
  try {
    superuser = !!(e.auth && e.auth.collection().name === '_superusers');
  } catch (_) {
    superuser = false;
  }
  if (existing > 0 && !superuser) {
    const settings = repo.first(e.app, 'settings', 'id != ""');
    if (!settings || !settings.getBool('signup_open')) {
      throw new ForbiddenError('Sign-up is closed. Ask a NetSentry admin to open sign-up in Workspace → Settings.');
    }
  }
  e.record.set('role', existing === 0 ? 'admin' : 'viewer');
  e.record.set('emailVisibility', true);
  return e.next();
}, 'users');

onRecordAfterCreateSuccess((e) => {
  try {
    const audit = require(`${__hooks}/lib/services/audit.js`);
    const { SYSTEM } = require(`${__hooks}/lib/infra/actor.js`);
    audit.append(e.app, SYSTEM, 'member.joined', { collection: 'users', id: e.record.id },
      `${e.record.getString('email')} joined as ${e.record.getString('role')}`, null);
  } catch (err) {
    console.error('[netsentry] audit of new member failed:', err);
  }
  return e.next();
}, 'users');

// Roles change only through members.set-role (an operation, which saves
// server-side and does not pass through this request hook).
onRecordUpdateRequest((e) => {
  const before = e.record.original().getString('role');
  if (e.record.getString('role') !== before) {
    throw new BadRequestError('Roles are changed by an admin in Workspace → Members.');
  }
  return e.next();
}, 'users');

// Every write goes through an operation (role check + audit). Direct REST
// writes are refused for EVERY collection — including ones added later and
// including the superuser credential — so neither a person nor the agent can
// bypass the audit trail (security review 2026-09-30: the v2 collections were
// missing from the old list). The only exceptions are people's own accounts:
// signing up, and changing your own email / password (roles only change
// through members.set-role, see above).
// Everything a handler uses is written inside it: PocketBase runs handlers apart from this file's top
// level, so a constant or helper declared up here is undefined there (a top-level message and
// self-service check made every refusal a 400, and people couldn't change their own password).

onRecordCreateRequest((e) => {
  let superuser = false;
  try {
    superuser = !!e.auth && e.auth.collection().name === '_superusers';
  } catch (_) {
    superuser = false;
  }
  if (e.collection.name === 'users' && !superuser) return e.next(); // sign-up (open or closed per settings)
  throw new ForbiddenError('Use NetSentry operations (/api/ops/…) to change data; direct writes are disabled.');
});

onRecordUpdateRequest((e) => {
  // people's own accounts: changing your own email / password (roles only change through members.set-role)
  let auth = null;
  try {
    auth = e.auth;
  } catch (_) {
    auth = null;
  }
  if (e.collection.name === 'users' && !!auth && auth.collection().name === 'users' && e.record && auth.id === e.record.id) return e.next();
  throw new ForbiddenError('Use NetSentry operations (/api/ops/…) to change data; direct writes are disabled.');
});

onRecordDeleteRequest((e) => {
  throw new ForbiddenError('Use NetSentry operations (/api/ops/…) to change data; direct writes are disabled.');
});
