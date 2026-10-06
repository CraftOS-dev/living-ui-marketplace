/**
 * Cloud checks — what the instance's own cloud says about it, collected by
 * the sensor with the instance identity (no keys): firewall / security-group
 * rules, the provider's threat detection, and who changed the firewall.
 */

const SENSITIVE = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 445: 'SMB', 1433: 'Microsoft SQL Server', 2375: 'Docker API', 2376: 'Docker API (TLS)',
  3306: 'MySQL', 3389: 'Remote Desktop', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 9200: 'Elasticsearch',
  11211: 'Memcached', 27017: 'MongoDB',
};

function isWorld(source) {
  return source === '0.0.0.0/0' || source === '::/0';
}

/** The sensitive ports a rule opens, or ['all'] when it opens every port. */
function openedPorts(rule, sensitive) {
  const lo = Number(rule.from_port) || 0;
  const hi = rule.to_port === undefined || rule.to_port === null ? 65535 : Number(rule.to_port);
  if (rule.proto === 'all' || (lo <= 0 && hi >= 65535)) return ['all'];
  return Object.keys(sensitive).filter((p) => Number(p) >= lo && Number(p) <= hi);
}

const CLD001 = {
  id: 'CLD-001',
  version: 1,
  title: 'Cloud firewall opens a sensitive port to the whole internet',
  category: 'cloud',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['cloud.firewall_rule'],
  params: { ports: SENSITIVE },
  rationale:
    'A security group / firewall rule allowing 0.0.0.0/0 to a database, remote-access or admin port lets anyone on the ' +
    'internet try it — these ports are scanned within minutes of opening. Even if the service on the host is locked ' +
    'down, the cloud firewall is the layer that should say no first.',
  remediation:
    "1. Restrict the rule's source to the addresses that need access (your office / VPN IP), or remove it.\n" +
    "2. For SSH/RDP prefer a bastion, VPN or the provider's session manager instead of an open port.\n" +
    '3. The server monitor re-reads the rules on its next report and confirms.',
  references: [
    'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-group-rules.html',
    'https://cloud.google.com/firewall/docs/firewalls',
    'https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview',
  ],
  evaluate(input) {
    const out = [];
    for (const o of input.obs('cloud.firewall_rule')) {
      const r = o.data;
      if (r.direction !== 'ingress' || !isWorld(r.source)) continue;
      const ports = openedPorts(r, input.params.ports);
      if (!ports.length) continue;
      const all = ports[0] === 'all';
      const names = all ? 'every port' : ports.map((p) => `${input.params.ports[p]} (${p})`).join(', ');
      out.push({
        subject: o.subject,
        title: `${r.group_name || r.group} allows ${r.source} to ${names}`,
        severity: all ? 'critical' : 'high',
        evidence: {
          group: r.group, group_name: r.group_name, protocol: r.proto, from_port: r.from_port, to_port: r.to_port,
          source: r.source, sensitive_ports: all ? 'all' : ports.map(Number),
        },
      });
    }
    return out;
  },
};

const CLD002 = {
  id: 'CLD-002',
  version: 1,
  title: "The cloud provider's threat detection raised an alert",
  category: 'cloud',
  severity: 'high',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['cloud.threat_finding'],
  params: { min_severity: 'medium' },
  rationale:
    'Amazon GuardDuty watches VPC flow, DNS and API activity from outside the instance — it sees things a monitor on the ' +
    'host can miss, such as the instance talking to a crypto-mining pool or its credentials being used elsewhere.',
  remediation:
    '1. Read the finding in the provider console (type and id are in the evidence).\n' +
    "2. Follow the provider's remediation for that finding type.\n" +
    '3. Archive the finding once handled; the next report resolves it here.',
  references: ['https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_finding-types-active.html'],
  evaluate(input) {
    const order = ['low', 'medium', 'high', 'critical'];
    const min = order.indexOf(input.params.min_severity);
    return input
      .obs('cloud.threat_finding')
      .filter((o) => order.indexOf(o.data.severity) >= min)
      .map((o) => ({
        subject: o.subject,
        title: `${o.data.provider === 'aws-guardduty' ? 'GuardDuty' : 'Threat detection'}: ${o.data.title || o.data.type}`,
        severity: o.data.severity,
        evidence: o.data,
      }));
  },
};

