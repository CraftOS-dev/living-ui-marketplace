/**
 * Host, device and sensor checks — evaluated on data a NetSentry Sensor reports.
 */

function sum(signals) {
  let n = 0;
  for (const s of signals) n += s.count || 0;
  return n;
}

const HOST001 = {
  id: 'HOST-001',
  version: 1,
  title: 'Sensitive service listening on all network interfaces',
  category: 'host',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['host.listener'],
  params: {
    ports: {
      21: ['FTP', 'high'], 23: ['Telnet', 'high'], 135: ['Windows RPC', 'medium'], 445: ['SMB', 'medium'],
      1433: ['Microsoft SQL Server', 'high'], 2375: ['Docker API (unencrypted)', 'critical'], 3306: ['MySQL', 'high'],
      3389: ['Remote Desktop (RDP)', 'medium'], 5432: ['PostgreSQL', 'high'], 5900: ['VNC', 'high'], 6379: ['Redis', 'high'],
      9200: ['Elasticsearch', 'high'], 11211: ['Memcached', 'high'], 27017: ['MongoDB', 'high'],
    },
  },
  rationale:
    'A database, admin API or remote-access service bound to every interface is reachable from any network the host is ' +
    'on — the internet for a cloud VM with a permissive firewall, or the whole LAN at home. Most of these services only ' +
    'need to listen on localhost.',
  remediation:
    '1. Bind the service to 127.0.0.1 (or a private interface) in its configuration.\n' +
    '2. If other servers need it, restrict access with the host firewall / security group to their addresses.\n' +
    '3. Restart the service; the server monitor’s next report confirms the change.',
  references: [],
  evaluate(input) {
    const out = [];
    for (const o of input.obs('host.listener')) {
      if (o.data.exposure !== 'all') continue;
      const def = input.params.ports[String(o.data.port)];
      if (!def) continue;
      out.push({
        subject: o.subject,
        title: `${def[0]} (port ${o.data.port}) listens on all interfaces${o.data.process ? ' — ' + o.data.process : ''}`,
        severity: def[1],
        evidence: { address: o.data.address, port: o.data.port, protocol: o.data.proto, process: o.data.process || null },
      });
    }
    return out;
  },
};

const HOST002 = {
  id: 'HOST-002',
  version: 1,
  title: 'Docker publishes a port on all interfaces',
  category: 'host',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['container.published_port', 'host.os'],
  params: {},
  rationale:
    'Ports published with `-p 8080:80` bind to 0.0.0.0, and Docker inserts its own firewall rules ahead of ufw/firewalld — ' +
    'so the container is reachable from outside even when the host firewall appears to block it.',
  remediation:
    '1. Publish to localhost instead: `-p 127.0.0.1:8080:80` (or `ports: ["127.0.0.1:8080:80"]` in compose).\n' +
    '2. Put a reverse proxy in front if it must be public.\n3. Recreate the container.',
  references: ['https://docs.docker.com/engine/network/packet-filtering-firewalls/'],
  evaluate(input) {
    // The firewall bypass is a Linux (iptables) behaviour; Docker Desktop on Windows/macOS
    // still exposes the port to the network but through the host firewall — medium there.
    const os = input.obs('host.os')[0];
    const linux = !os || String(os.data.system || '').toLowerCase() === 'linux';
    return input
      .obs('container.published_port')
      .filter((o) => ['', '0.0.0.0', '::'].indexOf(String(o.data.host_ip || '')) >= 0)
      .map((o) => ({
        subject: o.subject,
        title: `Container ${o.data.container} publishes port ${o.data.host_port} on all interfaces${linux ? ' (bypasses the host firewall)' : ''}`,
        severity: linux ? 'high' : 'medium',
        evidence: Object.assign({ firewall_bypass: linux }, o.data),
      }));
  },
};

