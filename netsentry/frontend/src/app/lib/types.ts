import type { RecordModel } from 'pocketbase';

export type Role = 'admin' | 'analyst' | 'viewer' | 'auditor';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'suppressed';
export type Health = 'unknown' | 'ok' | 'degraded' | 'failing';

export interface Member extends RecordModel {
  email: string;
  role: Role | '';
  created: string;
}

export interface Settings extends RecordModel {
  workspace_name: string;
  report_recipients?: string[] | null;
  access_review_days?: number;
  cloud_enrol_roles?: string[] | null;
  console_url?: string;
  signup_open: boolean;
  retention_days: number;
  digest_hour: number;
  remediation_paused: boolean;
  auto_approve_low_risk: boolean;
}

export interface Asset extends RecordModel {
  kind: 'domain' | 'subdomain' | 'ip' | 'host';
  identifier: string;
  label: string;
  ownership: 'unverified' | 'verified' | 'discovered';
  verify_token: string;
  status: 'active' | 'retired';
  added_by: string;
  parent: string;
  first_seen: string;
  last_seen: string;
}

export interface Source extends RecordModel {
  collector: string;
  target: string;
  schedule_minutes: number;
  next_run: string;
  enabled: boolean;
  health: Health;
  last_run: string;
  last_error: string;
  consecutive_failures: number;
  run_count: number;
  sensor: string;
}

export interface ScanRun extends RecordModel {
  source: string;
  collector: string;
  target_label: string;
  trigger: 'schedule' | 'manual' | '';
  status: 'ok' | 'error';
  observations: number;
  changes: number;
  findings_opened: number;
  findings_resolved: number;
  duration_ms: number;
  error: string;
  note: string;
  started: string;
}

export interface Observation extends RecordModel {
  asset: string;
  kind: string;
  subject: string;
  data: Record<string, unknown> | null;
  present: boolean;
  first_seen: string;
  last_seen: string;
}

export interface Change extends RecordModel {
  asset: string;
  kind: string;
  subject: string;
  change: 'added' | 'removed' | 'modified';
  before: unknown;
  after: unknown;
  at: string;
}

export interface Rule extends RecordModel {
  rule_id: string;
  title: string;
  category: string;
  severity_default: Severity;
  severity_override: Severity | '';
  enabled: boolean;
  rationale: string;
}

export interface Baseline extends RecordModel {
  asset: string;
  kind: string;
  accepted: unknown;
  accepted_by: string;
  at: string;
}

export interface Finding extends RecordModel {
  fingerprint: string;
  rule_id: string;
  asset: string;
  subject: string;
  title: string;
  category: string;
  severity: Severity;
  status: FindingStatus;
  evidence: unknown;
  first_seen: string;
  last_seen: string;
  resolved_at: string;
  reopen_count: number;
  status_note: string;
  status_by: string;
  incident: string;
  /** Everyday-language title (Simple view). */
  plain_title: string;
}

export interface AuditEntry extends RecordModel {
  seq: number;
  actor_type: 'user' | 'agent' | 'system';
  actor_label: string;
  action: string;
  target_collection: string;
  target_id: string;
  summary: string;
  at: string;
}

export interface Overview {
  ok: boolean;
  posture: {
    score: number;
    penalty: number;
    grade: 'good' | 'fair' | 'poor' | 'critical';
    bySeverity: Record<Severity, number>;
    byCategory: Record<string, number>;
    weights: Record<Severity, number>;
    perAssetCap: number;
  };
  open_findings: number;
  assets: { active: number; retired: number };
  changes_24h: number;
  source_health: Record<Health, number>;
  intel: Array<{ collector: string; health: Health; last_run: string; last_error: string }>;
}

export interface Explained {
  ok: boolean;
  suppression: { reason: string; until: string; created_by: string } | null;
  finding: {
    id: string;
    rule_id: string;
    title: string;
    plain_title?: string;
    severity: Severity;
    status: FindingStatus;
    subject: string;
    first_seen: string;
    last_seen: string;
    status_note: string;
    evidence: unknown;
  };
  asset: { id: string; kind: string; identifier: string; label?: string } | null;
  rule: {
    id: string;
    title: string;
    category: string;
    rationale: string;
    remediation: string;
    references: string[];
    ask_expected?: boolean;
    /** v2 checks also carry what was seen, how the fix is verified, and the severity factors. */
    plain?: { means: string; steps: string[]; saw?: string[]; verify?: string; factors?: string[] } | null;
    v2?: boolean;
  } | null;
}

