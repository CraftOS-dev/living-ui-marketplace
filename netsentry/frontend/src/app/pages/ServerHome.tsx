/**
 * Home (v4 plan §5.1, Slate redesign §16) — "is everything OK?" for the one server NetSentry looks
 * after, in four parts:
 *   1. one sentence with the server's live numbers, and Check now;
 *   2. Needs you — problems grouped by cause as tiles, each with the one button that fixes it;
 *   3. your apps (running or not, live) beside what happened recently (with Undo);
 *   4. ask the agent, in your own words.
 * Everything follows the records live (no timer): a stopped app shows within seconds.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input, Pill, Spinner, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { AppIcon } from '../components/Apps.tsx';
import { useChange, type Preview, previewOf, type UndoTarget } from '../components/Controls.tsx';
import { CheckCircleIcon, PlusIcon, ShieldIcon } from '../components/icons.tsx';
import { useAppNames } from '../components/ServerParts.tsx';
import { newerVersion, ReconnectDrawer } from '../components/Reconnect.tsx';
import { useLive, useUpdatedWords } from '../lib/liveStatus.tsx';
import { TONE_COLOR, type Tone } from '../components/visual.tsx';
import { loadCatalogue, openUrl } from '../lib/apps.ts';
import { relTime, toDate } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { go, href, to } from '../lib/nav.ts';
import { runOp } from '../lib/ops.ts';
import type { AppRecord, BackupPlanRecord, CatalogueApp, Change, Finding, Remediation, Sensor } from '../lib/types.ts';

type AppRecordLite = AppRecord;
type SensorLite = Sensor;

interface ServerSummary {
  asset_id: string;
  name: string;
  monitor: { status: string; last_seen: string; version: string; latest?: string; os: string; platform: string; changes_on: boolean } | null;
  cpu: number | null;
  mem_pct: number | null;
  disk_pct: number | null;
  apps: number;
  updates: { apps: number; risky: number; os_security: number | null };
  reboot_required: boolean | null;
  backups: { plans: number; failing: number };
}

type Action =
  | { kind: 'update'; app_id: string; to: string; risk: string; label: string }
  | { kind: 'backup'; app_ids: string[]; label: string }
  | { kind: 'fix'; finding_id: string; label: string }
  | { kind: 'app'; app_id: string; tab: string; label: string }
  | { kind: 'open'; app_id: string; url: { port: number; bind: string } | null; label: string; also?: { kind: 'stop'; app_id: string; label: string } }
  | { kind: 'steps'; finding_id: string; label: string }
  | { kind: 'start'; app_id: string; label: string }
  | { kind: 'apps'; label: string }
  | { kind: 'reconnect'; label: string; mode?: 'update' };

interface Group {
  key: string;
  rule: string;
  title: string;
  means: string;
  severity: string;
  findings: string[];
  apps: string[];
  app_ids?: string[];
  action: Action;
  busy: boolean;
  /** Broken right now (it leads the list): lib/v2/todo.js decides. */
  now?: boolean;
}

interface HomeApp {
  id: string;
  name: string;
  app_type: string;
  version: string;
  container: string;
  state: string;
  running: boolean;
  url: { port: number; bind: string } | null;
  problems: number;
}

interface Overview {
  server: ServerSummary | null;
  todo: Group[];
  handling: number;
  apps: HomeApp[];
}

interface HelpRequest {
  id: string;
  question: string;
  asked_by: string;
  status: 'waiting' | 'answered' | 'withdrawn';
  answer: string;
  changes: string[] | null;
  created: string;
  answered_at: string;
  collectionId: string;
  collectionName: string;
}

const SEVERITY: Record<string, { word: string; tone: Tone }> = {
  critical: { word: 'Urgent', tone: 'bad' },
  high: { word: 'Important', tone: 'bad' },
  medium: { word: 'Soon', tone: 'warn' },
  low: { word: 'When you have time', tone: 'neutral' },
  info: { word: 'For your information', tone: 'neutral' },
};



