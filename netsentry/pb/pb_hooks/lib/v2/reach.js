/**
 * Reachability (plan §19) — pure. Who can connect to an app endpoint, and
 * along which path. P0 models the listening address and the router's port
 * forwards; the host firewall is recorded as "not checked yet" so a verdict
 * never claims more certainty than NetSentry has (it only ever over-reports).
 *
 * endpoint:  { bind, port, proto }
 * machine:   { name, addresses: [{ ip, loopback, primary }] }
 * router:    { igd, mappings, remote: { tailscale, serve, cloudflared, vpn } } (observations)
 *
 * Safe remote access (plan §17) counts as its own vantage, "private_remote"
 * (your own devices when away): Tailscale and VPNs. Tailscale Funnel and
 * Cloudflare Tunnel hostnames publish to the internet.
 */
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const ALL = ['0.0.0.0', '::', '*', '[::]', ''];

/** "TP-Link Archer C7"; the maker is not repeated when the model name already starts with it. */
function routerName(d) {
  const maker = String(d.manufacturer || '').trim();
  const model = String(d.model || d.name || '').trim();
  if (!maker) return model;
  if (!model) return maker;
  return model.toLowerCase().indexOf(maker.toLowerCase()) === 0 ? model : `${maker} ${model}`;
}

/** Tunnels that deliver outside traffic to this port, even when the app only listens on this machine. */
function tunnelPaths(endpoint, remote) {
  const out = [];
  for (const s of (remote && remote.serve) || []) {
    const d = s.data || {};
    if (d.target_port !== endpoint.port) continue;
    out.push({
      vantage: d.funnel ? 'internet' : 'private_remote',
      hops: [{ component: d.funnel ? 'tailscale funnel' : 'tailscale serve', decision: 'allow', detail: `${d.funnel ? 'Tailscale Funnel (public)' : 'Tailscale (your devices)'} → port ${endpoint.port}`, funnel: !!d.funnel }],
    });
  }
  for (const c of (remote && remote.cloudflared) || []) {
    const d = c.data || {};
    if (d.target_port !== endpoint.port) continue;
    out.push({ vantage: 'internet', hops: [{ component: 'cloudflare tunnel', decision: 'allow', detail: `https://${d.hostname} → port ${endpoint.port}`, hostname: d.hostname }] });
  }
  return out;
}

