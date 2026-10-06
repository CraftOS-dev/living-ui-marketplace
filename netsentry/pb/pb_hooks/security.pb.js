/// <reference path="../pb_data/types.d.ts" />
/**
 * What the machine superuser credential may NOT do here (security review, 2026-09-30).
 *
 * The agent operates NetSentry with PocketBase's superuser credential (lib/infra/actor.js).
 * NetSentry's own rules — "the agent never approves a fix, never widens what is scanned, never
 * hands out keys" — live in its operations (lib/core/roles.js HUMAN_ONLY). PocketBase's built-in
 * superuser API would walk around them, so the parts of it NetSentry has no use for are refused:
 *
 *   - impersonating a person (for everyone — nothing here needs it);
 *   - reading logs, listing / downloading / restoring / uploading / deleting backups (creating
 *     one stays open: CraftBot's own backup of a running app uses it, and the file never
 *     leaves the machine through the API);
 *   - changing settings or collections (schema), and any direct record write — every change
 *     goes through an operation, with its role check and its audit entry.
 */
routerUse((e) => {
  let path = '';
  let method = '';
  try {
    path = String(e.request.url.path || '');
    method = String(e.request.method || '').toUpperCase();
  } catch (_) {
    return e.next();
  }
  if (/^\/api\/collections\/[^/]+\/impersonate\//.test(path)) {
    return e.json(403, { message: 'Impersonation is disabled in NetSentry.' });
  }
  let superuser = false;
  try {
    superuser = !!e.auth && e.auth.collection().name === '_superusers';
  } catch (_) {
    superuser = false;
  }
  if (!superuser || method === 'GET' && !/^\/api\/(logs|backups)/.test(path)) return e.next();

  const refuse = (what) => e.json(403, { message: `${what} is disabled for this credential in NetSentry; use NetSentry's operations (/api/ops/…).` });
  if (/^\/api\/logs/.test(path)) return refuse('Reading logs');
  if (/^\/api\/backups/.test(path)) {
    return method === 'POST' && path === '/api/backups' ? e.next() : refuse('Listing, downloading, restoring or deleting backups');
  }
  if (/^\/api\/settings/.test(path)) return refuse('Changing settings');
  if (/^\/api\/collections(\/import)?\/?$/.test(path) || /^\/api\/collections\/[^/]+\/?$/.test(path)) return refuse('Changing collections');
  if (/^\/api\/collections\/[^/]+\/records/.test(path)) return refuse('Writing records directly');
  // Security review 2026-10-01 (C7): every other change through the collections API (e.g. emptying a
  // collection with /truncate, which would make the next sign-up an administrator), the batch API (record
  // writes in bulk) and running scheduled jobs by hand. Only the superuser's own sign-in stays open.
  if (/^\/api\/collections\//.test(path) && !/^\/api\/collections\/_superusers\/(auth-|request-|confirm-)/.test(path)) return refuse('Changing collections or their records');
  if (/^\/api\/batch/.test(path)) return refuse('Writing records in a batch');
  if (/^\/api\/crons/.test(path)) return refuse('Running scheduled jobs by hand');
  return e.next();
});
