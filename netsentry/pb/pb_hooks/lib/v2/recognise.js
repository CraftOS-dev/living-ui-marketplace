/**
 * App recognition (plan §14.2) — pure. From what one machine's monitor
 * reported (containers, listening programs, HTTP answers) to the apps on it,
 * each with the endpoints people reach it on. Also produces the monitor's
 * next instructions: which endpoints to probe and which config keys to read
 * (the catalogue decides; the monitor only measures).
 *
 * snap: { asset: {id}, obs(kind) → [{ subject, data }] }
 */
const catalogue = require('./catalogue/index.js');

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const ALL = ['0.0.0.0', '::', '*', '[::]', ''];

/** The address the monitor should use to reach an endpoint, as the network sees it when possible. */
function probeHost(bind, addresses) {
  if (LOOPBACK.indexOf(bind) >= 0) return '127.0.0.1';
  if (ALL.indexOf(bind) >= 0) {
    const primary = addresses.find((a) => a.primary && !a.loopback);
    return primary ? primary.ip : '127.0.0.1';
  }
  return bind;
}

function addressesOf(snap) {
  return snap.obs('host.address').map((o) => ({ ip: o.subject, loopback: !!(o.data && o.data.loopback), primary: !!(o.data && o.data.primary) }));
}

/** app.http observations of one endpoint, by path. */
function httpAt(snap, host, port) {
  const prefix = `${host}:${port}/`;
  const out = {};
  for (const o of snap.obs('app.http')) {
    if (o.subject.indexOf(prefix) === 0) out['/' + o.subject.slice(prefix.length)] = o.data || {};
  }
  return out;
}

function recognise(snap) {
  const addresses = addressesOf(snap);
  const apps = [];
  const claimedPorts = {};

  // 1. Containers: the image says what the app is.
  for (const c of snap.obs('container')) {
    const d = c.data || {};
    const entry = catalogue.byImage(d.image);
    if (!entry) continue;
    // The app's usual port when it is published; otherwise every published port (people change ports).
    const usual = (d.ports || []).filter((p) => entry.recognise.containerPorts.indexOf(p.container_port) >= 0);
    const eps = (usual.length ? usual : (d.ports || []).filter((p) => (p.proto || 'tcp') === 'tcp'))
      .map((p) => ({ bind: p.host_ip || '0.0.0.0', port: p.host_port, proto: p.proto || 'tcp', via: 'docker', container_port: p.container_port }));
    for (const e of eps) claimedPorts[`${e.proto}/${e.port}`] = true;
    apps.push({
      key: `${snap.asset.id}|${entry.id}|${d.compose_project ? d.compose_project + '/' + d.compose_service : c.subject}`,
      app_type: entry.id,
      container: c.subject,
      image: d.image || '',
      compose_project: d.compose_project || '',
      compose_service: d.compose_service || '',
      running: d.running !== false,
      mounts: d.mounts || [],
      endpoints: eps,
      recognised_by: [{ signal: 'container_image', value: catalogue.imageRepo(d.image) }],
    });
  }

  // 1b. v4 §7.4: every other container is an app too — what NetSentry knows about any app still applies
  //     (running, logs, settings, updates of its image, reach, backups, Remove). NetSentry's own monitor is not.
  for (const c of snap.obs('container')) {
    const d = c.data || {};
    if (catalogue.byImage(d.image) || (d.labels && d.labels['netsentry.role'] === 'monitor')) continue;
    const eps = (d.ports || []).filter((p) => (p.proto || 'tcp') === 'tcp').map((p) => ({ bind: p.host_ip || '0.0.0.0', port: p.host_port, proto: p.proto || 'tcp', via: 'docker', container_port: p.container_port }));
    for (const e of eps) claimedPorts[`${e.proto}/${e.port}`] = true;
    apps.push({
      key: `${snap.asset.id}|container|${d.compose_project ? d.compose_project + '/' + d.compose_service : c.subject}`,
      app_type: 'container', container: c.subject, image: d.image || '', compose_project: d.compose_project || '', compose_service: d.compose_service || '',
      running: d.running !== false, mounts: d.mounts || [], endpoints: eps,
      recognised_by: [{ signal: 'container', value: catalogue.imageRepo(d.image) || c.subject }],
    });
  }

  // 2. Programs listening directly on the machine (not through Docker).
  for (const l of snap.obs('host.listener')) {
    const d = l.data || {};
    if (claimedPorts[l.subject]) continue;
    const entry = catalogue.byProcess(d.process);
    if (!entry) continue;
    const eps = (d.addresses || [d.address]).map((a) => ({ bind: a, port: d.port, proto: d.proto || 'tcp', via: 'process' }));
    claimedPorts[l.subject] = true;
    apps.push({
      key: `${snap.asset.id}|${entry.id}|port:${d.port}`,
      app_type: entry.id,
      container: '',
      image: '',
      compose_project: '',
      compose_service: '',
      running: true,
      mounts: [],
      endpoints: eps,
      recognised_by: [{ signal: 'process', value: d.process }],
    });
  }

  // 3. Confirm with the app's own answer; read its version from it.
  for (const a of apps) {
    const entry = catalogue.get(a.app_type);
    a.http = {};
    a.version = '';
    for (const e of a.endpoints) {
      e.probe_host = probeHost(e.bind, addresses);
      const http = httpAt(snap, e.probe_host, e.port);
      if (!Object.keys(http).length) continue;
      if (!Object.keys(a.http).length) a.http = http;
      // The app's own answer confirms it (some apps answer differently depending on their settings: `also`).
      for (const q of [entry.recognise.http].concat(entry.recognise.also || [])) {
        const ans = http[q.path];
        if (ans && q.match(ans) && !a.recognised_by.some((r) => r.signal === 'http')) a.recognised_by.push({ signal: 'http', value: q.path });
      }
      if (!a.version) a.version = entry.versionFrom(http);
    }
    if (!a.version && a.image) {
      const tag = String(a.image).split('@')[0].split('/').pop().split(':')[1] || '';
      if (/^\d+(\.\d+)+/.test(tag)) a.version = tag.replace(/^v/, '');
    }
    a.confidence = a.recognised_by.length > 1 ? 'confirmed' : 'likely';
  }
  return apps;
}

