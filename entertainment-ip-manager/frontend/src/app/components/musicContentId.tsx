/**
 * YouTube Content ID: our reference assets (with ownership per territory and
 * the match policy), claims in both directions with their reply deadlines,
 * the channel allowlist and ownership conflicts. Steps on a claim (dispute
 * or appeal received, resolved) go through content-id/claim-event so the
 * engine dates the reply: 30 days for a dispute, 7 days for an appeal.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Fingerprint, ListChecks, Pencil, Plus, ShieldCheck, Swords } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, listAll, op, opToast, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { d10, fmtDate, fmtPct, today, toPb } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, t, tf, tn } from '../lib/i18n.ts';
import { toneOf } from '../lib/labels.ts';
import { useHashParam } from '../lib/router.ts';
import type { CidAllowRec, ContentIdAssetRec, ContentIdClaimRec, DeadlineRec, EventRec, RecordingRec, SongRec } from '../lib/records.ts';
import type { Proposal } from '../lib/shapes.ts';
import { DeadlineList, kindHelp, useDeadlineActions } from './deadlines.tsx';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { useEventLabel } from './events.tsx';
import { CatalogSelect, RecordPicker } from './pickers.tsx';
import { EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Field, ListRow, Loading, Notice, Pill, Prose, Ref, Section, Segmented, Tag } from './ui.tsx';
import { CatalogLinks, Dash, DeadlineChip, RecordingLink, SongLink, TerritoryEditor, fmtIsrc, ownershipText, territoryShares, useOpenDeadlinesBy } from './musicShared.tsx';
import { DeleteButton, canDelete, deleteCol } from './deleteRecord.tsx';
import type { TerritoryShare } from './musicShared.tsx';

function opts(field: string): { value: string; label: string }[] {
  return enumOptions(field).map(([value, label]) => ({ value, label }));
}

function recLabel(r: RecordingRec): string {
  return r.isrc !== '' ? `${r.title} · ${fmtIsrc(r.isrc)}` : r.title;
}

function assetOf(c: ContentIdClaimRec): ContentIdAssetRec | undefined {
  return c.asset !== '' ? (c.expand?.['asset'] as ContentIdAssetRec | undefined) : undefined;
}

function assetLabel(a: ContentIdAssetRec): string {
  return [a.asset_id || t('No asset ID'), enumLabel('content_id_assets.asset_type', a.asset_type)].filter((x) => x !== '').join(' · ');
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export function AssetDialog({
  asset,
  recordingId = '',
  readOnly = false,
  onClose,
}: {
  asset: ContentIdAssetRec | null;
  recordingId?: string | undefined;
  readOnly?: boolean | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [recording, setRecording] = useState(asset?.recording ?? recordingId);
  const [song, setSong] = useState(asset?.song ?? '');
  const [assetId, setAssetId] = useState(asset?.asset_id ?? '');
  const [type, setType] = useState<string>(asset?.asset_type || 'sound_recording');
  const [owners, setOwners] = useState<TerritoryShare[]>(() => (asset !== null ? territoryShares(asset.ownership) : [{ territory: 'WORLD', pct: 100 }]));
  const [policy, setPolicy] = useState<string>(asset?.policy || 'monetize');
  const [admin, setAdmin] = useState(asset?.administrator ?? '');
  const [status, setStatus] = useState<string>(asset?.status || 'active');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    const data: Record<string, unknown> = {
      recording,
      song,
      asset_id: assetId.trim(),
      asset_type: type,
      ownership: owners.map((o) => ({ territory: o.territory, pct: o.pct })),
      policy,
      administrator: admin.trim(),
      status,
      notes,
    };
    try {
      if (asset === null) await createRecord('content_id_assets', data);
      else await updateRecord('content_id_assets', asset.id, data);
      toast.success(asset === null ? t('Asset added') : t('Saved'));
      onClose();
    } catch {
      /* the client shows the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={asset === null ? t('New Content ID asset') : t('Content ID asset')}
      description={t('A reference file YouTube matches uploads against: a sound recording, a composition or a music video.')}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {readOnly ? t('Close') : t('Cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} loading={busy}>
              {t('Save')}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Asset ID')}>
            <Input value={assetId} onChange={(e) => setAssetId(e.target.value)} className="font-mono" placeholder="A123456789012345" />
          </Field>
          <Field label={t('Asset type')}>
            <Select value={type} options={opts('content_id_assets.asset_type')} onChange={(e) => setType(e.target.value)} />
          </Field>
          <RecordPicker<RecordingRec> collection="recordings" label={t('Recording')} value={recording} onChange={(id) => setRecording(id)} labelOf={recLabel} searchFields={['title', 'isrc']} />
          <RecordPicker<SongRec> collection="songs" label={t('Song')} value={song} onChange={(id) => setSong(id)} labelOf={(s) => s.title} searchFields={['title', 'iswc']} />
          <Field label={t('Match policy')}>
            <Select value={policy} options={opts('content_id_assets.policy')} onChange={(e) => setPolicy(e.target.value)} />
          </Field>
          <Field label={t('Status')}>
            <Select value={status} options={opts('content_id_assets.status')} onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Field label={t('Administered by')} help={t('The distributor or CMS that holds the asset in YouTube.')}>
            <Input value={admin} onChange={(e) => setAdmin(e.target.value)} />
          </Field>
        </div>
        <TerritoryEditor value={owners} onChange={setOwners} />
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
}

export function AssetsSection({ recordingId }: { recordingId?: string | undefined }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<ContentIdAssetRec>('content_id_assets', {
    ...(recordingId !== undefined ? { filter: `recording = "${recordingId}"` } : {}),
    sort: '-updated',
    expand: 'recording,song',
  });
  const [dialog, setDialog] = useState<{ asset: ContentIdAssetRec | null } | null>(null);
  const cols: Col<ContentIdAssetRec>[] = [
    { key: 'asset_id', label: t('Asset ID'), render: (a) => (a.asset_id !== '' ? <Ref>{a.asset_id}</Ref> : <Dash />) },
    { key: 'asset_type', label: t('Asset type'), value: (a) => enumLabel('content_id_assets.asset_type', a.asset_type), render: (a) => enumLabel('content_id_assets.asset_type', a.asset_type) },
    ...(recordingId === undefined
      ? [
          {
            key: 'target',
            label: t('Recording or song'),
            value: (a: ContentIdAssetRec) => (a.expand?.['recording'] as RecordingRec | undefined)?.title ?? (a.expand?.['song'] as SongRec | undefined)?.title ?? '',
            render: (a: ContentIdAssetRec) =>
              a.recording !== '' ? (
                <RecordingLink id={a.recording} rec={a.expand?.['recording'] as RecordingRec | undefined} />
              ) : a.song !== '' ? (
                <SongLink id={a.song} song={a.expand?.['song'] as SongRec | undefined} />
              ) : (
                <Dash />
              ),
          },
        ]
      : []),
    { key: 'ownership', label: t('Ownership'), value: (a) => ownershipText(a.ownership), render: (a) => ownershipText(a.ownership) || <Dash /> },
    { key: 'policy', label: t('Policy|content id'), value: (a) => enumLabel('content_id_assets.policy', a.policy), render: (a) => (a.policy !== '' ? <Tag>{enumLabel('content_id_assets.policy', a.policy)}</Tag> : <Dash />) },
    { key: 'administrator', label: t('Administered by'), optional: true },
    { key: 'status', label: t('Status'), value: (a) => enumLabel('content_id_assets.status', a.status), render: (a) => <EnumPill field="content_id_assets.status" value={a.status} /> },
  ];
  return (
    <Section
      title={t('Assets')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ asset: null })}>
            <Plus size={13} aria-hidden /> {t('Add asset')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : (
        <DataTable<ContentIdAssetRec>
          tableId={recordingId !== undefined ? 'recording-cid-assets' : 'music-cid-assets'}
          rows={list.records}
          columns={[...cols, ...deleteCol<ContentIdAssetRec>('content_id_assets', canDelete(can, 'content_id_assets'))]}
          onRowClick={(a) => setDialog({ asset: a })}
          exportName="content-id-assets"
          empty={
            <EmptyHint
              icon={Fingerprint}
              title={t('No Content ID assets yet')}
              message={t('Add the assets our distributor or CMS delivered to YouTube, with the ownership we claim in each territory.')}
              action={
                can.edit ? (
                  <Button size="sm" onClick={() => setDialog({ asset: null })}>
                    <Plus size={13} aria-hidden /> {t('Add asset')}
                  </Button>
                ) : undefined
              }
              compact
            />
          }
        />
      )}
      {dialog !== null && <AssetDialog asset={dialog.asset} recordingId={recordingId} readOnly={!can.edit} onClose={() => setDialog(null)} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

/** Statuses set by hand; disputed, appealed and resolved come from recorded steps. */
const MANUAL_CLAIM_STATUSES = ['open', 'released', 'upheld', 'expired'];