const HOST003 = {
  id: 'HOST-003',
  version: 1,
  title: 'SSH allows password or root logins',
  category: 'host',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['host.ssh_config'],
  params: {},
  rationale:
    'Internet-facing SSH servers receive constant password-guessing. Key-only authentication makes that useless; ' +
    'disabling direct root login removes the most-targeted account.',
  remediation:
    '1. Make sure your own key login works (keep a session open while changing this).\n' +
    '2. In /etc/ssh/sshd_config set `PasswordAuthentication no` and `PermitRootLogin no` (or prohibit-password).\n' +
    '3. Validate with `sshd -t`, then reload sshd.',
  references: [],
  evaluate(input) {
    const out = [];
    for (const o of input.obs('host.ssh_config')) {
      if (o.data.password_authentication === true) {
        out.push({ subject: 'password_auth', title: 'SSH accepts password logins', evidence: o.data });
      }
      if (o.data.permit_root_login === 'yes') {
        out.push({ subject: 'root_login', title: 'SSH allows root to log in with a password', evidence: o.data });
      }
    }
    return out;
  },
};

const HOST004 = {
  id: 'HOST-004',
  detection: true, // v4: a change to review in Activity, not a problem to fix (plan §20.4)
  askExpected: true,
  version: 2,
  title: 'New program accepting network connections',
  category: 'host',
  severity: 'medium',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['host.listener'],
  params: {},
  rationale:
    'The first report from the server monitor records which programs accept connections from the network. A new one is a change — a deployment, ' +
    'a misconfiguration, or a backdoor.',
  remediation:
    '1. Identify the process (shown in the evidence) and who installed it.\n' +
    '2. If expected, use “Mark current as expected” on the server’s “What we see” tab.\n3. If not, stop it and investigate the server.',
  references: [],
  evaluate(input) {
    const base = input.baseline('listeners');
    if (!base) return [];
    const ok = {};
    for (const s of base) ok[s] = true;
    return input
      .obs('host.listener')
      .filter((o) => o.data.exposure === 'all' && !ok[o.subject])
      .map((o) => ({
        subject: o.subject,
        title: `New listener on all interfaces: ${o.data.proto}/${o.data.port}${o.data.process ? ' (' + o.data.process + ')' : ''}`,
        evidence: o.data,
      }));
  },
};

const HOST006 = {
  id: 'HOST-006',
  detection: true, // activity to review (Activity inbox), not a problem (plan §20.4)
  askExpected: true,
  version: 1,
  title: 'New user, administrator or SSH key',
  category: 'host',
  severity: 'high',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['host.user', 'host.authorized_key'],
  params: {},
  rationale:
    'Creating an account, granting admin rights or adding an SSH key is how attackers keep access to a server. ' +
    'Each one should be traceable to a person on your team.',
  remediation:
    '1. Confirm who made the change and why.\n2. If nobody did: remove the account/key, rotate credentials, and treat the host as compromised.',
  references: [],
  evaluate(input) {
    if (input.firstRun) return [];
    const out = [];
    for (const c of input.changes) {
      if (c.kind === 'host.user' && c.change === 'added') {
        out.push({ subject: 'user:' + c.subject, title: `New user account: ${c.subject}${c.after && c.after.admin ? ' (administrator)' : ''}`, evidence: c.after });
      } else if (c.kind === 'host.user' && c.change === 'modified' && c.after && c.after.admin && !(c.before && c.before.admin)) {
        out.push({ subject: 'admin:' + c.subject, title: `${c.subject} became an administrator`, evidence: { before: c.before, after: c.after } });
      } else if (c.kind === 'host.authorized_key' && c.change === 'added') {
        out.push({ subject: 'key:' + c.subject, title: `New SSH key for ${c.after ? c.after.user : c.subject}`, evidence: c.after });
      }
    }
    return out;
  },
};

