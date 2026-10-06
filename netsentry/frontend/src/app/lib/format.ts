import type { Tone } from '../../kit/index.ts';
import type { FindingStatus, Health, Severity } from './types.ts';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function severityRank(s: Severity): number {
  return SEV_RANK[s] ?? 0;
}

export function severityTone(s: Severity): Tone {
  return s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'low' ? 'info' : 'neutral';
}

export function statusTone(s: FindingStatus): Tone {
  return s === 'open' ? 'bad' : s === 'acknowledged' ? 'warn' : s === 'resolved' ? 'good' : 'neutral';
}

export function healthTone(h: Health): Tone {
  return h === 'ok' ? 'good' : h === 'degraded' ? 'warn' : h === 'failing' ? 'bad' : 'neutral';
}

export const COLLECTOR_LABELS: Record<string, string> = {
  'intel.kev': 'Known exploited security holes (CISA)',
  'intel.epss': 'How likely holes are to be exploited (EPSS)',
  'intel.blocklists': 'Lists of known-bad addresses',
  'sensor.liveness': 'Monitor reporting',
  'host.info': 'Operating system',
  'host.listeners': 'Programs open to the network',
  'host.users': 'Users and administrators',
  'host.ssh': 'Remote login (SSH)',
  'host.updates': 'Security updates',
  'host.auth': 'Login attempts',
  'host.persistence': 'Startup programs',
  'host.fim': 'Important system files',
  'host.posture': 'Disk encryption, firewall, antivirus',
  'host.docker': 'Ports Docker publishes',
  'host.connections': 'Network connections',
  'host.dns': 'Websites this server looks up',
  'host.ids': 'Intrusion alerts',
  'host.cloud': 'Cloud firewall, threat detection, audit trail',
  'host.deps': 'Vulnerable dependencies',
  'host.secrets': 'Secrets in code',
  'host.containers': 'Apps in containers',
  'host.app_config': 'App settings',
  'host.storage': 'Disk space',
  'probe.router': 'Router port forwards',
  'probe.apps': 'Apps answering',
  'host.remote_access': 'Remote access (Tailscale, tunnels, VPN)',
  'probe.accounts': 'Accounts in your apps',
  'host.health': 'Processor, memory and temperature',
  'host.container_stats': 'Processor and memory of each app',
  'host.services': 'Services that failed',
  'host.disks': 'Disk health and log growth',
};

/** The areas a problem can be in today (v4: one server) — what the filter offers. */
export const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  updates: 'Updates',
  backups: 'Backups',
  reach: 'Who can reach it',
  uptime: 'Apps running',
  health: 'Server health',
  storage: 'Disk space',
  host: 'Server security',
  network: 'Network',
  device: 'Device protection',
  cloud: 'Cloud settings',
  code: 'Code and secrets',
  resilience: 'Monitoring health',
  self: 'NetSentry itself',
};

/** Areas of checks earlier versions had: old, resolved problems still show a name. */
const RETIRED_CATEGORY_LABELS: Record<string, string> = {
  exposure: 'Internet exposure',
  dns: 'Domains',
  email: 'Email',
  certificates: 'Website certificates',
  registration: 'Domain registration',
  reputation: 'Reputation',
  web: 'Websites',
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? RETIRED_CATEGORY_LABELS[c] ?? capitalize(c);
}

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** PocketBase dates use a space separator; ISO strings use "T". Accept both. */
export function toDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

export function relTime(s: string): string {
  const d = toDate(s);
  if (d === null) return '—';
  const diff = Date.now() - d.getTime();
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60000);
  let text: string;
  if (mins < 1) text = 'just now';
  else if (mins < 60) text = `${mins} min`;
  else if (mins < 60 * 36) text = `${Math.round(mins / 60)} h`;
  else text = `${Math.round(mins / 1440)} d`;
  if (text === 'just now') return text;
  return future ? `in ${text}` : `${text} ago`;
}

