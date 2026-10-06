/**
 * Cloud checks for a machine that runs in a cloud network (plan §16.9, §18.4, P4).
 * Facts come from the monitor's `host.cloud` collector, which reads with the
 * instance's OWN identity (no keys). Pure evaluators; `m.cloud` is
 * lib/v2/cloudreach.js cloudOf(), or null off-cloud.
 */
const { plural, day } = require('../content.js');
const { groupAllows } = require('../cloudreach.js');

// Admin and database ports nobody should open to the whole internet.
const SENSITIVE = [
  { port: 22, what: 'remote login (SSH)' },
  { port: 3389, what: 'remote desktop (RDP)' },
  { port: 5432, what: 'PostgreSQL' },
  { port: 3306, what: 'MySQL / MariaDB' },
  { port: 6379, what: 'Redis' },
  { port: 27017, what: 'MongoDB' },
  { port: 9200, what: 'Elasticsearch' },
  { port: 2375, what: 'the Docker engine' },
];

const onCloud = (m) => !!(m.cloud && m.cloud.provider);
const awsOnly = (m) => onCloud(m) && m.cloud.provider === 'aws';
const readable = (m) => !!(m.cloud && m.cloud.read && m.cloud.read.rules);

const adminPortOpen = {
  id: 'CLD-ADMIN-PORT-OPEN',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: "An admin or database port is open to the whole internet in the cloud's firewall",
  appliesTo: onCloud,
  evaluate(m) {
    if (!readable(m)) return { state: 'unknown', reason: "NetSentry can't read this server's cloud firewall yet", facts: {} };
    const open = [];
    for (const s of SENSITIVE) {
      const g = groupAllows(m.cloud.rules, s.port, 'tcp');
      if (g.world.length) open.push({ port: s.port, what: s.what, rule: g.world[0] });
    }
    const facts = { open, public_ip: (m.cloud.instance && m.cloud.instance.public_ip) || '', provider: m.cloud.provider };
    const evidence = { open: open.map((o) => o.rule) };
    if (!open.length) return { state: 'pass', facts, evidence };
    return {
      state: 'fail',
      severity: facts.public_ip ? 'critical' : 'medium',
      factors: open.map((o) => `${o.what} open to the internet`).concat(facts.public_ip ? [] : ['no public address yet']),
      facts,
      evidence,
    };
  },
  text: {
    title: (f, m) => `${m.name}: ${f.open.map((o) => o.what).join(', ')} open to the whole internet`.slice(0, 80),
    saw: (f, m) =>
      f.open
        .map((o) => `The ${f.provider === 'aws' ? 'security group' : 'cloud firewall'} "${o.rule.group_name || o.rule.group}" lets anyone connect to ${o.what} (port ${o.port}).`)
        .concat(f.public_ip ? [`${m.name} has a public address (${f.public_ip}).`] : ['It has no public address today — one added later would expose it at once.']),
    means: (f, m) =>
      `Automated scanners try these ports on every cloud address, all day. One weak password or unpatched hole there gives them ${m.name} and its data. Only you (or your VPN) need to reach them.`,
    steps: (f, m) => {
      const o = f.open[0];
      const g = o.rule.group;
      if (f.provider === 'aws') {
        return {
          variant: 'aws',
          list: [
            `Console: EC2 → Security Groups → ${o.rule.group_name || g} → Inbound rules → Edit: delete the rule for port ${o.port} from 0.0.0.0/0 (and ::/0).`,
            `If you still need it, add it back for your own address only (your IP/32) or your VPN's range — or use AWS Systems Manager Session Manager instead of opening SSH.`,
            `Or with the AWS CLI: aws ec2 revoke-security-group-ingress --group-id ${g} --protocol tcp --port ${o.port} --cidr 0.0.0.0/0`,
            `Or in Terraform: remove the ingress block with from_port = ${o.port} and cidr_blocks = ["0.0.0.0/0"] from aws_security_group, then terraform apply.`,
          ],
        };
      }
      return {
        variant: f.provider,
        list: [
          `In your cloud console, open the firewall rule "${o.rule.group_name || g}" and remove 0.0.0.0/0 as a source for port ${o.port}.`,
          'If you still need it, allow only your own address or your VPN.',
        ],
      };
    },
    verify: (f, m) => `NetSentry re-reads ${m.name}'s cloud firewall within 15 minutes; this turns green when the port is closed to the internet.`,
    pass: (f, m) => `${m.name}: no admin or database port is open to the internet`,
    unknown: (f, m) => `${m.name}: can't read its cloud firewall yet`,
  },
  references: ['https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html', 'https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html'],
};

