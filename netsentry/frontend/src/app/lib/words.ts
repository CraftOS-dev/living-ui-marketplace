/**
 * The words people see. Internal names (finding, incident, source, sensor…)
 * stay in code and in the API; the UI speaks in these terms. See docs/UX-PLAN.md §3.
 */
import type { Tone } from '../../kit/index.ts';
import type { Asset, FindingStatus, Health, Severity } from './types.ts';

/** What to do about a severity, next to its colour. */
export const SEVERITY_ACTION: Record<Severity, string> = {
  critical: 'Act now',
  high: 'Today',
  medium: 'This week',
  low: 'When convenient',
  info: 'For your information',
};

/** Simple view: how urgent, in words anyone understands. */
export const URGENCY: Record<Severity, string> = {
  critical: 'Urgent',
  high: 'Important',
  medium: 'Soon',
  low: 'When you have time',
  info: 'For your information',
};

export const ISSUE_STATUS: Record<FindingStatus, string> = {
  open: 'Needs attention',
  acknowledged: 'Being handled',
  suppressed: 'Muted',
  resolved: 'Fixed',
};

export const CASE_STATUS: Record<string, string> = {
  new: 'New',
  investigating: 'Investigating',
  mitigated: 'Contained',
  closed: 'Closed',
  false_positive: 'Not a problem',
};

export const FIX_STATUS: Record<string, string> = {
  plan_requested: 'Waiting for a plan',
  planned: 'Needs approval',
  approved: 'Approved',
  executing: 'Being applied',
  verifying: 'Checking it worked',
  done: 'Fixed',
  failed: 'Did not work',
  rolled_back: 'Rolled back',
  rejected: 'Rejected',
  expired: 'Approval expired',
  cancelled: 'Cancelled',
};

export const RISK_WORDS: Record<string, { label: string; help: string; tone: Tone }> = {
  auto: { label: 'Low risk', help: 'Safe and reversible — can be approved automatically if you allow it in Settings.', tone: 'good' },
  approve: { label: 'Medium risk', help: 'Could disrupt something — an admin approves the exact plan first.', tone: 'warn' },
  high: { label: 'High impact', help: 'Downtime or data at stake — needs approval and a backup before anything runs.', tone: 'bad' },
  guided: { label: 'Done by you', help: 'A person does this one — NetSentry shows the steps, you follow them and say when you are done.', tone: 'info' },
};

export const ITEM_KIND: Record<Asset['kind'], string> = {
  host: 'Server',
  domain: 'Domain',
  subdomain: 'Subdomain',
  ip: 'IP address',
};

export type CheckState = 'working' | 'trouble' | 'broken' | 'unavailable' | 'waiting' | 'off';

export const CHECK_STATE: Record<CheckState, { label: string; tone: Tone; icon: string }> = {
  working: { label: 'Working', tone: 'good', icon: '✓' },
  trouble: { label: 'Having trouble', tone: 'warn', icon: '!' },
  broken: { label: 'Not working', tone: 'bad', icon: '✗' },
  unavailable: { label: 'Not available here', tone: 'neutral', icon: '–' },
  waiting: { label: 'Starting', tone: 'neutral', icon: '…' },
  off: { label: 'Turned off', tone: 'neutral', icon: '○' },
};

/** A check's state from its source record (sensor reports mark "Not available…" in last_error). */
export function checkState(s: { enabled: boolean; health: Health; last_error: string; last_run: string }): CheckState {
  if (!s.enabled) return 'off';
  if (s.last_error.startsWith('Not available')) return 'unavailable';
  if (s.health === 'ok') return 'working';
  if (s.health === 'degraded') return 'trouble';
  if (s.health === 'failing') return 'broken';
  return 'waiting';
}

/**
 * Plain description of each check, and what to do when it is not available.
 * `enable` is shown instead of the raw reason when the check cannot run.
 */
export const CHECK_HELP: Record<string, { what: string; enable?: string }> = {
  dns: { what: 'Where your web address points, email protection, and names someone else could take over' },
  ct: { what: 'New security certificates for your web addresses — spots impostors and forgotten sites' },
  rdap: { what: 'Domain registration expiry' },
  internetdb: { what: 'What the internet can reach on this address, and known security holes' },
  reputation: { what: 'Whether your names or addresses are on blocklists' },
  web: { what: 'Whether your website is secure (HTTPS) and protects visitors' },
  'sensor.liveness': { what: 'Whether the monitor is still reporting' },
  'host.info': { what: 'Operating system and version' },
  'host.listeners': { what: 'Programs accepting connections, and on which network', enable: 'Run the monitor as Administrator (Windows) or with sudo (Linux/macOS) to see program names.' },
  'host.users': { what: 'User accounts and administrators' },
  'host.ssh': { what: 'SSH server settings and authorised keys', enable: 'Only when the server runs an SSH server.' },
  'host.updates': { what: 'Security updates waiting to be installed', enable: 'Available on Linux (apt / dnf). Windows Update is checked by Windows itself.' },
  'host.auth': { what: 'Failed and successful logins (break-in attempts)', enable: 'Run the monitor as Administrator (Windows) or with sudo (Linux) so it can read the login log.' },
  'host.persistence': { what: 'Programs set to start automatically' },
  'host.fim': { what: 'Changes to critical system files' },
  'host.posture': { what: 'Disk encryption, firewall and antivirus' },
  'host.docker': { what: 'Docker containers exposed to the network', enable: 'Only where Docker is installed and the monitor can talk to it.' },
  'host.connections': { what: 'Which programs connect where' },
  'host.dns': { what: 'Websites and services this server looks up', enable: 'Automatic on Windows. On Linux install Zeek, or point the monitor at your Pi-hole (NETSENTRY_PIHOLE_URL).' },
  'host.ids': { what: 'Intrusion-detection alerts', enable: 'Install an intrusion-detection engine on the server: Suricata, Zeek, Falco or CrowdSec.' },
  'host.cloud': { what: 'Cloud firewall, threat detection and who changed what', enable: 'Only on AWS, Google Cloud or Azure VMs, once the VM has read-only access to its own settings (no keys needed — see the permissions guide in docs).' },
  'host.deps': { what: 'Known vulnerabilities in your projects’ dependencies', enable: 'Optional: tell the monitor which project folders to check (the NETSENTRY_CODE_PATHS setting — your agent can set it up).' },
  'host.secrets': { what: 'Passwords and keys committed in your code', enable: 'Optional: tell the monitor which project folders to check, and install gitleaks.' },
};

export function checkName(collector: string, labels: Record<string, string>): string {
  return labels[collector] ?? collector;
}
