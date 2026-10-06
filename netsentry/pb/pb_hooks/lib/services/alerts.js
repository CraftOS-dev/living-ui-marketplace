/**
 * Alerts service — notifying PEOPLE directly, independent of any agent:
 * webhooks (Slack / Discord / ntfy / JSON), an outside heartbeat ping
 * (dead-man's switch), CraftBot email when hosted in CraftBot, and the daily
 * digest. Every send records its outcome on the notifier.
 */
const repo = require('../infra/repo.js');
const secrets = require('../infra/secrets.js');
const audit = require('./audit.js');
const { formatAlert, validateDestination, urlHint, meetsSeverity, hostOf, isPublicAddress, looksNumeric } = require('../core/alerts.js');
const { createHttp } = require('../infra/http.js');
const { SEVERITIES } = require('../core/severity.js');
const { OpError } = require('../core/util.js');

const KINDS = ['webhook', 'heartbeat', 'craftbot_email'];
const FORMATS = ['slack', 'discord', 'ntfy', 'json'];

/**
 * Resolve the destination name and refuse private answers. Run at save time AND
 * before every send (DNS can change). HTTPS certificate validation is the second
 * line of defence against rebinding: an internal service cannot present a valid
 * certificate for the attacker's name.
 * @returns null when safe, else the reason
 */
function resolveCheck(url) {
  const host = hostOf(url);
  if (!host) return 'Invalid destination URL.';
  if (looksNumeric(host)) return isPublicAddress(host) ? null : 'The destination address is not public.';
  const dns = require('../collectors/dns.js');
  const http = createHttp();
  const answers = [];
  try {
    for (const type of ['A', 'AAAA']) {
      const r = dns.lookup(http, host, type);
      if (r.status === 'nxdomain') return `${host} does not exist in DNS.`;
      for (const a of r.answers) if (a.type === 1 || a.type === 28) answers.push(String(a.data));
    }
  } catch (err) {
    return 'Could not resolve the destination right now — try again shortly.';
  }
  if (answers.length === 0) return `${host} has no address records.`;
  if (answers.some((a) => !isPublicAddress(a))) return `${host} resolves to a private, loopback or link-local address, which is not allowed.`;
  return null;
}

function requireNotifier(app, id) {
  const n = repo.byId(app, 'notifiers', id);
  if (!n) throw new OpError(404, 'Notifier not found.', 'not_found');
  return n;
}

function readFields(p, isCreate) {
  const f = {};
  if (isCreate) {
    if (KINDS.indexOf(String(p.kind)) < 0) throw new OpError(400, `kind must be one of ${KINDS.join(', ')}.`);
    f.kind = String(p.kind);
  }
  if (p.name !== undefined && p.name !== '') {
    const name = String(p.name).trim();
    if (!name || name.length > 80) throw new OpError(400, 'Name must be 1–80 characters.');
    f.name = name;
  } else if (isCreate) throw new OpError(400, 'Give the notifier a name.');
  if (p.format !== undefined && p.format !== '') {
    if (FORMATS.indexOf(String(p.format)) < 0) throw new OpError(400, `format must be one of ${FORMATS.join(', ')}.`);
    f.format = String(p.format);
  }
  if (p.min_severity !== undefined && p.min_severity !== '') {
    if (SEVERITIES.indexOf(String(p.min_severity)) < 0) throw new OpError(400, `min_severity must be one of ${SEVERITIES.join(', ')}.`);
    f.min_severity = String(p.min_severity);
  }
  if (p.send_digest !== undefined && p.send_digest !== '') f.send_digest = p.send_digest === true || p.send_digest === 'true';
  if (p.interval_minutes !== undefined && p.interval_minutes !== '') {
    const m = Number(p.interval_minutes);
    if (!(m >= 1 && m <= 1440) || Math.floor(m) !== m) throw new OpError(400, 'Heartbeat interval must be 1–1440 whole minutes.');
    f.interval_minutes = m;
  }
  if (p.enabled !== undefined && p.enabled !== '') f.enabled = p.enabled === true || p.enabled === 'true';
  return f;
}

function create(app, actor, p) {
  const f = readFields(p, true);
  if (f.kind !== 'craftbot_email') {
    const err = validateDestination(p.url) || resolveCheck(p.url);
    if (err) throw new OpError(400, err, 'invalid_url');
    f.url_encrypted = secrets.encrypt(app, String(p.url).trim());
    f.url_hint = urlHint(String(p.url).trim());
  }
  if (f.kind === 'webhook' && !f.format) f.format = 'json';
  if (f.kind === 'heartbeat' && !f.interval_minutes) f.interval_minutes = 5;
  if (!f.min_severity) f.min_severity = 'high';
  if (f.enabled === undefined) f.enabled = true;
  const n = repo.create(app, 'notifiers', Object.assign({ sent_count: 0, last_ok: false }, f));
  audit.append(app, actor, 'notifier.created', { collection: 'notifiers', id: n.id }, `Added ${f.kind} notifier "${f.name}"${f.url_hint ? ' → ' + f.url_hint : ''}`, null);
  return { ok: true, notifier_id: n.id };
}