const imdsV1 = {
  id: 'CLD-IMDS-V1',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: 'The instance metadata service answers without a session token (IMDSv1)',
  appliesTo: awsOnly,
  evaluate(m) {
    const c = m.cloud.config;
    if (!c || !c.imds_tokens) return { state: 'unknown', reason: "NetSentry can't read the instance's settings yet (ec2:DescribeInstances)", facts: {} };
    const facts = { tokens: c.imds_tokens, id: (m.cloud.instance && m.cloud.instance.id) || '' };
    if (c.imds_tokens === 'required' || c.imds_endpoint === 'disabled') return { state: 'pass', facts, evidence: c };
    return { state: 'fail', severity: 'medium', factors: ['session tokens not required'], facts, evidence: c };
  },
  text: {
    title: (f, m) => `${m.name} hands out its cloud credentials without a session token`,
    saw: (f, m) => [`${m.name}'s instance metadata service accepts old-style requests with no session token (HttpTokens: ${f.tokens}).`],
    means: (f, m) =>
      `If any app on ${m.name} can be tricked into fetching a web address for an attacker, it can hand over the server's cloud credentials. Requiring tokens blocks that trick.`,
    steps: (f) => ({
      variant: 'aws',
      list: [
        'Console: EC2 → Instances → this instance → Actions → Instance settings → Modify instance metadata options → IMDSv2: Required.',
        `Or: aws ec2 modify-instance-metadata-options --instance-id ${f.id || '<instance-id>'} --http-tokens required --http-endpoint enabled`,
        'In Terraform: metadata_options { http_tokens = "required" } on the aws_instance.',
      ],
    }),
    verify: (f, m) => `NetSentry re-reads ${m.name}'s settings within 15 minutes.`,
    pass: (f, m) => `${m.name}'s metadata service requires session tokens`,
    unknown: (f, m) => `${m.name}: can't read its metadata settings yet`,
  },
  references: ['https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-existing-instances.html'],
};

const volumeUnencrypted = {
  id: 'CLD-VOLUME-UNENCRYPTED',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: "The server's cloud disk is not encrypted",
  appliesTo: (m) => awsOnly(m) && m.cloud.volumes.length > 0,
  evaluate(m) {
    const plain = m.cloud.volumes.filter((v) => !v.encrypted);
    const facts = { plain: plain.map((v) => v.id), count: m.cloud.volumes.length };
    if (!plain.length) return { state: 'pass', facts, evidence: { volumes: m.cloud.volumes } };
    return { state: 'fail', severity: 'low', factors: [`${plural(plain.length, 'disk')} unencrypted`], facts, evidence: { volumes: m.cloud.volumes } };
  },
  text: {
    title: (f, m) => `${m.name}: ${plural(f.plain.length, 'cloud disk')} not encrypted`,
    saw: (f) => [`Not encrypted: ${f.plain.join(', ')}.`],
    means: (f, m) => `Copies of these disks (snapshots, shared images) can be read by anyone who gets hold of them. Encryption costs nothing and ${m.name} won't notice it.`,
    steps: () => ({
      variant: 'aws',
      list: [
        'Take a snapshot of the disk, copy it with encryption on (Copy snapshot → Encrypt this snapshot), create a new disk from the copy and swap it in during a quiet moment.',
        'Turn on "EBS encryption by default" for the region (EC2 → Settings) so new disks are always encrypted.',
      ],
    }),
    verify: (f, m) => `NetSentry re-reads ${m.name}'s disks within 15 minutes.`,
    pass: (f, m) => `${m.name}'s cloud disks are encrypted`,
    unknown: (f, m) => `${m.name}: can't read its disks yet`,
  },
  references: ['https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html'],
};

