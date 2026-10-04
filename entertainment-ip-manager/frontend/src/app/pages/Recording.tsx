/**
 * One recording (the master): ISRC, version, owners, performers and the
 * art. 91(2) consent for performances first captured in a film, the
 * releases it is on, its Content ID assets and claims, and the
 * neighbouring-right terms (music/neighbouring-terms). "New version" makes a
 * TV size, instrumental, live or remix through music/new-version.
 */
import { useState } from 'react';
import { AudioLines, ChevronRight, CopyPlus, Pencil, Users } from 'lucide-react';
import { Button, Card, Dialog, toast } from '../../kit/index.ts';
import { op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { fmtDate, fmtPct } from '../lib/format.ts';
import { bi, enumLabel, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import type { RecordingRec, SongRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, ListRow, Loading, Notice, Pill, Prose, Ref, Section, Tag } from '../components/ui.tsx';
import {
  CatalogLinks,
  ConsentNotice,
  OwnersEditor,
  PctTotal,
  RecordingLink,
  SongLink,
  TabBar,
  fmtIsrc,
  isHundred,
  masterOwners,
  masterOwnersJson,
  ownerTypeLabel,
  total,
} from '../components/musicShared.tsx';
import type { MasterOwner } from '../components/musicShared.tsx';
import { NewVersionDialog, RecordingDialog } from '../components/musicRecordingForm.tsx';
import { PerformersPanel } from '../components/musicCredits.tsx';
import { ReleasesSection } from '../components/musicRelease.tsx';
import { AssetsSection, ClaimsSection } from '../components/musicContentId.tsx';

type TabKey = 'overview' | 'performers' | 'releases' | 'contentid' | 'terms' | 'documents';
const TABS: TabKey[] = ['overview', 'performers', 'releases', 'contentid', 'terms', 'documents'];

interface TermsResponse {
  performance: { date: string; text: Bi } | null;
  recording: { date: string; text: Bi } | null;
}

function duration(sec: number): string {
  if (!(sec > 0)) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function OwnersDialog({ rec, onClose }: { rec: RecordingRec; onClose: () => void }): React.JSX.Element {
  const [owners, setOwners] = useState<MasterOwner[]>(() => masterOwners(rec.master_owners));
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateRecord('recordings', rec.id, { master_owners: masterOwnersJson(owners) });
      toast.success(t('Saved'));
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
      title={t('Master owners')}
      description={rec.title}
      className="max-h-[92vh] w-[min(94vw,44rem)] overflow-y-auto"
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
      <OwnersEditor value={owners} onChange={setOwners} />
    </Dialog>
  );
}

function TermsPanel({ id }: { id: string }): React.JSX.Element {
  const res = useLiveAsync(() => op<TermsResponse>('music/neighbouring-terms', { recording_id: id }), [id], ['recordings', 'releases']);
  if (res.loading && res.data === null) return <Loading />;
  if (res.error !== null) return <ErrorBox message={res.error} onRetry={res.reload} />;
  const d = res.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
        {t('Performers and the record producer hold neighbouring rights (隣接権), separate from the copyright in the song. Under Copyright Act art. 101 they last 70 years and end on 31 December of the last year.')}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t('Performers\' rights')}>
          {d?.performance ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-[var(--agent-app-muted)]">{t('Ends|term')}</div>
              <div className="text-lg font-semibold tabular-nums">{fmtDate(d.performance.date)}</div>
              <p className="text-[13px] leading-relaxed">{bi(d.performance.text)}</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Add the recording date to work out when the performers\' rights end.')}</p>
          )}
        </Section>
        <Section title={t('Record producer\'s right')}>
          {d?.recording ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-[var(--agent-app-muted)]">{t('Ends|term')}</div>
              <div className="text-lg font-semibold tabular-nums">{fmtDate(d.recording.date)}</div>
              <p className="text-[13px] leading-relaxed">{bi(d.recording.text)}</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Add the recording date or put the recording on a release to work out when the master right ends.')}</p>
          )}
        </Section>
      </div>
    </div>
  );
}