function update(app, actor, p) {
  const n = requireNotifier(app, p.notifier_id);
  const f = readFields(p, false);
  if (p.url) {
    const err = validateDestination(p.url) || resolveCheck(p.url);
    if (err) throw new OpError(400, err, 'invalid_url');
    f.url_encrypted = secrets.encrypt(app, String(p.url).trim());
    f.url_hint = urlHint(String(p.url).trim());
  }
  if (Object.keys(f).length === 0) throw new OpError(400, 'Nothing to change.');
  repo.update(app, n, f);
  const changed = Object.keys(f).filter((k) => k !== 'url_encrypted').join(', ');
  audit.append(app, actor, 'notifier.updated', { collection: 'notifiers', id: n.id }, `Changed ${changed} on "${n.getString('name')}"`, null);
  return { ok: true, notifier_id: n.id };
}

function remove(app, actor, p) {
  const n = requireNotifier(app, p.notifier_id);
  const name = n.getString('name');
  app.delete(n);
  audit.append(app, actor, 'notifier.deleted', { collection: 'notifiers', id: p.notifier_id }, `Deleted notifier "${name}"`, null);
  return { ok: true };
}

/** Deliver one alert through one notifier. Never throws; records the outcome. */
function deliver(app, n, alert) {
  const kind = n.getString('kind');
  let ok = false;
  let error = '';
  try {
    if (kind === 'craftbot_email') {
      const body = [alert.text || ''].concat((alert.lines || []).map((l) => '• ' + l)).join('\n');
      const res = require('../../craftbot_actions.js').emailOwner(`[NetSentry ${alert.severity}] ${alert.title}`, body);
      ok = res.status >= 200 && res.status < 300;
      if (!ok) error = res.status === 503 ? 'Not running inside CraftBot — email via CraftBot is unavailable.' : String(res.error || 'bridge returned ' + res.status);
    } else {
      const url = secrets.decrypt(app, n.getString('url_encrypted'));
      const unsafe = validateDestination(url) || resolveCheck(url);
      if (unsafe) throw new Error('BLOCKED: ' + unsafe);
      const req =
        kind === 'heartbeat'
          ? { url, method: 'GET', timeout: 10 }
          : (function () {
              const msg = formatAlert(alert, n.getString('format') || 'json');
              return { url, method: 'POST', body: msg.body, headers: msg.headers, timeout: 10 };
            })();
      const res = $http.send(req);
      ok = res.statusCode >= 200 && res.statusCode < 300;
      if (!ok) error = `Destination answered HTTP ${res.statusCode}`;
    }
  } catch (err) {
    const raw = String((err && err.message) || err);
    // Never echo network errors verbatim: they would turn "Test" into an internal port scanner.
    error = raw.indexOf('BLOCKED: ') >= 0 ? raw.slice(raw.indexOf('BLOCKED: ') + 9, 500) : 'Could not connect to the destination (network or TLS error).';
    console.error(`[netsentry] notifier "${n.getString('name')}" send error: ${raw.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')}`);
  }
  repo.update(app, n, {
    last_sent: repo.nowIso(),
    last_ok: ok,
    last_error: error,
    sent_count: n.getInt('sent_count') + (ok ? 1 : 0),
  });
  if (!ok) console.error(`[netsentry] notifier "${n.getString('name')}" failed: ${error}`);
  return { ok, error };
}

/** Send an alert to every enabled, non-heartbeat notifier whose threshold it meets. */
function dispatch(app, alert) {
  const results = [];
  for (const n of repo.find(app, 'notifiers', 'enabled = true && kind != "heartbeat"')) {
    if (alert.kind === 'digest' ? !n.getBool('send_digest') : !meetsSeverity(alert.severity, n.getString('min_severity'))) continue;
    results.push(Object.assign({ notifier: n.getString('name') }, deliver(app, n, alert)));
  }
  return results;
}

function test(app, actor, p) {
  const n = requireNotifier(app, p.notifier_id);
  const r = deliver(app, n, {
    kind: 'test',
    severity: 'info',
    title: 'Test alert',
    text: `This is a test from NetSentry, sent by ${actor.label}. If you can read this, alerts to "${n.getString('name')}" work.`,
  });
  audit.append(app, actor, 'notifier.tested', { collection: 'notifiers', id: n.id }, `Tested "${n.getString('name')}": ${r.ok ? 'delivered' : 'failed'}`, { error: r.error || null });
  return { ok: r.ok, delivered: r.ok, error: r.error, message: r.ok ? 'Delivered.' : 'Delivery failed: ' + r.error };
}