const CLD003 = {
  id: 'CLD-003',
  version: 1,
  title: "Someone changed this instance's cloud firewall",
  category: 'cloud',
  severity: 'medium',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['cloud.audit_event'],
  params: {},
  rationale:
    'Firewall changes are how exposure starts — a "temporary" rule opened for debugging and never closed, or an ' +
    'attacker with stolen credentials opening a way in. Knowing who changed what, and when, is the first question in ' +
    'any investigation. A change that opens a port to the internet is raised as high.',
  remediation:
    '1. Confirm the change was intended with the person shown as actor.\n' +
    '2. If not: revert it, and rotate the credentials of that identity.\n' +
    '3. If it opened a port, CLD-001 on this host shows the resulting exposure (same incident).',
  references: ['https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html'],
  evaluate(input) {
    if (input.firstRun) return []; // history before the sensor started is not news
    const out = [];
    for (const s of input.newSignals.filter((x) => x.kind === 'cloud.audit_event')) {
      const e = s.data || {};
      const opensWorld =
        e.event === 'AuthorizeSecurityGroupIngress' && (e.permissions || []).some((p) => (p.sources || []).some(isWorld));
      out.push({
        subject: `${e.event}:${e.group || '-'}:${e.time || s.window_start}`,
        title: `${e.event} on ${e.group || 'a security group'} by ${String(e.actor || 'unknown').split('/').pop()}${opensWorld ? ' — opened to the internet' : ''}`,
        severity: opensWorld ? 'high' : 'medium',
        evidence: e,
      });
    }
    return out;
  },
};

const CLD004 = {
  id: 'CLD-004',
  version: 1,
  title: 'Cloud threat detection is turned off',
  category: 'cloud',
  severity: 'low',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['cloud.detection'],
  params: {},
  rationale:
    "Without the provider's threat detection nobody watches the network and API activity around the instance. It is " +
    'inexpensive for a single instance and needs no agent.',
  remediation: '1. Enable GuardDuty in this region (Console → GuardDuty → Get started).\n2. The next report confirms it.',
  references: ['https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html'],
  evaluate(input) {
    return input
      .obs('cloud.detection')
      .filter((o) => o.data.enabled === false)
      .map((o) => ({ subject: o.subject, title: `${o.data.service} is not enabled in ${o.data.region}`, evidence: o.data }));
  },
};

const CLD005 = {
  id: 'CLD-005',
  version: 1,
  title: "The instance's cloud disk is not encrypted",
  category: 'cloud',
  severity: 'medium',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['cloud.volume'],
  params: {},
  rationale:
    'An unencrypted EBS volume — and every snapshot made from it — can be read by anyone who gets access to the ' +
    'snapshot or the account. Encryption at rest is free, has no measurable performance cost, and is expected by ' +
    'every compliance baseline.',
  remediation:
    '1. Turn on "EBS encryption by default" for the region so new volumes are encrypted.\n' +
    '2. For this volume: snapshot it, copy the snapshot with encryption on, create a volume from the copy and swap it in ' +
    '(a stop/start of the instance).\n3. The next report confirms.',
  references: ['https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html'],
  evaluate(input) {
    return input
      .obs('cloud.volume')
      .filter((o) => o.data.encrypted === false)
      .map((o) => ({ subject: o.subject, title: `Disk ${o.subject} (${o.data.size_gb} GB) is not encrypted at rest`, evidence: o.data }));
  },
};

const CLD006 = {
  id: 'CLD-006',
  version: 1,
  title: 'Instance metadata allows the old token-less protocol (IMDSv1)',
  category: 'cloud',
  severity: 'medium',
  kind: 'state',
  appliesTo: ['host'],
  observes: ['cloud.instance_config'],
  params: {},
  rationale:
    'With IMDSv1 a single server-side request forgery bug in any web app on the instance is enough to read the ' +
    "instance role's credentials (the Capital One breach). IMDSv2 requires a session token that SSRF cannot obtain.",
  remediation:
    '1. Check nothing on the instance uses an old SDK (anything from the last few years supports IMDSv2).\n' +
    '2. Require tokens: aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required\n' +
    '3. The next report confirms.',
  references: ['https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-existing-instances.html'],
  evaluate(input) {
    return input
      .obs('cloud.instance_config')
      .filter((o) => o.data.imds_tokens === 'optional' && o.data.imds_endpoint !== 'disabled')
      .map((o) => ({ subject: o.subject, title: 'Instance metadata accepts token-less (IMDSv1) requests', evidence: o.data }));
  },
};

module.exports = [CLD001, CLD002, CLD003, CLD004, CLD005, CLD006];
