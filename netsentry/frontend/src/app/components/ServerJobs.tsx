/**
 * The server's everyday and server jobs (v4 plan §7.5–§7.10): disk space, programs, scheduled jobs,
 * the firewall, who can sign in, and reaching it from away. Each screen reads the server when it
 * opens; each button prepares a change an admin confirms (the agent may prepare them too).
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Pill, SearchInput, Select, Spinner, Textarea } from '../../kit/index.ts';
import { NamedSwitch } from './NamedSwitch.tsx';
import { BoxIcon, ShieldIcon } from './icons.tsx';
import { TONE_COLOR } from './visual.tsx';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { newerVersion, ReconnectDrawer } from './Reconnect.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { appName } from '../lib/apps.ts';
import { go } from '../lib/nav.ts';
import { bytesWords, readServer, useServerRead } from '../lib/serverRead.ts';
import type { AppRecord, Sensor } from '../lib/types.ts';
import { useAfterChange, useChange, Working, type Preview } from './Controls.tsx';

function Box({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">{children}</div>;
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">{children}</div>;
}

function Head({ title, loading, reload, children }: { title: string; loading: boolean; reload: () => void; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button size="sm" variant="ghost" loading={loading} onClick={reload}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function Asking({ loading, error, has }: { loading: boolean; error: string; has: boolean }): React.JSX.Element | null {
  if (error) return <p className="text-[13px] text-red-700 dark:text-red-400">{error}</p>;
  if (!has && loading)
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
        <Spinner /> Asking the server…
      </p>
    );
  return null;
}

// ------------------------------------------------------------------ disk space (§7.5)

interface Disk {
  filesystems: Array<{ mount: string; total: number; used: number; free: number }>;
  docker: null | {
    images: { count: number; size: number; unused: number; unused_size: number };
    rollback_pins: number;
    build_cache: { size: number; reclaimable: number };
    volumes: { count: number; size: number; unused: number };
  };
  journal: number | null;
  folders: Array<{ path: string; size: number }>;
  folders_partial: boolean;
  netsentry: { rollback_copies: number; bin: number };
}

export function DiskPanel(): React.JSX.Element {
  const { can } = useMe();
  const r = useServerRead<Disk>('disk.usage');
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  const d = r.data;
  const clean = (what: string): void => void flow.ask(() => runOp<Preview>('disk.cleanup', { what }), 'Clean up now');
  const items: Array<{ what: string; label: string; size: number; hint: string }> = d
    ? [
        ...(d.docker ? [
          { what: 'docker_images', label: `Docker images no app uses (${d.docker.images.unused} of ${d.docker.images.count})`, size: d.docker.images.unused_size, hint: 'Never an image an app runs, and never the copies Roll back needs.' },
          { what: 'docker_build_cache', label: 'Docker build cache', size: d.docker.build_cache.reclaimable, hint: 'Rebuilt by itself the next time something is built here.' },
        ] : []),
        ...(d.journal !== null ? [{ what: 'journal', label: 'System journal (logs)', size: Math.max(0, d.journal - 200e6), hint: 'Shrinks it to 200 MB; the oldest entries go.' }] : []),
        { what: 'netsentry_rollbacks', label: 'Roll-back copies of updates', size: d.netsentry.rollback_copies, hint: 'Copies older than 3 days go — those updates can then no longer be rolled back.' },
        { what: 'bin', label: 'NetSentry’s bin', size: d.netsentry.bin, hint: 'Deleted files and removed apps — they can no longer come back.' },
      ]
    : [];
  return (
    <div className="flex flex-col gap-4">
      <Head title="Disk space" loading={r.loading} reload={r.reload}>
        {flow.status && <Working status={flow.status} />}
      </Head>
      <Asking loading={r.loading} error={r.error} has={!!d} />
      {d && (
        <>
          <Box>
            {d.filesystems.map((f) => {
              const pct = Math.round((100 * f.used) / f.total);
              return (
                <Row key={f.mount}>
                  <span className="min-w-0 flex-1 font-mono text-[14px]">{f.mount}</span>
                  <span className="text-[13px] text-[var(--agent-app-muted)]">
                    {bytesWords(f.free)} free of {bytesWords(f.total)}
                  </span>
                  <div className="h-2 w-full overflow-hidden rounded bg-[var(--agent-app-surface-2)]" aria-label={`${pct}% used`}>
                    <div className="h-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--agent-app-danger, #dc2626)' : pct > 75 ? '#d97706' : 'var(--agent-app-accent)' }} />
                  </div>
                </Row>
              );
            })}
          </Box>
          <h3 className="px-1 text-[13px] font-semibold">What can be cleaned up safely</h3>
          <Box>
            {items.map((i) => (
              <Row key={i.what}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">{i.label}</span>
                  <span className="block text-[12px] text-[var(--agent-app-muted)]">{i.hint}</span>
                </span>
                <span className="text-[13px] font-medium">{bytesWords(i.size)}</span>
                {can('analyst') && (
                  <Button size="sm" variant="secondary" disabled={i.size <= 0 || flow.working} onClick={() => clean(i.what)}>
                    Clean up
                  </Button>
                )}
              </Row>
            ))}
            {d.docker && d.docker.volumes.unused > 0 && (
              <Row>
                <span className="min-w-0 flex-1 text-[13px] text-[var(--agent-app-muted)]">
                  {d.docker.volumes.unused} Docker volume{d.docker.volumes.unused === 1 ? '' : 's'} no app uses — NetSentry never deletes volumes (they hold data); remove one in the terminal if you're sure.
                </span>
              </Row>
            )}
          </Box>
          <h3 className="px-1 text-[13px] font-semibold">Biggest folders</h3>
          <Box>
            {d.folders.length === 0 && <p className="px-4 py-3 text-[14px] text-[var(--agent-app-muted)]">Nothing over 1 MB in the folders NetSentry may look at.</p>}
            <div className="relative max-h-[440px] overflow-y-auto">
              {d.folders.map((f) => (
                <Row key={f.path}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:underline" onClick={() => go('server/files')}>
                    {f.path}
                  </button>
                  <span className="text-[13px]">{bytesWords(f.size)}</span>
                </Row>
              ))}
            </div>
            {d.folders_partial && <p className="px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">Measuring stopped after 10 seconds — some folders may be bigger.</p>}
          </Box>
        </>
      )}
      {flow.element}
    </div>
  );
}

// ------------------------------------------------------------------ programs (§7.6)

interface Proc {
  pid: number;
  name: string;
  cpu_pct?: number;
  cpu_seconds?: number;
  memory: number;
  start: string;
  user: string;
  cmdline: string;
  container: string;
  protected: string;
}

export function ProcessesPanel(): React.JSX.Element {
  const { can } = useMe();
  const r = useServerRead<{ processes: Proc[]; cpu_note: string }>('process.list');
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  return (
    <div className="flex flex-col gap-3">
      <Head title="Busiest programs" loading={r.loading} reload={r.reload}>
        {flow.status && <Working status={flow.status} />}
      </Head>
      <Asking loading={r.loading} error={r.error} has={!!r.data} />
      {r.data && (
        <Box>
          <div className="relative max-h-[440px] overflow-y-auto">
            {r.data.processes.map((p) => (
              <Row key={`${p.pid}-${p.start}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">
                    {p.name} <span className="font-normal text-[var(--agent-app-muted)]">· {p.pid}{p.user ? ` · ${p.user}` : ''}</span>
                  </span>
                  {p.cmdline && <span className="block truncate font-mono text-[12px] text-[var(--agent-app-muted)]">{p.cmdline}</span>}
                </span>
                {p.container && <Pill tone="info">app: {p.container}</Pill>}
                <span className="w-16 text-right text-[13px]">{p.cpu_pct !== undefined ? `${p.cpu_pct}%` : `${p.cpu_seconds}s`}</span>
                <span className="w-20 text-right text-[13px]">{bytesWords(p.memory)}</span>
                {can('analyst') &&
                  (p.protected ? (
                    <span className="w-16 text-right text-[12px] text-[var(--agent-app-muted)]" title={p.protected}>
                      —
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('processes.stop', { pid: p.pid, start: p.start, name: p.name, user: p.user }), 'Stop it', true)}>
                      Stop
                    </Button>
                  ))}
              </Row>
            ))}
          </div>
          <p className="px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">
            {r.data.cpu_note}. A dash means NetSentry won't stop it: the operating system, remote login, Docker, NetSentry itself — and programs inside an app (stop the app instead).
          </p>
        </Box>
      )}
      {flow.element}
    </div>
  );
}

// ------------------------------------------------------------------ scheduled jobs (§7.9)

interface Job {
  kind: 'cron' | 'timer' | 'task';
  id: string;
  file?: string;
  user?: string;
  schedule?: string;
  when?: string;
  command?: string;
  unit?: string;
  description?: string;
  runs?: string;
  next?: string;
  name?: string;
  path?: string;
  paused: boolean;
  ours?: boolean;
  /** made in NetSentry (v4 §17, N-B42): only these can be deleted */
  made?: boolean;
}