/** "Back them up": one plan for the apps, to a folder on the server (another disk or a NAS share is best). */
function BackupDialog({ open, onClose, server, appIds, names }: { open: boolean; onClose: () => void; server: ServerSummary; appIds: string[]; names: string[] }): React.JSX.Element {
  const plans = useCollection<BackupPlanRecord>('backup_plans', { filter: 'method = "netsentry"' });
  const windows = server.monitor?.platform === 'windows';
  const known = plans.records.find((p) => p.destination)?.destination ?? '';
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDest(known);
  }, [open, known, windows]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ message: string }>('backups.create-plan', {
        asset_id: server.asset_id, name: appIds.length === 1 ? `${names[0]} — daily` : 'Apps — daily', method: 'netsentry',
        app_ids: appIds.join(','), destination: dest.trim(), schedule_hours: 24,
      });
      toast.success(r.message);
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={appIds.length === 1 ? `Back up ${names[0]}` : `Back up ${appIds.length} apps`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!dest.trim()} onClick={() => void save()}>
            Back up every day
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[14px]">
        <p>{names.join(', ')}: their settings and databases, every night. NetSentry keeps 7 daily, 4 weekly and 6 monthly copies and tests a restore every month.</p>
        <Input label="Folder for the copies" value={dest} onChange={(e) => setDest(e.target.value)} placeholder={windows ? 'E:\\Backups' : '/mnt/backups'} />
        <p className="text-[13px] text-[var(--agent-app-muted)]">A folder on another disk or a NAS share that's mounted on the server — a copy on the same disk doesn't survive that disk failing. NetSentry makes the last sub-folder there if it's missing.</p>
      </div>
    </Dialog>
  );
}

/** One "needs you" tile: what's wrong in a sentence, why it matters, and the one button that fixes it. */
function ToFix({ group, server, apps, onBackup, onReconnect, ask, busy }: { group: Group; server: ServerSummary | null; apps: HomeApp[]; onBackup: (g: Group) => void; onReconnect: (mode: 'reconnect' | 'update') => void; ask: ReturnType<typeof useChange>['ask']; busy: boolean }): React.JSX.Element {
  const { can } = useMe();
  // Broken right now (it leads the list): the chip says so, whatever the check's severity.
  const sev = group.now ? { word: 'Broken now', tone: 'bad' as Tone } : SEVERITY[group.severity] ?? SEVERITY['medium']!;
  const tone = TONE_COLOR[sev.tone];
  const a = group.action;
  const primary = (): void => {
    switch (a.kind) {
      case 'update':
        void ask(() => runOp<Preview>('updates.request', { app_id: a.app_id, to: a.to }), a.label, a.risk === 'high');
        break;
      case 'fix':
        void ask(() => runOp<Preview>('changes.prepare-fix', { finding_id: a.finding_id }), 'Fix it');
        break;
      case 'backup':
        onBackup(group);
        break;
      case 'start':
        void ask(() => runOp<Preview>('changes.request', { action: 'start', app_id: a.app_id }), 'Start now');
        break;
      case 'app':
        go(to.app(a.app_id, a.tab));
        break;
      case 'apps':
        go('apps');
        break;
      case 'reconnect':
        onReconnect(a.mode === 'update' ? 'update' : 'reconnect');
        break;
      case 'open': {
        const url = openUrl(a.url ?? apps.find((x) => x.id === a.app_id)?.url);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else go(to.app(a.app_id));
        break;
      }
      default:
        go(to.issue(a.finding_id) + '/steps');
    }
  };
  // Changes need the right role and the monitor's permission; the rest is navigation.
  const needsChange = a.kind === 'update' || a.kind === 'fix' || a.kind === 'backup' || a.kind === 'start';
  const allowed = (!needsChange || (a.kind === 'update' || a.kind === 'fix' ? can('admin') : can('analyst'))) && (a.kind !== 'reconnect' || can('admin'));
  const off = needsChange && a.kind !== 'backup' && server?.monitor && !server.monitor.changes_on;
  const why = href(a.kind === 'apps' ? 'issues' : to.issue(group.findings[0]!) + (group.findings.length > 1 || a.kind === 'steps' ? '' : '/steps'));
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-[0.65rem] p-3.5"
      style={{ background: `color-mix(in srgb, var(--agent-app-surface), ${tone} 5%)`, border: `1px solid color-mix(in srgb, var(--agent-app-border), ${tone} 30%)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ color: tone, background: 'var(--agent-app-surface)' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden />
          {sev.word}
        </span>
        <span className="flex items-center gap-3">
          {!group.busy && a.kind === 'open' && a.also && can('analyst') && (
            <button
              type="button"
              disabled={busy}
              className="text-[12.5px] text-[var(--agent-app-muted)] underline underline-offset-2 hover:text-[var(--agent-app-text)] disabled:opacity-50"
              onClick={() => void ask(() => runOp<Preview>('changes.request', { action: 'stop', app_id: a.app_id }), 'Stop now', true)}
            >
              {a.also.label}
            </button>
          )}
          <a href={why} className="text-[12.5px] text-[var(--agent-app-muted)] underline underline-offset-2 hover:text-[var(--agent-app-text)]">
            Why?
          </a>
        </span>
      </div>
      <p className="text-[14.5px] font-semibold leading-snug">{group.title}</p>
      {/* The description keeps the tile a set height and scrolls inside (Ahmad, 2026-10-02). */}
      <div className="relative flex max-h-[112px] flex-col gap-2 overflow-y-auto pr-1">
      {group.means && <p className="text-[13px] text-[var(--agent-app-muted)]">{group.means}</p>}
      {group.apps.length > 1 && (
        <p className="text-[12px] text-[var(--agent-app-muted)]">
          {group.apps.map((n, i) => (
            <span key={n + i}>
              {i > 0 && ', '}
              {group.app_ids?.[i] ? (
                <a href={href(to.app(group.app_ids[i]!))} className="hover:underline">
                  {n}
                </a>
              ) : (
                n
              )}
            </span>
          ))}
        </p>
      )}
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-1.5">
        {group.busy ? (
          <Pill tone="accent">Being fixed…</Pill>
        ) : (
          <>
            {allowed && (
              <Button className="w-full min-w-0" disabled={busy || !!off} onClick={primary} title={a.label}>
                {/* One line always: a long app name is cut with "…" (the title above names it in full). */}
                <span className="block min-w-0 truncate">{a.label}</span>
              </Button>
            )}
            {off && <span className="text-[12px] text-[var(--agent-app-muted)]">Changes are switched off on this server (Server → Overview).</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** A small area graph of the last readings (oldest first), drawn to a 0–100 scale. */
function Spark({ points, color }: { points: number[]; color: string }): React.JSX.Element {
  const n = points.length;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, n - 1)) * 100).toFixed(1)} ${(24 - (Math.min(100, Math.max(0, v)) / 100) * 22).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="mt-1 block h-[26px] w-full overflow-visible" aria-hidden>
      <path d={`${d} L100 26 L0 26 Z`} fill={color} opacity={0.14} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Meter({ label, pct, extra, points }: { label: string; pct: number | null; extra?: string | undefined; points?: number[] | undefined }): React.JSX.Element {
  const tone: Tone = pct === null ? 'neutral' : pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good';
  const color = pct === null ? 'var(--agent-app-border)' : TONE_COLOR[tone];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-[var(--agent-app-muted)]">
        <span>{label}</span>
        <span className="tabular-nums">
          {pct === null ? '—' : `${Math.round(pct)}%`}
          {extra ? ` · ${extra}` : ''}
        </span>
      </div>
      {points && points.length > 1 ? (
        <Spark points={points} color={color} />
      ) : (
        <div className="mt-1 h-1.5 rounded-full bg-[var(--agent-app-surface-2)]">
          <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.max(2, pct ?? 0))}%`, background: pct === null ? 'transparent' : color }} />
        </div>
      )}
    </div>
  );
}