export function RecordingPage({ id }: { id: string }): React.JSX.Element {
  const { can, on } = useApp();
  const rec = useCollection<RecordingRec>('recordings', { filter: `id = ${q(id)}`, expand: 'song,songs,parent' });
  const r = rec.records[0] ?? null;
  const versions = useCollection<RecordingRec>('recordings', { filter: `parent = ${q(id)}`, sort: 'title' });
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const tab: TabKey = (TABS as string[]).includes(tabParam) ? (tabParam as TabKey) : 'overview';
  const [edit, setEdit] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  const [owners, setOwners] = useState(false);

  if (rec.loading) return <Loading />;
  if (r === null) {
    return (
      <Card>
        <EmptyHint
          icon={AudioLines}
          title={t('This recording could not be opened')}
          message={t('It may have been deleted, or the link is incomplete.')}
          action={
            <Button variant="outline" onClick={() => navigate('music', undefined, { tab: 'recordings' })}>
              {t('Back to Music')}
            </Button>
          }
        />
      </Card>
    );
  }

  const song = r.expand?.['song'] as SongRec | undefined;
  const medley = ((r.expand?.['songs'] as SongRec[] | undefined) ?? []).filter((x) => x.id !== r.song);
  const parent = r.expand?.['parent'] as RecordingRec | undefined;
  const ownerList = masterOwners(r.master_owners);
  const ownerSum = total(ownerList.map((o) => o.pct));

  const tabs: { value: TabKey; label: string }[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'performers', label: t('Performers') },
    { value: 'releases', label: t('Releases') },
    { value: 'contentid', label: t('Content ID') },
    { value: 'terms', label: t('Terms|neighbouring rights') },
    { value: 'documents', label: t('Documents') },
  ];

  return (
    <div className="min-w-0">
      <Card className="mb-5">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('music', undefined, { tab: 'recordings' })} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  {t('Music')}
                </a>
                <ChevronRight size={12} className="text-[var(--agent-app-muted)]" aria-hidden />
                <span className="text-xs text-[var(--agent-app-muted)]">{t('Recording')}</span>
                {r.version_type !== '' && <Pill tone="info">{enumLabel('recordings.version_type', r.version_type)}</Pill>}
                <EnumPill field="recordings.status" value={r.status} />
                {r.virtual_singer && <Tag title={r.virtual_singer_note || undefined}>{t('Virtual singer')}</Tag>}
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{r.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-[var(--agent-app-muted)]">{t('ISRC')}</span>
                  {r.isrc !== '' ? <Ref>{fmtIsrc(r.isrc)}</Ref> : <span className="text-xs text-amber-700 dark:text-amber-400">{t('Not assigned')}</span>}
                </span>
                {r.song !== '' && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-xs text-[var(--agent-app-muted)]">{t('Song')}</span>
                    <SongLink id={r.song} song={song} />
                  </span>
                )}
                {parent !== undefined && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-xs text-[var(--agent-app-muted)]">{t('Version of')}</span>
                    <RecordingLink id={parent.id} rec={parent} />
                  </span>
                )}
              </div>
            </div>
            {can.edit && (
              <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
                <Button size="sm" onClick={() => setNewVersion(true)}>
                  <CopyPlus size={13} aria-hidden /> {t('New version')}
                </Button>
                <DeleteButton collection="recordings" id={r.id} onDeleted={() => navigate('music', undefined, { tab: 'recordings' })} />
              </div>
            )}
          </div>
          {r.isrc === '' && r.status === 'released' && (
            <div className="mt-3">
              <Notice tone="warn">{t('This recording is released but has no ISRC. Assign one: every released version needs its own.')}</Notice>
            </div>
          )}
        </div>
      </Card>

      <TabBar value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section title={t('Facts')}>
              <FactGrid cols={2}>
                <Fact label={t('ISRC')} value={r.isrc !== '' ? fmtIsrc(r.isrc) : ''} mono />
                <Fact label={t('Version|recording')} value={enumLabel('recordings.version_type', r.version_type)} />
                <Fact label={t('Recording date')} value={fmtDate(r.recording_date)} />
                <Fact label={t('Duration|recording')} value={duration(r.duration_sec)} />
                <Fact label={t('P-line')} value={r.p_line} className="sm:col-span-2" />
                {medley.length > 0 && (
                  <Fact
                    label={t('Other songs in this recording (medley)')}
                    value={
                      <span className="inline-flex flex-wrap gap-x-2">
                        {medley.map((m) => (
                          <SongLink key={m.id} id={m.id} song={m} />
                        ))}
                      </span>
                    }
                    className="sm:col-span-2"
                  />
                )}
                {r.virtual_singer && <Fact label={t('Virtual singer')} value={r.virtual_singer_note || t('Yes')} className="sm:col-span-2" />}
                {on('talents') && r.talents.length > 0 && <Fact label={t('Talents')} value={<CatalogLinks kind="talent" ids={r.talents} />} className="sm:col-span-2" />}
                {on('franchises') && r.characters.length > 0 && <Fact label={t('Characters')} value={<CatalogLinks kind="character" ids={r.characters} />} className="sm:col-span-2" />}
              </FactGrid>
            </Section>

            <Section
              title={t('Master owners')}
              actions={
                can.edit ? (
                  <Button size="sm" variant="outline" onClick={() => setOwners(true)}>
                    <Pencil size={13} aria-hidden /> {t('Edit')}
                  </Button>
                ) : undefined
              }
              flush
            >
              {ownerList.length === 0 ? (
                <EmptyHint
                  icon={Users}
                  title={t('No master owners recorded')}
                  message={t('Record who owns the master (原盤権) and in what percentage. Licensing the recording needs every owner.')}
                  compact
                />
              ) : (
                <>
                  {ownerList.map((o, i) => (
                    <ListRow
                      key={i}
                      primary={
                        o.party !== '' ? (
                          <a className="hover:underline" href={href('people', o.party)}>
                            {o.name || t('Unnamed|party')}
                          </a>
                        ) : (
                          o.name || t('Unnamed|party')
                        )
                      }
                      secondary={ownerTypeLabel(o.type) || undefined}
                      trailing={<span className="text-sm font-medium tabular-nums">{fmtPct(o.pct)}</span>}
                    />
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--agent-app-border)] px-4 py-2">
                    <span className="text-xs font-semibold">{t('Total')}</span>
                    <PctTotal value={ownerSum} />
                  </div>
                  {!isHundred(ownerSum) && (
                    <div className="px-4 pb-3">
                      <Notice tone="warn">{t('Master ownership adds up to {pct}%, not 100%. Check the shares before licensing the recording.', { pct: ownerSum })}</Notice>
                    </div>
                  )}
                </>
              )}
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Section title={t('Performer consent')}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Pill tone={r.captured_in_av ? 'info' : 'neutral'}>{r.captured_in_av ? t('Recorded for a film or anime') : t('Recorded as sound only')}</Pill>
                  {r.captured_in_av && <Pill tone={r.sound_only_consent ? 'good' : 'warn'}>{r.sound_only_consent ? t('Sound-only consent given') : t('No sound-only consent')}</Pill>}
                </div>
                <ConsentNotice captured={r.captured_in_av} consent={r.sound_only_consent} />
                {r.consent_note !== '' && <Prose>{r.consent_note}</Prose>}
                <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                  {t('Copyright Act art. 91(2): once performers agree to their performance being recorded in a film, they have no say over the film\'s uses, but a recording that takes the sound alone (a single, an album, streaming) needs their consent again.')}
                </p>
              </div>
            </Section>

            <Section title={t('Versions|recording')} meta={versions.records.length ? String(versions.records.length) : undefined} flush>
              {versions.records.length === 0 ? (
                <p className="px-4 py-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('No other versions made from this recording. A TV size, instrumental, live or remix each needs its own ISRC.')}</p>
              ) : (
                versions.records.map((v) => (
                  <ListRow
                    key={v.id}
                    onClick={() => navigate('recording', v.id)}
                    primary={v.title}
                    secondary={v.isrc !== '' ? fmtIsrc(v.isrc) : t('No ISRC')}
                    trailing={<Tag>{enumLabel('recordings.version_type', v.version_type)}</Tag>}
                  />
                ))
              )}
            </Section>

            {r.notes !== '' && (
              <Section title={t('Notes')}>
                <Prose>{r.notes}</Prose>
              </Section>
            )}
          </div>
        </div>
      )}

      {tab === 'performers' && <PerformersPanel recordingId={id} />}
      {tab === 'releases' && <ReleasesSection recordingId={id} />}
      {tab === 'contentid' && (
        <div className="flex flex-col gap-4">
          <ClaimsSection recordingId={id} />
          <AssetsSection recordingId={id} />
        </div>
      )}
      {tab === 'terms' && <TermsPanel id={id} />}
      {tab === 'documents' && <DocumentsPanel relation="recording" relationId={id} />}

      {edit && <RecordingDialog recording={r} onClose={() => setEdit(false)} onSaved={() => undefined} />}
      {newVersion && <NewVersionDialog source={r} onClose={() => setNewVersion(false)} />}
      {owners && <OwnersDialog rec={r} onClose={() => setOwners(false)} />}
    </div>
  );
}