interface Schedules {
  jobs: Job[];
  why_not?: string;
  /** monitor 0.4.7+: whether a new job can be made here, and as whom */
  create?: { available: boolean; reason?: string; runs_as?: string; shell?: string };
}

type Every = 'minutes' | 'hour' | 'day' | 'week' | 'start';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVERY_OPTIONS: Array<{ value: Every; label: string }> = [
  { value: 'minutes', label: 'Every few minutes' },
  { value: 'hour', label: 'Every hour' },
  { value: 'day', label: 'Every day' },
  { value: 'week', label: 'Every week' },
  { value: 'start', label: 'When the server starts' },
];

interface Draft {
  name: string;
  command: string;
  every: Every;
  n: string;
  minute: string;
  at: string;
  day: string;
}

const NEW_JOB: Draft = { name: '', command: '', every: 'day', n: '15', minute: '0', at: '03:00', day: '1' };

function whenOf(d: Draft): Record<string, string | number> {
  if (d.every === 'minutes') return { every: 'minutes', n: Number(d.n) };
  if (d.every === 'hour') return { every: 'hour', minute: Number(d.minute) };
  if (d.every === 'day') return { every: 'day', at: d.at };
  if (d.every === 'week') return { every: 'week', day: Number(d.day), at: d.at };
  return { every: 'start' };
}

