/**
 * One song (the composition): its facts and names, how complete its rights
 * data is (music/completeness), the writers and their shares, the society
 * registrations with their deadlines, the recordings of it and documents.
 */
import { useState } from 'react';
import { AudioLines, Check, ChevronRight, FileMusic, Music2, Pencil, Plus, X } from 'lucide-react';
import { Button, Card } from '../../kit/index.ts';
import { op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { bi, enumLabel, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DeadlineRec, RecordingRec, SocietyRegistrationRec, SongRec } from '../lib/records.ts';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, ListRow, Loading, Notice, Pill, Prose, Ref, Section, Tag } from '../components/ui.tsx';
import { CatalogLinks, TabBar, fmtIsrc, fmtIswc, lyricsLanguageLabel, namesText } from '../components/musicShared.tsx';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { SongDialog } from '../components/musicSongForm.tsx';
import { RecordingDialog } from '../components/musicRecordingForm.tsx';
import { WritersPanel } from '../components/musicCredits.tsx';
import type { CompletenessResult } from '../components/musicCredits.tsx';
import { RegistrationDialog, RegistrationsTable } from '../components/musicSocieties.tsx';

type TabKey = 'overview' | 'writers' | 'registrations' | 'recordings' | 'deadlines' | 'documents';
const TABS: TabKey[] = ['overview', 'writers', 'registrations', 'recordings', 'deadlines', 'documents'];

