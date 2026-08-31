/// <reference path="../pb_data/types.d.ts" />
/**
 * SPA cache policy.
 *
 * The frontend is a single-page app: index.html is a tiny shell that points at
 * a CONTENT-HASHED bundle (assets/index-<hash>.js). The hashed assets are
 * immutable and safe to cache forever, but the shell must NEVER be cached —
 * otherwise a browser (or the CraftBot host iframe, which reuses a pooled
 * frame) keeps serving an old shell that references a deleted bundle, and new
 * deploys appear to "not take effect".
 *
 * PocketBase's static handler sets Last-Modified but no Cache-Control, which
 * lets browsers heuristically cache the shell. We force no-store on the shell
 * only. Headers must be set BEFORE e.next() — they flush with the first body
 * byte, so a post-next mutation is a no-op (same rule the CORS middleware in
 * _system.pb.js relies on). Callbacks run in isolated VMs, so everything is
 * inlined here.
 */
routerUse((e) => {
  var path = '';
  try {
    path = String((e.request && e.request.url && e.request.url.path) || '');
  } catch {
    path = '';
  }

  // The document shell only: "/", "/index.html", or any *.html. Hashed assets
  // under /assets/ and the /api/* surface are left alone.
  var isShell = path === '/' || path === '/index.html' || path.slice(-5) === '.html';
  if (isShell) {
    var headers = e.response.header();
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
  }
  return e.next();
});