function draftWords(d: Draft): string {
  if (d.every === 'minutes') return `every ${d.n} minutes`;
  if (d.every === 'hour') return `every hour at :${d.minute.padStart(2, '0')}`;
  if (d.every === 'day') return `every day at ${d.at}`;
  if (d.every === 'week') return `every ${DAY_NAMES[Number(d.day)]} at ${d.at}`;
  return 'when the server starts';
}

function draftProblem(d: Draft): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,59}$/.test(d.name.trim())) return 'A name: letters, numbers, spaces and - _ . ( ) — up to 60.';
  if (/netsentry/i.test(d.name)) return 'Pick another name — NetSentry’s own jobs are called that.';
  if (!d.command.trim()) return 'What should it run?';
  if (d.command.length > 1000) return 'Up to 1000 characters.';
  if (d.every === 'hour' && !(/^\d{1,2}$/.test(d.minute) && Number(d.minute) <= 59)) return 'A minute from 0 to 59.';
  if ((d.every === 'day' || d.every === 'week') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.at)) return 'A time, like 03:00.';
  return '';
}

/** Make a job: a name, one command, one of a few schedules. */
function NewJobDialog({ open, onClose, onNext, runsAs, shell }: { open: boolean; onClose: () => void; onNext: (d: Draft) => void; runsAs: string; shell: string }): React.JSX.Element {
  const [d, setD] = useState<Draft>(NEW_JOB);
  const set = (patch: Partial<Draft>): void => setD((x) => ({ ...x, ...patch }));
  const problem = draftProblem(d);
  const windows = shell === 'PowerShell';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New scheduled job"
      description={`It runs one command on a schedule, as ${runsAs} — with full rights, like a command typed in the terminal. You see exactly what will be made before it is.`}
      footer={
        <div className="flex items-center justify-end gap-2">
          {d.name && problem && <span className="mr-auto text-[12.5px] text-[var(--agent-app-muted)]">{problem}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!problem}
            onClick={() => {
              onNext(d);
              setD(NEW_JOB);
            }}
          >
            Next…
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Name" value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Back up photos" />
        <Textarea
          label={`What to run (${shell}, one line)`}
          rows={3}
          className="font-mono text-[12.5px]"
          value={d.command}
          maxLength={1000}
          onChange={(e) => set({ command: e.target.value.replace(/[\r\n]+/g, ' ') })}
          placeholder={windows ? "Remove-Item 'C:\\Temp\\*.log' -Force" : 'tar czf /backup/photos.tgz /srv/photos'}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="How often" value={d.every} onChange={(e) => set({ every: e.target.value as Every })} options={EVERY_OPTIONS} />
          {d.every === 'minutes' && (
            <Select label="Every" value={d.n} onChange={(e) => set({ n: e.target.value })} options={['5', '10', '15', '30'].map((n) => ({ value: n, label: `${n} minutes` }))} />
          )}
          {d.every === 'hour' && <Input label="At minute" inputMode="numeric" value={d.minute} onChange={(e) => set({ minute: e.target.value.replace(/\D/g, '').slice(0, 2) })} />}
          {d.every === 'week' && <Select label="On" value={d.day} onChange={(e) => set({ day: e.target.value })} options={DAY_NAMES.map((n, i) => ({ value: String(i), label: n }))} />}
          {(d.every === 'day' || d.every === 'week') && <Input label="At" type="time" value={d.at} onChange={(e) => set({ at: e.target.value })} />}
        </div>
        <p className="rounded-lg bg-[var(--agent-app-surface-2)] px-3 py-2 text-[13px]">
          Runs <b>{draftWords(d)}</b>, as {runsAs}
          {d.every === 'day' || d.every === 'week' || d.every === 'hour' ? ' (the server’s own clock)' : ''}.
        </p>
      </div>
    </Dialog>
  );
}