const HOST007 = {
  id: 'HOST-007',
  version: 1,
  title: 'Security updates pending for more than a week',
  category: 'host',
  severity: 'low',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['host.package_updates'],
  params: { days: 7 },
  rationale: 'Most intrusions use vulnerabilities that already have a fix. Security updates left pending are open doors with a published map.',
  remediation: '1. Apply the updates (e.g. `sudo apt upgrade`, `sudo dnf upgrade --security`).\n2. Turn on unattended security updates.\n3. Reboot if the kernel was updated.',
  references: [],
  evaluate(input) {
    const o = input.obs('host.package_updates')[0];
    if (!o || !(o.data.security > 0) || !o.first_seen) return [];
    const days = (Date.parse(input.now) - Date.parse(o.first_seen)) / 86400000;
    if (days < input.params.days) return [];
    return [{ subject: 'security', title: `${o.data.security} security update(s) pending for ${Math.floor(days)} days`, evidence: o.data }];
  },
};

const HOST008 = {
  id: 'HOST-008',
  detection: true, // activity to review (Activity inbox), not a problem (plan §20.4)
  askExpected: true,
  version: 1,
  title: 'Critical system file changed',
  category: 'host',
  severity: 'high',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['host.fim'],
  params: {},
  rationale:
    'Files like /etc/passwd, sudoers, sshd_config or the hosts file rarely change outside planned maintenance. An ' +
    'unexplained change is a classic sign of tampering.',
  remediation: '1. Check package-manager and config-management logs for the change.\n2. If unexplained, diff against a known-good copy and investigate the host.',
  references: [],
  evaluate(input) {
    if (input.firstRun) return [];
    return input.changes
      // 'added' matters too: e.g. /etc/ld.so.preload appearing is a classic rootkit hook.
      .filter((c) => c.kind === 'host.fim')
      .map((c) => ({
        subject: c.subject,
        title: `Critical file ${c.change === 'removed' ? 'removed' : c.change === 'added' ? 'appeared' : 'changed'}: ${c.subject}`,
        evidence: { change: c.change, before: c.before, after: c.after },
      }));
  },
};

const HOST009 = {
  id: 'HOST-009',
  detection: true, // activity to review (Activity inbox), not a problem (plan §20.4)
  askExpected: true,
  version: 1,
  title: 'New autostart entry',
  category: 'host',
  severity: 'high',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['host.persistence'],
  params: {},
  rationale:
    'Malware survives reboots by adding itself to cron, systemd, Windows Run keys, scheduled tasks, services or launchd. ' +
    'Legitimate installs do this too — which is why each new entry deserves a look.',
  remediation: '1. Identify the program the entry starts.\n2. If it is not something you installed, disable it, remove the program and investigate the host.',
  references: [],
  evaluate(input) {
    if (input.firstRun) return [];
    return input.changes
      .filter((c) => c.kind === 'host.persistence' && c.change === 'added')
      .map((c) => ({ subject: c.subject, title: `New autostart entry (${c.after.type}): ${c.after.name}`, evidence: c.after }));
  },
};

function postureRule(id, subject, title, severity, rationale, remediation) {
  return {
    id,
    version: 1,
    title,
    category: 'device',
    severity,
    kind: 'state',
    appliesTo: ['host'],
    observes: ['device.posture'],
    params: {},
    rationale,
    remediation,
    references: [],
    evaluate(input) {
      const o = input.obs('device.posture').filter((x) => x.subject === subject)[0];
      if (!o || o.data.enabled !== false) return []; // unknown ≠ off
      return [{ subject, title, evidence: o.data }];
    },
  };
}

const DEV001 = postureRule(
  'DEV-001', 'disk_encryption', 'System disk is not encrypted', 'medium',
  'If the server or its disk is lost, stolen or decommissioned, everything on an unencrypted disk can be read.',
  '1. Windows: turn on BitLocker. macOS: turn on FileVault. Linux: use LUKS (usually at install time).\n2. Store the recovery key somewhere safe — not on the same server.',
);
const DEV002 = postureRule(
  'DEV-002', 'firewall', 'Host firewall is off', 'medium',
  'Without a host firewall every listening service is reachable from any network the server joins.',
  '1. Windows: enable Windows Defender Firewall for all profiles. macOS: enable the application firewall. Linux: enable ufw/firewalld with a default-deny inbound policy.',
);
const DEV004 = postureRule(
  'DEV-004', 'antivirus', 'Real-time malware protection is off', 'medium',
  'Real-time protection blocks known malware at the moment it is written to disk or executed.',
  '1. Turn real-time protection back on (Windows Security → Virus & threat protection).\n2. Find out why it was turned off.',
);

