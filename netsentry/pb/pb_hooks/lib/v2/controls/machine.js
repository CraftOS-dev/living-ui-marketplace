/**
 * Machine checks: remote login, firewall, OS security updates, disk space,
 * and whether NetSentry's monitor is still reporting. Pure evaluators.
 */
const { vantageWords, widest } = require('../intent.js');
const { day, span, plural } = require('../content.js');
const { diskName } = require('./util.js');

function one(machine, kind, subject) {
  return machine.obs(kind).find((o) => (subject ? o.subject === subject : true)) || null;
}

// ------------------------------------------------------------------ SSH

const sshPassword = {
  id: 'HST-SSH-PASSWORD',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: 'Remote login (SSH) accepts passwords',
  appliesTo: (m) => !!one(m, 'host.ssh_config', 'sshd'),
  evaluate(m) {
    const cfg = one(m, 'host.ssh_config', 'sshd').data || {};
    const listener = m.obs('host.listener').find((l) => l.data && l.data.port === 22 && l.data.proto === 'tcp');
    if (!listener) return { state: 'not_applicable', reason: 'no remote login (SSH) server is running', facts: {} };
    const reach = m.sshReach || { vantages: ['this_machine'] };
    const facts = { root: cfg.permit_root_login === 'yes', widest: widest(reach.vantages) };
    const evidence = { config: cfg, reach };
    if (!cfg.password_authentication && !cfg.kbd_interactive) return { state: 'pass', facts, evidence };
    const internet = reach.vantages.indexOf('internet') >= 0;
    const network = reach.vantages.indexOf('local_network') >= 0;
    return {
      state: 'fail',
      severity: internet ? 'critical' : network ? 'high' : 'low',
      factors: ['password guessing works', internet ? 'reachable from the internet' : network ? 'reachable on your network' : 'only on this server'].concat(facts.root ? ['root can log in'] : []),
      facts,
      evidence,
    };
  },
  text: {
    title: (f, m) => `Remote login (SSH) to ${m.name} accepts passwords`,
    saw: (f, m, ctx) =>
      [`${m.name}'s remote login (SSH) lets people sign in with a password.`, `It can be reached by ${vantageWords(f.widest, ctx.place)}.`].concat(
        f.root ? ['Signing in directly as the all-powerful "root" user is allowed too.'] : [],
      ),
    means: (f, m) =>
      `Anyone who can reach it can keep guessing passwords; one weak or reused password gives them full control of ${m.name}. Keys can't be guessed.`,
    steps: (f, m) => ({
      variant: m.variant,
      list: [
        'On the computer you use to log in, create a key if you have none: ssh-keygen -t ed25519',
        `Copy it to ${m.name}: ssh-copy-id your-user@${m.name} — then check you can log in without a password.`,
        `On ${m.name}, create /etc/ssh/sshd_config.d/10-netsentry.conf containing: PasswordAuthentication no${f.root ? ' and, on its own line, PermitRootLogin prohibit-password' : ''}`,
        'Keep this session open, then check the settings and reload: sudo sshd -t && sudo systemctl reload ssh',
        'In a new window, log in again with your key before closing the old session.',
      ],
    }),
    verify: (f, m) => `NetSentry re-reads ${m.name}'s remote-login settings within 15 minutes.`,
    pass: (f, m) => `Remote login (SSH) to ${m.name} needs a key — passwords are off`,
    unknown: (f, m) => `We couldn't read ${m.name}'s remote-login settings`,
    notApplicable: (f, m) => `${m.name} has no remote login (SSH) server running`,
  },
  references: ['https://man.openbsd.org/sshd_config#PasswordAuthentication'],
};

// -------------------------------------------------------------- firewall

