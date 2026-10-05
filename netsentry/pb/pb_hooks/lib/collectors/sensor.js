/**
 * Collectors that run ON A SENSOR (remote: true). The console never calls
 * collect() for these — the sensor reports their results through
 * sensors.report and the pipeline applies them exactly like a local run.
 * Each declares the observation kinds it fully owns and the signal kinds it
 * may send, which is what the console validates reports against.
 *
 * `sensor.liveness` is the exception: it runs on the console and turns the
 * sensor's check-in time into an observation, so "host went silent" is an
 * ordinary finding (RES-002) with ordinary alerts.
 */

function remote(id, title, kinds, signalKinds, intervalSeconds, extra) {
  return Object.assign(
    {
      id,
      title,
      remote: true,
      appliesTo: ['host'],
      scheduleMinutes: Math.max(5, Math.round(intervalSeconds / 60)),
      intervalSeconds,
      kinds: () => kinds,
      signalKinds,
    },
    extra || {},
  );
}

const REMOTE = [
  remote('host.info', 'Operating system and addresses', ['host.os', 'host.address'], [], 3600),
  remote('host.listeners', 'Listening ports', ['host.listener'], [], 300, {
    // First report becomes the baseline of expected listeners (HOST-004).
    baseline: (observations) => ({
      kind: 'listeners',
      accepted: observations.filter((o) => o.data && o.data.exposure === 'all').map((o) => o.subject).sort(),
    }),
  }),
  remote('host.users', 'Local users and administrators', ['host.user'], [], 900),
  remote('host.ssh', 'SSH server and authorized keys', ['host.ssh_config', 'host.authorized_key'], [], 900),
  remote('host.updates', 'Pending security updates', ['host.package_updates'], [], 21600),
  remote('host.auth', 'Login attempts', [], ['auth.failure', 'auth.success'], 60),
  remote('host.persistence', 'Autostart entries', ['host.persistence'], [], 900),
  remote('host.fim', 'Critical file integrity', ['host.fim'], [], 900),
  remote('host.posture', 'Disk encryption, firewall and antivirus', ['device.posture'], [], 3600),
  remote('host.docker', 'Docker published ports', ['container.published_port'], [], 300),
  remote('host.connections', 'Network connections', ['host.net_process'], ['net.conn'], 60),
  remote('host.dns', 'DNS lookups', [], ['net.dns'], 300),
  remote('host.ids', 'IDS alerts (Suricata / CrowdSec)', [], ['ids.alert'], 60),
  remote('host.cloud', 'Cloud firewall, threat detection and audit trail', ['cloud.instance', 'cloud.instance_config', 'cloud.volume', 'cloud.firewall_rule', 'cloud.threat_finding', 'cloud.detection', 'cloud.nacl_entry', 'cloud.route', 'cloud.snapshot', 'cloud.permissions'], ['cloud.audit_event'], 900),
  remote('host.deps', 'Vulnerable dependencies (opt-in project folders)', ['code.vulnerable_dependency'], [], 21600),
  remote('host.secrets', 'Secrets committed in code (gitleaks)', ['code.secret'], [], 21600),
  // v2 (docs/SYSTEM-V2-PLAN.md §18): apps, their settings, disks, the router, and the apps' own answers.
  remote('host.containers', 'Containers and their apps', ['container', 'container.health'], [], 300),
  remote('host.app_config', 'App settings (only the keys the catalogue lists)', ['app.config'], [], 300),
  remote('host.storage', 'Disk space', ['host.filesystem'], ['storage.usage'], 900),
  remote('probe.router', 'Router port forwards (UPnP)', ['router.igd', 'router.port_mapping'], [], 300),
  remote('probe.apps', 'Apps answering and up', ['app.http', 'endpoint.status'], [], 60),
  remote('host.remote_access', 'Safe remote access (Tailscale, Cloudflare Tunnel, VPN)', ['remote.tailscale', 'remote.tailscale_serve', 'remote.cloudflared', 'remote.vpn'], [], 900),
  // Organisations (plan §4.2 S2–S3): the networks this machine is on; devices only on networks a person confirmed.
  // D12: account lists, only for apps someone gave a read-only key (organisation mode).
  remote('probe.accounts', 'Accounts in your apps (read-only keys)', ['app.account', 'app.accounts_status'], [], 21600),
  // v3 (docs/SYSTEM-V3-PLAN.md §7): is it running well? Numbers become metrics, not change history.
  remote('host.health', 'CPU, memory, uptime and temperature', ['host.health'], ['health.sample'], 60),
  remote('host.container_stats', 'CPU and memory of each app', [], ['container.sample'], 60),
  remote('host.services', 'Services that failed or keep restarting', ['service.problem'], [], 120),
  remote('host.disks', 'Disk health and Docker logs', ['disk.smart', 'disk.raid', 'disk.pool', 'docker.root', 'container.logs'], [], 900),
];

const liveness = {
  id: 'sensor.liveness',
  title: 'Sensor liveness',
  appliesTo: ['host'],
  scheduleMinutes: 5,
  kinds: () => ['sensor.status'],
  collect({ asset }, deps) {
    const s = deps.sensors.forAsset(asset.id);
    if (!s) return { observations: [], note: 'No sensor linked to this host.' };
    return {
      observations: [{ kind: 'sensor.status', subject: 'heartbeat', data: { online: s.online, revoked: s.revoked } }],
      note: s.online ? '' : `Last check-in ${s.last_seen || 'never'}.`,
    };
  },
};

module.exports = { REMOTE, liveness };