/** "Live" with a soft pulse: these numbers are moving now. */
export function LivePill({ words = 'Live' }: { words?: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: TONE_COLOR.good }}>
      <span className="ns-live-dot h-[7px] w-[7px] rounded-full" style={{ background: TONE_COLOR.good }} aria-hidden />
      {words}
    </span>
  );
}

function CardHead({ title, children }: { title: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[var(--agent-app-border)] px-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children && <div className="flex items-center gap-4 text-[13px]">{children}</div>}
    </div>
  );
}

function bytesShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

/** Your apps as rows: running or not (live), and the one thing you'd do — open it, or start it. */
function AppRows({ apps, cat, ask, busy }: { apps: HomeApp[]; cat: CatalogueApp[]; ask: ReturnType<typeof useChange>['ask']; busy: boolean }): React.JSX.Element {
  const { can } = useMe();
  const live = useLive();
  return (
    <ul className="relative max-h-[480px] overflow-y-auto">
      {apps.map((a) => {
        const l = live.app(a.container);
        const running = l ? l.running : a.running;
        const known = !!l || a.state !== 'unknown';
        const url = openUrl(a.url);
        const entry = cat.find((c) => c.id === a.app_type);
        const tone: Tone = !known ? 'neutral' : !running ? 'bad' : a.problems ? 'warn' : 'good';
        return (
          <li key={a.id} className="flex min-h-[60px] items-center gap-3 border-t border-[var(--agent-app-border)] px-4 py-2 first:border-t-0">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-[var(--agent-app-surface-2)] text-[var(--agent-app-muted)]">
              <AppIcon category={entry?.category ?? ''} size={18} />
            </span>
            <a href={href(to.app(a.id))} className="min-w-0 flex-1 hover:opacity-90">
              <span className="block truncate text-[14px] font-medium">{a.name}</span>
              <span className="flex items-center gap-1.5 truncate text-[12.5px] text-[var(--agent-app-muted)]">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tone === 'neutral' ? 'var(--agent-app-border)' : TONE_COLOR[tone] }} aria-hidden />
                {!known ? 'Not reported yet' : running ? (a.problems ? `Running · ${a.problems} to look at` : 'Running') : 'Stopped'}
                {l && running && l.mem !== null ? ` · ${bytesShort(l.mem)}${l.cpu !== null ? ` · ${Math.round(l.cpu)}% CPU` : ''}` : entry?.what ? ` · ${entry.what}` : ''}
              </span>
            </a>
            <span className="flex shrink-0 items-center gap-1">
              {url && running ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-[76px] justify-center rounded-md border border-[var(--agent-app-border)] px-3 py-1.5 text-[13px] font-medium hover:bg-[var(--agent-app-surface-2)]">
                  Open
                </a>
              ) : !running && known && a.container && can('analyst') ? (
                <Button size="sm" variant="secondary" className="min-w-[76px]" disabled={busy} onClick={() => void ask(() => runOp<Preview>('changes.request', { action: 'start', app_id: a.id }), 'Start now')}>
                  Start
                </Button>
              ) : (
                <span className="min-w-[76px]" />
              )}
              <a href={href(to.app(a.id))} className="inline-flex min-w-[76px] justify-center rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[var(--agent-app-surface-2)]">
                Manage
              </a>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface ActivityRow {
  key: string;
  what: string;
  who: string;
  at: string;
  undo?: { id: string; title: string; words: string[] } | undefined;
}

interface ChangeListRow {
  id: string;
  title: string;
  status: string;
  requested_by: string;
  approved_by: string;
  created: string;
  undoable?: boolean;
  undo?: string[];
}

const CHANGE_WORD: Record<string, string> = { failed: "didn't work", rolled_back: "didn't work, put back", undone: 'undone', planned: 'waiting for you', approved: 'sent', executing: 'happening now', verifying: 'checking' };

/**
 * The last few things that happened: changes made through NetSentry (with Undo while it's possible)
 * and apps the monitor saw stop or start. Follows both live.
 */
function RecentActivity({ assetId, askUndo }: { assetId: string; askUndo: (t: UndoTarget) => void }): React.JSX.Element {
  const { can } = useMe();
  const since = useMemo(() => new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' '), []);
  const seen = useCollection<Change>('changes', { filter: `asset = "${assetId}" && kind = "container.health" && at >= "${since}"`, sort: '-at' });
  const mine = useCollection<Remediation>('remediations', { filter: `asset = "${assetId}"`, sort: '-updated' });
  const names = useAppNames();
  const signature = mine.records.slice(0, 30).map((r) => r.id + r.status).join(',');
  const list = useOp<{ changes: ChangeListRow[] }>('changes.list', { asset_id: assetId }, { deps: signature });
  const rows = list.data ? list.data.changes : list.error ? [] : null;

  const items: ActivityRow[] = [];
  for (const r of (rows ?? []).filter((x) => x.status !== 'cancelled' && x.status !== 'expired' && x.status !== 'rejected').slice(0, 8)) {
    const word = r.status === 'done' ? '' : CHANGE_WORD[r.status] ?? r.status;
    items.push({
      key: 'r' + r.id,
      what: r.title + (word ? ` (${word})` : ''),
      who: r.approved_by && r.approved_by !== r.requested_by ? `${r.requested_by || 'Someone'}, confirmed by ${r.approved_by}` : r.requested_by || 'Someone',
      at: r.created,
      undo: r.undoable && can('admin') ? { id: r.id, title: r.title, words: r.undo ?? [] } : undefined,
    });
  }
  for (const c of seen.records.slice(0, 20)) {
    const b = (c.before ?? {}) as { state?: string };
    const a = (c.after ?? {}) as { state?: string };
    if (c.change !== 'modified' || !a.state || b.state === a.state) continue;
    const name = names[c.subject];
    if (!name) continue;
    const stopped = a.state !== 'running' && a.state !== 'restarting';
    items.push({ key: 'c' + c.id, what: stopped ? `${name} stopped` : b.state === 'restarting' || a.state === 'restarting' ? `${name} restarted` : `${name} started`, who: 'Seen by the monitor', at: c.at });
  }
  items.sort((x, y) => (toDate(y.at)?.getTime() ?? 0) - (toDate(x.at)?.getTime() ?? 0));
  const shown = items.slice(0, 30);

  return (
    <>
      {rows === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-[var(--agent-app-muted)]">Nothing has happened yet. Changes you make here, and apps stopping or starting, show up as they happen.</p>
      ) : (
        <ul className="relative max-h-[480px] overflow-y-auto py-1 pl-5 pr-4">
          {shown.map((r, i) => (
            <li key={r.key} className="relative grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-l border-[var(--agent-app-border)] py-2 pl-[18px]">
              <span
                className="absolute -left-1 top-[calc(50%-4px)] h-[7px] w-[7px] rounded-full"
                style={{ background: i === 0 && Date.now() - (toDate(r.at)?.getTime() ?? 0) < 600000 ? 'var(--agent-app-accent)' : 'var(--agent-app-border)' }}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] [overflow-wrap:anywhere]">{r.what}</span>
                <span className="block text-[12px] text-[var(--agent-app-muted)]">
                  {r.who} · {relTime(r.at)}
                </span>
              </span>
              {r.undo ? (
                <Button size="sm" variant="secondary" onClick={() => askUndo(r.undo!)}>
                  Undo
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AskAgent({ ask, busy }: { ask: ReturnType<typeof useChange>['ask']; busy: boolean }): React.JSX.Element {
  const { can } = useMe();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const recent = useCollection<HelpRequest>('help_requests', { sort: '-created' });
  // Every question still waiting stays in sight (with a way to withdraw it); answers fill up to three.
  const waiting = recent.records.filter((r) => r.status === 'waiting');
  const shown = waiting.concat(recent.records.filter((r) => r.status === 'answered').slice(0, Math.max(0, 3 - waiting.length)));
  const shownIds = shown.flatMap((h) => h.changes ?? []);
  const changes = useCollection<Remediation>('remediations', { filter: shownIds.length ? shownIds.map((id) => `id = "${id}"`).join(' || ') : 'id = ""' });
  // Is an agent connected? (it acted in the last week) — so "looking" is never claimed when nobody is.
  const presence = useOp<{ recent: boolean }>('agent.presence', {}, { deps: recent.records.length });
  const agentNear = presence.data ? presence.data.recent : null;
  const send = async (): Promise<void> => {
    setSending(true);
    try {
      const r = await runOp<{ message: string }>('help.ask', { question: text.trim() });
      toast.success(r.message);
      setText('');
    } catch {
      /* toast shown */
    } finally {
      setSending(false);
    }
  };
  const withdraw = async (id: string): Promise<void> => {
    try {
      const r = await runOp<{ message: string }>('help.withdraw', { help_id: id });
      toast.success(r.message);
    } catch {
      /* toast shown */
    }
  };
  // An agent that is around answers within minutes; past that, say so rather than spin forever.
  const LATE_MS = 15 * 60 * 1000;
  return (
    <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      <CardHead title="Ask the agent">
        <span className="text-[var(--agent-app-muted)]">It looks, prepares a fix, and you confirm</span>
      </CardHead>
      <div className="flex flex-col gap-2 p-4">
        <Textarea rows={2} placeholder="In your own words, e.g. “Plex is slow in the evening” or “free up disk space”" value={text} onChange={(e) => setText(e.target.value)} aria-label="Your question" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12.5px] text-[var(--agent-app-muted)]">The agent can't change anything without your tap.</span>
          <Button loading={sending} disabled={text.trim().length < 3} onClick={() => void send()}>
            Ask
          </Button>
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="relative flex max-h-[360px] flex-col gap-3 overflow-y-auto border-t border-[var(--agent-app-border)] p-4">
          {shown.map((h) => (
            <li key={h.id} className="text-[14px]">
              <p className="text-[13px] text-[var(--agent-app-muted)]">
                You asked {relTime(h.created)}: “{h.question}”
              </p>
              {h.status === 'waiting' ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {agentNear === false ? (
                    <p className="text-[13px] text-[var(--agent-app-muted)]">Waiting for the agent — it isn't connected right now. Your question stays here until it is (connect NetSentry to CraftBot).</p>
                  ) : Date.now() - (toDate(h.created)?.getTime() ?? Date.now()) > LATE_MS ? (
                    <p className="text-[13px] text-[var(--agent-app-muted)]">The agent hasn't answered yet. It may be busy or switched off — your question stays here until it answers.</p>
                  ) : (
                    <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
                      <Spinner /> The agent is looking…
                    </p>
                  )}
                  <button type="button" onClick={() => void withdraw(h.id)} className="min-h-[32px] text-[13px] text-[var(--agent-app-muted)] underline hover:text-[var(--agent-app-text)]">
                    Withdraw question
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-1 whitespace-pre-wrap">{h.answer}</p>
                  {(h.changes ?? []).map((id) => {
                    const r = changes.records.find((x) => x.id === id);
                    if (!r) return null;
                    const done: Record<string, string> = { done: 'Done', failed: "Didn't work", rolled_back: 'Didn’t work — put back as it was', cancelled: 'Not done — closed without confirming', expired: 'Not done — nobody confirmed it', approved: 'Confirmed — on its way', executing: 'Happening now', verifying: 'Checking it worked' };
                    return (
                      <div key={id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--agent-app-surface-2)] px-3 py-2">
                        <span className="min-w-0 flex-1 text-[13px]">{r.plain_title || r.title}</span>
                        {r.status === 'planned' ? (
                          can('analyst') && (
                            <Button size="sm" disabled={busy} onClick={() => void ask(async () => previewOf(r), 'Confirm')}>
                              Review
                            </Button>
                          )
                        ) : (
                          <span className="text-[12px] text-[var(--agent-app-muted)]">{done[r.status] ?? r.status}</span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ServerHome(): React.JSX.Element {
  const { can } = useMe();
  const flow = useChange();
  const live = useLive();
  const [backupFor, setBackupFor] = useState<Group | null>(null);
  const [cat, setCat] = useState<CatalogueApp[]>([]);
  const [checking, setChecking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [reconnect, setReconnect] = useState<'reconnect' | 'update' | null>(null);
  useEffect(() => void loadCatalogue().then(setCat), []);
  // v4 §16 (N-B26): reload when anything Home shows changes — no timer. Problems, changes and backup
  // plans are realtime collections; app states move with the live sample (and the apps list).
  const findings = useCollection<Finding>('findings', { filter: 'status = "open" || status = "acknowledged"' });
  const active = useCollection<Remediation>('remediations', { filter: 'status = "planned" || status = "approved" || status = "executing" || status = "verifying"' });
  const plans = useCollection<BackupPlanRecord>('backup_plans');
  const appRecs = useCollection<AppRecordLite>('apps', { filter: 'status = "active"' });
  const monitors = useCollection<SensorLite>('sensors', { filter: 'status != "revoked"' });
  const liveStates = (live.sample?.apps ?? []).map((a) => a.container + (a.running ? '+' : '-')).join(',');
  const signature = useMemo(
    () =>
      [
        findings.records.map((f) => f.id + f.status + f.severity).join(','),
        active.records.map((r) => r.id + r.status).join(','),
        plans.records.length,
        appRecs.records.map((a) => a.id + a.version + a.label + a.display_name).join(','),
        monitors.records.map((m) => m.id + m.status).join(','),
        liveStates,
      ].join('|'),
    [findings.records, active.records, plans.records.length, appRecs.records, monitors.records, liveStates],
  );
  // Cached in the store (v4 §17): coming back to Home shows the last overview at once.
  const overview = useOp<Overview>('home.overview', {}, { deps: signature });
  const data = overview.data;
  const failed = !!overview.error && !data;
  const updated = useUpdatedWords(live.at, live.fresh);

  if (!data) {
    return failed ? (
      <p className="py-20 text-center text-[14px] text-[var(--agent-app-muted)]">NetSentry couldn't load this page. Reload to try again.</p>
    ) : (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const server = data.server;
  if (!server || !server.monitor) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <p className="text-[20px] font-semibold">Let NetSentry look after this server</p>
        <p className="text-[14px] text-[var(--agent-app-muted)]">It needs a small helper — the monitor — running on this server. Setting it up takes one command.</p>
        {can('admin') ? (
          <Button onClick={() => go('setup')}>
            <PlusIcon size={16} /> Set it up
          </Button>
        ) : (
          <p className="text-[14px] text-[var(--agent-app-muted)]">An admin needs to set NetSentry up first.</p>
        )}
      </div>
    );
  }

  const silent = server.monitor.status !== 'online';
  const outdated = !!server.monitor.latest && newerVersion(server.monitor.latest, server.monitor.version);
  const isRunning = (a: HomeApp): boolean => live.app(a.container)?.running ?? a.running;
  const known = (a: HomeApp): boolean => !!live.app(a.container) || a.state !== 'unknown';
  const running = data.apps.filter(isRunning).length;
  const stopped = data.apps.filter((a) => !isRunning(a) && known(a));
  const todo = data.todo;
  // The same word the tiles use: only "Urgent" tiles count as urgent (high reads "Important").
  const urgent = todo.filter((g) => g.severity === 'critical').length;
  const serious = todo.some((g) => g.severity === 'critical' || g.severity === 'high');
  const headline = silent
    ? `${server.name} isn't reporting`
    : todo.length === 0 && stopped.length === 0
      ? "Everything's running and safe"
      : todo.length === 0
        ? `${stopped.length === 1 ? stopped[0]!.name + ' is' : stopped.length + ' apps are'} stopped`
        : `${todo.length === 1 ? 'One thing needs' : `${todo.length} things need`} you${urgent ? ` — ${urgent === todo.length ? (urgent === 1 ? "it's" : 'all') : urgent} urgent` : ''}`;
  const tone: Tone = silent || serious || stopped.length ? 'bad' : todo.length ? 'warn' : 'good';
  const shownTodo = showAll ? todo : todo.slice(0, 6);
  const s = live.sample;
  const cpu = s?.cpu ?? server.cpu;
  const mem = s?.mem_pct ?? server.mem_pct;
  const disk = s?.disk_pct ?? server.disk_pct;
  const checkNow = async (): Promise<void> => {
    setChecking(true);
    try {
      const r = await runOp<{ monitor: { online: boolean } | null }>('assets.rescan', { asset_id: server.asset_id });
      toast.success(r.monitor && !r.monitor.online ? "The monitor isn't running — start it, then try again." : 'Checking everything now — results arrive over the next minute.');
    } catch {
      /* toast shown */
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {/* 1. status */}
      <section className="grid grid-cols-1 items-center gap-6 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex items-start gap-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ color: TONE_COLOR[tone], background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR[tone]} 13%)` }}>
              {tone === 'good' ? <CheckCircleIcon size={22} /> : <ShieldIcon size={22} />}
            </span>
            <div className="min-w-0">
              <h1 className="text-[21px] font-semibold leading-tight [text-wrap:balance]">{headline}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--agent-app-muted)]">
                {live.fresh && (
                  <>
                    <LivePill />
                    <span>·</span>
                  </>
                )}
                <a href={href('server')} className="hover:underline">
                  {server.name}
                </a>
                {server.monitor.os && <span>· {server.monitor.os}</span>}
                <span>
                  · {silent ? `last heard from ${relTime(server.monitor.last_seen)}` : `${running} of ${data.apps.length} app${data.apps.length === 1 ? '' : 's'} running`}
                </span>
                {stopped.length > 0 && (
                  <a href={href('apps')} className="hover:underline" style={{ color: TONE_COLOR.bad }} title={stopped.map((a) => a.name).join(', ')}>
                    · {stopped.length <= 2 ? `${stopped.map((a) => a.name).join(' and ')} stopped` : `${stopped.length} apps stopped`}
                  </a>
                )}
                {server.reboot_required ? <span>· needs a restart</span> : null}
                {updated && <span>· {updated}</span>}
              </p>
            </div>
          </div>
          {!silent && outdated && (
            <p className="mt-3 text-[13px]">
              A newer monitor is ready ({server.monitor.version || '?'} → {server.monitor.latest}) — it brings fixes for this server's terminal and live numbers.
            </p>
          )}
          {silent && (
            <p className="mt-3 text-[13px]">
              NetSentry can't see or change anything on {server.name} until its monitor reports again — one command on the server brings it back.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {silent && can('admin') && <Button onClick={() => setReconnect('reconnect')}>Reconnect the monitor</Button>}
            {!silent && outdated && can('admin') && (
              <Button variant="secondary" onClick={() => setReconnect('update')}>
                Update the monitor
              </Button>
            )}
            {todo.length > 0 && !silent && <Button onClick={() => document.getElementById('needs-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>See what needs you</Button>}
            {can('analyst') && (
              <Button variant="secondary" loading={checking} onClick={() => void checkNow()}>
                Check now
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2.5" aria-label={live.fresh ? 'Server load, live' : 'Server load'}>
          <Meter label={live.fresh && live.history.cpu.length > 1 ? 'Processor · last 80 s' : 'Processor'} pct={cpu} points={live.fresh ? live.history.cpu : undefined} />
          <Meter label={live.fresh && live.history.mem.length > 1 ? 'Memory · last 80 s' : 'Memory'} pct={mem} points={live.fresh ? live.history.mem : undefined} />
          <Meter label="Fullest disk" pct={disk} extra={s?.disk_free ? `${bytesShort(s.disk_free)} free` : undefined} />
        </div>
      </section>

      {/* 2. needs you */}
      {todo.length > 0 ? (
        <section id="needs-you" className="scroll-mt-4 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          <CardHead title="Needs you">
            {data.handling > 0 && (
              <a href={href('issues/handled')} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
                {data.handling} more being handled →
              </a>
            )}
          </CardHead>
          {/* Needs you shows the first six and "Show N more" (Ahmad preferred it to a scrolling box, 2026-10-02). */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 p-4">
            {shownTodo.map((g) => (
              <ToFix key={g.key} group={g} server={server} apps={data.apps} onBackup={setBackupFor} onReconnect={setReconnect} ask={flow.ask} busy={flow.working} />
            ))}
          </div>
          {todo.length > 6 && !showAll && (
            <button type="button" className="min-h-[44px] w-full border-t border-[var(--agent-app-border)] text-[13px] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-surface-2)]" onClick={() => setShowAll(true)}>
              Show {todo.length - 6} more
            </button>
          )}
        </section>
      ) : (
        !silent && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
            <span style={{ color: TONE_COLOR.good }}>
              <CheckCircleIcon size={24} />
            </span>
            <p className="text-[15px] font-medium">Nothing needs you right now</p>
            {data.handling > 0 && (
              <a href={href('issues/handled')} className="ml-auto text-[13px] text-[var(--agent-app-muted)] hover:underline">
                {data.handling} being handled →
              </a>
            )}
          </div>
        )
      )}

      {/* 3. apps beside activity */}
      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          <CardHead title="Your apps">
            {can('admin') && (
              <a href={href('install')} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
                Add an app
              </a>
            )}
            <a href={href('apps')} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
              All apps →
            </a>
          </CardHead>
          {data.apps.length ? (
            <AppRows apps={data.apps} cat={cat} ask={flow.ask} busy={flow.working} />
          ) : (
            <p className="px-4 py-6 text-[14px] text-[var(--agent-app-muted)]">No apps found on this server yet.</p>
          )}
        </section>
        <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          <CardHead title="Recent activity">
            <a href={href('activity')} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
              All activity →
            </a>
          </CardHead>
          <RecentActivity assetId={server.asset_id} askUndo={flow.askUndo} />
        </section>
      </div>

      {/* 4. ask */}
      <AskAgent ask={flow.ask} busy={flow.working} />

      {backupFor && backupFor.action.kind === 'backup' && (
        <BackupDialog open server={server} appIds={backupFor.action.app_ids} names={backupFor.apps} onClose={() => setBackupFor(null)} />
      )}
      <ReconnectDrawer open={reconnect !== null} mode={reconnect ?? 'reconnect'} onClose={() => setReconnect(null)} />
      {flow.element}
    </div>
  );
}

/** The server's own things to fix (not any app's), as Home groups them — for the Server page. */
export function ServerToFix(): React.JSX.Element | null {
  const flow = useChange();
  const [backupFor, setBackupFor] = useState<Group | null>(null);
  const [reconnect, setReconnect] = useState<'reconnect' | 'update' | null>(null);
  const findings = useCollection<Finding>('findings', { filter: 'status = "open" || status = "acknowledged"' });
  const signature = findings.records.map((f) => f.id + f.status + f.severity).join(',');
  const data = useOp<Overview>('home.overview', {}, { deps: signature }).data;
  if (!data || !data.server) return null;
  const mine = data.todo.filter((g) => g.apps.length === 0 || g.rule === 'HOST-002');
  if (!mine.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold">To fix on the server</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {mine.map((g) => (
          <ToFix key={g.key} group={g} server={data.server} apps={data.apps} onBackup={setBackupFor} onReconnect={setReconnect} ask={flow.ask} busy={flow.working} />
        ))}
      </div>
      {backupFor && backupFor.action.kind === 'backup' && data.server && (
        <BackupDialog open server={data.server} appIds={backupFor.action.app_ids} names={backupFor.apps} onClose={() => setBackupFor(null)} />
      )}
      <ReconnectDrawer open={reconnect !== null} mode={reconnect ?? 'reconnect'} onClose={() => setReconnect(null)} />
      {flow.element}
    </section>
  );
}