export function fmtDateTime(s: string): string {
  const d = toDate(s);
  return d === null ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDate(s: string): string {
  const d = toDate(s);
  return d === null ? '—' : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** A PocketBase filter literal for "now minus hours" on date fields. */
export function pbSince(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString().replace('T', ' ');
}

/** One-line human summary of an observation's data, per kind. */
export function describeObservation(kind: string, data: Record<string, unknown> | null): string {
  const d = data ?? {};
  const list = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(', ') : '');
  switch (kind) {
    case 'dns.record': {
      const base = list(d['values']);
      return d['target_status'] === 'nxdomain' ? `${base} — target does not exist` : base;
    }
    case 'dns.status':
      return d['status'] === 'nxdomain' ? 'Name does not exist (NXDOMAIN)' : 'Resolves';
    case 'dns.email_policy':
      return d['record'] ? String(d['record']) : 'Not published';
    case 'port.open':
      return `Port ${String(d['port'])} open`;
    case 'host.exposure':
      return d['known'] === false
        ? 'No open services recorded by InternetDB'
        : `Ports ${list(d['ports']) || 'none'} · ${Array.isArray(d['vulns']) ? d['vulns'].length : 0} known CVE(s)`;
    case 'ct.issuer':
      return String(d['issuer'] ?? '');
    case 'ct.hostname':
      return `Newest certificate expires ${fmtDate(String(d['latest_not_after'] ?? ''))} · ${String(d['issuer'] ?? '')}`;
    case 'domain.registration':
      return d['found'] === false
        ? 'No RDAP record'
        : `Expires ${fmtDate(String(d['expires'] ?? ''))} · ${String(d['registrar'] ?? 'unknown registrar')}`;
    case 'host.os':
      return String(d['label'] ?? d['system'] ?? '');
    case 'host.listener':
      return `${String(d['exposure']) === 'all' ? 'All interfaces' : String(d['exposure']) === 'local' ? 'Localhost only' : 'Specific interface'} (${list(d['addresses'])})${d['process'] ? ' · ' + String(d['process']) : ''}`;
    case 'host.user':
      return d['admin'] ? 'Administrator' : 'Standard user';
    case 'host.ssh_config':
      return `Password logins ${d['password_authentication'] ? 'ON' : 'off'} · root login: ${String(d['permit_root_login'])}`;
    case 'host.authorized_key':
      return `${String(d['type'])} key for ${String(d['user'])}`;
    case 'host.package_updates':
      return `${String(d['security'])} security update(s) pending (${String(d['manager'])})`;
    case 'host.persistence':
      return `${String(d['type'])}${d['command'] ? ' · ' + String(d['command']) : ''}`;
    case 'host.fim':
      return `sha256 ${String(d['sha256']).slice(0, 16)}… · ${String(d['size'])} bytes`;
    case 'device.posture':
      return `${d['enabled'] === true ? 'On' : d['enabled'] === false ? 'OFF' : 'Unknown'} · ${String(d['detail'] ?? '')}`;
    case 'container.published_port':
      return `${String(d['container'])} (${String(d['image'])}) → ${String(d['host_ip'] || 'all')}:${String(d['host_port'])}`;
    case 'host.net_process':
      return 'Makes outbound connections';
    case 'sensor.status':
      return d['online'] ? 'Checking in' : 'Silent';
    case 'rep.listing':
      return `Listed: ${String(d['list'])} (${String(d['match'])})`;
    case 'cloud.instance':
      return `${String(d['provider'] ?? '').toUpperCase()} ${String(d['id'] ?? '')} · ${String(d['region'] ?? '')}${d['public_ip'] ? ' · public IP ' + String(d['public_ip']) : ''}${d['role'] ? ' · identity ' + String(d['role']) : ''}`;
    case 'cloud.instance_config':
      return `Instance metadata tokens: ${d['imds_tokens'] === 'required' ? 'required (IMDSv2)' : String(d['imds_tokens'] ?? 'unknown')}`;
    case 'cloud.volume':
      return `${d['encrypted'] ? 'Encrypted' : 'NOT encrypted'} · ${String(d['size_gb'] ?? '?')} GB ${String(d['type'] ?? '')}`;
    case 'cloud.firewall_rule':
      return `${String(d['group_name'] || d['group'])}: ${String(d['proto'])} ${d['from_port'] === d['to_port'] ? String(d['from_port']) : `${String(d['from_port'])}–${String(d['to_port'])}`} from ${String(d['source'])}`;
    case 'cloud.threat_finding':
      return `${String(d['severity'] ?? '')} · ${String(d['title'] ?? d['type'] ?? '')}`;
    case 'cloud.detection':
      return `${String(d['service'] ?? '')} ${d['enabled'] ? 'enabled' : 'NOT enabled'} in ${String(d['region'] ?? '')}`;
    case 'web.status':
      return d['https'] ? `HTTPS works (HTTP ${String(d['status'])})` : `HTTPS fails${d['https_error'] ? ': ' + String(d['https_error']) : ''}`;
    case 'web.headers': {
      const have = ['hsts', 'csp', 'frame_protection', 'nosniff', 'referrer_policy'].filter((k) => d[k]);
      return have.length ? `Sends: ${have.join(', ').replace('frame_protection', 'frame protection').replace('referrer_policy', 'referrer policy')}` : 'No security headers';
    }
    case 'web.exposed_file':
      return `${String(d['url'])} is public`;
    case 'code.vulnerable_dependency':
      return `${String(d['name'])} ${String(d['version'])} · ${Array.isArray(d['vulns']) ? d['vulns'].length : 0} known vulnerabilit(ies)`;
    case 'code.secret':
      return `${String(d['rule'])} in ${String(d['project'])}/${String(d['file'])}:${String(d['line'])}`;
    case 'net.network':
      return `${String(d['kind'] === 'container' ? 'Docker network' : 'Network')} ${String(d['cidr'] ?? '')}${d['address'] ? ` · this server is ${String(d['address'])}` : ''}`;
    case 'router.port_mapping':
      return `${d['enabled'] === false ? 'Off' : 'On'} · from the internet port ${String(d['external_port'])} to ${String(d['internal_client'])}:${String(d['internal_port'])}`;
    case 'router.igd':
      return `${d['external_ip'] ? `internet address ${String(d['external_ip'])}` : 'internet address unknown'}${d['address'] ? ` · on your network at ${String(d['address'])}` : ''}`;
    case 'host.address':
      return d['loopback'] ? 'Only this server itself' : d['primary'] ? 'Main address' : 'Other address';
    case 'container': {
      const svc = d['compose_service'] ? `Compose service ${String(d['compose_service'])}` : 'Started by hand';
      return `${String(d['image'] ?? '')}${d['image'] ? ' · ' : ''}${svc}`;
    }
    case 'container.health': {
      const st = String(d['state'] ?? '');
      const word = st === 'running' ? 'Running' : st === 'restarting' ? 'Keeps restarting' : st === 'exited' ? `Stopped${d['oom_killed'] ? ' (ran out of memory)' : d['exit_code'] ? ` (exit code ${String(d['exit_code'])})` : ''}` : st || 'Unknown';
      return `${word}${d['health'] ? ` · ${String(d['health'])}` : ''}${Number(d['restart_count']) ? ` · restarted ${String(d['restart_count'])} times` : ''}`;
    }
    case 'host.filesystem':
      return `${String(d['total_gb'] ?? '?')} GB · ${String(d['fs'] ?? '')}`;
    case 'docker.root':
      return `Docker keeps its apps here (${String(d['driver'] ?? '')})`;
    case 'container.logs':
      return d['size_gb'] === null || d['size_gb'] === undefined ? 'Size unknown' : `${Number(d['size_gb']).toFixed(2)} GB of logs${d['max_size'] ? ` · capped at ${String(d['max_size'])}` : ' · no cap'}`;
    case 'endpoint.status':
      return d['up'] ? `Answering since ${fmtDate(String(d['since'] ?? ''))}` : `Not answering since ${fmtDate(String(d['since'] ?? ''))}`;
    case 'app.http':
      return `Answered ${String(d['status'] ?? '')}${d['server'] ? ` · ${String(d['server'])}` : ''}`;
    case 'app.config':
      return d['readable'] ? `Settings read (${String(d['format'] ?? '')})` : 'Settings file not readable';
    case 'host.health':
      return `${String(d['cores'] ?? '?')} cores · ${d['mem_total'] ? `${Math.round(Number(d['mem_total']) / 1e9)} GB memory` : ''}${d['reboot_required'] ? ' · needs a restart' : ''}`;
    default:
      return Object.entries(d)
        .filter(([, v]) => v !== null && typeof v !== 'object')
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`)
        .join(' · ')
        .slice(0, 160);
  }
}

/** Internal subject keys that should read as words ("rdap" → "Domain registration"). */
const SUBJECT_WORDS: Record<string, string> = {
  machine: 'This server',
  rdap: 'Domain registration',
  site: 'Website',
  https: 'HTTPS response',
  heartbeat: 'status',
  instance: 'This VM',
  metadata: 'Instance metadata',
  disk_encryption: 'Disk encryption',
  firewall: 'Firewall',
  antivirus: 'Antivirus',
  'aws-guardduty': 'GuardDuty',
  name: 'This name',
  dmarc: 'DMARC (email protection)',
  spf: 'SPF (email sender list)',
};

export function subjectLabel(subject: string): string {
  return SUBJECT_WORDS[subject] ?? subject;
}

/** What a row of the server's inventory is called (no internal ids: a router forward reads "Jellyfin — TCP 8096"). */
export function observationTitle(kind: string, subject: string, data: Record<string, unknown> | null, apps?: Record<string, string>): string {
  const d = data ?? {};
  // A container is shown by the app it runs ("Jellyfin"), not Docker's name for it.
  if (kind.startsWith('container')) {
    const [ctr, ...rest] = subject.split(':');
    if (ctr && apps?.[ctr]) return rest.length ? `${apps[ctr]!} — port ${rest.join(':')}` : apps[ctr]!;
  }
  if (kind === 'router.port_mapping') return `${String(d['description'] || 'A forward')} — ${String(d['proto'] ?? '')} ${String(d['external_port'] ?? '')}`;
  if (kind === 'router.igd') return String(d['name'] || d['model'] || 'Your router');
  if (kind === 'app.http') return subject.replace(/^[^/]+/, '').slice(0, 80) || subject;
  if (kind === 'app.config') return subject.split(':').slice(2).join(':') || subject;
  return subjectLabel(subject);
}

export const KIND_LABELS: Record<string, string> = {
  'host.os': 'Operating system',
  'host.listener': 'Programs accepting connections',
  'host.address': 'Network addresses',
  'host.user': 'Users',
  'host.ssh_config': 'Remote login (SSH) settings',
  'host.authorized_key': 'SSH keys that can sign in',
  'host.package_updates': 'Security updates',
  'host.persistence': 'Startup programs',
  'host.fim': 'Watched system files',
  'host.filesystem': 'Disks',
  'host.health': 'Health',
  'net.network': 'Networks this server is on',
  'host.remote_access': 'Remote access (Tailscale, tunnels, VPN)',
  'device.posture': 'Firewall, disk encryption, antivirus',
  'container': 'Apps in containers',
  'container.health': 'App health',
  'container.logs': 'App log files',
  'container.published_port': 'Ports Docker publishes',
  'app.http': 'What the apps answer',
  'app.config': 'App settings files',
  'endpoint.status': 'Apps answering',
  'docker.root': 'Docker storage',
  'router.igd': 'Router',
  'router.port_mapping': 'Router port forwards',
  'sensor.status': 'Monitor',
  'host.net_process': 'Programs on the network',
  'cloud.instance': 'Cloud instance',
  'cloud.firewall_rule': 'Cloud firewall rules',
  'cloud.threat_finding': 'Cloud threat findings',
  'cloud.detection': 'Cloud threat detection',
  'cloud.instance_config': 'Instance metadata settings',
  'cloud.volume': 'Cloud disks',
  'code.vulnerable_dependency': 'Vulnerable dependencies',
  'code.secret': 'Secrets in code',
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  investigating: 'Investigating',
  mitigated: 'Contained',
  closed: 'Closed',
  false_positive: 'Not a problem',
};

export function incidentStatusTone(s: string): Tone {
  return s === 'new' ? 'bad' : s === 'investigating' ? 'warn' : s === 'mitigated' ? 'info' : s === 'closed' ? 'good' : 'neutral';
}

/** Allowed next statuses — mirrors lib/core/lifecycle.js (server enforces). */
export const INCIDENT_NEXT: Record<string, string[]> = {
  new: ['investigating', 'mitigated', 'closed', 'false_positive'],
  investigating: ['mitigated', 'closed', 'false_positive'],
  mitigated: ['investigating', 'closed'],
  closed: ['investigating'],
  false_positive: ['investigating'],
};