const SNAPSHOT_DAYS = 7;
const noSnapshot = {
  id: 'CLD-NO-SNAPSHOT',
  version: 1,
  outcome: 'backups',
  subject: 'machine',
  title: 'No recent snapshot of the server’s cloud disk',
  appliesTo: (m) => awsOnly(m) && m.cloud.volumes.length > 0,
  evaluate(m, ctx) {
    const checked = (m.cloud.permissions && m.cloud.permissions.checked) || {};
    if (checked['ec2:DescribeSnapshots'] === false) return { state: 'unknown', reason: "NetSentry isn't allowed to list snapshots (ec2:DescribeSnapshots)", facts: {} };
    const now = Date.parse(ctx.now);
    const recent = m.cloud.snapshots.filter((s) => s.state !== 'error' && s.started && now - Date.parse(s.started) <= SNAPSHOT_DAYS * 86400000);
    const last = m.cloud.snapshots.map((s) => s.started).filter(Boolean).sort().pop() || '';
    const facts = { last, days: SNAPSHOT_DAYS, volumes: m.cloud.volumes.map((v) => v.id) };
    if (recent.length) return { state: 'pass', facts, evidence: { snapshots: m.cloud.snapshots } };
    return { state: 'fail', severity: 'medium', factors: [last ? `last snapshot ${day(last)}` : 'never snapshotted'], facts, evidence: { snapshots: m.cloud.snapshots } };
  },
  text: {
    title: (f, m) => (f.last ? `${m.name}: no disk snapshot for over ${f.days} days` : `${m.name}'s cloud disk has never been snapshotted`),
    saw: (f) => [f.last ? `The last snapshot was taken ${day(f.last)}.` : `No snapshot exists for ${f.volumes.join(', ')}.`],
    means: (f, m) => `If ${m.name}'s disk is deleted, corrupted or encrypted by ransomware, there is nothing to restore it from.`,
    steps: (f, m) => ({
      variant: 'aws',
      list: [
        'Console: EC2 → Lifecycle Manager (or AWS Backup) → create a daily snapshot policy for this instance, keeping at least 7.',
        `One now: aws ec2 create-snapshot --volume-id ${f.volumes[0] || '<volume-id>'} --description "${m.name} manual"`,
        'Test a restore once: create a disk from a snapshot and look inside.',
      ],
    }),
    verify: (f, m) => `NetSentry looks for new snapshots within 15 minutes.`,
    pass: (f, m) => `${m.name}: its disk was snapshotted in the last ${f.days} days`,
    unknown: (f, m) => `${m.name}: can't list its snapshots`,
  },
  references: ['https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-lifecycle.html'],
};

// What NetSentry's cloud role must be able to read (plan §18.4 permission self-test).
const NEEDED = {
  gcp: ['compute.firewalls.list'],
  azure: ['Microsoft.Compute/virtualMachines/read', 'Microsoft.Network/networkSecurityGroups/read'],
  aws: ['ec2:DescribeSecurityGroups', 'ec2:DescribeInstances', 'ec2:DescribeNetworkAcls', 'ec2:DescribeRouteTables', 'ec2:DescribeVolumes', 'ec2:DescribeSnapshots'],
};