function endpointReach(endpoint, machine, router) {
  const hops = [];
  const vantages = ['this_machine'];
  const bind = endpoint.bind;
  const where = `${bind}:${endpoint.port}`;
  const remote = (router && router.remote) || {};
  const tunnels = tunnelPaths(endpoint, remote);
  const addTunnels = (paths) => {
    for (const t of tunnels) {
      if (vantages.indexOf(t.vantage) < 0) vantages.push(t.vantage);
      paths.push(t);
    }
  };
  if (LOOPBACK.indexOf(bind) >= 0) {
    hops.push({ component: 'listening address', decision: 'this_machine', detail: where });
    const paths = [{ vantage: 'this_machine', hops }];
    addTunnels(paths);
    return { vantages, paths, confidence: 'computed' };
  }
  const own = machine.addresses.filter((a) => !a.loopback).map((a) => a.ip);
  const onNetwork = ALL.indexOf(bind) >= 0 || own.indexOf(bind) >= 0;
  if (!onNetwork) {
    hops.push({ component: 'listening address', decision: 'unknown', detail: where });
    return { vantages, paths: [{ vantage: 'this_machine', hops }], confidence: 'unknown' };
  }
  // On a cloud machine the provider's network decides first (lib/v2/cloudreach.js).
  const cloud = machine.cloud || null;
  const cp = cloud ? require('./cloudreach.js').cloudPaths(endpoint, cloud) : { known: false };
  if (cp.known) {
    const hopsFor = (p) => [{ component: 'listening address', decision: 'network', detail: ALL.indexOf(bind) >= 0 ? `every network of ${machine.name}, port ${endpoint.port}` : where }].concat(p.hops);
    const paths = [{ vantage: 'this_machine', hops: [{ component: 'listening address', decision: 'network', detail: where }] }];
    for (const p of cp.paths) {
      if (vantages.indexOf(p.vantage) < 0) vantages.push(p.vantage);
      paths.push({ vantage: p.vantage, hops: hopsFor(p) });
    }
    addTunnels(paths);
    return { vantages, paths, confidence: 'computed' };
  }
  vantages.push('local_network');
  // The firewall's on/off state is known (device.posture); its rules aren't read yet, so "on" still counts as letting this in.
  const fw = ((machine.obs ? machine.obs('device.posture') : []).find((o) => o.subject === 'firewall') || {}).data || null;
  const fwHop = fw && fw.enabled === false
    ? { component: 'host firewall', decision: 'allow', detail: `off${fw.detail ? ` (${fw.detail})` : ''} — it lets everything in` }
    : fw && fw.enabled === true
      ? { component: 'host firewall', decision: 'not_checked', detail: `on${fw.detail ? ` (${fw.detail})` : ''} — its rules aren't read yet, so NetSentry assumes it lets this in` }
      : { component: 'host firewall', decision: 'not_checked', detail: 'not checked yet' };
  const netHops = [
    { component: 'listening address', decision: 'network', detail: ALL.indexOf(bind) >= 0 ? `every network of ${machine.name}, port ${endpoint.port}` : where },
    fwHop,
  ];
  const paths = [{ vantage: 'local_network', hops: netHops }];
  // On a tailnet or a VPN, whatever listens on every network is reachable from your own devices away.
  const ts = ((remote.tailscale || [])[0] || {}).data;
  if ((ts && ts.running && ALL.indexOf(bind) >= 0) || ((remote.vpn || []).length && ALL.indexOf(bind) >= 0)) {
    vantages.push('private_remote');
    paths.push({ vantage: 'private_remote', hops: [{ component: ts && ts.running ? 'tailscale' : 'vpn', decision: 'allow', detail: ts && ts.running ? `Tailscale (${ts.name || 'your tailnet'})` : 'your VPN' }].concat(netHops) });
  }
  addTunnels(paths);

  // Router forwards that land on this machine and this port.
  const targets = ALL.indexOf(bind) >= 0 ? own : [bind];
  for (const m of router.mappings || []) {
    const d = m.data || {};
    if (!d.enabled || targets.indexOf(d.internal_client) < 0 || d.internal_port !== endpoint.port) continue;
    if (String(d.proto || '').toLowerCase() !== String(endpoint.proto || 'tcp').toLowerCase()) continue;
    const igd = (router.igd || []).find((g) => g.subject === d.router);
    const rd = (igd && igd.data) || {};
    if (vantages.indexOf('internet') < 0) vantages.push('internet');
    paths.push({
      vantage: 'internet',
      hops: [
        { component: 'router forward', decision: 'allow', detail: `internet port ${d.external_port} → ${d.internal_client}:${d.internal_port}`,
          router: routerName(rd), external_ip: rd.external_ip || '', description: d.description || '',
          via_upnp: true, external_port: d.external_port,
          // what a fix needs to remove this exact rule (and put it back)
          router_id: d.router || '', proto: String(d.proto || 'TCP').toUpperCase(), internal_client: d.internal_client, internal_port: d.internal_port },
      ].concat(netHops),
    });
  }
  return { vantages, paths, confidence: 'computed' };
}

/** All endpoints of an app → the union of vantages and every path. */
function appReach(app, machine, router) {
  const vantages = [];
  const paths = [];
  let confidence = 'computed';
  for (const e of app.endpoints || []) {
    const r = endpointReach(e, machine, router);
    for (const v of r.vantages) if (vantages.indexOf(v) < 0) vantages.push(v);
    for (const p of r.paths) paths.push(Object.assign({ endpoint: `${e.bind}:${e.port}` }, p));
    if (r.confidence === 'unknown') confidence = 'unknown';
  }
  return { vantages, paths, confidence };
}

module.exports = { endpointReach, appReach, routerName };