export function SchedulesPanel(): React.JSX.Element {
  const { can } = useMe();
  const r = useServerRead<Schedules>('schedule.list');
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  const [making, setMaking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const latest = useOp<{ version?: string }>('sensors.install-info', {}, { freshMs: 300000 }).data?.version || '';
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"', sort: '-last_seen' });
  const mon = monitors.records[0];
  const create = r.data?.create;
  // An older monitor lists jobs but can't make one: say so, with the update.
  const olderMonitor = !!r.data && !create && !r.data.why_not && !!mon && !!latest && newerVersion(latest, mon.version);
  const words = (j: Job): string => (j.kind === 'cron' ? (j.made && j.name ? j.name : `${j.when}: ${j.command}`) : j.kind === 'timer' ? j.description || j.unit || '' : j.name || '');
  const madeCommand = (j: Job): string => (j.description ?? '').replace(/^Made in NetSentry: /, '');
  const toggle = (j: Job): void =>
    void flow.ask(
      () => runOp<Preview>('schedules.set', { kind: j.kind, pause: !j.paused, file: j.file, id: j.id, unit: j.unit, name: j.name, path: j.path, words: words(j).slice(0, 100) }),
      j.paused ? 'Resume it' : 'Pause it',
    );
  const madeFirst = (a: Job, b: Job): number => Number(!!b.made) - Number(!!a.made);
  const groups: Array<[string, Job[]]> = r.data
    ? [
        ['Timers (systemd)', r.data.jobs.filter((j) => j.kind === 'timer')],
        ['Cron jobs', r.data.jobs.filter((j) => j.kind === 'cron').sort(madeFirst)],
        ['Scheduled tasks', r.data.jobs.filter((j) => j.kind === 'task').sort(madeFirst)],
      ]
    : [];
  return (
    <div className="flex flex-col gap-3">
      <Head title="Scheduled jobs" loading={r.loading} reload={r.reload}>
        {flow.status && <Working status={flow.status} />}
        {can('analyst') && create && (
          <Button size="sm" variant="secondary" disabled={!create.available || flow.working} onClick={() => setMaking(true)}>
            New scheduled job
          </Button>
        )}
      </Head>
      <Asking loading={r.loading} error={r.error} has={!!r.data} />
      {r.data?.why_not && <p className="text-[13px] text-[var(--agent-app-muted)]">{r.data.why_not}</p>}
      {can('analyst') && create && !create.available && create.reason && <p className="text-[13px] text-[var(--agent-app-muted)]">New jobs: {create.reason}</p>}
      {can('analyst') && olderMonitor && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1">
            This server's monitor is version {mon?.version || '?'}; NetSentry has {latest}. Update it to make new scheduled jobs here (and see when each one runs).
          </span>
          <Button size="sm" variant="secondary" onClick={() => setUpdating(true)}>
            Update the monitor
          </Button>
        </div>
      )}
      <ReconnectDrawer open={updating} mode="update" onClose={() => setUpdating(false)} />
      {groups.map(([title, jobs]) =>
        jobs.length ? (
          <section key={title} className="flex flex-col gap-2">
            <h3 className="px-1 text-[13px] font-semibold">{title}</h3>
            <Box>
              <div className="relative max-h-[440px] overflow-y-auto">
                {jobs.map((j) => (
                  <Row key={j.kind + j.id}>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[14px]">
                        {j.kind === 'cron' ? (j.made && j.name ? j.name : j.when) : j.kind === 'timer' ? j.description || j.unit : j.name}
                        {j.made && <Pill tone="info">made in NetSentry</Pill>}
                        {j.paused && <Pill tone="warn">paused</Pill>}
                      </span>
                      {j.kind === 'task' && (
                        <span className="block truncate text-[12.5px] text-[var(--agent-app-muted)]">
                          {j.when ? `Runs ${j.when}` : j.path}
                          {!j.made && j.description ? ` · ${j.description}` : ''}
                        </span>
                      )}
                      {j.kind === 'cron' && j.made && j.name && <span className="block truncate text-[12.5px] text-[var(--agent-app-muted)]">Runs {j.when}</span>}
                      {(j.kind !== 'task' || (j.made && madeCommand(j))) && (
                        <span className="block truncate font-mono text-[12px] text-[var(--agent-app-muted)]">
                          {j.kind === 'cron' ? `${j.user ? j.user + ' · ' : ''}${j.command}` : j.kind === 'timer' ? `${j.unit} → ${j.runs}` : madeCommand(j)}
                        </span>
                      )}
                    </span>
                    {can('analyst') && !j.ours && (
                      <Button size="sm" variant="ghost" disabled={flow.working} onClick={() => toggle(j)}>
                        {j.paused ? 'Resume' : 'Pause'}
                      </Button>
                    )}
                    {can('analyst') && j.made && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={flow.working}
                        onClick={() =>
                          void flow.ask(() => runOp<Preview>('schedules.delete', { kind: j.kind, file: j.file, name: j.name, path: j.path, words: words(j).slice(0, 100) }), 'Delete it', true)
                        }
                      >
                        Delete
                      </Button>
                    )}
                  </Row>
                ))}
              </div>
            </Box>
          </section>
        ) : null,
      )}
      {r.data && r.data.jobs.length === 0 && !r.data.why_not && <p className="text-[14px] text-[var(--agent-app-muted)]">No scheduled jobs on this server.</p>}
      {create?.available && (
        <NewJobDialog
          open={making}
          onClose={() => setMaking(false)}
          runsAs={create.runs_as ?? 'root'}
          shell={create.shell ?? 'sh'}
          onNext={(d) => {
            setMaking(false);
            void flow.ask(() => runOp<Preview>('schedules.create', { name: d.name.trim(), command: d.command.trim(), when: JSON.stringify(whenOf(d)) }), 'Make it');
          }}
        />
      )}
      {flow.element}
    </div>
  );
}

// ------------------------------------------------------------------ firewall (§7.7)