const cloudAccess = {
  id: 'NS-CLOUD-ACCESS',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: "NetSentry can't read everything it needs in the cloud",
  appliesTo: onCloud,
  evaluate(m) {
    const p = m.cloud.permissions;
    if (!p) {
      if (m.cloud.provider !== 'aws') return { state: readable(m) ? 'pass' : 'unknown', reason: 'no permission report', facts: { missing: [] } };
      return { state: 'fail', severity: 'medium', factors: ['no cloud role'], facts: { missing: NEEDED.aws, role: '' } };
    }
    const need = NEEDED[m.cloud.provider] || [];
    const missing = need.filter((x) => p.checked && p.checked[x] === false);
    const facts = { missing, role: p.role || '' };
    if (!missing.length) return { state: 'pass', facts, evidence: p };
    return { state: 'fail', severity: 'low', factors: [`${plural(missing.length, 'permission')} missing`], facts, evidence: p };
  },
  text: {
    title: (f, m) => (f.role ? `NetSentry is missing ${plural(f.missing.length, 'read permission')} on ${m.name}` : `${m.name} has no cloud role for NetSentry to read with`),
    saw: (f) => (f.role ? [`The server's role (${f.role}) is refused: ${f.missing.join(', ')}.`] : ['The server has no IAM role, so NetSentry sees only what the server itself reports.']),
    means: (f, m) => `NetSentry can't tell who the cloud network lets reach ${m.name} — those checks say "can't tell" instead of guessing.`,
    steps: (f) => ({
      variant: 'aws',
      list: [
        f.role
          ? `Add these read-only actions to the role ${f.role}: ${f.missing.join(', ')} (or attach the AWS-managed SecurityAudit policy).`
          : 'Create a role for EC2 with the AWS-managed SecurityAudit policy, attach it to this instance (Actions → Security → Modify IAM role).',
        'Nothing to restart: NetSentry uses the new rights on its next read.',
      ],
    }),
    verify: (f, m) => `NetSentry tries again within 15 minutes.`,
    pass: (f, m) => `NetSentry can read ${m.name}'s cloud network`,
    unknown: (f, m) => `NetSentry hasn't read ${m.name}'s cloud yet`,
  },
  references: ['https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SecurityAudit.html'],
};

const identityTooBroad = {
  id: 'NS-IDENTITY-TOO-BROAD',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: "NetSentry's cloud role can change more than it needs",
  appliesTo: (m) => awsOnly(m) && !!m.cloud.permissions,
  evaluate(m) {
    const p = m.cloud.permissions;
    const facts = { role: p.role || '', executor: !!p.executor_on };
    if (p.write_allowed === null || p.write_allowed === undefined) return { state: 'unknown', reason: "NetSentry couldn't ask AWS (dry run) what its role may change", facts };
    if (!p.write_allowed || p.executor_on) return { state: 'pass', facts, evidence: p };
    return { state: 'fail', severity: 'low', factors: ['can change security groups', 'fixing is off here'], facts, evidence: p };
  },
  text: {
    title: (f, m) => `NetSentry's role on ${m.name} can change your security groups`,
    saw: (f) => [`AWS says the role ${f.role} may change security groups (a dry run, nothing was changed) — but fixing is switched off on this server.`],
    means: (f, m) => `NetSentry only needs to read. If ${m.name} were taken over, those extra rights would let an attacker open your network.`,
    steps: (f) => ({
      variant: 'aws',
      list: [
        `In IAM → Roles → ${f.role || 'the role'}, remove the policies that allow ec2:AuthorizeSecurityGroupIngress / RevokeSecurityGroupIngress (or anything broader), keeping SecurityAudit.`,
        'If you want NetSentry to close ports itself, keep them — and switch fixing on at the server (NETSENTRY_EXECUTOR=on) so they are used on purpose.',
      ],
    }),
    verify: (f, m) => `NetSentry asks AWS again within 15 minutes.`,
    pass: (f, m) => (f.executor ? `NetSentry's role on ${m.name} has fixing rights, and fixing is on` : `NetSentry's role on ${m.name} can only read`),
    unknown: (f, m) => `We can't tell yet what NetSentry's role on ${m.name} may change`,
  },
  references: ['https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege'],
};

module.exports = [adminPortOpen, imdsV1, volumeUnencrypted, noSnapshot, cloudAccess, identityTooBroad];