const firewallOff = {
  id: 'HST-FIREWALL-OFF',
  version: 1,
  outcome: 'security',
  subject: 'machine',
  title: "The server's firewall is off",
  appliesTo: () => true,
  evaluate(m) {
    const fw = one(m, 'device.posture', 'firewall');
    if (!fw || fw.data.enabled === null || fw.data.enabled === undefined) {
      return { state: 'unknown', reason: 'no firewall program we can read was found', facts: {} };
    }
    const facts = { detail: String(fw.data.detail || '') };
    if (fw.data.enabled) return { state: 'pass', facts, evidence: fw.data };
    return { state: 'fail', severity: 'medium', factors: ['firewall off'], facts, evidence: fw.data };
  },
  text: {
    title: (f, m) => `${m.name}'s firewall is off`,
    saw: (f, m) => [`${m.name} reports its firewall as off${f.detail ? ` (${f.detail.replace(/^Off for: /, 'for: ')})` : ''}.`],
    means: (f, m) => `Any program on ${m.name} that starts accepting connections is open to the whole network straight away, with nothing in front of it.`,
    steps: (f, m) => ({
      variant: m.variant,
      list:
        m.variant === 'windows_gui'
          ? ['Open Windows Security → Firewall & network protection.', 'Turn the firewall on for Domain, Private and Public networks.']
          : m.variant === 'rhel_family'
            ? ['sudo systemctl enable --now firewalld', 'sudo firewall-cmd --list-all  (check the services you need are listed)']
            : ['sudo ufw allow OpenSSH  (keeps remote login working)', 'sudo ufw enable', 'Note: ports published by Docker skip ufw — NetSentry checks those separately.'],
    }),
    verify: (f, m) => `NetSentry re-reads ${m.name}'s firewall state within the hour.`,
    pass: (f, m) => `${m.name}'s firewall is on`,
    unknown: (f, m) => `We couldn't read ${m.name}'s firewall`,
  },
  references: [],
};

// ------------------------------------------------------------ OS updates

const osSecurity = {
  id: 'UPD-OS-SECURITY',
  version: 1,
  outcome: 'updates',
  subject: 'machine',
  title: 'Operating-system security updates are waiting',
  appliesTo: () => true,
  evaluate(m) {
    const u = one(m, 'host.package_updates', 'security');
    if (!u) return { state: 'unknown', reason: "we can't read pending updates on this system yet", facts: {} };
    const n = Number(u.data.security || 0);
    const facts = { count: n, total: u.data.total, manager: u.data.manager, critical: Number(u.data.critical || 0), last_install: u.data.last_install || '' };
    if (n === 0) return { state: 'pass', facts, evidence: u.data };
    return { state: 'fail', severity: n >= 20 ? 'high' : 'medium', factors: [plural(n, 'security update') + ' waiting'], facts, evidence: u.data };
  },
  text: {
    title: (f, m) => `${m.name} has ${plural(f.count, 'security update')} waiting`,
    saw: (f, m) =>
      [`${plural(f.count, 'security update')} for ${m.name}'s operating system ${f.count === 1 ? 'is' : 'are'} ready to install${f.total ? ` (${f.total} updates in total)` : ''}.`]
        .concat(f.critical ? [`${plural(f.critical, 'of them is', 'of them are')} rated critical by Microsoft.`] : [])
        .concat(f.last_install ? [`Updates were last installed on ${day(f.last_install)}.`] : []),
    means: () => 'Security updates close holes that are already public. Until they are installed, anything that reaches this server can try them.',
    steps: (f, m) => ({
      variant: f.manager === 'windows_update' ? 'windows_gui' : f.manager === 'dnf' ? 'rhel_family' : 'ubuntu_debian',
      list:
        f.manager === 'windows_update'
          ? [`On ${m.name}, open Settings → Windows Update.`, 'Select "Check for updates", then install everything it offers.', 'Restart when Windows asks.']
          : f.manager === 'dnf'
          ? ['sudo dnf upgrade --security -y', 'Reboot if the kernel was updated: sudo needs-restarting -r || sudo reboot']
          : ['sudo apt update && sudo apt upgrade -y', 'Reboot if asked: [ -f /var/run/reboot-required ] && sudo reboot', 'To have this happen by itself: sudo apt install unattended-upgrades'],
    }),
    verify: (f, m) => `NetSentry checks ${m.name}'s pending updates every 6 hours and after "Check now".`,
    pass: (f, m) => `${m.name} has no security updates waiting`,
    unknown: (f, m) => `We can't tell whether ${m.name} has security updates waiting`,
  },
  references: [],
};

// ---------------------------------------------------------------- monitor

