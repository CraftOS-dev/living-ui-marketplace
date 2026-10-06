/**
 * Looking at the server (v4 plan N-B9): one road for files, settings, disk, programs, firewall,
 * users and scheduled jobs. Like logs (v3 §9): a request waits in memory for the monitor's next
 * check-in, the monitor answers, the answer lives two minutes in memory — nothing is stored, and
 * only the person (or agent) who asked can read it.
 *
 *   server.read        { kind, ...params } → { request_id }
 *   server.read-result { request_id }       → { ready, result?, error? }
 *
 * Each kind says who may ask (N-B12: file contents and app settings are people-only, admins).
 */
const repo = require('../infra/repo.js');
const { OpError } = require('../core/util.js');
const { LEVEL } = require('../core/roles.js');

const TTL_MS = 120000;
const FULL_PATH = /^(\/|[A-Za-z]:\\)[^\0\n\r]{0,1000}$/;

const KINDS = {
  'files.list': { role: 'analyst', params: (p) => ({ path: p.path ? path(p.path) : '' }) },
  'files.read': { role: 'admin', human: true, params: (p) => ({ path: path(p.path) }) },
  'files.download': { role: 'admin', human: true, params: (p) => ({ path: path(p.path) }) },
  'app.settings': { role: 'admin', human: true, params: (p, actor, app) => ({ container: containerOf(app, p.app_id) }) },
  'compose.check': {
    role: 'analyst',
    params: (p) => {
      const content = String(p.content || '');
      if (!content.trim() || content.length > 256000) throw new OpError(400, 'Paste a Compose file (up to 256 KB).');
      const project = String(p.name || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 40) || 'app';
      return { content, project, root: String(p.root || '/srv/apps') };
    },
  },
  'disk.usage': { role: 'analyst', params: () => ({}) },
  'process.list': { role: 'analyst', params: () => ({}) },
  'firewall.status': { role: 'analyst', params: () => ({}) },
  'users.list': { role: 'analyst', params: () => ({}) },
  'schedule.list': { role: 'analyst', params: () => ({}) },
  // The sign-in link would attach this server to whoever opens it: the admin who asked only.
  'remote.tailscale_login': { role: 'admin', human: true, params: () => ({}) },
};

function path(p) {
  const s = String(p || '');
  if (!FULL_PATH.test(s)) throw new OpError(400, 'Give the full path (it starts with /).');
  return s;
}

function containerOf(app, appId) {
  const a = repo.byId(app, 'apps', String(appId || ''));
  if (!a) throw new OpError(404, 'No such app.');
  if (!a.getString('container')) throw new OpError(409, "This app isn't a container, so it has no settings NetSentry can show.");
  return a.getString('container');
}

function store() {
  return $app.store();
}

function theAsset(app, p) {
  const asset = p.asset_id ? repo.byId(app, 'assets', String(p.asset_id)) : require('./server.js').theServer(app);
  if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No server is set up yet.');
  return asset;
}

/** Ask the server something. Who may ask depends on what. */
function request(app, actor, p) {
  const kind = String(p.kind || '');
  const k = KINDS[kind];
  if (!k) throw new OpError(400, `kind must be one of: ${Object.keys(KINDS).join(', ')}.`);
  if (k.human && actor.type === 'agent') throw new OpError(403, `"${kind}" is for people only — the agent never reads file contents or settings.`);
  if (actor.type === 'user' && (LEVEL[actor.role] || 0) < LEVEL[k.role]) throw new OpError(403, `Only an ${k.role} can see this.`);
  const asset = theAsset(app, p);
  const params = k.params(p, actor, app);
  const id = $security.randomString(16);
  const queue = (store().get(`reads:${asset.id}`) || []).filter((r) => r.expires > Date.now()).slice(-9);
  queue.push({ id, kind, params, expires: Date.now() + TTL_MS });
  store().set(`reads:${asset.id}`, queue);
  store().set(`readpending:${id}`, { asset: asset.id, kind, who: actor.type === 'agent' ? 'agent' : actor.id, expires: Date.now() + TTL_MS });
  store().set(`watch:${asset.id}`, Date.now() + 60000);
  return { ok: true, request_id: id, asset_id: asset.id };
}

/** What the monitor gets at check-in (and the queue empties). */
function requestsFor(assetId) {
  const queue = (store().get(`reads:${assetId}`) || []).filter((r) => r.expires > Date.now());
  store().set(`reads:${assetId}`, []);
  return queue.map((r) => ({ id: r.id, kind: r.kind, params: r.params }));
}

function waiting(assetId) {
  return (store().get(`reads:${assetId}`) || []).some((r) => r.expires > Date.now());
}

/** The monitor's answer (sensor op): only for a request made for its own server. */
function reply(app, actor, p) {
  const sensor = repo.byId(app, 'sensors', actor.id);
  if (!sensor) throw new OpError(403, 'Not a monitor.');
  const id = String(p.request_id || '');
  const pending = store().get(`readpending:${id}`);
  if (!pending || pending.asset !== sensor.getString('asset')) throw new OpError(404, 'No such request for this server.');
  let result = null;
  if (p.result) {
    try {
      result = typeof p.result === 'string' ? JSON.parse(p.result) : p.result;
    } catch (_) {
      result = null;
    }
  }
  store().set(`readreply:${id}`, { who: pending.who, kind: pending.kind, result, error: String(p.error || '').slice(0, 400), at: new Date().toISOString(), expires: Date.now() + TTL_MS });
  store().remove(`readpending:${id}`);
  return { ok: true };
}

/** The answer, once the monitor sent it — only to whoever asked. */
function result(app, actor, p) {
  const id = String(p.request_id || '');
  const r = store().get(`readreply:${id}`);
  const who = actor.type === 'agent' ? 'agent' : actor.id;
  if (!r || r.expires < Date.now()) {
    const pending = store().get(`readpending:${id}`);
    if (pending && pending.who !== who) throw new OpError(404, 'No such request.');
    return { ok: true, ready: false };
  }
  if (r.who !== who) throw new OpError(404, 'No such request.');
  return { ok: true, ready: true, kind: r.kind, result: r.result, error: r.error, at: r.at };
}

module.exports = { KINDS, request, requestsFor, waiting, reply, result };