interface Rule {
  to: string;
  port: number | null;
  proto: string;
  action: string;
  from: string;
  ours?: boolean;
  comment?: string;
  service?: string;
  /** Windows: every rule, with its id (to switch it), name, group, program, profiles */
  id?: string;
  name?: string;
  group?: string;
  enabled?: boolean;
  ports?: string;
  program?: string;
  profiles?: string;
}
interface Firewall {
  backend: string;
  enabled: boolean;
  default_incoming?: string;
  rules: Rule[];
  ssh_ports: number[];
  can_change: boolean;
  /** Windows: each rule can be switched off and on */
  can_toggle?: boolean;
  profiles?: Array<{ name: string; enabled: boolean }>;
  why_not?: string;
  note?: string;
}

const FROM = (f: string): string => (f === 'any' ? 'every network' : f === 'local' || /^(10\.0\.0\.0\/8|172\.16\.0\.0\/12|192\.168\.0\.0\/16)$/.test(f) ? 'your local network' : f);

/** Who a rule is about, as a small chip (anyone is the one to notice). */
function FromChip({ from }: { from: string }): React.JSX.Element {
  const anyone = from === 'any';
  const words = anyone ? 'anyone' : FROM(from) === 'your local network' ? 'local network' : from;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={anyone ? { color: TONE_COLOR.warn, background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.warn} 12%)` } : { color: 'var(--agent-app-muted)', background: 'var(--agent-app-surface-2)' }}
    >
      {words}
    </span>
  );
}

function Chip({ children, mono = false }: { children: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return <span className={`inline-flex items-center rounded-full bg-[var(--agent-app-surface-2)] px-2 py-0.5 text-[11.5px] text-[var(--agent-app-muted)] ${mono ? 'font-mono' : ''}`}>{children}</span>;
}

const PROFILE_WORDS: Record<string, { title: string; hint: string }> = {
  Private: { title: 'Home networks', hint: 'your own Wi-Fi or office' },
  Public: { title: 'Public networks', hint: 'cafés, hotels, airports' },
  Domain: { title: 'Work domain', hint: 'a company network' },
};

type View = 'open' | 'programs' | 'blocked' | 'off';

/**
 * One row on screen. Windows keeps a separate rule per protocol (TCP, UDP), per kind of network and per
 * copy of a program — the same thing to a person — so rules alike in everything else are one row, with
 * one switch for them all.
 */
interface RuleRow {
  key: string;
  rules: Rule[];
  first: Rule;
  protos: string[];
  networks: string[];
  copies: number;
}

const NETWORK_WORDS: Record<string, string> = { Private: 'home', Public: 'public', Domain: 'work domain', Any: 'every network' };

/**
 * The firewall (v4 §7.7, redesigned §17): is it on (per kind of network on Windows), every rule that lets
 * something in — ports, programs, blocks, and the ones switched off — and the buttons that change them:
 * open or block a port, switch a rule or a network off or on, close what NetSentry opened. Every change
 * opens the side panel, an admin confirms, and Undo puts it back.
 */
export function FirewallPanel(): React.JSX.Element {
  const { can } = useMe();
  const r = useServerRead<Firewall>('firewall.status');
  const apps = useCollection<AppRecord>('apps', { filter: 'status = "active"' });
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  const [adding, setAdding] = useState<null | 'allow' | 'block'>(null);
  const [port, setPort] = useState('');
  const [proto, setProto] = useState<'tcp' | 'udp'>('tcp');
  const [source, setSource] = useState('local');
  const [view, setView] = useState<View>('open');
  const [q, setQ] = useState('');
  const byPort = useMemo(() => {
    const m: Record<number, string> = {};
    for (const a of apps.records) for (const e of a.endpoints ?? []) if (e.port) m[e.port] = appName(a);
    return m;
  }, [apps.records]);
  const f = r.data;
  const consolePort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  const label = (rule: Rule): string => {
    if (rule.name) return rule.name.replace(/^NetSentry:\s*/, '');
    if (rule.port && f?.ssh_ports.includes(rule.port)) return 'Remote login (SSH)';
    if (rule.port && String(rule.port) === consolePort) return 'NetSentry';
    if (rule.port && byPort[rule.port]) return byPort[rule.port]!;
    return rule.service ? rule.service : rule.to;
  };
  const appPorts = Array.from(
    new Map(
      apps.records.flatMap((a) =>
        (a.endpoints ?? [])
          .filter((e) => e.port && e.bind !== '127.0.0.1' && e.bind !== '::1')
          .map((e) => [e.port, { value: String(e.port), label: `${appName(a)} — port ${e.port}` }] as const),
      ),
    ).values(),
  );
  const canChange = can('analyst') && !!f?.can_change;
  const rules = f?.rules ?? [];
  const isOff = (x: Rule): boolean => x.enabled === false;
  const isBlock = (x: Rule): boolean => x.action === 'block' || x.action === 'deny' || x.action === 'reject';
  const programOf = (x: Rule): string => (x.program ? x.program.split(/[\\/]/).pop()!.toLowerCase() : '');
  const rowsOf = (list: Rule[]): RuleRow[] => {
    const m = new Map<string, Rule[]>();
    for (const x of list) {
      const k = [label(x), programOf(x), x.action, x.from, x.ports || x.port || '', x.ours ? 1 : 0].join('|');
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return [...m.entries()].map(([key, rs]) => ({
      key,
      rules: rs,
      first: rs[0]!,
      protos: [...new Set(rs.map((r) => r.proto).filter(Boolean))].sort(),
      networks: [...new Set(rs.flatMap((r) => String(r.profiles || '').split(',').map((n) => n.trim())).filter(Boolean))],
      copies: new Set(rs.map((r) => (r.program || '').toLowerCase())).size,
    }));
  };
  const groups: Record<View, RuleRow[]> = {
    open: rowsOf(rules.filter((x) => !isOff(x) && !isBlock(x) && (x.port || x.ports || !x.program))),
    programs: rowsOf(rules.filter((x) => !isOff(x) && !isBlock(x) && !x.port && !x.ports && !!x.program)),
    blocked: rowsOf(rules.filter((x) => !isOff(x) && isBlock(x))),
    off: rowsOf(rules.filter(isOff)),
  };
  const needle = q.trim().toLowerCase();
  const shown = groups[view].filter(({ first: x }) => !needle || `${label(x)} ${x.group ?? ''} ${x.ports ?? x.port ?? ''} ${x.program ?? ''}`.toLowerCase().includes(needle));
  const tabs: Array<[View, string]> = [
    ['open', 'Open ports'],
    ['programs', 'Programs allowed'],
    ['blocked', 'Blocked'],
    ...(f?.can_toggle ? [['off', 'Switched off'] as [View, string]] : []),
  ];
  const sourceOf = (x: Rule): string => (x.from === 'any' ? 'any' : FROM(x.from) === 'your local network' ? 'local' : x.from);
  const on = !!f?.enabled;

  return (
    <div className="flex flex-col gap-4">
      <Head title="Firewall" loading={r.loading} reload={r.reload}>
        {flow.status && <Working status={flow.status} />}
      </Head>
      <Asking loading={r.loading} error={r.error} has={!!f} />
      {f && (
        <>
          {/* 1. is it on */}
          <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ color: on ? TONE_COLOR.good : TONE_COLOR.bad, background: `color-mix(in srgb, var(--agent-app-surface), ${on ? TONE_COLOR.good : TONE_COLOR.bad} 13%)` }}>
                <ShieldIcon size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold">
                  {f.backend ? `${f.backend === 'windows' ? 'Windows Firewall' : f.backend} is ${on ? 'on' : 'off'}` : 'No firewall NetSentry knows'}
                </p>
                <p className="text-[13px] text-[var(--agent-app-muted)]">
                  {on ? 'Only what the rules below let in can reach this server from other devices.' : 'Anything listening can be reached from other devices.'}
                  {f.why_not ? ` ${f.why_not}` : ''}
                </p>
              </div>
              {canChange && (
                <div className="flex flex-wrap gap-2">
                  {!on && !f.profiles?.length && (
                    <Button onClick={() => void flow.ask(() => runOp<Preview>('firewall.change', { action: 'enable', keep_open: consolePort }), 'Switch it on')}>Switch it on</Button>
                  )}
                  <Button variant="secondary" onClick={() => (setAdding('allow'), setPort(appPorts[0]?.value ?? ''), setSource('local'))}>
                    Open a port
                  </Button>
                  <Button variant="secondary" onClick={() => (setAdding('block'), setPort(''), setSource('any'))}>
                    Block a port
                  </Button>
                </div>
              )}
            </div>
            {!!f.profiles?.length && (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {['Private', 'Public', 'Domain'].map((name) => {
                  const p = f.profiles!.find((x) => x.name === name);
                  if (!p) return null;
                  const w = PROFILE_WORDS[name]!;
                  return (
                    <div key={name} className="flex items-center gap-3 rounded-lg border border-[var(--agent-app-border)] px-3 py-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.enabled ? TONE_COLOR.good : TONE_COLOR.bad }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium">{w.title}</span>
                        <span className="block text-[12px] text-[var(--agent-app-muted)]">{w.hint}</span>
                      </span>
                      <NamedSwitch
                        checked={p.enabled}
                        disabled={!canChange || flow.working}
                        label={<span className="text-[12px] text-[var(--agent-app-muted)]">{p.enabled ? 'On' : 'Off'}</span>}
                        onCheckedChange={(v) => void flow.ask(() => runOp<Preview>('firewall.change', { action: 'profile', profile: name, enable: String(v) }), v ? 'Switch it on' : 'Switch it off', !v)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. the rules */}
          <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-3 py-2.5">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rules">
                {tabs.map(([key, words]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={`rounded-md px-2.5 py-1.5 text-[13px] ${view === key ? 'bg-[var(--agent-app-selected)] font-medium' : 'text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-surface-2)]'}`}
                  >
                    {words} <span className="tabular-nums text-[var(--agent-app-muted)]">{groups[key].length}</span>
                  </button>
                ))}
              </div>
              <div className="ml-auto w-full sm:w-56">
                <SearchInput onSearch={setQ} placeholder="Find a rule" label="Find a rule" />
              </div>
            </div>
            {shown.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-[var(--agent-app-muted)]">
                {needle ? 'No rule matches.' : view === 'blocked' ? 'Nothing is blocked on purpose — with the firewall on, anything not let in is blocked anyway.' : view === 'off' ? 'No rule is switched off.' : 'None.'}
              </p>
            ) : (
              <ul className="relative max-h-[520px] overflow-y-auto">
                {shown.slice(0, 400).map(({ key, rules: rs, first: x, protos, networks, copies }) => (
                  <li key={key} className="flex items-center gap-3 border-t border-[var(--agent-app-border)] px-4 py-2.5 first:border-t-0">
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-semibold"
                      style={isBlock(x) ? { color: TONE_COLOR.bad, background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.bad} 12%)` } : { background: 'var(--agent-app-surface-2)', color: 'var(--agent-app-muted)' }}
                      aria-hidden
                    >
                      {x.port ? x.port : x.program ? <BoxIcon size={16} /> : <ShieldIcon size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-[14px] ${isOff(x) ? 'text-[var(--agent-app-muted)]' : ''}`}>{label(x)}</span>
                        {x.ours && <Pill tone="accent">NetSentry</Pill>}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {(x.ports || x.port) ? <Chip mono>{`${x.ports || x.port}${protos.length ? `/${protos.join('+')}` : ''}`}</Chip> : protos.length > 0 && <Chip mono>{protos.join(' + ')}</Chip>}
                        <FromChip from={x.from} />
                        {x.program && <Chip>{x.program.split(/[\\/]/).pop()}{copies > 1 ? ` · ${copies} copies` : ''}</Chip>}
                        {networks.length > 0 && <Chip>{networks.includes('Any') ? 'every network' : networks.map((n) => NETWORK_WORDS[n] ?? n).join(', ')}</Chip>}
                        {rs.length > 1 && <span className="text-[11.5px] text-[var(--agent-app-muted)]">{rs.length} rules</span>}
                      </span>
                    </span>
                    {canChange && f.can_toggle && x.id ? (
                      <NamedSwitch
                        checked={!isOff(x)}
                        disabled={flow.working}
                        label={<span className="sr-only">{isOff(x) ? `Switch “${label(x)}” on` : `Switch “${label(x)}” off`}</span>}
                        onCheckedChange={(v) =>
                          void flow.ask(
                            () => runOp<Preview>('firewall.change', { action: 'toggle', rule_ids: JSON.stringify(rs.map((r) => r.id).filter(Boolean)), enable: String(v), label: label(x) }),
                            v ? 'Switch it on' : 'Switch it off',
                            !v,
                          )
                        }
                      />
                    ) : canChange && x.port && !isBlock(x) && (!f.can_toggle || x.ours) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={flow.working}
                        onClick={() => void flow.ask(() => runOp<Preview>('firewall.change', { action: 'remove', port: x.port!, proto: x.proto === 'udp' ? 'udp' : 'tcp', source: sourceOf(x) }), 'Close it', true)}
                      >
                        Close
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {shown.length > 400 && <p className="border-t border-[var(--agent-app-border)] px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">Showing 400 of {shown.length} — search to narrow it.</p>}
          </div>
        </>
      )}
      <Dialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        title={adding === 'block' ? 'Block a port' : 'Open a port'}
        description={
          adding === 'block'
            ? 'Nothing from there can reach that port any more. Remote login (22, 3389) is never blocked, so you can’t lock yourself out.'
            : 'Only your local network is the safe choice for most apps; every network includes the internet if your router forwards it.'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button
              disabled={!/^\d{1,5}$/.test(port)}
              onClick={() => {
                const what = adding;
                setAdding(null);
                void flow.ask(
                  () =>
                    runOp<Preview>(
                      'firewall.change',
                      what === 'block' ? { action: 'block', port: Number(port), proto, source } : { action: 'allow', port: Number(port), proto, source, label: byPort[Number(port)] ?? '' },
                    ),
                  what === 'block' ? 'Block it' : 'Open it',
                  what === 'block',
                );
              }}
            >
              Next…
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {adding === 'allow' && appPorts.length > 0 && <Select label="App" value={port} onChange={(e) => setPort(e.target.value)} options={appPorts} />}
          <Input label="Port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          <Select label="Protocol" value={proto} onChange={(e) => setProto(e.target.value === 'udp' ? 'udp' : 'tcp')} options={[{ value: 'tcp', label: 'TCP (most apps)' }, { value: 'udp', label: 'UDP' }]} />
          <Select
            label={adding === 'block' ? 'Block it from' : 'Who can reach it'}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            options={[
              { value: 'local', label: adding === 'block' ? 'Your local network' : 'Only your local network' },
              { value: 'any', label: 'Every network' },
            ]}
          />
        </div>
      </Dialog>
      {flow.element}
    </div>
  );
}

// ------------------------------------------------------------------ users and keys (§7.8)

interface Users {
  users: Array<{ name: string; uid: number; admin: boolean; home: string; keys: Array<{ type: string; fingerprint: string; comment: string }> }>;
  password_login: boolean | null;
  why_not?: string;
}

export function KeysPanel(): React.JSX.Element {
  const { can } = useMe();
  const r = useServerRead<Users>('users.list');
  const flow = useChange();
  useAfterChange(flow.status, r.reload);
  const [adding, setAdding] = useState<string | null>(null);
  const [key, setKey] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <Head title="Who can sign in" loading={r.loading} reload={r.reload}>
        {flow.status && <Working status={flow.status} />}
      </Head>
      <Asking loading={r.loading} error={r.error} has={!!r.data} />
      {r.data?.why_not && <p className="text-[13px] text-[var(--agent-app-muted)]">{r.data.why_not}</p>}
      {r.data && r.data.password_login !== null && (
        <p className="text-[13px]">
          Remote login with a password is <strong>{r.data.password_login ? 'on' : 'off'}</strong>
          {r.data.password_login ? ' — keys are far safer; once everyone has a key, turn passwords off from the problem on Home.' : ' — only keys sign in.'}
        </p>
      )}
      {r.data && (
        <Box>
          <div className="relative max-h-[440px] overflow-y-auto">
            {r.data.users.map((u) => (
              <div key={u.name} className="border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{u.name}</span>
                  {u.admin && <Pill tone="warn">administrator</Pill>}
                  <span className="text-[12px] text-[var(--agent-app-muted)]">
                    {u.keys.length} key{u.keys.length === 1 ? '' : 's'}
                  </span>
                  {can('analyst') && (
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => (setAdding(u.name), setKey(''))}>
                      Add a key
                    </Button>
                  )}
                </div>
                {u.keys.map((k) => (
                  <div key={k.fingerprint} className="mt-1 flex flex-wrap items-center gap-2 pl-3 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">
                      {k.comment || 'a key'} <span className="font-mono text-[12px] text-[var(--agent-app-muted)]">{k.type.replace('ssh-', '')} {k.fingerprint.slice(7, 23)}…</span>
                    </span>
                    {can('analyst') && (
                      <Button size="sm" variant="ghost" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('keys.remove', { user: u.name, fingerprint: k.fingerprint, comment: k.comment }), 'Remove it', true)}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Box>
      )}
      <Dialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        title={`Let a key sign in as ${adding ?? ''}`}
        description="Paste the PUBLIC key (the .pub file: one line starting with ssh-ed25519, ssh-rsa or ecdsa-). Never the private key."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button
              disabled={!/^(ssh-|ecdsa-|sk-)/.test(key.trim()) || /PRIVATE KEY/.test(key)}
              onClick={() => {
                const user = adding!;
                setAdding(null);
                void flow.ask(() => runOp<Preview>('keys.add', { user, key: key.trim() }), 'Add it');
              }}
            >
              Next…
            </Button>
          </div>
        }
      >
        <Textarea aria-label="Public key" rows={4} className="font-mono text-[12px]" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ssh-ed25519 AAAA… you@laptop" />
        {/PRIVATE KEY/.test(key) && <p className="mt-2 text-[13px] text-red-700 dark:text-red-400">That is a private key — never share it. Paste the .pub file instead.</p>}
      </Dialog>
      {flow.element}
    </div>
  );
}

// ------------------------------------------------------------------ reach it from away (§7.10)

export function RemotePanel({ tailscale }: { tailscale: { running?: boolean; name?: string } | null }): React.JSX.Element {
  const { can } = useMe();
  const flow = useChange();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signIn = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const r = await readServer<{ connected: boolean; url: string }>('remote.tailscale_login');
      setLink(r.connected ? '' : r.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the sign-in.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box>
      <Row>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Reach this server from away, privately</span>
          <span className="block text-[13px] text-[var(--agent-app-muted)]">
            {tailscale?.running
              ? `Tailscale is connected${tailscale.name ? ` as ${tailscale.name}` : ''}: your own devices on your tailnet reach it; nobody else does.`
              : 'Tailscale gives your phone and laptop a private road to this server, without opening anything to the internet.'}
          </span>
        </span>
        {flow.status && <Working status={flow.status} />}
        {tailscale === null && can('analyst') && (
          <Button size="sm" variant="secondary" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('remote.tailscale-install', {}), 'Install it')}>
            Install Tailscale
          </Button>
        )}
        {tailscale !== null && !tailscale.running && can('admin') && (
          <Button size="sm" loading={busy} onClick={() => void signIn()}>
            Sign it in
          </Button>
        )}
      </Row>
      {err && (
        <Row>
          <span className="text-[13px] text-red-700 dark:text-red-400">{err}</span>
        </Row>
      )}
      {link !== null && (
        <Row>
          <span className="text-[13px]">
            {link ? (
              <>
                Open this link and sign in with your Tailscale account to finish (only you see it — whoever opens it adds this server to their tailnet):{' '}
                <a className="break-all text-[var(--agent-app-accent)] underline" href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
              </>
            ) : (
              'It is already signed in.'
            )}
          </span>
        </Row>
      )}
      <Row>
        <span className="text-[12px] text-[var(--agent-app-muted)]">
          Prefer Cloudflare Tunnel? Its setup gives you a token that is a secret, so NetSentry guides instead of carrying it: each app's Access & safety tab shows the steps.
        </span>
      </Row>
      {flow.element}
    </Box>
  );
}