/** What the monitor should probe and read next (bounded; only this machine's addresses). */
/** Apps a catalogue entry only claims once the app itself confirmed it (e.g. NetSentry's own console). */
function shown(apps) {
  return apps.filter((a) => !(catalogue.get(a.app_type).recognise.confirmRequired && a.confidence !== 'confirmed'));
}

function instructionsFor(apps) {
  const probe_targets = [];
  const app_config = [];
  for (const a of apps) {
    const entry = catalogue.get(a.app_type);
    // Only the ports that serve its web pages (e.g. not DNS port 53).
    // If none of its ports is a usual web port (the owner moved it), probe what it publishes.
    const web = entry.recognise.webPorts || entry.recognise.containerPorts;
    const usual = a.endpoints.some((e) => web.indexOf(e.container_port || e.port) >= 0);
    for (const e of a.endpoints) {
      if (e.proto !== 'tcp' || !e.probe_host) continue;
      if (usual && web.indexOf(e.container_port || e.port) < 0) continue;
      if (probe_targets.some((t) => t.host === e.probe_host && t.port === e.port)) continue;
      probe_targets.push({ host: e.probe_host, port: e.port, paths: entry.probe });
    }
    for (const cfg of entry.config || []) {
      if (!a.container || cfg.images.every((i) => catalogue.imageRepo(i) !== catalogue.imageRepo(a.image))) continue;
      app_config.push({ app: a.app_type, container: a.container, path: cfg.path, format: cfg.format, keys: cfg.keys });
    }
  }
  return { probe_targets: probe_targets.slice(0, 40), app_config: app_config.slice(0, 40) };
}

module.exports = { recognise, instructionsFor, probeHost, shown };
