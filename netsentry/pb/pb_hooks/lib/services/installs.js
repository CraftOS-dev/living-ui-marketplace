/**
 * Install an app (v3 plan §12): pick the version (the newest release, pinned),
 * a free port, the address it is published on (the machine's own address for
 * "people at home", 127.0.0.1 for "only this machine"), render the template,
 * and prepare the change an admin confirms. When the new app shows up,
 * NetSentry already knows who should reach it, and offers its setup link.
 */
const repo = require('../infra/repo.js');
const { createHttp } = require('../infra/http.js');
const images = require('../v2/images.js');
const { TEMPLATES, newestRelease } = require('../v2/install.js');
const { OpError } = require('../core/util.js');

const DEFAULT_ROOT = '/srv/apps';

function list() {
  return {
    ok: true,
    templates: Object.keys(TEMPLATES).map((id) => {
      const t = TEMPLATES[id];
      return { id, name: t.name, category: t.category, port: t.port, needs: t.needs || [], host_network: !!t.hostNetwork, catalogue: t.catalogue };
    }),
  };
}

/** Resolve "newest-3" / "newest-major-apache" to a real tag from the registry; fixed tags stay as they are. */
function resolveTags(t, http) {
  const out = {};
  const updates = require('./updates.js');
  for (const repoName of Object.keys(t.images)) {
    const want = t.images[repoName];
    if (want.indexOf('newest-') !== 0) {
      out[repoName] = want;
      continue;
    }
    const ref = images.parseRef(`${repoName}:latest`);
    const found = updates.lookup(http || createHttp(), Object.assign({}, ref, { tag: want === 'newest-3' ? '1.0.0' : '1' }));
    const tag = want === 'newest-3' ? newestRelease(found.tags, 3) : newestRelease(found.tags, 1, '-apache');
    if (!tag) throw new OpError(502, `Couldn't find a current release of ${repoName} — try again in a minute.`);
    out[repoName] = tag;
  }
  return out;
}

function addressesOf(app, assetId) {
  return repo.find(app, 'observations', 'asset = {:a} && kind = "host.address" && present = true', { a: assetId }).map((o) => ({ ip: o.getString('subject'), d: repo.jsonOf(o, 'data') || {} }));
}

function freePort(app, assetId, want) {
  const used = {};
  for (const l of repo.find(app, 'observations', 'asset = {:a} && kind = "host.listener" && present = true', { a: assetId })) used[(repo.jsonOf(l, 'data') || {}).port] = true;
  for (const c of repo.find(app, 'observations', 'asset = {:a} && kind = "container" && present = true', { a: assetId })) {
    for (const p of (repo.jsonOf(c, 'data') || {}).ports || []) used[p.host_port] = true;
  }
  let port = want;
  while (used[port] && port < want + 200) port++;
  return port;
}

function request(app, actor, p) {
  const t = TEMPLATES[String(p.template || '')];
  if (!t) throw new OpError(404, 'NetSentry doesn’t install that app.');
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset || asset.getString('kind') !== 'host') throw new OpError(404, 'No such server.');
  const project = String(p.name || p.template).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 40) || p.template;
  if (repo.first(app, 'apps', 'asset = {:a} && compose_project = {:p} && status = "active"', { a: asset.id, p: project })) throw new OpError(409, `Something called ${project} already runs there — pick another name.`);
  const reach = p.reach === 'this_machine' ? 'this_machine' : 'local_network';
  let bind = '127.0.0.1';
  if (reach === 'local_network') {
    const addr = addressesOf(app, asset.id).filter((a) => !a.d.loopback && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.ip));
    const primary = addr.find((a) => a.d.primary) || addr[0];
    if (!primary) throw new OpError(409, "NetSentry doesn't know this server's local-network address yet.");
    bind = primary.ip;
  }
  if ((t.needs || []).indexOf('data_root') >= 0 && !/^\//.test(String(p.data_root || ''))) throw new OpError(400, `${t.name} needs the folder with your media (the full path, e.g. /srv/data).`);
  const port = freePort(app, asset.id, Number(p.port) || t.port);
  const o = {
    project, bind, port, puid: Number(p.puid) || 1000, pgid: Number(p.pgid) || 1000, tz: String(p.tz || 'Etc/UTC').replace(/[^A-Za-z0-9_/+-]/g, '') || 'Etc/UTC',
    data_root: String(p.data_root || '').replace(/\/+$/, ''), tags: resolveTags(t),
  };
  const rendered = t.render(o);
  const params = {
    template: p.template, app: t.name, project, root: String(p.root || DEFAULT_ROOT), bind, probe_port: t.hostNetwork ? t.port : port,
    data_roots: o.data_root ? [o.data_root] : [], spec: { services: rendered.services, volumes: rendered.volumes || {} },
    secrets: rendered.secrets || [], files: rendered.files || [], dirs: rendered.dirs || [], primary: rendered.primary,
    setup: rendered.setup, reach, intent_reach: reach,
  };
  const r = require('./updates.js').createChange(app, actor, null, 'app.install', params, 'install', asset);
  const url = `http://${t.hostNetwork ? (bind === '127.0.0.1' ? '127.0.0.1' : bind) : bind}:${params.probe_port}${rendered.setup || '/'}`;
  r.preview.notes = (rendered.notes || []).concat([`When it runs: finish its first-time setup at ${url}`]);
  r.preview.keeps = [`Folder: ${params.root}/${project} · published on ${bind}:${params.probe_port} only${o.data_root ? ` · sees ${o.data_root}` : ''}`];
  r.setup_url = url;
  return r;
}

/** A new app appeared: if NetSentry installed it, it already knows who should reach it. */
function adopt(app, appRec) {
  const project = appRec.getString('compose_project');
  if (!project) return;
  const rem = repo.first(app, 'remediations', 'purpose = "install" && status = "done" && asset = {:a}', { a: appRec.getString('asset') }, '-created');
  const step = rem ? ((repo.jsonOf(rem, 'plan') || {}).steps || [])[0] : null;
  if (!step || step.params.project !== project) return;
  // The install is this app's first change: it shows in its own history (v4 walk: "No changes yet").
  if (!rem.getString('app')) repo.update(app, rem, { app: appRec.id });
  if (repo.first(app, 'intents', 'app = {:a}', { a: appRec.id })) return;
  repo.create(app, 'intents', { app: appRec.id, reach: step.params.intent_reach || 'local_network', source: 'template', set_by: `install (${rem.getString('requested_by')})`, set_at: repo.nowIso() });
  if (!appRec.getString('owner') && rem.getString('approved_by')) repo.update(app, appRec, { owner: rem.getString('approved_by') });
  // v4 §7.4: an app installed from a pasted Compose file is called what the person called it
  if (step.params.template === 'custom' && step.params.app && !appRec.getString('label')) repo.update(app, appRec, { label: String(step.params.app).slice(0, 80) });
}

module.exports = { list, request, adopt, resolveTags };