function Completeness({ res }: { res: { data: CompletenessResult | null; loading: boolean; error: string | null; reload: () => void } }): React.JSX.Element {
  if (res.loading && res.data === null) return <Loading />;
  if (res.error !== null) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (res.data === null) return <Loading />;
  return (
    <ul className="flex flex-col gap-1.5">
      {res.data.items.map((i) => (
        <li key={i.key} className="flex items-start gap-2 text-[13px] leading-relaxed">
          {i.ok ? (
            <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label={t('Done')} />
          ) : (
            <X size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label={t('Missing|checklist')} />
          )}
          <span className="min-w-0 break-words">{bi(i.text)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SongPage({ id }: { id: string }): React.JSX.Element {
  const { can } = useApp();
  const rec = useCollection<SongRec>('songs', { filter: `id = ${q(id)}` });
  const s = rec.records[0] ?? null;
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const tab: TabKey = (TABS as string[]).includes(tabParam) ? (tabParam as TabKey) : 'overview';
  const regs = useCollection<SocietyRegistrationRec>('society_registrations', { filter: `song = ${q(id)}`, sort: 'society' });
  const regIds = regs.records.map((r) => r.id);
  const deadlines = useCollection<DeadlineRec>('deadlines', {
    filter: regIds.length > 0 ? regIds.map((x) => `registration = ${q(x)}`).join(' || ') : 'id = ""',
    sort: 'due_date',
  });
  const recordings = useCollection<RecordingRec>('recordings', { filter: `song = ${q(id)} || songs.id ?= ${q(id)}`, sort: 'title' });
  const completeness = useLiveAsync(() => op<CompletenessResult>('music/completeness', { song_id: id }), [id], ['songs', 'involvements', 'society_registrations', 'recordings']);
  const dl = useDeadlineActions();
  const [edit, setEdit] = useState(false);
  const [addRec, setAddRec] = useState(false);
  const [regDialog, setRegDialog] = useState<{ reg: SocietyRegistrationRec | null } | null>(null);

  if (rec.loading) return <Loading />;
  if (s === null) {
    return (
      <Card>
        <EmptyHint
          icon={Music2}
          title={t('This song could not be opened')}
          message={t('It may have been deleted, or the link is incomplete.')}
          action={
            <Button variant="outline" onClick={() => navigate('music')}>
              {t('Back to Music')}
            </Button>
          }
        />
      </Card>
    );
  }

  const open = deadlines.records.filter((d) => d.status === 'open');
  const otherNames = namesText(s.names, s.title);
  const score = completeness.data?.score;
  const taken = regs.records.map((r) => r.society);

  const tabs: { value: TabKey; label: string; count?: number | undefined }[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'writers', label: t('Writers') },
    { value: 'registrations', label: t('Registrations'), count: regs.records.length },
    { value: 'recordings', label: t('Recordings'), count: recordings.records.length },
    { value: 'deadlines', label: t('Deadlines'), count: open.length },
    { value: 'documents', label: t('Documents') },
  ];

  return (
    <div className="min-w-0">
      <Card className="mb-5">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('music')} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  {t('Music')}
                </a>
                <ChevronRight size={12} className="text-[var(--agent-app-muted)]" aria-hidden />
                <span className="text-xs text-[var(--agent-app-muted)]">{t('Song')}</span>
                <EnumPill field="songs.status" value={s.status} />
                {s.tie_up_use !== '' && s.tie_up_use !== 'none' && <Tag>{enumLabel('songs.tie_up_use', s.tie_up_use)}</Tag>}
                <Tag>{s.original ? t('Our own song') : t('Cover of another song')}</Tag>
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{s.title}</h1>
              {otherNames !== '' && <div className="mt-0.5 break-words text-[13px] text-[var(--agent-app-muted)]">{otherNames}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-[var(--agent-app-muted)]">{t('ISWC')}</span>
                  {s.iswc !== '' ? <Ref>{fmtIswc(s.iswc)}</Ref> : <span className="text-xs text-[var(--agent-app-muted)]">{t('Not assigned')}</span>}
                </span>
                {s.franchise !== '' && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-xs text-[var(--agent-app-muted)]">{t('Franchise')}</span>
                    <CatalogLinks kind="franchise" ids={[s.franchise]} />
                  </span>
                )}
                {s.work !== '' && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-xs text-[var(--agent-app-muted)]">{t('Title')}</span>
                    <CatalogLinks kind="work" ids={[s.work]} />
                  </span>
                )}
                {s.characters.length > 0 && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-xs text-[var(--agent-app-muted)]">{t('Characters')}</span>
                    <CatalogLinks kind="character" ids={s.characters} />
                  </span>
                )}
              </div>
            </div>
            {can.edit && (
              <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
                <Button size="sm" onClick={() => setAddRec(true)}>
                  <Plus size={13} aria-hidden /> {t('Add recording')}
                </Button>
                <DeleteButton collection="songs" id={s.id} onDeleted={() => navigate('music')} />
              </div>
            )}
          </div>
        </div>
      </Card>

      <TabBar value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section title={t('Facts')}>
              <FactGrid cols={2}>
                <Fact label={t('ISWC')} value={s.iswc !== '' ? fmtIswc(s.iswc) : ''} mono />
                <Fact label={t('Lyrics language')} value={lyricsLanguageLabel(s.lyrics_language)} />
                <Fact label={t('Tie-up use')} value={s.tie_up_use !== '' && s.tie_up_use !== 'none' ? enumLabel('songs.tie_up_use', s.tie_up_use) : ''} />
                <Fact label={t('First publication')} value={fmtDate(s.first_publication)} />
                <Fact label={t('Copyright line')} value={s.copyright_line} className="sm:col-span-2" />
              </FactGrid>
            </Section>
            <Section title={t('Fan covers')}>
              <div className="flex flex-col gap-2">
                <div>
                  <Pill tone={s.fan_cover_allowed ? 'good' : 'neutral'}>{s.fan_cover_allowed ? t('Fans may cover this song') : t('Fan covers not offered')}</Pill>
                </div>
                {s.fan_cover_note !== '' && <Prose>{s.fan_cover_note}</Prose>}
                <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                  {t('Platform blanket licences let fans sing the composition on YouTube, TikTok, niconico and similar platforms. Our master or off-vocal track is a separate permission.')}
                </p>
              </div>
            </Section>
            {s.notes !== '' && (
              <Section title={t('Notes')}>
                <Prose>{s.notes}</Prose>
              </Section>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Section
              title={t('Completeness')}
              actions={score !== undefined ? <Pill tone={score >= 100 ? 'good' : score >= 60 ? 'warn' : 'bad'}>{t('{n}% complete', { n: score })}</Pill> : undefined}
            >
              <Completeness res={completeness} />
            </Section>
            <Section title={t('Next deadlines')} flush>
              {open.length === 0 ? (
                <p className="px-4 py-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('No open deadlines. A draft society registration gets a deadline to submit it before the quarter\'s cut-off.')}</p>
              ) : (
                <DeadlineList deadlines={open.slice(0, 3)} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} grouped={false} bulk={false} />
              )}
            </Section>
          </div>
        </div>
      )}

      {tab === 'writers' && <WritersPanel songId={id} completeness={completeness.data} />}

      {tab === 'registrations' && (
        <div className="flex flex-col gap-4">
          {completeness.data?.items
            .filter((i) => i.key === 'registration' && !i.ok)
            .map((i) => (
              <Notice key={i.key} tone="warn">
                {bi(i.text)}
              </Notice>
            ))}
          <Section
            title={t('Society registrations')}
            meta={regs.records.length ? String(regs.records.length) : undefined}
            flush
            actions={
              can.edit && taken.length < 4 ? (
                <Button size="sm" variant="outline" onClick={() => setRegDialog({ reg: null })}>
                  <Plus size={13} aria-hidden /> {t('Add registration')}
                </Button>
              ) : undefined
            }
          >
            {regs.loading ? (
              <Loading />
            ) : (
              <RegistrationsTable
                regs={regs.records}
                showSong={false}
                onOpen={(r) => setRegDialog({ reg: r })}
                empty={
                  <EmptyHint
                    icon={FileMusic}
                    title={t('Not registered with any society')}
                    message={t('JASRAC holds every work of a trust member; NexTone takes works one by one. File the shares per right category, or mark the song self-managed.')}
                    action={
                      can.edit ? (
                        <Button size="sm" onClick={() => setRegDialog({ reg: null })}>
                          <Plus size={13} aria-hidden /> {t('Add registration')}
                        </Button>
                      ) : undefined
                    }
                    compact
                  />
                }
              />
            )}
          </Section>
        </div>
      )}

      {tab === 'recordings' && (
        <Section
          title={t('Recordings')}
          meta={recordings.records.length ? String(recordings.records.length) : undefined}
          flush
          actions={
            can.edit ? (
              <Button size="sm" variant="outline" onClick={() => setAddRec(true)}>
                <Plus size={13} aria-hidden /> {t('Add recording')}
              </Button>
            ) : undefined
          }
        >
          {recordings.loading ? (
            <Loading />
          ) : recordings.records.length === 0 ? (
            <EmptyHint
              icon={AudioLines}
              title={t('No recordings of this song yet')}
              message={t('Add the studio recording first. TV size, instrumental and live versions are made from it, each with its own ISRC.')}
              action={
                can.edit ? (
                  <Button size="sm" onClick={() => setAddRec(true)}>
                    <Plus size={13} aria-hidden /> {t('Add recording')}
                  </Button>
                ) : undefined
              }
              compact
            />
          ) : (
            recordings.records.map((r) => (
              <ListRow
                key={r.id}
                onClick={() => navigate('recording', r.id)}
                primary={r.title}
                secondary={[r.isrc !== '' ? fmtIsrc(r.isrc) : t('No ISRC'), r.song !== id ? t('Part of a medley') : ''].filter((x) => x !== '').join(' · ')}
                trailing={
                  <>
                    {r.version_type !== '' && (
                      <span className="hidden sm:inline-flex">
                        <Tag>{enumLabel('recordings.version_type', r.version_type)}</Tag>
                      </span>
                    )}
                    <EnumPill field="recordings.status" value={r.status} />
                  </>
                }
              />
            ))
          )}
        </Section>
      )}

      {tab === 'deadlines' && (
        <Section title={t('Deadlines')} meta={open.length ? String(open.length) : undefined} flush>
          {deadlines.loading ? (
            <Loading />
          ) : (
            <DeadlineList
              deadlines={deadlines.records}
              actions={dl.actions}
              canEdit={dl.canEdit}
              showSubject={false}
              empty={<EmptyHint title={t('No deadlines')} message={t('Deadlines of this song\'s society registrations show here: the cut-off to submit a draft registration each quarter.')} compact />}
            />
          )}
        </Section>
      )}

      {tab === 'documents' && <DocumentsPanel relation="song" relationId={id} />}

      {dl.dialogs}
      {edit && <SongDialog song={s} onClose={() => setEdit(false)} onSaved={() => undefined} />}
      {addRec && <RecordingDialog recording={null} songId={id} songTitle={s.title} onClose={() => setAddRec(false)} onSaved={(r) => navigate('recording', r.id)} />}
      {regDialog !== null && <RegistrationDialog reg={regDialog.reg} songId={id} taken={taken} readOnly={!can.edit} onClose={() => setRegDialog(null)} />}
    </div>
  );
}
