/**
 * Network checks — on sensor signals (new destinations, DNS names, IDS alerts)
 * and the set of programs that talk to the network.
 */

const LIST_NAMES = {
  'spamhaus-drop': 'Spamhaus DROP',
  feodo: 'abuse.ch Feodo Tracker (botnet C2)',
  urlhaus: 'abuse.ch URLhaus (malware distribution)',
};

const NET001 = {
  id: 'NET-001',
  version: 1,
  title: 'Contact with a known-malicious address or domain',
  category: 'network',
  severity: 'high',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['net.conn', 'net.dns'],
  params: {},
  rationale:
    'This host connected to, or looked up, an address or domain that threat-intelligence feeds list as botnet ' +
    'command-and-control or malware distribution. Legitimate software almost never does this.',
  remediation:
    '1. Identify the program (shown in the evidence) and when it started.\n' +
    '2. Isolate the host if the program is unknown, and scan it for malware.\n' +
    '3. Block the destination at the firewall; rotate credentials used on the host.',
  references: ['https://feodotracker.abuse.ch/', 'https://urlhaus.abuse.ch/', 'https://www.spamhaus.org/drop/'],
  evaluate(input) {
    const out = [];
    const seen = {};
    for (const s of input.newSignals) {
      let hits = [];
      if (s.kind === 'net.conn') hits = input.intel.matchIp(s.key);
      else if (s.kind === 'net.dns') hits = input.intel.matchDomain(s.key);
      if (!hits.length || seen[s.key]) continue;
      seen[s.key] = true;
      const lists = hits.map((h) => LIST_NAMES[h.list] || h.list);
      out.push({
        subject: s.key,
        title: `${s.kind === 'net.dns' ? 'Looked up' : 'Connected to'} ${s.key}${s.data && s.data.process ? ' (' + s.data.process + ')' : ''} — listed on ${lists[0]}`,
        evidence: { destination: s.key, kind: s.kind, lists, match: hits.map((h) => h.match), details: s.data },
      });
    }
    return out;
  },
};

