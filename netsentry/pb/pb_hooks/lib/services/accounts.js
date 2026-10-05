/**
 * App accounts and access reviews (plan §12.4, §16.7, D12).
 *
 * - An admin can give NetSentry a READ-ONLY key for an app whose catalogue
 *   entry supports it. It is stored encrypted (the
 *   same key file as alert destinations), never returned by any operation, and
 *   handed only to the monitor on the machine that runs the app.
 * - Access reviews: "who has admin in X" looked at by a person, recorded with
 *   the account list at that moment. A quarterly reminder asks for them.
 */
const repo = require('../infra/repo.js');
const secrets = require('../infra/secrets.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');
const catalogue = require('../v2/catalogue/index.js');

function requireApp(app, id) {
  const a = repo.byId(app, 'apps', String(id || ''));
  if (!a) throw new OpError(404, 'App not found.');
  return a;
}

function nameOf(a) {
  return a.getString('label') || a.getString('display_name');
}

function setAccess(app, actor, p) {
  const a = requireApp(app, p.app_id);
  const entry = catalogue.get(a.getString('app_type'));
  if (!entry || !entry.accounts) throw new OpError(400, `NetSentry can't read ${nameOf(a)}'s accounts with a read-only key.`);
  const token = String(p.token || '').trim();
  if (token.length < 8 || token.length > 400 || /\s/.test(token)) throw new OpError(400, 'That does not look like a key.');
  const fields = { app: a.id, secret: secrets.encrypt(app, token), hint: `…${token.slice(-4)}`, added_by: actor.label || actor.type, added_at: repo.nowIso(), last_error: '' };
  const ex = repo.first(app, 'app_access', 'app = {:a}', { a: a.id });
  if (ex) repo.update(app, ex, fields);
  else repo.create(app, 'app_access', fields);
  audit.append(app, actor, 'app.access_key_set', { collection: 'apps', id: a.id }, `Gave NetSentry a read-only key for ${nameOf(a)}`, { hint: fields.hint });
  require('./sensors.js').requestRun(app, a.getString('asset'));
  require('./v2.js').evaluateAndAlert(app, a.getString('asset'));
  return { ok: true, message: `NetSentry will read ${nameOf(a)}'s accounts within a minute.` };
}

function removeAccess(app, actor, p) {
  const a = requireApp(app, p.app_id);
  const ex = repo.first(app, 'app_access', 'app = {:a}', { a: a.id });
  if (ex) app.delete(ex);
  audit.append(app, actor, 'app.access_key_removed', { collection: 'apps', id: a.id }, `Removed NetSentry's key for ${nameOf(a)}`, null);
  require('./v2.js').evaluateAndAlert(app, a.getString('asset'));
  return { ok: true, message: 'Removed. Revoke the key in the app too.' };
}

/** Check-in: the account jobs for the monitor on this machine (keys decrypted only here). */
function configFor(app, assetId) {
  if (!assetId) return [];
  const out = [];
  for (const acc of repo.find(app, 'app_access', 'app.asset = {:a}', { a: assetId })) {
    const a = repo.byId(app, 'apps', acc.getString('app'));
    if (!a || a.getString('status') !== 'active') continue;
    const entry = catalogue.get(a.getString('app_type'));
    const ep = (repo.jsonOf(a, 'endpoints') || [])[0];
    if (!entry || !entry.accounts || !ep) continue;
    const host = ep.probe_host || (['0.0.0.0', '::', '[::]', ''].indexOf(ep.bind) >= 0 ? '127.0.0.1' : ep.bind);
    let token = '';
    try {
      token = secrets.decrypt(app, acc.getString('secret'));
    } catch (_) {
      continue;
    }
    out.push({ app_key: a.getString('key'), kind: entry.accounts.kind, base_url: `http://${host}:${ep.port}`, token });
  }
  return out;
}

/** After the monitor reports: remember whether the key worked (shown on the app page). */
function afterReport(app, collectorId, assetId, now) {
  if (collectorId !== 'probe.accounts') return;
  for (const o of repo.find(app, 'observations', 'asset = {:a} && kind = "app.accounts_status" && present = true', { a: assetId })) {
    const d = repo.jsonOf(o, 'data') || {};
    const a = repo.first(app, 'apps', 'key = {:k}', { k: o.getString('subject') });
    const acc = a ? repo.first(app, 'app_access', 'app = {:a}', { a: a.id }) : null;
    if (acc) repo.update(app, acc, d.ok ? { last_ok: now, last_error: '' } : { last_error: String(d.error || 'failed').slice(0, 300) });
  }
}

/** A person looked at who has access and confirmed it (or noted what they changed). */
function review(app, actor, p) {
  const a = requireApp(app, p.app_id);
  const accounts = [];
  for (const o of repo.find(app, 'observations', 'kind = "app.account" && present = true && asset = {:s}', { s: a.getString('asset') })) {
    const d = repo.jsonOf(o, 'data') || {};
    if (d.app_key === a.getString('key')) accounts.push({ login: d.login, is_admin: !!d.is_admin, active: !!d.active, last_login: d.last_login || '' });
  }
  const rec = repo.create(app, 'access_reviews', {
    app: a.id, reviewer: actor.label || actor.type, reviewed_at: repo.nowIso(), note: String(p.note || '').slice(0, 1000), accounts,
  });
  audit.append(app, actor, 'app.access_reviewed', { collection: 'access_reviews', id: rec.id }, `Reviewed who has access to ${nameOf(a)}`, { accounts: accounts.length });
  return { ok: true, review_id: rec.id };
}

/** Apps whose access review is due: business-critical ones and every app with a key. */
function reviewsDue(app, now) {
  const s = repo.first(app, 'settings', 'id != ""');
  const days = (s && s.getInt('access_review_days')) || 90;
  const due = [];
  for (const a of repo.find(app, 'apps', 'status = "active"')) {
    const keyed = !!repo.first(app, 'app_access', 'app = {:a}', { a: a.id });
    if (!keyed && a.getString('importance') !== 'critical') continue;
    const last = repo.first(app, 'access_reviews', 'app = {:a}', { a: a.id }, '-reviewed_at');
    const at = last ? repo.isoOf(last, 'reviewed_at') : '';
    if (!at || Date.parse(now) - Date.parse(at) > days * 86400000) due.push({ id: a.id, name: nameOf(a), last: at });
  }
  return due;
}

/** Monthly (1st): remind about due reviews through the alert channels (only apps someone gave a key for). */
function reviewReminder(app) {
  const due = reviewsDue(app, repo.nowIso());
  if (!due.length) return;
  require('./alerts.js').dispatch(app, {
    kind: 'digest',
    severity: 'low',
    title: `Time to review who has access: ${due.map((d) => d.name).slice(0, 5).join(', ')}${due.length > 5 ? '…' : ''}`,
    text: 'Check that everyone with an account — especially administrators — still needs it, then press "Reviewed" on each app in NetSentry.',
    lines: due.map((d) => `${d.name}: ${d.last ? `last reviewed ${d.last.slice(0, 10)}` : 'never reviewed'}`),
  });
}

module.exports = { setAccess, removeAccess, configFor, afterReport, review, reviewsDue, reviewReminder };
