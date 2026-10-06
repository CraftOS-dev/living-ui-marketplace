/**
 * Cloud reachability (plan §19, P4) — pure. On a cloud machine the provider's
 * network decides who can connect, before the machine's own firewall:
 *
 *   internet → public address → route to the internet (AWS: 0.0.0.0/0 → igw-…)
 *            → network ACL (AWS: lowest-numbered matching rule wins)
 *            → security group / firewall rule (any allow from 0.0.0.0/0 or ::/0)
 *   the VPC  → security group / firewall rule allowing the port from a private range or another group
 *
 * cloud (from the monitor's `host.cloud` observations):
 *   { provider, instance: { public_ip, vpc, subnet }, rules: [firewall_rule], nacl: [entries], routes: [...],
 *     read: { rules: bool, nacl: bool, routes: bool } }   (read = NetSentry could read that layer)
 */

const WORLD = ['0.0.0.0/0', '::/0'];

function portMatches(r, port, proto) {
  const p = String(r.proto || 'all').toLowerCase();
  if (p !== 'all' && p !== '-1' && p !== String(proto || 'tcp').toLowerCase()) return false;
  return port >= Number(r.from_port || 0) && port <= Number(r.to_port === undefined ? 65535 : r.to_port);
}

/** Security-group / firewall rules that let this port in, split by where from. */
function groupAllows(rules, port, proto) {
  const hits = (rules || []).filter((r) => (r.direction || 'ingress') === 'ingress' && portMatches(r, port, proto));
  return { world: hits.filter((r) => WORLD.indexOf(r.source) >= 0), inside: hits.filter((r) => WORLD.indexOf(r.source) < 0) };
}

/** AWS network ACL: the lowest-numbered inbound entry that matches the port from the internet decides. */
function naclAllowsWorld(entries, port, proto) {
  const inbound = (entries || []).filter((e) => !e.egress && WORLD.indexOf(e.cidr) >= 0 && portMatches(e, port, proto)).sort((a, b) => a.rule - b.rule);
  return inbound.length ? { allow: inbound[0].action === 'allow', entry: inbound[0] } : { allow: false, entry: null };
}

function internetRoute(provider, routes) {
  if (provider !== 'aws') return { ok: true, route: null }; // GCP / Azure: the default route reaches the internet (documented default)
  const r = (routes || []).find((x) => x.destination === '0.0.0.0/0' && String(x.target || '').indexOf('igw-') === 0 && x.state !== 'blackhole');
  return { ok: !!r, route: r || null };
}

/**
 * The cloud paths for one endpoint that already listens on the network.
 * → { known, vantages: [...], paths: [...] }; known=false when NetSentry could not read the cloud network.
 */
function cloudPaths(endpoint, cloud) {
  if (!cloud || !cloud.read || !cloud.read.rules) return { known: false, vantages: [], paths: [] };
  const port = endpoint.port;
  const proto = endpoint.proto || 'tcp';
  const g = groupAllows(cloud.rules, port, proto);
  const vantages = [];
  const paths = [];
  const groupHop = (rs, what) => ({
    component: cloud.provider === 'aws' ? 'security group' : 'cloud firewall',
    decision: 'allow',
    detail: `${rs[0].group_name || rs[0].group} lets ${what} in on port ${port}`,
    group: rs[0].group,
    source: rs[0].source,
    from_port: rs[0].from_port,
    to_port: rs[0].to_port,
    proto: rs[0].proto,
  });
  if (g.inside.length || g.world.length) {
    vantages.push('local_network');
    paths.push({ vantage: 'local_network', hops: [groupHop(g.inside.length ? g.inside : g.world, g.inside.length ? g.inside.map((r) => r.source).join(', ') : 'everyone')] });
  }
  if (g.world.length && cloud.instance && cloud.instance.public_ip) {
    const route = internetRoute(cloud.provider, cloud.routes);
    const nacl = cloud.provider === 'aws' ? naclAllowsWorld(cloud.nacl, port, proto) : { allow: true, entry: null };
    const naclKnown = cloud.provider !== 'aws' || !!(cloud.read && cloud.read.nacl);
    const routeKnown = cloud.provider !== 'aws' || !!(cloud.read && cloud.read.routes);
    // Over-report rather than under-report: a layer we could not read counts as open.
    if ((route.ok || !routeKnown) && (nacl.allow || !naclKnown)) {
      vantages.push('internet');
      const hops = [{ component: 'public address', decision: 'allow', detail: `${cloud.instance.public_ip} → port ${port}` }];
      if (cloud.provider === 'aws') {
        hops.push(route.route
          ? { component: 'route', decision: 'allow', detail: `0.0.0.0/0 → ${route.route.target}` }
          : { component: 'route', decision: 'not_checked', detail: 'route table not readable' });
        hops.push(nacl.entry
          ? { component: 'network acl', decision: 'allow', detail: `rule ${nacl.entry.rule} allows the internet`, acl: nacl.entry.acl }
          : { component: 'network acl', decision: 'not_checked', detail: 'network ACL not readable' });
      }
      hops.push(groupHop(g.world, 'the whole internet'));
      paths.push({ vantage: 'internet', hops });
    }
  }
  return { known: true, vantages, paths };
}

/** The cloud facts for the engine, from `host.cloud` observations (obs(kind) → [{subject, data}]). */
function cloudOf(obs) {
  const inst = (obs('cloud.instance')[0] || {}).data;
  if (!inst) return null;
  const perms = (obs('cloud.permissions')[0] || {}).data || null;
  const checked = (perms && perms.checked) || {};
  const rules = obs('cloud.firewall_rule').map((o) => o.data);
  const aws = inst.provider === 'aws';
  return {
    provider: inst.provider,
    instance: inst,
    rules,
    nacl: obs('cloud.nacl_entry').map((o) => o.data),
    routes: obs('cloud.route').map((o) => o.data),
    snapshots: obs('cloud.snapshot').map((o) => o.data),
    volumes: obs('cloud.volume').map((o) => o.data),
    config: (obs('cloud.instance_config')[0] || {}).data || null,
    permissions: perms,
    read: {
      rules: aws ? !!checked['ec2:DescribeSecurityGroups'] : inst.provider === 'gcp' ? !!checked['compute.firewalls.list'] : !!checked['Microsoft.Network/networkSecurityGroups/read'],
      nacl: aws ? !!checked['ec2:DescribeNetworkAcls'] : true,
      routes: aws ? !!checked['ec2:DescribeRouteTables'] : true,
    },
  };
}

module.exports = { cloudPaths, cloudOf, groupAllows, naclAllowsWorld, internetRoute, WORLD };