/** Ping heartbeat URLs that are due. Silence at the receiver = NetSentry (or its host) is down. */
function heartbeatTick(app) {
  const now = Date.now();
  for (const n of repo.find(app, 'notifiers', 'enabled = true && kind = "heartbeat"')) {
    const last = Date.parse(repo.isoOf(n, 'last_sent') || '1970-01-01T00:00:00Z');
    if (now - last >= (n.getInt('interval_minutes') || 5) * 60000 - 20000) deliver(app, n, { severity: 'info', title: 'heartbeat' });
  }
}

function incidentAlert(app, inc, reason) {
  const root = repo.byId(app, 'assets', inc.getString('root_asset'));
  const findings = repo.find(app, 'findings', 'incident = {:i}', { i: inc.id }, '-severity', 10);
  return {
    kind: 'incident',
    severity: inc.getString('severity'),
    title: (reason === 'created' ? 'New security case: ' : reason === 'escalated' ? `Case now ${inc.getString('severity')}: ` : reason === 'reopened' ? 'Case reopened: ' : 'Case updated: ') + inc.getString('title'),
    text: `${root ? root.getString('identifier') + ' · ' : ''}${inc.getInt('finding_count')} issue(s). Open NetSentry → Issues → Cases to see what to do.`,
    lines: findings.map((f) => `${f.getString('severity').toUpperCase()} ${f.getString('rule_id')}: ${f.getString('title')}`),
  };
}

function sourceAlert(app, sourceRec, message) {
  const target = sourceRec.getString('target') ? repo.byId(app, 'assets', sourceRec.getString('target')) : null;
  return {
    kind: 'source',
    severity: 'medium',
    title: `A check is not working: ${sourceRec.getString('collector')}${target ? ' on ' + target.getString('identifier') : ''}`,
    text: `It failed 3 times in a row; NetSentry keeps retrying with longer pauses. Last error: ${message}`,
  };
}

/** The daily digest: Home's "to fix" as text — the same count, grouped the same way (v4 §5.1). */
function buildDigest(app) {
  const todo = require('./home.js').overview(app).todo;
  const since = repo.pbDate(new Date(Date.now() - 86400000).toISOString());
  const newFindings = repo.find(app, 'findings', 'first_seen >= {:s}', { s: since }).length;
  const resolved = repo.find(app, 'findings', 'resolved_at >= {:s}', { s: since }).length;
  const incidents = repo.find(app, 'incidents', 'status = "new" || status = "investigating"');
  const untriaged = incidents.filter((i) => i.getBool('needs_triage')).length;
  const failing = repo.find(app, 'sources', 'enabled = true && health = "failing"').length;
  let toReview = 0;
  try {
    toReview = repo.find(app, 'detections', 'verdict = "unreviewed"').length;
  } catch (_) {
    toReview = 0;
  }
  const words = { critical: 'Urgent', high: 'Important', medium: 'Soon', low: 'When you have time', info: 'FYI' };
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  // Accepted risks that ended in the last day: they count again (P5).
  const nowIso = new Date().toISOString();
  const lapsed = repo.find(app, 'suppressions', 'until != "" && until >= {:s} && until <= {:n}', { s: since, n: repo.pbDate(nowIso) }).map((x) => {
    const f = repo.first(app, 'findings', 'fingerprint = {:f}', { f: x.getString('fingerprint') });
    return f ? f.getString('plain_title') || f.getString('title') : 'an accepted issue';
  });
  const auditHead = require('./audit.js').head(app);
  const worst = todo.some((g) => g.severity === 'critical') ? 'critical' : todo.some((g) => g.severity === 'high') ? 'high' : 'info';
  return {
    kind: 'digest',
    severity: worst,
    title: todo.length ? `NetSentry daily summary: ${n(todo.length, 'thing', 'things')} to fix` : 'NetSentry daily summary: all fine',
    text:
      `Last 24 hours: ${n(newFindings, 'new problem', 'new problems')}, ${resolved} fixed.` +
      (toReview ? ` ${n(toReview, 'thing that happened is', 'things that happened are')} waiting for your review.` : '') +
      (untriaged ? ` ${n(untriaged, 'case is', 'cases are')} waiting for a look.` : '') +
      (failing ? ` ${n(failing, 'check keeps', 'checks keep')} failing to run.` : ''),
    lines: todo
      .slice(0, 5)
      .map((g) => `${words[g.severity] || g.severity}: ${g.title}`)
      .concat(todo.length > 5 ? [`…and ${todo.length - 5} more on Home.`] : [])
      .concat(lapsed.map((t) => `No longer accepted (its end date passed): ${t}`))
      .concat(auditHead ? [`Tamper check for the record of who did what: entry #${auditHead.seq}, fingerprint ${auditHead.hash.slice(0, 16)}…`] : []),
  };
}

module.exports = { create, update, remove, test, dispatch, deliver, heartbeatTick, incidentAlert, sourceAlert, buildDigest };
