/**
 * Music: songs (the composition), recordings (the master), releases,
 * collecting-society contracts and work registrations, YouTube Content ID,
 * the singing-stream setlist check and the songs used before registration.
 * Deadline links arrive as ?open=<registration, claim or society contract id>.
 */
import { useEffect, useMemo, useState } from 'react';
import { AudioLines, FileWarning, Music2, Plus, Search } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { getRecord, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { toneOf } from '../lib/labels.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { ContentIdClaimRec, InvolvementRec, RecordingRec, SocietyContractRec, SocietyRegistrationRec, SongRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, EnumPill, ErrorBox, ListRow, Loading, PageHeader, Pill, Ref, Section, Tag, Toolbar } from '../components/ui.tsx';
import { CatalogLinks, Dash, RecordingLink, SongLink, TabBar, fmtIsrc, fmtIswc, isHundred, masterOwners, namesText, ownersText, total, writersSummary } from '../components/musicShared.tsx';
import { canDelete, deleteCol } from '../components/deleteRecord.tsx';
import { SongDialog } from '../components/musicSongForm.tsx';
import { RecordingDialog } from '../components/musicRecordingForm.tsx';
import { ReleasesSection } from '../components/musicRelease.tsx';
import { ContractDialog, ContractsSection, RegistrationDialog, RegistrationsSection } from '../components/musicSocieties.tsx';
import { AllowlistSection, AssetsSection, ClaimDrawer, ClaimsSection, ConflictsSection } from '../components/musicContentId.tsx';
import { SetlistCheck } from '../components/musicSetlist.tsx';

type TabKey = 'songs' | 'recordings' | 'releases' | 'societies' | 'contentid' | 'setlist' | 'unregistered';
const TABS: TabKey[] = ['songs', 'recordings', 'releases', 'societies', 'contentid', 'setlist', 'unregistered'];

type Focus = { kind: 'registration'; rec: SocietyRegistrationRec } | { kind: 'contract'; rec: SocietyContractRec } | { kind: 'claim'; id: string } | null;

function matches(q: string, ...fields: string[]): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((f) => f.toLowerCase().includes(needle));
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): React.JSX.Element {
  return (
    <div className="relative w-full sm:w-72">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={t('Search')} className="pl-8" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Songs                                                               */
/* ------------------------------------------------------------------ */

function SongsTab({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  const { can, nameOf } = useApp();
  const songs = useCollection<SongRec>('songs', { sort: 'title' });
  const inv = useCollection<InvolvementRec>('involvements', { filter: 'song != ""', expand: 'party' });
  const regs = useCollection<SocietyRegistrationRec>('society_registrations', { sort: 'society' });
  const [q, setQ] = useHashParam('q', '');
  const [status, setStatus] = useHashParam('status', '');

  const writersBySong = useMemo(() => {
    const m = new Map<string, InvolvementRec[]>();
    for (const i of inv.records) m.set(i.song, [...(m.get(i.song) ?? []), i]);
    return m;
  }, [inv.records]);
  const regsBySong = useMemo(() => {
    const m = new Map<string, SocietyRegistrationRec[]>();
    for (const r of regs.records) m.set(r.song, [...(m.get(r.song) ?? []), r]);
    return m;
  }, [regs.records]);
  const rows = songs.records.filter(
    (s) => (status === '' || s.status === status) && matches(q, s.title, s.iswc, namesText(s.names), writersSummary(writersBySong.get(s.id) ?? [])),
  );

  const cols: Col<SongRec>[] = [
    {
      key: 'title',
      label: t('Song title'),
      render: (s) => (
        <div className="min-w-0 max-w-[18rem]">
          <SongLink id={s.id} song={s} />
          {namesText(s.names, s.title) !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{namesText(s.names, s.title)}</div>}
        </div>
      ),
    },
    { key: 'iswc', label: t('ISWC'), value: (s) => fmtIswc(s.iswc), render: (s) => (s.iswc !== '' ? <Ref>{fmtIswc(s.iswc)}</Ref> : <Dash />) },
    {
      key: 'writers',
      label: t('Writers'),
      value: (s) => writersSummary(writersBySong.get(s.id) ?? []),
      render: (s) => {
        const w = writersSummary(writersBySong.get(s.id) ?? []);
        return w !== '' ? <div className="max-w-[16rem] truncate text-xs" title={w}>{w}</div> : <Dash />;
      },
    },
    {
      key: 'society',
      label: t('Society'),
      value: (s) => (regsBySong.get(s.id) ?? []).map((r) => `${r.society}:${r.status}`).join(','),
      render: (s) => {
        const list = regsBySong.get(s.id) ?? [];
        if (list.length === 0) return <span className="text-xs text-[var(--agent-app-muted)]">{t('Not registered')}</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {list.map((r) => (
              <Pill key={r.id} tone={toneOf('society_registrations.status', r.status)}>
                {enumLabel('society_registrations.society', r.society)} {enumLabel('society_registrations.status', r.status)}
              </Pill>
            ))}
          </div>
        );
      },
    },
    { key: 'tie_up_use', label: t('Tie-up use'), value: (s) => enumLabel('songs.tie_up_use', s.tie_up_use), render: (s) => (s.tie_up_use !== '' && s.tie_up_use !== 'none' ? <Tag>{enumLabel('songs.tie_up_use', s.tie_up_use)}</Tag> : <Dash />) },
    {
      key: 'work',
      label: t('Franchise or title'),
      value: (s) => nameOf('work', s.work) || nameOf('franchise', s.franchise),
      render: (s) =>
        s.work !== '' ? <CatalogLinks kind="work" ids={[s.work]} /> : s.franchise !== '' ? <CatalogLinks kind="franchise" ids={[s.franchise]} /> : <Dash />,
    },
    { key: 'status', label: t('Status'), value: (s) => enumLabel('songs.status', s.status), render: (s) => <EnumPill field="songs.status" value={s.status} /> },
  ];

  return (
    <div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder={t('Title, ISWC or writer')} />
        <div className="w-full sm:w-48">
          <Select aria-label={t('Status')} value={status} placeholder={t('Every status')} options={enumOptions('songs.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
      </Toolbar>
      <Section title={t('Songs')} meta={songs.loading ? undefined : String(rows.length)} flush>
        {songs.loading ? (
          <Loading />
        ) : (
          <DataTable<SongRec>
            tableId="music-songs"
            rows={rows}
            columns={[...cols, ...deleteCol<SongRec>('songs', canDelete(can, 'songs'))]}
            onRowClick={(s) => navigate('song', s.id)}
            exportName="songs"
            empty={
              songs.records.length === 0 ? (
                <EmptyHint
                  icon={Music2}
                  title={t('No songs yet')}
                  message={t('A song is the composition: melody and lyrics, its writers and their shares, and its society registrations. Recordings of it come after.')}
                  action={
                    can.edit ? (
                      <Button size="sm" onClick={onCreate}>
                        <Plus size={13} aria-hidden /> {t('New song')}
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              ) : (
                <EmptyHint title={t('No song matches')} message={t('Try another title or clear the status filter.')} compact />
              )
            }
          />
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recordings                                                          */
/* ------------------------------------------------------------------ */

function RecordingsTab({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  const { can } = useApp();
  const recs = useCollection<RecordingRec>('recordings', { sort: 'title', expand: 'song' });
  const [q, setQ] = useHashParam('q', '');
  const [vt, setVt] = useHashParam('version', '');
  const rows = recs.records.filter((r) => (vt === '' || r.version_type === vt) && matches(q, r.title, r.isrc, fmtIsrc(r.isrc), (r.expand?.['song'] as SongRec | undefined)?.title ?? ''));

  const cols: Col<RecordingRec>[] = [
    {
      key: 'title',
      label: t('Recording title'),
      render: (r) => (
        <span className="font-medium">
          <RecordingLink id={r.id} rec={r} />
        </span>
      ),
    },
    { key: 'version_type', label: t('Version|recording'), value: (r) => enumLabel('recordings.version_type', r.version_type), render: (r) => (r.version_type !== '' ? <Tag>{enumLabel('recordings.version_type', r.version_type)}</Tag> : <Dash />) },
    { key: 'isrc', label: t('ISRC'), value: (r) => fmtIsrc(r.isrc), render: (r) => (r.isrc !== '' ? <Ref>{fmtIsrc(r.isrc)}</Ref> : <span className="text-xs text-amber-700 dark:text-amber-400">{t('No ISRC')}</span>) },
    { key: 'song', label: t('Song'), value: (r) => (r.expand?.['song'] as SongRec | undefined)?.title ?? '', render: (r) => (r.song !== '' ? <SongLink id={r.song} song={r.expand?.['song'] as SongRec | undefined} /> : <Dash />) },
    { key: 'status', label: t('Status'), value: (r) => enumLabel('recordings.status', r.status), render: (r) => <EnumPill field="recordings.status" value={r.status} /> },
    {
      key: 'owners',
      label: t('Master owners'),
      value: (r) => ownersText(r.master_owners),
      render: (r) => {
        const owners = masterOwners(r.master_owners);
        if (owners.length === 0) return <span className="text-xs text-[var(--agent-app-muted)]">{t('Not recorded')}</span>;
        const sum = total(owners.map((o) => o.pct));
        return (
          <div className="max-w-[16rem] text-xs">
            <div className="truncate" title={ownersText(r.master_owners)}>
              {ownersText(r.master_owners)}
            </div>
            {!isHundred(sum) && <div className="text-amber-700 dark:text-amber-400">{t('Adds to {pct}%, not 100%', { pct: sum })}</div>}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder={t('Title, ISRC or song')} />
        <div className="w-full sm:w-48">
          <Select aria-label={t('Version|recording')} value={vt} placeholder={t('Every version')} options={enumOptions('recordings.version_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setVt(e.target.value)} />
        </div>
      </Toolbar>
      <Section title={t('Recordings')} meta={recs.loading ? undefined : String(rows.length)} flush>
        {recs.loading ? (
          <Loading />
        ) : (
          <DataTable<RecordingRec>
            tableId="music-recordings"
            rows={rows}
            columns={[...cols, ...deleteCol<RecordingRec>('recordings', canDelete(can, 'recordings'))]}
            onRowClick={(r) => navigate('recording', r.id)}
            exportName="recordings"
            empty={
              recs.records.length === 0 ? (
                <EmptyHint
                  icon={AudioLines}
                  title={t('No recordings yet')}
                  message={t('A recording is the master (原盤): one fixed performance of a song with its own ISRC, owners and performers.')}
                  action={
                    can.edit ? (
                      <Button size="sm" onClick={onCreate}>
                        <Plus size={13} aria-hidden /> {t('New recording')}
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              ) : (
                <EmptyHint title={t('No recording matches')} message={t('Try another title or ISRC, or clear the version filter.')} compact />
              )
            }
          />
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unregistered                                                        */
/* ------------------------------------------------------------------ */

interface UnregisteredSong {
  id: string;
  title: string;
  first_publication: string;
  registrations: { society: string; status: string }[];
}

function UnregisteredTab(): React.JSX.Element {
  const { can } = useApp();
  const res = useLiveAsync(() => op<{ songs: UnregisteredSong[] }>('music/unregistered'), [], ['songs', 'recordings', 'society_registrations']);
  const [add, setAdd] = useState<UnregisteredSong | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
        {t('Songs already released, streamed or performed in public that no society has registered yet (and that are not marked self-managed). Uses before registration may be withheld or paid to no one.')}
      </p>
      <Section title={t('Used but not registered')} meta={res.data !== null ? String(res.data.songs.length) : undefined} flush>
        {res.loading && res.data === null ? (
          <Loading />
        ) : res.error !== null ? (
          <div className="p-4">
            <ErrorBox message={res.error} onRetry={res.reload} />
          </div>
        ) : res.data === null || res.data.songs.length === 0 ? (
          <EmptyHint icon={FileWarning} title={t('Every song in use is registered')} message={t('Released and published songs all have a JASRAC or NexTone registration, or are self-managed.')} compact />
        ) : (
          res.data.songs.map((s) => (
            <ListRow
              key={s.id}
              onClick={() => navigate('song', s.id, { tab: 'registrations' })}
              primary={s.title}
              secondary={
                <span className="inline-flex flex-wrap gap-x-2">
                  {s.first_publication !== '' && <span>{t('First published {date}', { date: fmtDate(s.first_publication) })}</span>}
                  {s.registrations.length === 0 ? (
                    <span>{t('No registration started')}</span>
                  ) : (
                    s.registrations.map((r, i) => (
                      <span key={i}>
                        {enumLabel('society_registrations.society', r.society)}: {enumLabel('society_registrations.status', r.status)}
                      </span>
                    ))
                  )}
                </span>
              }
              trailing={
                can.edit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdd(s);
                    }}
                  >
                    <Plus size={13} aria-hidden /> <span className="hidden sm:inline">{t('Add registration')}</span>
                  </Button>
                ) : undefined
              }
            />
          ))
        )}
      </Section>
      {add !== null && <RegistrationDialog reg={null} songId={add.id} taken={add.registrations.map((r) => r.society)} onClose={() => setAdd(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function MusicPage(): React.JSX.Element {
  const { can } = useApp();
  const [tabParam, setTab] = useHashParam('tab', 'songs');
  const [openParam, setOpenParam] = useHashParam('open', '');
  const [, setQ] = useHashParam('q', '');
  const tab: TabKey = (TABS as string[]).includes(tabParam) ? (tabParam as TabKey) : 'songs';
  const [focus, setFocus] = useState<Focus>(null);
  const [newSong, setNewSong] = useState(false);
  const [newRec, setNewRec] = useState(false);

  // A deadline link (?open=<id>) opens the registration, claim or society contract it is about.
  useEffect(() => {
    if (openParam === '') return;
    let cancelled = false;
    const find = async (): Promise<void> => {
      const reg = await getRecord<SocietyRegistrationRec>('society_registrations', openParam).catch(() => null);
      if (cancelled) return;
      if (reg !== null) {
        setTab('societies');
        setFocus({ kind: 'registration', rec: reg });
        return;
      }
      const claim = await getRecord<ContentIdClaimRec>('content_id_claims', openParam).catch(() => null);
      if (cancelled) return;
      if (claim !== null) {
        setTab('contentid');
        setFocus({ kind: 'claim', id: claim.id });
        return;
      }
      const sc = await getRecord<SocietyContractRec>('society_contracts', openParam).catch(() => null);
      if (cancelled) return;
      if (sc !== null) {
        setTab('societies');
        setFocus({ kind: 'contract', rec: sc });
      }
    };
    void find();
    return () => {
      cancelled = true;
    };
  }, [openParam, setTab]);

  const closeFocus = (): void => {
    setFocus(null);
    if (openParam !== '') setOpenParam('');
  };

  const tabs: { value: TabKey; label: string }[] = [
    { value: 'songs', label: t('Songs') },
    { value: 'recordings', label: t('Recordings') },
    { value: 'releases', label: t('Releases') },
    { value: 'societies', label: t('Societies') },
    { value: 'contentid', label: t('Content ID') },
    { value: 'setlist', label: t('Setlist check') },
    { value: 'unregistered', label: t('Unregistered') },
  ];

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('Music')}
        subtitle={t('The three rights in every song: the composition and its writers, the master recording and its owners, and the performances. Plus society registrations, Content ID and singing-stream checks.')}
        actions={
          can.edit ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setNewRec(true)}>
                <Plus size={13} aria-hidden /> {t('New recording')}
              </Button>
              <Button size="sm" onClick={() => setNewSong(true)}>
                <Plus size={13} aria-hidden /> {t('New song')}
              </Button>
            </>
          ) : undefined
        }
      />
      <TabBar
        value={tab}
        onChange={(v) => {
          setQ('');
          setTab(v);
        }}
        tabs={tabs}
      />
      {tab === 'songs' && <SongsTab onCreate={() => setNewSong(true)} />}
      {tab === 'recordings' && <RecordingsTab onCreate={() => setNewRec(true)} />}
      {tab === 'releases' && <ReleasesSection />}
      {tab === 'societies' && (
        <div className="flex flex-col gap-4">
          <ContractsSection onOpen={(c) => setFocus({ kind: 'contract', rec: c })} />
          <RegistrationsSection onOpen={(r) => setFocus({ kind: 'registration', rec: r })} />
        </div>
      )}
      {tab === 'contentid' && (
        <div className="flex flex-col gap-4">
          <ClaimsSection />
          <AssetsSection />
          <AllowlistSection />
          <ConflictsSection />
        </div>
      )}
      {tab === 'setlist' && <SetlistCheck />}
      {tab === 'unregistered' && <UnregisteredTab />}

      {newSong && <SongDialog song={null} onClose={() => setNewSong(false)} onSaved={(s) => navigate('song', s.id)} />}
      {newRec && <RecordingDialog recording={null} onClose={() => setNewRec(false)} onSaved={(r) => navigate('recording', r.id)} />}
      {focus?.kind === 'registration' && <RegistrationDialog reg={focus.rec} readOnly={!can.edit} onClose={closeFocus} />}
      {focus?.kind === 'contract' && <ContractDialog contract={focus.rec} readOnly={!can.edit} onClose={closeFocus} />}
      {focus?.kind === 'claim' && <ClaimDrawer id={focus.id} onClose={closeFocus} />}
    </div>
  );
}