const monitorSilent = {
  id: 'NS-MONITOR-SILENT',
  version: 1,
  outcome: 'self',
  subject: 'machine',
  title: "NetSentry's monitor stopped reporting",
  appliesTo: (m) => !!m.sensor,
  evaluate(m) {
    const s = m.sensor;
    const facts = { last_seen: s.last_seen || '' };
    if (s.revoked) return { state: 'not_applicable', reason: 'the monitor was removed', facts };
    if (s.online) return { state: 'pass', facts, evidence: { last_seen: s.last_seen } };
    return { state: 'fail', severity: 'high', factors: ['nothing on this server is being checked'], facts, evidence: { last_seen: s.last_seen } };
  },
  text: {
    title: (f, m) => `NetSentry lost contact with ${m.name}`,
    saw: (f, m, ctx) => [f.last_seen ? `The monitor on ${m.name} last reported ${span(f.last_seen, ctx.now)} ago (${day(f.last_seen)}).` : `The monitor on ${m.name} has never reported.`],
    means: (f, m) => `Nothing on ${m.name} is being checked right now. The server may be off, or the monitor stopped — or someone stopped it.`,
    steps: (f, m) => ({
      variant: m.variant,
      list:
        m.variant === 'windows_gui'
          ? [`Check ${m.name} is on and connected.`, 'Start the NetSentry monitor again (the command from Settings → Monitor).']
          : [`Check ${m.name} is on and connected.`, 'See the monitor: sudo systemctl status netsentry-monitor', 'Start it again: sudo systemctl restart netsentry-monitor'],
    }),
    verify: (f, m) => `This turns green the moment the monitor on ${m.name} reports again.`,
    pass: (f, m) => `The monitor on ${m.name} is reporting`,
    unknown: (f, m) => `We don't know yet whether ${m.name}'s monitor is reporting`,
  },
  references: [],
};

// ------------------------------------------------------------ disk space

const FULL_PCT = 95;
const SOON_DAYS = 7;

/** Least-squares growth of used bytes per day over the samples; null without enough spread. */
function growthPerDay(samples) {
  if (samples.length < 2) return null;
  const t0 = Date.parse(samples[0].at);
  const xs = samples.map((s) => (Date.parse(s.at) - t0) / 86400000);
  const ys = samples.map((s) => s.used);
  // Less than a day of history: one big copy would look like a trend (seen in the lab loading images).
  if (xs[xs.length - 1] - xs[0] < 1) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den ? num / den : null;
}

const fullSoon = {
  id: 'STO-FULL-SOON',
  version: 1,
  outcome: 'storage',
  subject: 'filesystem',
  title: 'A disk is full or filling up',
  appliesTo: () => true,
  evaluate(fsys) {
    const samples = fsys.samples;
    if (!samples.length) return { state: 'unknown', reason: 'no disk usage reported yet', facts: {} };
    const last = samples[samples.length - 1];
    const pct = Math.round((last.used / last.total) * 100);
    const perDay = growthPerDay(samples);
    const daysLeft = perDay && perDay > 0 ? last.free / perDay : null;
    const facts = { pct, free_gb: Math.round(last.free / 1e8) / 10, days_left: daysLeft === null ? null : Math.max(0, Math.round(daysLeft)), mount: fsys.mount };
    const evidence = { latest: last, growth_bytes_per_day: perDay, samples: samples.length };
    if (pct >= FULL_PCT) return { state: 'fail', severity: pct >= 98 ? 'high' : 'medium', factors: [`${pct}% full`], facts: Object.assign(facts, { full: true }), evidence };
    if (daysLeft !== null && daysLeft < SOON_DAYS) {
      return { state: 'fail', severity: daysLeft < 2 ? 'high' : 'medium', factors: [`full in about ${plural(facts.days_left, 'day')}`], facts, evidence };
    }
    return { state: 'pass', facts, evidence };
  },
  text: {
    title: (f, fsys) => (f.full ? `${cap(diskName(f.mount))} on ${fsys.machine} is ${f.pct}% full` : `${cap(diskName(f.mount))} on ${fsys.machine} will be full in about ${plural(f.days_left, 'day')}`),
    saw: (f, fsys) =>
      [`${cap(diskName(f.mount))} is ${f.pct}% used — ${f.free_gb} GB free.`].concat(f.days_left !== null ? [`At the rate it filled recently, it runs out in about ${plural(f.days_left, 'day')}.`] : []),
    means: (f, fsys) => `When a disk fills up, apps on ${fsys.machine} stop saving: downloads fail, databases can break and backups stop.`,
    steps: (f, fsys) => ({
      variant: 'storage',
      list: [
        `See what uses the space: sudo du -xh --max-depth=2 ${f.mount} | sort -h | tail -20`,
        'Delete or move what you no longer need (old downloads, finished media, logs).',
        'Docker keeps old images and build cache: docker system df, then docker image prune -a',
      ],
    }),
    verify: (f, fsys) => `NetSentry measures ${diskName(f.mount)} every 15 minutes; this turns green when there's room again.`,
    pass: (f, fsys) => `${cap(diskName(f.mount))} on ${fsys.machine}: ${f.pct}% used`,
    unknown: (f, fsys) => `We haven't measured ${diskName(fsys.mount)} on ${fsys.machine} yet`,
  },
  references: [],
};

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { controls: [sshPassword, firewallOff, osSecurity, monitorSilent, fullSoon], growthPerDay };