export function ClaimDialog({ claim, recordingId = '', onClose }: { claim: ContentIdClaimRec | null; recordingId?: string | undefined; onClose: () => void }): React.JSX.Element {
  const [direction, setDirection] = useState<string>(claim?.direction || 'incoming');
  const [videoTitle, setVideoTitle] = useState(claim?.video_title ?? '');
  const [videoUrl, setVideoUrl] = useState(claim?.video_url ?? '');
  const [channel, setChannel] = useState(claim?.channel ?? '');
  const [claimant, setClaimant] = useState(claim?.claimant ?? '');
  const [asset, setAsset] = useState(claim?.asset ?? '');
  const [recording, setRecording] = useState(claim?.recording ?? recordingId);
  const [status, setStatus] = useState<string>(claim?.status || 'open');
  const [received, setReceived] = useState(d10(claim?.received_date) || (claim === null ? today() : ''));
  const [reason, setReason] = useState(claim?.reason ?? '');
  const [notes, setNotes] = useState(claim?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const statusChoices = MANUAL_CLAIM_STATUSES.includes(status) ? MANUAL_CLAIM_STATUSES : [status, ...MANUAL_CLAIM_STATUSES];

  const save = async (): Promise<void> => {
    setBusy(true);
    const data: Record<string, unknown> = {
      direction,
      video_title: videoTitle.trim(),
      video_url: videoUrl.trim(),
      channel: channel.trim(),
      claimant: claimant.trim(),
      asset,
      recording,
      status,
      received_date: toPb(received),
      reason,
      notes,
    };
    try {
      if (claim === null) await createRecord('content_id_claims', data);
      else await updateRecord('content_id_claims', claim.id, data);
      toast.success(claim === null ? t('Claim added') : t('Saved'));
      onClose();
    } catch {
      /* the client shows the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={claim === null ? t('New Content ID claim') : t('Edit claim')}
      description={t('A claim on one video. Record disputes, appeals and the outcome as steps so the reply deadline is dated.')}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Direction|claim')}>
          <Segmented value={direction} onChange={setDirection} options={opts('content_id_claims.direction')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Video title')}>
            <Input value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} />
          </Field>
          <Field label={t('Video URL')}>
            <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=" />
          </Field>
          <Field label={t('Channel|youtube')}>
            <Input value={channel} onChange={(e) => setChannel(e.target.value)} />
          </Field>
          <Field label={t('Claimant')} help={direction === 'incoming' ? t('Who claimed our video.') : t('Usually us or our distributor.')}>
            <Input value={claimant} onChange={(e) => setClaimant(e.target.value)} />
          </Field>
          <RecordPicker<ContentIdAssetRec> collection="content_id_assets" label={t('Asset')} value={asset} onChange={(id) => setAsset(id)} labelOf={assetLabel} searchFields={['asset_id', 'administrator']} />
          <RecordPicker<RecordingRec> collection="recordings" label={t('Recording')} value={recording} onChange={(id) => setRecording(id)} labelOf={recLabel} searchFields={['title', 'isrc']} />
          <Field label={t('Claim received')}>
            <Input type="date" value={received} onChange={(e) => setReceived(e.target.value)} />
          </Field>
          <Field label={t('Status')} help={t('Disputed, appealed and resolved are set by recording a step.')}>
            <Select value={status} options={statusChoices.map((s) => ({ value: s, label: enumLabel('content_id_claims.status', s) }))} onChange={(e) => setStatus(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Reason')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

const STEP_CODES = ['CID_DISPUTE_RECEIVED', 'CID_APPEAL_RECEIVED', 'CID_RESOLVED'] as const;

/** Record a dispute, an appeal or the outcome; previews the reply deadline first. */
export function ClaimStepDialog({ claim, onClose }: { claim: ContentIdClaimRec; onClose: () => void }): React.JSX.Element {
  const eventLabel = useEventLabel();
  const [code, setCode] = useState<string>(claim.status === 'disputed' ? 'CID_APPEAL_RECEIVED' : claim.status === 'appealed' ? 'CID_RESOLVED' : 'CID_DISPUTE_RECEIVED');
  const [date, setDate] = useState(today());
  const [preview, setPreview] = useState<Proposal[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    setPreview(null);
    const timer = setTimeout(() => {
      op<{ proposals: Proposal[] }>('events/preview', { subject_type: 'claim', subject_id: claim.id, code, date })
        .then((r) => {
          if (!cancelled) {
            setPreview(r.proposals);
            setError('');
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setPreview([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [claim.id, code, date]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const r = await opToast<{ event: string; created: number }>('content-id/claim-event', { claim_id: claim.id, code, date });
    setBusy(false);
    if (r === null) return;
    toast.success(r.created > 0 ? tn(r.created, 'Recorded. {n} deadline created.', 'Recorded. {n} deadlines created.') : t('Recorded.'));
    onClose();
  };

  const help =
    code === 'CID_DISPUTE_RECEIVED'
      ? t('The uploader disputed the claim. We have 30 days to release, uphold or take the video down; with no answer the claim expires.')
      : code === 'CID_APPEAL_RECEIVED'
        ? t('The uploader appealed after we upheld the claim. We have 7 days to release it or send a copyright removal request.')
        : t('The claim is settled: released, upheld or the video removed. Open reply deadlines can then be closed.');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Record a claim step')}
      description={claim.video_title || claim.video_url || undefined}
      className="max-h-[92vh] w-[min(94vw,36rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}>
            {t('Record step')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Step|claim')}>
            <Select value={code} options={STEP_CODES.map((c) => ({ value: c, label: eventLabel(c) }))} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('Date received')} help={t('The date YouTube notified us.')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Notice tone="info">{help}</Notice>
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-medium">{t('Deadlines this creates')}</div>
          {error !== '' ? (
            <ErrorBox message={error} />
          ) : preview === null ? (
            <p className="text-xs text-[var(--agent-app-muted)]">{t('Working out deadlines...')}</p>
          ) : preview.length === 0 ? (
            <p className="text-xs text-[var(--agent-app-muted)]">{t('No reply deadline for this step.')}</p>
          ) : (
            <div className="border border-[var(--agent-app-border)]">
              {preview.map((p) => (
                <div key={p.key} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words text-[13px] font-medium">{tf(p, 'title')}</span>
                    <Tag title={kindHelp(p.kind)}>{enumLabel('deadlines.kind', p.kind)}</Tag>
                    {p.exists && <Tag>{t('Already on the list')}</Tag>}
                    {p.past && !p.exists && <Tag>{t('Already past')}</Tag>}
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Due {date}', { date: fmtDate(p.due_date) })}</div>
                  {p.steps.length > 0 && (
                    <ol className="mt-1 list-decimal pl-5 text-xs leading-relaxed text-[var(--agent-app-muted)]">
                      {p.steps.map((s, i) => (
                        <li key={i}>{bi(s)}</li>
                      ))}
                    </ol>
                  )}
                  {p.citation !== '' && <div className="mt-1 text-xs text-[var(--agent-app-muted)]">{t('Basis: {citation}', { citation: p.citation })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** One claim: facts, reply deadlines, history, and the step and edit actions. */
export function ClaimDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const eventLabel = useEventLabel();
  const rec = useCollection<ContentIdClaimRec>('content_id_claims', { filter: `id = "${id}"`, expand: 'asset,recording' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `claim = "${id}"`, sort: 'due_date' });
  const events = useCollection<EventRec>('events', { filter: `claim = "${id}"`, sort: '-date' });
  const dl = useDeadlineActions();
  const [step, setStep] = useState(false);
  const [edit, setEdit] = useState(false);
  const c = rec.records[0] ?? null;
  const finished = c !== null && ['released', 'upheld', 'expired', 'resolved'].includes(c.status);

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('Content ID claim')}
      width={560}
      footer={
        c !== null && can.edit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <DeleteButton collection="content_id_claims" id={c.id} onDeleted={onClose} className="mr-auto" />
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
            {!finished && (
              <Button onClick={() => setStep(true)}>
                <ListChecks size={13} aria-hidden /> {t('Record a step')}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {rec.loading ? (
        <Loading />
      ) : c === null ? (
        <EmptyHint title={t('This claim could not be opened')} message={t('It may have been deleted, or the link is incomplete.')} compact />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{enumLabel('content_id_claims.direction', c.direction)}</Tag>
              <EnumPill field="content_id_claims.status" value={c.status} />
            </div>
            <div className="mt-2 break-words text-base font-semibold">{c.video_title || c.video_url || t('Untitled video')}</div>
            {c.video_url !== '' && (
              <a className="break-all text-xs text-[var(--agent-app-accent)] hover:underline" href={c.video_url} target="_blank" rel="noreferrer">
                {c.video_url}
              </a>
            )}
          </div>
          <FactGrid cols={2}>
            <Fact label={t('Channel|youtube')} value={c.channel} />
            <Fact label={t('Claimant')} value={c.claimant} />
            <Fact label={t('Asset')} value={assetOf(c) !== undefined ? assetLabel(assetOf(c) as ContentIdAssetRec) : ''} />
            <Fact label={t('Recording')} value={c.recording !== '' ? <RecordingLink id={c.recording} rec={c.expand?.['recording'] as RecordingRec | undefined} /> : ''} />
            <Fact label={t('Claim received')} value={fmtDate(c.received_date)} />
            <Fact label={t('Dispute received')} value={fmtDate(c.dispute_received)} />
            <Fact label={t('Appeal received')} value={fmtDate(c.appeal_received)} />
          </FactGrid>
          {c.reason !== '' && (
            <div>
              <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Reason')}</div>
              <Prose>{c.reason}</Prose>
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] font-semibold">{t('Reply deadlines')}</div>
            {deadlines.records.length === 0 ? (
              <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('No reply deadline yet. Recording a dispute (30 days) or an appeal (7 days) sets one.')}</p>
            ) : (
              <div className="border border-[var(--agent-app-border)]">
                <DeadlineList deadlines={deadlines.records} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} grouped={false} bulk={false} />
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 text-[13px] font-semibold">{t('History')}</div>
            {events.records.length === 0 ? (
              <p className="text-xs text-[var(--agent-app-muted)]">{t('No steps recorded yet.')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {events.records.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-2">
                    <span className="tabular-nums text-[var(--agent-app-muted)]">{fmtDate(e.date)}</span>
                    <span className="min-w-0 flex-1">{tf(e, 'label') || eventLabel(e.code)}</span>
                    <DeleteButton collection="events" id={e.id} iconOnly label={t('Delete this event')} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {step && c !== null && <ClaimStepDialog claim={c} onClose={() => setStep(false)} />}
      {edit && c !== null && <ClaimDialog claim={c} onClose={() => setEdit(false)} />}
      {dl.dialogs}
    </Drawer>
  );
}

export function ClaimsSection({ recordingId }: { recordingId?: string | undefined }): React.JSX.Element {
  const { can } = useApp();
  const [dir, setDir] = useHashParam('dir', 'all');
  const list = useCollection<ContentIdClaimRec>('content_id_claims', {
    ...(recordingId !== undefined ? { filter: `recording = "${recordingId}"` } : {}),
    sort: '-received_date,-created',
  });
  const dead = useOpenDeadlinesBy('claim');
  const dl = useDeadlineActions();
  const [create, setCreate] = useState(false);
  const [openId, setOpenId] = useState('');
  const shown = useMemo(() => (dir === 'all' ? list.records : list.records.filter((c) => c.direction === dir)), [list.records, dir]);
  const cols: Col<ContentIdClaimRec>[] = [
    {
      key: 'video',
      label: t('Video|youtube'),
      value: (c) => c.video_title || c.video_url,
      render: (c) => (
        <div className="min-w-0 max-w-[20rem]">
          <div className="truncate font-medium">{c.video_title || c.video_url || t('Untitled video')}</div>
          {c.channel !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{c.channel}</div>}
        </div>
      ),
    },
    { key: 'direction', label: t('Direction|claim'), value: (c) => enumLabel('content_id_claims.direction', c.direction), render: (c) => <Tag>{enumLabel('content_id_claims.direction', c.direction)}</Tag> },
    { key: 'claimant', label: t('Claimant'), optional: true },
    { key: 'status', label: t('Status'), value: (c) => enumLabel('content_id_claims.status', c.status), render: (c) => <EnumPill field="content_id_claims.status" value={c.status} /> },
    { key: 'received_date', label: t('Received|date'), value: (c) => d10(c.received_date), render: (c) => fmtDate(c.received_date) || <Dash /> },
    { key: 'dispute_received', label: t('Dispute'), value: (c) => d10(c.dispute_received), render: (c) => fmtDate(c.dispute_received) || <Dash /> },
    { key: 'appeal_received', label: t('Appeal'), value: (c) => d10(c.appeal_received), render: (c) => fmtDate(c.appeal_received) || <Dash /> },
    {
      key: 'reply',
      label: t('Reply by'),
      value: (c) => d10(dead.byId.get(c.id)?.[0]?.due_date),
      render: (c) => {
        const d = dead.byId.get(c.id)?.[0];
        return d !== undefined ? <DeadlineChip d={d} onWhy={dl.actions.onWhy} short /> : <Dash />;
      },
    },
  ];
  const urgent = list.records.filter((c) => (dead.byId.get(c.id) ?? []).length > 0).length;

  return (
    <Section
      title={t('Claims')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setCreate(true)}>
            <Plus size={13} aria-hidden /> {t('Add claim')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : (
        <DataTable<ContentIdClaimRec>
          tableId={recordingId !== undefined ? 'recording-cid-claims' : 'music-cid-claims'}
          rows={shown}
          columns={[...cols, ...deleteCol<ContentIdClaimRec>('content_id_claims', canDelete(can, 'content_id_claims'))]}
          onRowClick={(c) => setOpenId(c.id)}
          exportName="content-id-claims"
          toolbar={
            <>
              <Segmented
                size="sm"
                value={dir}
                onChange={setDir}
                options={[{ value: 'all', label: t('All') }, ...opts('content_id_claims.direction')]}
              />
              {urgent > 0 && <Pill tone="warn">{tn(urgent, '{n} claim awaits our reply', '{n} claims await our reply')}</Pill>}
            </>
          }
          empty={
            <EmptyHint
              icon={Swords}
              title={t('No claims')}
              message={t('Log claims on our videos and the claims we make, so the 30-day dispute and 7-day appeal replies are never missed.')}
              action={
                can.edit ? (
                  <Button size="sm" onClick={() => setCreate(true)}>
                    <Plus size={13} aria-hidden /> {t('Add claim')}
                  </Button>
                ) : undefined
              }
              compact
            />
          }
        />
      )}
      {create && <ClaimDialog claim={null} recordingId={recordingId} onClose={() => setCreate(false)} />}
      {openId !== '' && <ClaimDrawer id={openId} onClose={() => setOpenId('')} />}
      {dl.dialogs}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Allowlist                                                           */
/* ------------------------------------------------------------------ */

export function AllowDialog({ entry, onClose }: { entry: CidAllowRec | null; onClose: () => void }): React.JSX.Element {
  const { on } = useApp();
  const [channelId, setChannelId] = useState(entry?.channel_id ?? '');
  const [name, setName] = useState(entry?.name ?? '');
  const [reason, setReason] = useState(entry?.reason ?? '');
  const [added, setAdded] = useState(d10(entry?.added_date) || today());
  const [talent, setTalent] = useState(entry?.talent ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (channelId.trim() === '') return;
    setBusy(true);
    const data: Record<string, unknown> = { channel_id: channelId.trim(), name: name.trim(), reason: reason.trim(), added_date: toPb(added), talent, notes };
    try {
      if (entry === null) await createRecord('cid_allowlist', data);
      else await updateRecord('cid_allowlist', entry.id, data);
      toast.success(entry === null ? t('Channel added to the allowlist') : t('Saved'));
      onClose();
    } catch {
      /* the client shows the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry === null ? t('Add a channel to the allowlist') : t('Allowlisted channel')}
      description={t('Videos on an allowlisted channel are not claimed by our assets from now on.')}
      className="max-h-[92vh] w-[min(94vw,36rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={channelId.trim() === ''}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="warn" icon={AlertTriangle}>
          {t('Adding a channel does not release claims made before it was added. Release those claims one by one in YouTube Studio.')}
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Channel ID')} required>
            <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} className="font-mono" placeholder="UC..." />
          </Field>
          <Field label={t('Channel name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Added on')}>
            <Input type="date" value={added} onChange={(e) => setAdded(e.target.value)} />
          </Field>
          {on('talents') && (
            <Field label={t('Talent')} help={t('When the channel belongs to one of our talents.')}>
              <CatalogSelect kind="talent" value={talent} onChange={setTalent} />
            </Field>
          )}
        </div>
        <Field label={t('Reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('For example: our talent\'s own channel, a licensed partner')} />
        </Field>
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function AllowlistSection(): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<CidAllowRec>('cid_allowlist', { sort: '-added_date,-created' });
  const [dialog, setDialog] = useState<{ entry: CidAllowRec | null } | null>(null);
  return (
    <Section
      title={t('Channel allowlist')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ entry: null })}>
            <Plus size={13} aria-hidden /> {t('Add channel')}
          </Button>
        ) : undefined
      }
    >
      <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
        {t('Allowlisting stops new claims only. Claims made before the channel was added stay until they are released one by one.')}
      </div>
      {list.loading ? (
        <Loading />
      ) : list.records.length === 0 ? (
        <EmptyHint
          icon={ShieldCheck}
          title={t('No allowlisted channels')}
          message={t('Add our talents\' channels and licensed partners so our own assets do not claim their videos.')}
          action={
            can.edit ? (
              <Button size="sm" onClick={() => setDialog({ entry: null })}>
                <Plus size={13} aria-hidden /> {t('Add channel')}
              </Button>
            ) : undefined
          }
          compact
        />
      ) : (
        list.records.map((a) => (
          <ListRow
            key={a.id}
            onClick={can.edit ? () => setDialog({ entry: a }) : undefined}
            primary={
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate">{a.name || a.channel_id}</span>
                <Ref>{a.channel_id}</Ref>
              </span>
            }
            secondary={
              <span className="inline-flex min-w-0 flex-wrap gap-x-2">
                {a.added_date !== '' && <span>{t('Added {date}', { date: fmtDate(a.added_date) })}</span>}
                {a.reason !== '' && <span>{a.reason}</span>}
                {a.talent !== '' && <CatalogLinks kind="talent" ids={[a.talent]} />}
              </span>
            }
            trailing={
              <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
                <DeleteButton collection="cid_allowlist" id={a.id} iconOnly />
              </span>
            }
          />
        ))
      )}
      {dialog !== null && <AllowDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

interface Conflict {
  target: string;
  territory: string;
  total: number;
}

export function ConflictsSection(): React.JSX.Element {
  const res = useLiveAsync(
    async () => {
      const r = await op<{ conflicts: Conflict[] }>('content-id/conflicts');
      const ids = [...new Set(r.conflicts.map((c) => c.target))];
      if (ids.length === 0) return { conflicts: r.conflicts, recs: new Map<string, string>(), songs: new Map<string, string>() };
      const filter = ids.map((id) => `id = "${id}"`).join(' || ');
      const [recs, songs] = await Promise.all([listAll<RecordingRec>('recordings', { filter }), listAll<SongRec>('songs', { filter })]);
      return { conflicts: r.conflicts, recs: new Map(recs.map((x) => [x.id, x.title])), songs: new Map(songs.map((x) => [x.id, x.title])) };
    },
    [],
    ['content_id_assets'],
  );
  return (
    <Section title={t('Ownership conflicts')} meta={res.data !== null && res.data.conflicts.length > 0 ? String(res.data.conflicts.length) : undefined} flush>
      {res.loading && res.data === null ? (
        <Loading />
      ) : res.error !== null ? (
        <div className="p-4">
          <ErrorBox message={res.error} onRetry={res.reload} />
        </div>
      ) : res.data === null || res.data.conflicts.length === 0 ? (
        <EmptyHint icon={ShieldCheck} title={t('No ownership conflicts')} message={t('No recording or song is claimed for more than 100% in any territory across our assets.')} compact />
      ) : (
        res.data.conflicts.map((c) => {
          const recTitle = res.data?.recs.get(c.target);
          const songTitle = res.data?.songs.get(c.target);
          return (
            <ListRow
              key={`${c.target}:${c.territory}`}
              leading={<AlertTriangle size={15} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />}
              primary={
                recTitle !== undefined ? (
                  <RecordingLink id={c.target} fallback={recTitle} />
                ) : songTitle !== undefined ? (
                  <SongLink id={c.target} fallback={songTitle} />
                ) : (
                  <Ref>{c.target}</Ref>
                )
              }
              secondary={t('{territory}: {total} claimed across our assets. Fix the ownership or ask YouTube to resolve the conflict.', {
                territory: c.territory === 'WORLD' ? t('Worldwide') : c.territory,
                total: fmtPct(c.total),
              })}
              trailing={<Pill tone={toneOf('content_id_assets.status', 'conflict')}>{fmtPct(c.total)}</Pill>}
            />
          );
        })
      )}
    </Section>
  );
}