export type IncidentStatus = 'new' | 'investigating' | 'mitigated' | 'closed' | 'false_positive';

export interface Incident extends RecordModel {
  title: string;
  severity: Severity;
  status: IncidentStatus;
  correlation_key: string;
  root_asset: string;
  assignee: string;
  needs_triage: boolean;
  summary: string;
  confidence: 'low' | 'medium' | 'high' | '';
  triaged_by: string;
  triaged_at: string;
  finding_count: number;
  opened_at: string;
  last_activity: string;
  closed_at: string;
  agent_request: string;
}

export interface IncidentNote extends RecordModel {
  incident: string;
  kind: 'note' | 'event';
  body: string;
  actor_type: 'user' | 'agent' | 'system';
  actor_label: string;
  created: string;
}

export interface Notifier extends RecordModel {
  kind: 'webhook' | 'heartbeat' | 'craftbot_email';
  name: string;
  format: 'slack' | 'discord' | 'ntfy' | 'json' | '';
  url_hint: string;
  min_severity: Severity | '';
  send_digest: boolean;
  interval_minutes: number;
  enabled: boolean;
  last_sent: string;
  last_ok: boolean;
  last_error: string;
  sent_count: number;
}

export interface Sensor extends RecordModel {
  name: string;
  status: 'pending' | 'online' | 'offline' | 'revoked';
  hostname: string;
  platform: string;
  os: string;
  version: string;
  is_admin: boolean;
  last_seen: string;
  environment: { cloud?: string | null; container?: boolean } | null;
  capabilities: Record<string, { available: boolean; reason?: string }> | null;
  asset: string;
  dropped: number;
}

export interface PlanStep {
  action?: string;
  description: string;
  command: string;
  target: string;
  rollback: string;
}

export interface Remediation extends RecordModel {
  finding: string;
  incident: string;
  asset: string;
  playbook_id: string;
  title: string;
  risk_class: 'auto' | 'approve' | 'high' | 'guided';
  status: string;
  plan: { steps: PlanStep[] } | null;
  plan_hash: string;
  approved_plan_hash: string;
  preconditions: string[] | null;
  blast_radius: string;
  downtime: string;
  cost_note: string;
  backup_ref: string;
  steps_log: Array<{ step: number; outcome: string; output: string; at: string; by: string }> | null;
  verify_result: { checked?: boolean; rule?: string; result?: string; note?: string; at?: string } | null;
  requested_by: string;
  planned_by: string;
  approved_by: string;
  executor: string;
  approved_at: string;
  failure_reason: string;
  agent_request: string;
  plain_title: string;
}

export interface Suggestion {
  ok: boolean;
  active_remediation: { id: string; status: string } | null;
  playbooks: Array<{ id: string; title: string; plain_title?: string; risk: string; lockout_risk: boolean; downtime: string; cost: string; preconditions: string[]; steps: string[]; rollback: string[]; verified_by: string | null; builtin?: boolean }>;
  /** v2: whether fixing is switched on at the machine (NetSentry's own fixes need it). */
  executor_ready?: boolean;
}

// ------------------------------------------------------------------ v2 (docs/SYSTEM-V2-PLAN.md)

export type Reach = 'this_machine' | 'local_network' | 'local_plus_private_remote' | 'specific_networks' | 'internet';
export type CheckState = 'pass' | 'fail' | 'not_applicable' | 'unknown' | 'accepted';
export type Outcome = 'reach' | 'security' | 'updates' | 'backups' | 'uptime' | 'storage' | 'self';

export interface AppEndpoint {
  bind: string;
  port: number;
  proto: string;
  via: string;
  reach: string[];
}

export interface AppRecord extends RecordModel {
  key: string;
  app_type: string;
  asset: string;
  display_name: string;
  label: string;
  container: string;
  compose_project: string;
  compose_service: string;
  version: string;
  endpoints: AppEndpoint[] | null;
  recognised_by: Array<{ signal: string; value: string }> | null;
  importance: 'low' | 'normal' | 'critical';
  owner: string;
  status: 'active' | 'gone' | 'ignored';
  first_seen: string;
  last_seen: string;
}

export interface IntentRecord extends RecordModel {
  app: string;
  reach: Reach;
  source: 'default' | 'template' | 'person';
  set_by: string;
  set_at: string;
}

export interface RenderedText {
  control: string;
  state: CheckState;
  title: string;
  saw?: string[];
  means?: string;
  steps?: string[];
  variant?: string;
  verify?: string;
}

