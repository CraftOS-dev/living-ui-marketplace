/**
 * PURE — the everyday-language version of every check, for people without
 * network or IT knowledge (the "Simple" view). The rule's own title,
 * rationale and remediation stay the technical version ("Detailed" view, the
 * agent). One entry per rule id:
 *
 *   title(ctx) → one sentence saying what is wrong, in plain words
 *   means      → what it means for you (why you should care)          — text, or (ctx) → text
 *   steps      → what to do, as short steps a non-expert can follow   — list, or (ctx) → list
 *
 * ctx = { subject, evidence, on } where `on` is the item's name.
 */

const e = (ctx, k) => (ctx.evidence && ctx.evidence[k] !== undefined && ctx.evidence[k] !== null ? ctx.evidence[k] : '');

const KIND_OF_SERVICE = {
  21: 'a file-sharing service (FTP)', 22: 'remote login (SSH)', 23: 'an old remote login service (Telnet)', 135: 'a Windows system service',
  445: 'Windows file sharing', 1433: 'a database', 2375: 'Docker’s control service', 2376: 'Docker’s control service', 3306: 'a database',
  3389: 'Remote Desktop', 5432: 'a database', 5900: 'screen sharing (VNC)', 6379: 'a database', 9200: 'a database', 11211: 'a database',
  27017: 'a database',
};
const service = (port) => KIND_OF_SERVICE[Number(port)] || `a service (port ${port})`;