function entropy(str) {
  const counts = {};
  for (const c of str) counts[c] = (counts[c] || 0) + 1;
  let h = 0;
  for (const k of Object.keys(counts)) {
    const p = counts[k] / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const NET004 = {
  id: 'NET-004',
  version: 1,
  title: 'DNS name that looks like tunnelling or a generated domain',
  category: 'network',
  severity: 'medium',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['net.dns'],
  params: { max_label: 40, entropy: 4.0, min_len: 25 },
  rationale:
    'Malware smuggles data out through very long DNS labels, and botnets find their servers with randomly generated ' +
    'domain names. Both look unlike the names people and normal software use.',
  remediation: '1. Find which program made the lookup.\n2. If unknown, isolate and scan the host; block the domain.',
  references: [],
  evaluate(input) {
    const out = [];
    for (const s of input.newSignals.filter((x) => x.kind === 'net.dns')) {
      const labels = String(s.key).split('.');
      const longest = labels.reduce((a, b) => (b.length > a.length ? b : a), '');
      const first = labels[0] || '';
      const tunnel = longest.length >= input.params.max_label;
      const generated = first.length >= input.params.min_len && entropy(first) >= input.params.entropy && /\d/.test(first);
      if (!tunnel && !generated) continue;
      out.push({
        subject: s.key,
        title: `${tunnel ? 'Very long DNS label' : 'Random-looking DNS name'}: ${String(s.key).slice(0, 80)}`,
        evidence: { name: s.key, longest_label: longest.length, entropy: Math.round(entropy(first) * 100) / 100 },
      });
    }
    return out;
  },
};

const MINING = {
  3333: 'mining pool (stratum)',
  4444: 'mining pool / Metasploit default',
  5555: 'mining pool',
  7777: 'mining pool',
  14444: 'mining pool',
  14433: 'mining pool (TLS)',
  45700: 'mining pool',
};

const NET006 = {
  id: 'NET-006',
  version: 1,
  title: 'Outbound connection on a mining-pool or backdoor port',
  category: 'network',
  severity: 'high',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['net.conn'],
  params: {},
  rationale:
    'Cryptominers dropped on compromised servers connect to pools on well-known stratum ports; 4444 is also the ' +
    'default port for Metasploit reverse shells.',
  remediation:
    '1. Identify and stop the program.\n2. Look for how it got there (new users, keys, autostart entries).\n3. Rebuild the host if it cannot be explained.',
  references: [],
  evaluate(input) {
    return input.newSignals
      .filter((s) => s.kind === 'net.conn' && s.data && s.data.direction === 'outbound' && MINING[s.data.remote_port])
      .map((s) => ({
        subject: `${s.key}:${s.data.remote_port}`,
        title: `Outbound connection to ${s.key}:${s.data.remote_port} (${MINING[s.data.remote_port]})${s.data.process ? ' by ' + s.data.process : ''}`,
        evidence: s.data,
      }));
  },
};

const NET007 = {
  id: 'NET-007',
  detection: true, // activity to review (Activity inbox), not a problem (plan §20.4)
  version: 1,
  title: 'A program started connecting to the internet for the first time',
  category: 'network',
  severity: 'medium',
  kind: 'event',
  askExpected: true,
  appliesTo: ['host'],
  observes: ['host.net_process', 'net.conn'],
  params: { lookback_minutes: 180 },
  rationale:
    'NetSentry learns which programs on this server talk to the internet. A new one is almost always something you ' +
    'installed or an update — but it is also how unwanted software shows up, so it is worth a quick look. Programs ' +
    'signed by a known publisher are marked low.',
  remediation:
    '1. Look at the file location and publisher below. Software you installed, or part of Windows/macOS/Linux, is expected.\n' +
    '2. If you do not recognise it: search the exact file name online, and run a full scan with your antivirus.\n' +
    '3. If it is unwanted, uninstall it (Windows: Settings → Apps; macOS: move it to the Bin) and change passwords you typed on this server.',
  references: [],
  evaluate(input) {
    if (input.firstRun) return [];
    const dests = {};
    for (const s of input.signals('net.conn', input.params.lookback_minutes)) {
      const p = s.data && s.data.process;
      if (!p || (s.data.direction && s.data.direction !== 'outbound')) continue;
      (dests[p] = dests[p] || []).indexOf(s.key) < 0 && dests[p].length < 5 && dests[p].push(`${s.key}:${s.data.remote_port}`);
    }
    return input.changes
      .filter((c) => c.kind === 'host.net_process' && c.change === 'added')
      .map((c) => {
        const d = c.after || {};
        const trusted = d.signed === true && !!d.publisher;
        return {
          subject: c.subject,
          title: `${c.subject}${d.publisher ? ` (${d.publisher})` : ''} started connecting to the internet`,
          severity: trusted ? 'low' : undefined,
          evidence: {
            program: c.subject,
            file: d.path || 'unknown (run the monitor as Administrator/root to see it)',
            publisher: d.publisher || 'unknown',
            signed: d.signed === true ? 'yes, valid signature' : d.signed === false ? 'NO valid signature' : 'unknown',
            connected_to: dests[c.subject] || [],
          },
        };
      });
  },
};

const NET008 = {
  id: 'NET-008',
  version: 1,
  title: 'Outbound connection on Tor relay ports',
  category: 'network',
  severity: 'medium',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['net.conn'],
  params: { ports: [9001, 9030] },
  rationale: 'Tor hides where traffic goes. On a server it is rarely legitimate and often used by malware for command-and-control.',
  remediation: '1. Identify the program.\n2. If Tor is not intentionally installed, treat the host as compromised.',
  references: [],
  evaluate(input) {
    return input.newSignals
      .filter((s) => s.kind === 'net.conn' && s.data && s.data.direction === 'outbound' && input.params.ports.indexOf(s.data.remote_port) >= 0)
      .map((s) => ({ subject: `${s.key}:${s.data.remote_port}`, title: `Connection to a Tor relay port: ${s.key}:${s.data.remote_port}`, evidence: s.data }));
  },
};

const ENGINE_NAMES = { suricata: 'Suricata', crowdsec: 'CrowdSec', zeek: 'Zeek', falco: 'Falco' };

const NET009 = {
  id: 'NET-009',
  version: 1,
  title: 'Intrusion-detection alert',
  category: 'network',
  severity: 'medium',
  kind: 'event',
  appliesTo: ['host'],
  observes: ['ids.alert'],
  params: {},
  rationale:
    'An intrusion-detection engine on the host (Suricata, Zeek, Falco or CrowdSec) matched traffic or behaviour ' +
    'against a known attack signature, scenario or runtime rule.',
  remediation:
    '1. Read the signature/scenario in the evidence.\n2. Block the source if it is attacking you; investigate the host if the alert is about outbound traffic.',
  references: ['https://docs.suricata.io/', 'https://docs.crowdsec.net/', 'https://docs.zeek.org/', 'https://falco.org/docs/'],
  evaluate(input) {
    const out = [];
    const seen = {};
    for (const s of input.newSignals.filter((x) => x.kind === 'ids.alert')) {
      const d = s.data || {};
      const subject = `${d.engine || 'ids'}:${d.sid || d.signature}:${s.key}`;
      if (seen[subject]) continue;
      seen[subject] = true;
      out.push({
        subject,
        title: `${ENGINE_NAMES[d.engine] || 'IDS'}: ${d.signature} (${d.engine === 'falco' ? 'on' : 'from'} ${s.key})`,
        severity: d.severity || 'medium',
        evidence: Object.assign({ source: s.key }, d),
      });
    }
    return out;
  },
};

module.exports = [NET001, NET004, NET006, NET007, NET008, NET009];
module.exports._internal = { entropy };