export interface EvaluationRecord extends RecordModel {
  fingerprint: string;
  control: string;
  outcome: Outcome;
  subject_type: 'app' | 'machine' | 'filesystem' | 'backup_plan';
  subject_key: string;
  asset: string;
  app: string;
  state: CheckState;
  reason: string;
  severity: string;
  factors: string[] | null;
  evidence: Record<string, unknown> | null;
  plain_title: string;
  finding: string;
  first_failed: string;
  evaluated_at: string;
}

export interface BackupPlanRecord extends RecordModel {
  name: string;
  asset: string;
  apps: string[];
  method: 'heartbeat' | 'declared' | 'detected' | 'netsentry';
  schedule_hours: number;
  grace_hours: number;
  destination: string;
  last_success: string;
  last_failure: string;
  last_note: string;
  created_by: string;
}

export interface CatalogueApp {
  id: string;
  name: string;
  category: string;
  what: string;
  default_intent: Reach;
  important: string[];
  skip: string[];
  sources: Record<string, string>;
  /** Organisation mode: the policy template this kind of app usually takes. */
  template?: string;
  /** D12: this app's accounts can be listed with a read-only key (how to make one). */
  accounts?: { how: string[] } | null;
}

export interface DetectionRecord extends RecordModel {
  dedupe_key: string;
  rule_id: string;
  asset: string;
  subject: string;
  summary: string;
  severity: string;
  evidence: Record<string, unknown> | null;
  verdict: 'unreviewed' | 'expected' | 'suspicious' | 'learned' | 'known_good';
  verdict_by: string;
  count: number;
  first_at: string;
  last_at: string;
  finding: string;
}

export interface AppAccessRecord extends RecordModel {
  app: string;
  hint: string;
  added_by: string;
  added_at: string;
  last_ok: string;
  last_error: string;
}

export interface AccessReviewRecord extends RecordModel {
  app: string;
  reviewer: string;
  reviewed_at: string;
  note: string;
  accounts: Array<{ login: string; is_admin: boolean; active: boolean; last_login: string }> | null;
}

export interface ReportRecord extends RecordModel {
  period: string;
  kind: 'monthly';
  generated_at: string;
  generated_by: string;
  data: MonthlyReport | null;
  sent_to: Array<{ at: string; to: string[]; how: string }> | null;
}

export type ReportState = 'pass' | 'fail' | 'unknown' | 'accepted' | 'none' | 'not_applicable';
export interface MonthlyReport {
  period: string;
  from: string;
  to: string;
  generated_at: string;
  workspace: string;
  headline: { apps: number; healthy: number; attention: number; previous: { apps: number; attention: number } | null };
  apps: Array<{ id: string; name: string; machine: string; owner: string; importance: string; uptime: number | null; last_backup: string; healthy: boolean; reach: ReportState; security: ReportState; updates: ReportState; backups: ReportState; uptime_state?: ReportState }>;
  fixed: Array<{ title: string; when: string; asked_by: string; done_by: string }>;
  open: Array<{ title: string; app: string; owner: string; since: string; due: string; severity: string }>;
  accepted: Array<{ title: string; by: string; until: string; reason: string }>;
  coverage: { machines_monitored?: number; machines_offline?: number; servers_found?: number; servers_unmonitored?: number; networks_confirmed?: number; networks_waiting?: number };
  netsentry: { monitors_online?: number; monitors_total?: number; checks_unknown?: number; summary?: string };
}

/** Organisations (plan §4.2 S2–S3): a network NetSentry may look at once a person confirms it. */
export interface NetworkRecord extends RecordModel {
  cidr: string;
  name: string;
  purpose: 'office' | 'servers' | 'vpn' | 'guest' | 'home' | 'other' | '';
  source: 'detected' | 'person';
  state: 'proposed' | 'confirmed' | 'ignored';
  gateway: string;
  seen_by: string;
  confirmed_by: string;
  confirmed_at: string;
  last_scan: string;
  device_count: number;
}

export interface DeviceWeb {
  port: number;
  scheme: string;
  status?: number;
  server?: string;
  title?: string;
  error?: string;
}

export interface DeviceRecord extends RecordModel {
  key: string;
  network: string;
  ip: string;
  mac: string;
  hostname: string;
  kind: 'server' | 'pc' | 'printer' | 'network' | 'phone' | 'other' | 'unknown';
  label: string;
  owner: string;
  open_ports: number[] | null;
  web: DeviceWeb[] | null;
  apps: Array<{ type: string; name: string; port: number; by: string }> | null;
  monitored_by: string;
  status: 'new' | 'known' | 'ignored' | 'gone';
  first_seen: string;
  last_seen: string;
}
