/**
 * NetSentry's own backups for one app (v3 plan §11): set it up once (a folder
 * on the machine, how often), then the copies it made, each with "Test a
 * restore" and "Restore…". Every one of those is a change the machine's
 * monitor applies; a restore needs an admin and puts back what was there if
 * the app doesn't come back healthy.
 */
import { useState } from 'react';
import { Button, Input, Pill, Select, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';
import type { AppRecord, BackupPlanRecord } from '../lib/types.ts';
import type { RecordModel } from 'pocketbase';
import { bytes } from './Health.tsx';
import { useChange, Working, type Preview } from './Controls.tsx';

interface Taken extends RecordModel {
  archive: string;
  size_bytes: number;
  taken_at: string;
  contents: string;
  removed: boolean;
  tested_at: string;
  test_result: string;
}

interface FailedRun extends RecordModel {
  updated: string;
  failure_reason: string;
  plan: { steps?: Array<{ action?: string }> } | null;
}

function when(archive: string): string {
  // 2026-10-01_030000.tar.gz → 2026-10-01 03:00 UTC
  return `${archive.slice(0, 10)} ${archive.slice(11, 13)}:${archive.slice(13, 15)} UTC`;
}

export function OwnBackups({ app, plans }: { app: AppRecord; plans: BackupPlanRecord[] }): React.JSX.Element | null {
  const { can } = useMe();
  const own = plans.find((p) => p.method === 'netsentry');
  const taken = useCollection<Taken>('backups_taken', { filter: `app = "${app.id}" && removed = false`, sort: '-taken_at' });
  // This app's own runs: a plan covers several apps, and another app's copy says nothing about this one.
  const failed = useCollection<FailedRun>('remediations', {
    filter: `app = "${app.id}" && purpose = "backup" && (status = "failed" || status = "rolled_back")`,
    sort: '-updated',
  });
  const [folder, setFolder] = useState('/mnt/backups');
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const now = useChange();
  const test = useChange();

  if (!app.container) return null;
  const lastCopy = taken.records[0]?.taken_at ?? '';
  const lastFailure = failed.records.find((r) => r.plan?.steps?.[0]?.action === 'backup.run') ?? null;

  if (!own) {
    if (!can('analyst')) return null;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <p className="text-[14px] font-medium">Let NetSentry back it up</p>
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          Its settings and database are copied to a folder on the server — best another disk or a NAS share, not the disk the app lives on. 7 daily, 4 weekly and 6 monthly copies are kept, and once a month NetSentry tests that the newest one restores.
        </p>
        <Input label="Folder on the server" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/mnt/backups" />
        <Select
          label="How often"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          options={[
            { value: '24', label: 'Every day' },
            { value: '168', label: 'Every week' },
            { value: '6', label: 'Every 6 hours' },
          ]}
        />
        <div>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await runOp<{ message: string }>('backups.create-plan', {
                  asset_id: app.asset,
                  name: `${app.label || app.display_name} — NetSentry backup`,
                  method: 'netsentry',
                  destination: folder.trim(),
                  schedule_hours: Number(hours),
                  app_ids: app.id,
                });
                toast.success(r.message);
              } catch {
                /* toast shown */
              } finally {
                setBusy(false);
              }
            }}
          >
            Back it up with NetSentry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        <span className="min-w-0 flex-1 text-[14px]">
          NetSentry copies it to <code className="text-[13px]">{own.destination}</code> every {own.schedule_hours === 24 ? 'day' : `${own.schedule_hours} hours`}
          {lastCopy ? (
            <span className="text-[var(--agent-app-muted)]"> · last copy {relTime(lastCopy)}</span>
          ) : !taken.loading && !lastFailure ? (
            <span className="text-[var(--agent-app-muted)]"> · first copy within the hour</span>
          ) : null}
        </span>
        {can('analyst') &&
          (now.status ? (
            <Working status={now.status} />
          ) : (
            <Button size="sm" variant="secondary" disabled={now.working} onClick={() => void now.ask(() => runOp<Preview>('backups.run-now', { app_id: app.id }), 'Back up now')}>
              Back up now
            </Button>
          ))}
        {can('analyst') && taken.records.length > 0 &&
          (test.status ? (
            <Working status={test.status} />
          ) : (
            <Button size="sm" variant="ghost" disabled={test.working} onClick={() => void test.ask(() => runOp<Preview>('backups.test-now', { app_id: app.id }), 'Test now')}>
              Test a restore
            </Button>
          ))}
      </div>
      {lastFailure && (!lastCopy || lastFailure.updated > lastCopy) && (
        <p className="text-[13px] text-red-700 dark:text-red-400">
          {lastCopy ? 'The last backup' : 'The backup'} failed {relTime(lastFailure.updated)}: {lastFailure.failure_reason.replace(/^Step \d+ failed: /, '')}
        </p>
      )}
      {taken.records.length > 0 && (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          {taken.records.map((t) => (
            <TakenRow key={t.id} t={t} app={app} canRestore={can('admin')} />
          ))}
        </div>
      )}
      {now.element}
      {test.element}
    </div>
  );
}

function TakenRow({ t, app, canRestore }: { t: Taken; app: AppRecord; canRestore: boolean }): React.JSX.Element {
  const flow = useChange();
  const tested = t.test_result ? (t.test_result.startsWith('ok') ? 'good' : 'bad') : null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">{when(t.archive)}</span>
        <span className="block text-[12px] text-[var(--agent-app-muted)]">
          {bytes(t.size_bytes)} · {t.contents}
        </span>
      </span>
      {tested && <Pill tone={tested}>{tested === 'good' ? `restore tested ${relTime(t.tested_at)}` : 'restore test failed'}</Pill>}
      {canRestore &&
        (flow.status ? (
          <Working status={flow.status} />
        ) : (
          <Button size="sm" variant="ghost" disabled={flow.working} onClick={() => void flow.ask(() => runOp<Preview>('backups.restore', { app_id: app.id, backup_id: t.id }), 'Restore now', true)}>
            Restore…
          </Button>
        ))}
      {flow.element}
    </div>
  );
}