const HOST005 = {
  id: 'HOST-005',
  version: 1,
  title: 'Burst of failed logins',
  category: 'host',
  severity: 'medium',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['auth.failure'],
  params: { window_minutes: 15, threshold: 20 },
  rationale: 'Many failed logins from one source in a short time is password guessing. On its own it is noise; followed by a success it is an intrusion.',
  remediation:
    '1. Block the source (firewall, fail2ban/CrowdSec).\n2. Make sure the targeted service uses keys or MFA, not passwords.\n3. Check whether any login from that source succeeded.',
  references: [],
  evaluate(input) {
    const byKey = {};
    for (const s of input.signals('auth.failure', input.params.window_minutes)) (byKey[s.key] = byKey[s.key] || []).push(s);
    const out = [];
    for (const key of Object.keys(byKey)) {
      const n = sum(byKey[key]);
      if (n >= input.params.threshold) {
        out.push({ subject: key, title: `${n} failed logins from ${key} in ${input.params.window_minutes} minutes`, evidence: { source: key, failures: n } });
      }
    }
    return out;
  },
};

const HOST016 = {
  id: 'HOST-016',
  version: 1,
  title: 'Successful login right after a burst of failures',
  category: 'host',
  severity: 'critical',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['auth.success'],
  params: { lookback_minutes: 60, threshold: 10 },
  rationale: 'A source that failed many times and then got in has most likely guessed a password. Treat the account and the host as compromised until shown otherwise.',
  remediation:
    '1. Disable or reset the account that logged in, and kill its sessions.\n2. Block the source.\n' +
    '3. Look for new users, keys, autostart entries and listeners on the host (NetSentry reports those too).\n4. Rotate credentials that were on the server.',
  references: [],
  evaluate(input) {
    const out = [];
    const failures = {};
    for (const s of input.signals('auth.failure', input.params.lookback_minutes)) failures[s.key] = (failures[s.key] || 0) + (s.count || 0);
    for (const s of input.newSignals.filter((x) => x.kind === 'auth.success')) {
      const n = failures[s.key] || 0;
      if (n >= input.params.threshold) {
        out.push({
          subject: s.key + '|' + (s.data && s.data.user ? s.data.user : ''),
          title: `Login succeeded from ${s.key}${s.data && s.data.user ? ' as ' + s.data.user : ''} after ${n} failures`,
          evidence: { source: s.key, user: s.data ? s.data.user : null, prior_failures: n, at: s.window_start },
        });
      }
    }
    return out;
  },
};

const RES002 = {
  id: 'RES-002',
  version: 1,
  title: 'Server monitor stopped reporting',
  category: 'resilience',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['sensor.status'],
  params: {},
  rationale:
    'A server monitor that stops reporting means the server is down, disconnected — or someone stopped the monitor. Until it is back, ' +
    'nothing on that host is being watched.',
  remediation: '1. Check whether the server is on and connected.\n2. Start the monitor again (Settings → Monitor shows how).\n3. If nobody stopped it, find out who did.',
  references: [],
  evaluate(input) {
    const o = input.obs('sensor.status')[0];
    if (!o || o.data.online !== false || o.data.revoked) return [];
    return [{ subject: 'heartbeat', title: `The server monitor on ${input.asset.identifier} stopped reporting`, evidence: o.data }];
  },
};

module.exports = [HOST001, HOST002, HOST003, HOST004, HOST005, HOST006, HOST007, HOST008, HOST009, HOST016, DEV001, DEV002, DEV004, RES002];
