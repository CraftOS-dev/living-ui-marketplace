/**
 * Home in one call (v4 plan §5.1): how the server is doing, what to fix — grouped by cause with the
 * button that fixes it (lib/v2/todo.js) — and every app with whether it's running.
 */
const repo = require('../infra/repo.js');
const { group } = require('../v2/todo.js');
const server = require('./server.js');

const ACTIVE = 'status = "plan_requested" || status = "planned" || status = "approved" || status = "executing" || status = "verifying"';

/** Where an app opens: the browser knows the server's address, the app only its port (and where it listens). */
function opensAt(a) {
  const ep = (repo.jsonOf(a, 'endpoints') || []).find((e) => e && e.proto !== 'udp' && e.port) || null;
  return ep ? { port: ep.port, bind: ep.bind || '' } : null;
}

function overview(app) {
  const R = require('./remediations.js');
  const srv = server.theServer(app);
  const findings = repo.find(app, 'findings', 'status = "open"', {}, '-last_seen', 300);
  const appRecs = repo.find(app, 'apps', 'status = "active"', {}, 'display_name');
  const byId = {};
  const names = {}; // container → app name, for plain words
  const apps = [];
  for (const a of appRecs) {
    const name = a.getString('label') || a.getString('display_name') || a.getString('container');
    const c = a.getString('container') && srv
      ? repo.first(app, 'observations', 'asset = {:s} && kind = "container" && subject = {:c} && present = true', { s: srv.id, c: a.getString('container') })
      : null;
    const d = c ? repo.jsonOf(c, 'data') || {} : null;
    const state = d ? String(d.state || (d.running === false ? 'exited' : 'running')) : 'unknown';
    byId[a.id] = { name, update: repo.jsonOf(a, 'update') || null, url: opensAt(a) };
    if (a.getString('container')) names[a.getString('container')] = name;
    apps.push({
      id: a.id, name, app_type: a.getString('app_type'), version: a.getString('version'), container: a.getString('container'),
      state, running: state === 'running', url: opensAt(a), update: repo.jsonOf(a, 'update') || null,
      problems: findings.filter((f) => ((repo.jsonOf(f, 'evidence') || {}).app_id || '') === a.id).length,
    });
  }
  const fixable = {};
  for (const f of findings) {
    try {
      if (R.v2Fix(app, f)) fixable[f.id] = true;
    } catch (_) {
      /* no built-in fix */
    }
  }
  const busy = {};
  // Confirmed and on its way (a prepared fix nobody confirmed yet isn't "being fixed").
  for (const r of repo.find(app, 'remediations', 'finding != "" && (status = "plan_requested" || status = "approved" || status = "executing" || status = "verifying")')) busy[r.getString('finding')] = true;
  const words = require('../rules/plain.js');
  const plain = findings.map((f) => {
    const evidence = repo.jsonOf(f, 'evidence') || {};
    // v2 checks carry their own words; an older (v1) rule's "what it means" comes from rules/plain.js.
    if (!(evidence.text && evidence.text.means)) {
      const ex = words.explain(f.getString('rule_id'), { subject: f.getString('subject'), evidence, on: srv ? srv.getString('label') || srv.getString('identifier') : '', apps: names });
      if (ex && ex.means) evidence.text = Object.assign({}, evidence.text || {}, { means: ex.means });
    }
    return {
      id: f.id, rule_id: f.getString('rule_id'), severity: f.getString('severity'), title: f.getString('title'),
      plain_title: f.getString('plain_title'), subject: f.getString('subject'), first_seen: repo.isoOf(f, 'first_seen'), evidence,
    };
  });
  return {
    ok: true,
    server: srv ? server.summary(app, srv) : null,
    todo: group({ findings: plain, apps: byId, fixable, busy, now: Date.now() }),
    handling: repo.find(app, 'findings', 'status = "acknowledged"').length,
    apps,
  };
}

module.exports = { overview };