const PLAIN = {
  // ------------------------------------------------------------ outside view
  'HOST-001': {
    title: (c) => `${capital(service(e(c, 'port')))} on ${c.on} accepts connections from other devices`,
    means: (c) =>
      Number(e(c, 'port')) === 445
        ? 'Windows file sharing lets other computers on your network open shared folders and printers. If you do not share anything, it only gives attackers on the same Wi-Fi something to try.'
        : Number(e(c, 'port')) === 135
          ? 'This is a part of Windows that other devices on your network can talk to. It is normal on Windows; the firewall should keep it away from anything outside your home or office.'
          : Number(e(c, 'port')) === 2375
            ? "Docker's control service gives whoever reaches it full control of the server — no password asked. Usually only the server itself needs it."
            : 'Other devices on the same network — or the internet, if the server is exposed — can try to connect to it. Usually only the server itself needs it.',
    steps: (c) =>
      Number(e(c, 'port')) === 445
        ? ['If you do not share folders or printers from this server: open Settings → Network & internet → Advanced network settings → Advanced sharing settings, and turn off "File and printer sharing".', 'If you do share, make sure you only do it on your home or office network, not public Wi-Fi.']
        : Number(e(c, 'port')) === 135
          ? ['Make sure the Windows firewall is on (Windows Security → Firewall & network protection).', 'On public Wi-Fi, set the network to "Public" when Windows asks.', 'That is all — this part of Windows cannot be switched off. Choose "Not a problem — mute" so it stops showing.']
          : Number(e(c, 'port')) === 2375
            ? [
                'Find where Docker is told to listen on the network: "hosts" in /etc/docker/daemon.json, or "-H tcp://0.0.0.0:2375" in its service settings (systemctl cat docker).',
                'Remove the tcp:// entry (keep "unix:///var/run/docker.sock"), then restart Docker: sudo systemctl restart docker. Your apps start again by themselves.',
                'If another computer really needs to control Docker, use SSH instead (DOCKER_HOST=ssh://you@server) — never an open port.',
              ]
            : ['If you do not know why it is there, ask whoever installed it.', 'If only the server itself uses it, make it listen on 127.0.0.1 only (in its own settings), or block the port in the firewall.', 'If other devices need it, allow only those devices in the firewall.'],
  },
  'HOST-002': {
    title: (c) => `Docker opens ${(c.apps && c.apps[e(c, 'container')]) || e(c, 'container') || c.subject} to ${e(c, 'firewall_bypass') === true ? 'every network, past the firewall' : 'every network'}`,
    means: (c) =>
      e(c, 'firewall_bypass') === true
        ? 'Docker publishes this app on every address the server has, and on Linux it does so ahead of the firewall — so closing the port in the firewall does not close it.'
        : 'Docker publishes this app on every address the server has, so every device on the network can reach it.',
    steps: (c) => {
      const name = (c.apps && c.apps[e(c, 'container')]) || e(c, 'container') || 'the app';
      const hp = e(c, 'host_port');
      const cp = e(c, 'container_port') || hp;
      const now = hp ? `"${hp}:${cp}"` : 'its port';
      const want = hp ? `"127.0.0.1:${hp}:${cp}"` : 'the port with 127.0.0.1: in front';
      return [
        `If only this server uses ${name}, publish it on 127.0.0.1 only: in its compose file, under ports, change ${now} to ${want}.`,
        `If other devices need ${name}, put the server’s local-network address in front instead of 127.0.0.1, or put it behind a reverse proxy.`,
        'Recreate the app (docker compose up -d in its folder).',
      ];
    },
  },
  'HOST-003': {
    title: (c) => (c.subject === 'root_login' ? `Anyone can try to log in to ${c.on} as the all-powerful "root" user` : `Remote login to ${c.on} accepts passwords`),
    means: 'Remote login (SSH) with passwords is attacked all day by automated password guessing. Keys are far safer.',
    steps: ['Make sure you can log in with an SSH key first.', 'Then turn off password logins — or let the agent plan it carefully (it keeps your session open).'],
  },
  'HOST-004': {
    title: (c) => `${e(c, 'process') || 'A program'} on ${c.on} started accepting connections from the network`,
    means: 'A program that was not doing this before is now reachable from other devices. Usually it is something new you installed.',
    steps: ['If you know the program, mark it as expected.', 'If not, find out what it is before leaving it running.'],
  },
  'HOST-005': {
    title: (c) => `Someone is guessing passwords on ${c.on}`,
    means: 'There were many failed logins from one address in a short time. That is usually an automated attack.',
    steps: ['Make sure every account on this server has a strong, unique password.', 'Block that address — or let the agent do it.'],
  },
  'HOST-006': {
    title: (c) => (String(c.subject).startsWith('admin:') ? `${String(c.subject).slice(6)} became an administrator on ${c.on}` : String(c.subject).startsWith('key:') ? `A new login key was added on ${c.on}` : `A new user account was created on ${c.on}: ${String(c.subject).replace(/^user:/, '')}`),
    means: 'New accounts and keys are how people get into servers. It is normal when you set one up yourself.',
    steps: ['If you or a colleague created it, confirm it is expected.', 'If not, disable the account or remove the key right away and change your passwords.'],
  },
  'HOST-007': {
    title: (c) => `${c.on} has security updates waiting to be installed`,
    means: 'Updates fix weaknesses that attackers already know about. The longer they wait, the more risk.',
    steps: ['Install the updates (and restart if asked) — or let the agent plan it.'],
  },
  'HOST-008': {
    title: (c) => `An important system file changed on ${c.on}`,
    means: 'These files control who can log in and how the server starts. Updates change them sometimes — attackers do too.',
    steps: ['If you just installed updates or changed settings, confirm it is expected.', 'If not, have someone check the server.'],
  },
  'HOST-009': {
    title: (c) => `A new program was set to start automatically on ${c.on}${e(c, 'name') ? `: ${e(c, 'name')}` : ''}`,
    means: 'Programs that start by themselves keep running after a restart. Installers add these all the time — and so does unwanted software.',
    steps: ['If you just installed this program, confirm it is expected.', 'If you do not recognise it, look it up and remove it if it is unwanted.'],
  },
  'HOST-016': {
    title: (c) => `Someone may have broken into ${c.on}: a login succeeded right after many failed tries`,
    means: 'A password was guessed correctly. Treat the server as possibly taken over until checked.',
    steps: ['Change the password of that account now and sign out all its sessions.', 'Have someone check the server; ask the agent to investigate.'],
  },
  'DEV-001': {
    title: (c) => `The disk of ${c.on} is not encrypted`,
    means: 'If the computer is lost or stolen, anyone can read all its files.',
    steps: ['Windows: turn on BitLocker (or "Device encryption"). Mac: turn on FileVault. Keep the recovery key somewhere safe, not on this server.'],
  },
  'DEV-002': {
    title: (c) => `The firewall on ${c.on} is turned off`,
    means: 'The firewall blocks unwanted connections from the network. Without it, anything listening on the server can be reached.',
    steps: ['Turn the firewall back on in the security settings — or let the agent plan it.'],
  },
  'DEV-004': {
    title: (c) => `Virus protection on ${c.on} is turned off`,
    means: 'Real-time protection stops malware as it arrives. With it off, nothing is watching.',
    steps: ['Turn real-time protection back on (Windows Security → Virus & threat protection).'],
  },
  'RES-002': {
    title: (c) => `NetSentry lost contact with ${c.on}`,
    means: 'The server monitor stopped reporting, so nothing on this server is being checked. The server may be off — or someone stopped the monitor.',
    steps: ['Check that the server is switched on and connected to the internet.', 'On the server, run the monitor’s install command again (Settings → Monitor shows it).'],
  },
  // ------------------------------------------------------------ network
  'NET-001': {
    title: (c) => `${c.on} contacted an address known for malware or attacks`,
    means: 'The address is on security lists used by criminals. A program on this server may be infected.',
    steps: ['Run a full virus scan on this server.', 'Ask the agent to investigate which program did it.'],
  },
  'NET-004': {
    title: (c) => `${c.on} looked up a strange-looking web address`,
    means: 'Malware sometimes uses random-looking names to hide or send data out. It can also be harmless software.',
    steps: ['If this keeps happening, run a virus scan and ask the agent to look into it.'],
  },
  'NET-006': {
    title: (c) => `${c.on} connected somewhere used by crypto-mining or remote-control malware`,
    means: 'Connections like this are typical for malware that uses your computer to mine cryptocurrency or lets someone control it.',
    steps: ['Run a full virus scan.', 'Ask the agent to investigate which program did it.'],
  },
  'NET-007': {
    title: (c) => `${c.subject}${e(c, 'publisher') && e(c, 'publisher') !== 'unknown' ? ` (${e(c, 'publisher')})` : ''} started using the internet on ${c.on}`,
    means: 'NetSentry noticed a program going online for the first time. Almost always it is something you installed or an update.',
    steps: ['If you recognise it, confirm it is expected.', 'If not, search its name online and run a virus scan.'],
  },
  'NET-008': {
    title: (c) => `${c.on} connected to the Tor anonymity network`,
    means: 'Tor hides where traffic goes. Normal if you use the Tor browser — otherwise it can mean software is hiding what it does.',
    steps: ['If you do not use Tor, find out which program did this and run a virus scan.'],
  },
  'NET-009': {
    title: (c) => `An intrusion alarm went off on ${c.on}`,
    means: 'The intrusion-detection software on this server saw something that looks like an attack.',
    steps: ['Ask the agent to look at the alarm and tell you whether it is serious.'],
  },
  // ------------------------------------------------------------ cloud
  'CLD-001': {
    title: (c) => `The cloud firewall lets anyone on the internet reach ${c.on}`,
    means: 'A rule in your cloud account opens a sensitive door to the whole internet.',
    steps: ['Limit the rule to your own addresses — or let the agent plan it.'],
  },
  'CLD-002': { title: (c) => `Your cloud provider raised a security alarm about ${c.on}`, means: 'The provider’s own threat detection saw something suspicious around this server.', steps: ['Ask the agent to look at the alarm and tell you what to do.'] },
  'CLD-003': { title: (c) => `Someone changed the cloud firewall of ${c.on}`, means: 'Firewall changes are how servers get exposed — by mistake or on purpose.', steps: ['Check with your team that the change was intended.'] },
  'CLD-004': { title: (c) => `Your cloud’s threat detection is off (${c.on})`, means: 'The cloud provider can watch for attacks on this server, but that is switched off.', steps: ['Turn on GuardDuty in your AWS account (small monthly cost).'] },
  'CLD-005': { title: (c) => `A cloud disk of ${c.on} is not encrypted`, means: 'Copies and backups of this disk can be read by anyone who gets hold of them.', steps: ['Let the agent plan encrypting it (needs a short restart).'] },
  'CLD-006': { title: (c) => `${c.on} uses an older, riskier cloud setting`, means: 'An old way of reading this server’s cloud credentials is still allowed; a single website bug could leak them.', steps: ['Let the agent plan switching it to the newer setting.'] },
  // ------------------------------------------------------------ web & code
  'CODE-001': {
    title: (c) => `A password or key is written into your code (${e(c, 'project') || c.on})`,
    means: 'Anyone who sees the code can use it. Removing it is not enough — it must be changed.',
    steps: ['Change (rotate) that password or key where it was issued.', 'Then move it out of the code into a setting.'],
  },
  'CODE-002': {
    title: (c) => `A building block of your software has a known security hole (${e(c, 'package') || c.subject})`,
    means: 'Your project uses a library with a publicly known weakness.',
    steps: ['Update it to the fixed version shown in the details, then test and redeploy — or let the agent plan it.'],
  },
};

function capital(s) {
  const t = String(s || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const val = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/** Plain title for a finding; null when the rule has no plain version. */
function titleFor(ruleId, ctx) {
  const p = PLAIN[ruleId];
  if (!p) return null;
  try {
    return String(p.title(ctx)).replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  } catch (_) {
    return null;
  }
}

function explain(ruleId, ctx) {
  const p = PLAIN[ruleId];
  if (!p) return null;
  const c = ctx || { subject: '', evidence: {}, on: '' };
  try {
    return { means: val(p.means, c), steps: val(p.steps, c) };
  } catch (_) {
    return null;
  }
}

module.exports = { PLAIN, titleFor, explain };
