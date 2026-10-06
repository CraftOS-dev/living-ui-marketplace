/**
 * "To fix" (v4 plan §5.1) — pure. Open problems grouped by CAUSE, each group with the one button
 * that fixes it. Six apps without a backup are one thing to fix ("Back them up"), not six; a
 * security update is an update button, not a page of steps.
 *
 *   group({ findings, apps, fixable, busy, now }) → [{ key, title, means, severity, findings, apps, action, more, busy, now }]
 *
 * Order (v4 §16, N-B28/N-B30): what is broken RIGHT NOW first — an app that stopped in the last day,
 * crash-loops or stopped answering (`now: true`, "Broken now") — then worst first. Apps stopped for longer
 * are a state, not an outage: they are ONE ordinary tile ("5 apps have been stopped for a while").
 *
 * findings: [{ id, rule_id, severity, title, plain_title, subject, first_seen, evidence }]   (open ones)
 * apps:     { id: { name, update, url } }   update = apps.update (v3), url = where it opens
 * fixable:  { findingId: true }   NetSentry has a built-in fix for it (v2 actions)
 * busy:     { findingId: true }   a change for it is already on its way
 */
const images = require('./images.js');

const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const rank = (s) => RANK[s] || 0;

/** "12.1.20260915-010956" → "12.1": what a person calls the version. */
function shortVersion(tag) {
  const v = images.versionOf(tag);
  return v ? `${v.prefix}${v.nums.join('.')}` : String(tag || '');
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function means(f) {
  const t = ((f.evidence || {}).text || {}).means;
  return Array.isArray(t) ? t.join(' ') : String(t || '');
}

function titleOf(f) {
  return f.plain_title || f.title || f.rule_id;
}

/** Problems that are one cause however many things they touch. */
const ACROSS = {
  'BKP-NONE': (fs, names) => {
    // A backup that exists but fails needs fixing, not a second plan.
    const failing = fs.some((f) => ((f.evidence || {}).factors || []).some((x) => /fail|never worked|no backup made/.test(x)));
    if (failing) {
      return {
        title: fs.length === 1 ? titleOf(fs[0]) : `Backups of ${plural(fs.length, 'app', 'apps')} aren't working`,
        means: 'Until a backup works, a failed disk or a bad update loses their settings, users and history.',
        action: (ids) => ({ kind: 'app', app_id: ids[0], tab: 'backups', label: 'See what went wrong' }),
      };
    }
    return {
      title: fs.length === 1 ? titleOf(fs[0]) : `${plural(fs.length, 'app isn’t', 'apps aren’t')} backed up`,
      means: 'If the disk fails, or a bad update or ransomware hits, their settings, users and history are gone.',
      action: (ids) => ({ kind: 'backup', app_ids: ids, label: fs.length === 1 ? 'Back it up' : 'Back them up' }),
    };
  },
  'HOST-002': (fs, names) => ({
    title: fs.length === 1 ? titleOf(fs[0]) : `Docker opens ${plural(fs.length, 'app', 'apps')} to every network, past the firewall`,
    means: `Docker publishes these apps on every address this server has, and on Linux it does so ahead of the firewall — so closing them in the firewall doesn’t work.${fs.length > 1 ? ' Each app’s page has the steps for that app.' : ''}`,
    action: () => ({ kind: 'steps', finding_id: fs[0].id, label: fs.length > 1 && names[0] ? `Steps for ${names[0]}` : 'Show me how' }),
  }),
};

/** How recent a stop must be to count as broken right now (older: it has simply been stopped). */
const FRESH_STOP_MS = 24 * 3600000;

const stoppedApp = (f) => f.rule_id === 'UP-APP-DOWN' && ((f.evidence || {}).evidence || {}).running === false;

/** Is this problem something broken right now (not a risk, not an old state)? */
function brokenNow(f, nowMs) {
  // The monitor silent: nothing on the server is being checked or can be changed — that comes first.
  if (f.rule_id === 'UP-RESTART-LOOP' || f.rule_id === 'NS-MONITOR-SILENT') return true;
  if (f.rule_id !== 'UP-APP-DOWN') return false;
  if (!stoppedApp(f)) return true; // running but not answering: that is now
  const at = Date.parse(((f.evidence || {}).evidence || {}).stopped_at || '');
  return !isNaN(at) && nowMs - at < FRESH_STOP_MS;
}

/** The one button for a single problem. */
function actionFor(f, app, fixable) {
  const appId = (f.evidence || {}).app_id || '';
  if (f.rule_id === 'UPD-APP-SECURITY' && app) {
    const u = app.update || {};
    const to = u.state === 'available' && u.to ? u.to : u.major && u.major.to ? u.major.to : '';
    if (to) return { kind: 'update', app_id: appId, to, risk: u.state === 'available' && u.to === to ? u.risk || 'low' : 'high', label: `Update to ${shortVersion(to)}` };
  }
  if (f.rule_id === 'APP-SETUP-OPEN' && app) {
    return { kind: 'open', app_id: appId, url: app.url || '', label: `Open ${app.name} to finish setup`, also: { kind: 'stop', app_id: appId, label: 'Stop it for now' } };
  }
  // v4 §16: the monitor stopped reporting — Home walks the person through reconnecting it.
  if (f.rule_id === 'NS-MONITOR-SILENT') return { kind: 'reconnect', label: 'Reconnect the monitor' };
  if (f.rule_id === 'NS-MONITOR-OLD') return { kind: 'reconnect', mode: 'update', label: 'Update the monitor' };
  // v4 §16 (walk): an app that is stopped now gets the button that starts it.
  if (stoppedApp(f) && app) {
    return { kind: 'start', app_id: appId, label: `Start ${app.name}` };
  }
  if (/^REACH-/.test(f.rule_id) && appId) return { kind: 'app', app_id: appId, tab: 'access', label: 'Choose who can reach it' };
  if (/^BKP-/.test(f.rule_id) && appId) return { kind: 'app', app_id: appId, tab: 'backups', label: 'See its backups' };
  if (fixable[f.id]) return { kind: 'fix', finding_id: f.id, label: 'Fix it' };
  return { kind: 'steps', finding_id: f.id, label: 'Show me how' };
}

function group(input) {
  const findings = input.findings || [];
  const apps = input.apps || {};
  const fixable = input.fixable || {};
  const busy = input.busy || {};
  const nowMs = typeof input.now === 'number' ? input.now : Date.now();
  const out = [];
  const byRule = {};
  const longStopped = [];
  for (const f of findings) {
    if (stoppedApp(f) && !brokenNow(f, nowMs)) longStopped.push(f);
    else (byRule[f.rule_id] = byRule[f.rule_id] || []).push(f);
  }
  if (longStopped.length === 1) (byRule['UP-APP-DOWN'] = byRule['UP-APP-DOWN'] || []).push(longStopped[0]);
  else if (longStopped.length > 1) {
    const ids = longStopped.map((f) => (f.evidence || {}).app_id || '').filter(Boolean);
    const names = ids.map((id) => (apps[id] || {}).name || id);
    out.push({
      key: 'stopped:long', rule: 'UP-APP-DOWN', title: `${plural(longStopped.length, 'app has', 'apps have')} been stopped for over a day`,
      means: 'Nobody can use them until they run again. If you don’t need one any more, remove it from its page.',
      severity: longStopped.reduce((w, f) => (rank(f.severity) > rank(w) ? f.severity : w), 'info'),
      findings: longStopped.map((f) => f.id), apps: names, app_ids: ids,
      action: { kind: 'apps', label: 'See the stopped apps' },
      busy: longStopped.every((f) => busy[f.id]), first_seen: longStopped.map((f) => f.first_seen).sort()[0] || '', now: false,
    });
  }

  for (const rule of Object.keys(byRule)) {
    const fs = byRule[rule];
    if (ACROSS[rule]) {
      const appIds = fs.map((f) => (f.evidence || {}).app_id || '').filter(Boolean);
      const names = appIds.map((id) => (apps[id] || {}).name || id);
      const g = ACROSS[rule](fs, names);
      out.push({
        key: `rule:${rule}`, rule, title: g.title, means: g.means,
        severity: fs.reduce((w, f) => (rank(f.severity) > rank(w) ? f.severity : w), 'info'),
        findings: fs.map((f) => f.id), apps: names, app_ids: appIds, action: g.action(appIds),
        busy: fs.every((f) => busy[f.id]), first_seen: fs.map((f) => f.first_seen).sort()[0] || '', now: fs.some((f) => brokenNow(f, nowMs)),
      });
      continue;
    }
    for (const f of fs) {
      const appId = (f.evidence || {}).app_id || '';
      const app = apps[appId] || null;
      out.push({
        key: `finding:${f.id}`, rule, title: titleOf(f), means: means(f),
        severity: f.severity, findings: [f.id], apps: app ? [app.name] : [], app_ids: app ? [appId] : [], action: actionFor(f, app, fixable),
        busy: !!busy[f.id], first_seen: f.first_seen || '', now: brokenNow(f, nowMs),
      });
    }
  }
  // Broken right now (an app stopped or crash-looping) first — it's what a person notices — then worst
  // first; among equals, the one that fixes most, then the oldest (v4 §16, N-B28).
  const now = (g) => (g.now ? 1 : 0);
  out.sort((a, b) => now(b) - now(a) || rank(b.severity) - rank(a.severity) || b.findings.length - a.findings.length || (a.first_seen < b.first_seen ? -1 : a.first_seen > b.first_seen ? 1 : 0));
  return out;
}

module.exports = { group, shortVersion, ACROSS };
