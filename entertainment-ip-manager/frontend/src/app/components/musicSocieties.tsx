/**
 * Collecting societies: our contracts with JASRAC (all works on trust) and
 * NexTone (work by work), and each song's registration (作品届) with its
 * shares per right category and the tie-up uses the publisher reserves.
 * Draft registrations and contracts get their deadlines from the server.
 */
import { useMemo, useState } from 'react';
import { Building2, Copy, FileMusic, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, getPbClient, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t, tn } from '../lib/i18n.ts';
import { useHashParam } from '../lib/router.ts';
import type { InvolvementRec, SocietyContractRec, SocietyRegistrationRec, SongRec } from '../lib/records.ts';
import { useDeadlineActions } from './deadlines.tsx';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { PartyPicker, RecordPicker } from './pickers.tsx';
import { EmptyHint, EnumPill, Field, ListRow, Loading, Notice, Ref, Section, Tag } from './ui.tsx';
import {
  CheckRow,
  Dash,
  DeadlineChip,
  PctTotal,
  REG_CATEGORIES,
  RESERVATION_TYPES,
  RowsHeader,
  SongLink,
  WRITER_ROLES,
  isHundred,
  num,
  partyOf,
  regCategoryLabel,
  regShareJson,
  regShareRows,
  reservationTypeLabel,
  reservations,
  reservationsJson,
  roleOptions,
  total,
  useOpenDeadlinesBy,
  writerShares,
} from './musicShared.tsx';
import { FooterDelete } from './deleteRecord.tsx';
import type { RegCategory, RegShareRow, Reservation, ReservationType } from './musicShared.tsx';

function societyOptions(field: string): { value: string; label: string }[] {
  return enumOptions(field).map(([value, label]) => ({ value, label }));
}

/* ------------------------------------------------------------------ */
/* Shares editor                                                       */
/* ------------------------------------------------------------------ */

function usedCategories(list: RegShareRow[]): RegCategory[] {
  const used = new Set<RegCategory>(['performance', 'mechanical']);
  for (const r of list) for (const c of REG_CATEGORIES) if ((r.vals[c] ?? '').trim() !== '') used.add(c);
  return REG_CATEGORIES.filter((c) => used.has(c));
}

export function SharesEditor({ value, onChange, society }: { value: RegShareRow[]; onChange: (v: RegShareRow[]) => void; society: string }): React.JSX.Element {
  const [cats, setCats] = useState<RegCategory[]>(() => usedCategories(value));
  const set = (i: number, patch: Partial<RegShareRow>): void => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setVal = (i: number, c: RegCategory, v: string): void => onChange(value.map((r, j) => (j === i ? { ...r, vals: { ...r.vals, [c]: v } } : r)));
  const toggleCat = (c: RegCategory): void => setCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : REG_CATEGORIES.filter((x) => cs.includes(x) || x === c)));
  const sums = cats.map((c) => {
    const vals = value.map((r) => r.vals[c] ?? '').filter((v) => v.trim() !== '');
    return { c, used: vals.length > 0, sum: total(vals.map(num)) };
  });
  const publisherPerf = total(value.filter((r) => r.role === 'publisher').map((r) => num(r.vals.performance ?? '')));

  return (
    <div className="flex flex-col gap-2">
      <RowsHeader
        title={t('Shares filed')}
        help={t('Each writer and publisher with their share in percent per right category. Every category used must add to 100.')}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { party: '', name: '', role: 'composer', vals: {} }])}>
            <Plus size={13} aria-hidden /> {t('Add row')}
          </Button>
        }
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Right categories')}>
        {REG_CATEGORIES.map((c) => {
          const on = cats.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggleCat(c)}
              className={
                on
                  ? 'border border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 px-2 py-0.5 text-xs text-[var(--agent-app-accent)]'
                  : 'border border-[var(--agent-app-border)] px-2 py-0.5 text-xs text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30'
              }
            >
              {regCategoryLabel(c)}
            </button>
          );
        })}
      </div>
      {value.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto] sm:items-end">
            <PartyPicker label={t('Person or company')} value={r.party} onChange={(id, p) => set(i, { party: id, name: p?.name ?? r.name })} />
            <Input label={t('Name as filed')} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <Select label={t('Role|credit')} value={r.role} options={roleOptions(WRITER_ROLES.includes(r.role as (typeof WRITER_ROLES)[number]) || r.role === '' ? WRITER_ROLES : [...WRITER_ROLES, r.role])} onChange={(e) => set(i, { role: e.target.value })} />
            <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {cats.map((c) => (
              <Input key={c} label={regCategoryLabel(c)} type="number" min={0} max={100} step="0.01" value={r.vals[c] ?? ''} placeholder="%" onChange={(e) => setVal(i, c, e.target.value)} />
            ))}
          </div>
        </div>
      ))}
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {sums
            .filter((s) => s.used)
            .map((s) => (
              <PctTotal key={s.c} value={s.sum} label={regCategoryLabel(s.c)} />
            ))}
        </div>
      )}
      {sums.some((s) => s.used && !isHundred(s.sum)) && <Notice tone="warn">{t('A right category does not add up to 100%.')}</Notice>}
      {society === 'jasrac' && publisherPerf > 50.0001 && (
        <Notice tone="warn">{t('JASRAC caps the music publisher\'s performance share at 6/12 (50%). This registration gives the publisher {pct}%.', { pct: publisherPerf })}</Notice>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reservations editor                                                 */
/* ------------------------------------------------------------------ */

export function ReservationsEditor({ value, onChange }: { value: Reservation[]; onChange: (v: Reservation[]) => void }): React.JSX.Element {
  const set = (i: number, patch: Partial<Reservation>): void => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      <RowsHeader
        title={t('Reserved uses')}
        help={t('Tie-up uses the publisher keeps out of the society\'s licensing (留保): the advertiser, the product and the period.')}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { type: 'cm', party: '', product: '', from: '', to: '', note: '' }])}>
            <Plus size={13} aria-hidden /> {t('Add reservation')}
          </Button>
        }
      />
      {value.map((r, i) => (
        <div key={i} className="grid gap-2 border border-[var(--agent-app-border)] p-2 sm:grid-cols-2">
          <Select label={t('Use|reservation')} value={r.type} options={RESERVATION_TYPES.map((x) => ({ value: x, label: reservationTypeLabel(x) }))} onChange={(e) => set(i, { type: e.target.value as ReservationType })} />
          <PartyPicker label={t('Advertiser or licensee')} value={r.party} onChange={(id) => set(i, { party: id })} />
          <Input label={t('Product or programme')} value={r.product} onChange={(e) => set(i, { product: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('From|period')} type="date" value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
            <Input label={t('To|period')} type="date" value={r.to} onChange={(e) => set(i, { to: e.target.value })} />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Input label={t('Note')} value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
            <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registration dialog                                                 */
/* ------------------------------------------------------------------ */

export function RegistrationDialog({
  reg,
  songId = '',
  taken = [],
  readOnly = false,
  onClose,
}: {
  /** null to create. */
  reg: SocietyRegistrationRec | null;
  /** Preset song when creating from a song. */
  songId?: string | undefined;
  /** Societies this song is already registered with (one registration per society). */
  taken?: string[] | undefined;
  readOnly?: boolean | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [song, setSong] = useState(reg?.song ?? songId);
  const free = societyOptions('society_registrations.society').filter((o) => reg !== null || !taken.includes(o.value));
  const [society, setSociety] = useState<string>(reg?.society || free[0]?.value || 'jasrac');
  const [status, setStatus] = useState<string>(reg?.status || 'draft');
  const [workCode, setWorkCode] = useState(reg?.work_code ?? '');
  const [submitted, setSubmitted] = useState(d10(reg?.submitted_date));
  const [registered, setRegistered] = useState(d10(reg?.registered_date));
  const [shares, setShares] = useState<RegShareRow[]>(() => regShareRows(reg?.shares));
  const [resv, setResv] = useState<Reservation[]>(() => reservations(reg?.reservations));
  const [notes, setNotes] = useState(reg?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [sharesKey, setSharesKey] = useState(0);

  const copyWriters = async (): Promise<void> => {
    if (song === '') return;
    try {
      const inv = await getPbClient().call((pb) =>
        pb.collection('involvements').getFullList<InvolvementRec>({
          filter: `song = "${song}" && (role = "composer" || role = "lyricist" || role = "arranger" || role = "publisher")`,
          sort: 'created',
          expand: 'party',
        }),
      );
      const withParty = inv.map((i) => ({ i, name: partyOf(i)?.name ?? '' }));
      const next: RegShareRow[] = withParty.map(({ i, name }) => {
        const s = writerShares(i);
        const vals: RegShareRow['vals'] = {};
        if (s.performance !== undefined) vals.performance = String(s.performance);
        if (s.mechanical !== undefined) vals.mechanical = String(s.mechanical);
        return { party: i.party, name: i.credit_name || name, role: i.role, vals };
      });
      if (next.length === 0) {
        toast.info(t('This song has no writers yet. Add them on the song\'s Writers tab.'));
        return;
      }
      setShares(next);
      setSharesKey((k) => k + 1);
    } catch {
      /* the client shows the server's message */
    }
  };

  const save = async (): Promise<void> => {
    if (song === '' || society === '') return;
    setBusy(true);
    const data: Record<string, unknown> = {
      song,
      society,
      status,
      work_code: workCode.trim(),
      submitted_date: toPb(submitted),
      registered_date: toPb(registered),
      shares: regShareJson(shares),
      reservations: reservationsJson(resv),
      notes,
    };
    try {
      if (reg === null) await createRecord('society_registrations', data);
      else await updateRecord('society_registrations', reg.id, data);
      toast.success(reg === null ? t('Registration added') : t('Saved'));
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
      title={reg === null ? t('New society registration') : t('Society registration')}
      description={t('The work registration (作品届) of one song with one society. While it is a draft, a deadline to submit it before the quarter\'s cut-off is set.')}
      className="max-h-[92vh] w-[min(94vw,46rem)] overflow-y-auto"
      footer={
        <>
          {reg !== null && <FooterDelete collection="society_registrations" id={reg.id} onDeleted={onClose} />}
          <Button variant="outline" onClick={onClose}>
            {readOnly ? t('Close') : t('Cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} loading={busy} disabled={song === '' || society === '' || (reg === null && free.length === 0)}>
              {t('Save')}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        {reg === null && songId === '' ? (
          <RecordPicker<SongRec> collection="songs" label={t('Song')} value={song} onChange={(id) => setSong(id)} labelOf={(s) => s.title} searchFields={['title', 'iswc']} />
        ) : null}
        {reg === null && free.length === 0 && <Notice tone="info">{t('This song already has a registration with every society.')}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Society')} required>
            <Select value={society} options={reg === null ? free : societyOptions('society_registrations.society')} disabled={reg !== null} onChange={(e) => setSociety(e.target.value)} />
          </Field>
          <Field label={t('Status')}>
            <Select value={status} options={societyOptions('society_registrations.status')} onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Field label={t('Work code')} help={t('The code the society issues (作品コード).')}>
            <Input value={workCode} onChange={(e) => setWorkCode(e.target.value)} className="font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('Submitted on')}>
              <Input type="date" value={submitted} onChange={(e) => setSubmitted(e.target.value)} />
            </Field>
            <Field label={t('Registration date')}>
              <Input type="date" value={registered} onChange={(e) => setRegistered(e.target.value)} />
            </Field>
          </div>
        </div>
        {!readOnly && song !== '' && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => void copyWriters()}>
              <Copy size={13} aria-hidden /> {t('Fill the shares from the song\'s writers')}
            </Button>
          </div>
        )}
        <SharesEditor key={sharesKey} value={shares} onChange={setShares} society={society} />
        <ReservationsEditor value={resv} onChange={setResv} />
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Registration lists                                                  */
/* ------------------------------------------------------------------ */

/** Totals per right category filed on a registration (green at 100). */
function SharesSummary({ value }: { value: unknown }): React.JSX.Element {
  const list = regShareRows(value);
  const sums = REG_CATEGORIES.map((c) => {
    const vals = list.map((r) => r.vals[c] ?? '').filter((v) => v.trim() !== '');
    return { c, used: vals.length > 0, sum: total(vals.map(num)) };
  }).filter((x) => x.used);
  if (sums.length === 0) return <Dash />;
  return (
    <div className="flex max-w-[18rem] flex-wrap gap-1">
      {sums.map((x) => (
        <PctTotal key={x.c} value={x.sum} label={regCategoryLabel(x.c)} />
      ))}
    </div>
  );
}

function sharesText(value: unknown): string {
  const list = regShareRows(value);
  return REG_CATEGORIES.map((c) => {
    const vals = list.map((r) => r.vals[c] ?? '').filter((v) => v.trim() !== '');
    return vals.length > 0 ? `${regCategoryLabel(c)} ${total(vals.map(num))}%` : '';
  })
    .filter((x) => x !== '')
    .join(', ');
}

export function RegistrationsTable({
  regs,
  showSong,
  onOpen,
  empty,
}: {
  regs: SocietyRegistrationRec[];
  showSong: boolean;
  onOpen: (r: SocietyRegistrationRec) => void;
  empty: React.ReactNode;
}): React.JSX.Element {
  const dl = useDeadlineActions();
  const dead = useOpenDeadlinesBy('registration');
  const cols: Col<SocietyRegistrationRec>[] = [
    ...(showSong
      ? [
          {
            key: 'song',
            label: t('Song'),
            value: (r: SocietyRegistrationRec) => (r.expand?.['song'] as SongRec | undefined)?.title ?? '',
            render: (r: SocietyRegistrationRec) => <SongLink id={r.song} song={r.expand?.['song'] as SongRec | undefined} />,
          },
        ]
      : []),
    { key: 'society', label: t('Society'), value: (r) => enumLabel('society_registrations.society', r.society), render: (r) => <Tag>{enumLabel('society_registrations.society', r.society)}</Tag> },
    { key: 'status', label: t('Status'), value: (r) => enumLabel('society_registrations.status', r.status), render: (r) => <EnumPill field="society_registrations.status" value={r.status} /> },
    { key: 'work_code', label: t('Work code'), render: (r) => (r.work_code !== '' ? <Ref>{r.work_code}</Ref> : <Dash />) },
    { key: 'shares', label: t('Shares filed'), sortable: false, value: (r) => sharesText(r.shares), render: (r) => <SharesSummary value={r.shares} /> },
    {
      key: 'reservations',
      label: t('Reserved uses'),
      optional: true,
      value: (r) => reservations(r.reservations).length,
      render: (r) => {
        const n = reservations(r.reservations).length;
        return n > 0 ? tn(n, '{n} reservation', '{n} reservations') : <Dash />;
      },
    },
    { key: 'submitted_date', label: t('Submitted on'), value: (r) => d10(r.submitted_date), render: (r) => fmtDate(r.submitted_date) || <Dash /> },
    { key: 'registered_date', label: t('Registration date'), value: (r) => d10(r.registered_date), render: (r) => fmtDate(r.registered_date) || <Dash /> },
    {
      key: 'deadline',
      label: t('Next deadline'),
      value: (r) => d10(dead.byId.get(r.id)?.[0]?.due_date),
      render: (r) => {
        const d = dead.byId.get(r.id)?.[0];
        return d !== undefined ? <DeadlineChip d={d} onWhy={dl.actions.onWhy} short /> : <Dash />;
      },
    },
  ];
  return (
    <>
      <DataTable<SocietyRegistrationRec> tableId={showSong ? 'music-registrations' : 'song-registrations'} rows={regs} columns={cols} onRowClick={onOpen} empty={empty} exportName="society-registrations" />
      {dl.dialogs}
    </>
  );
}

/** Registrations across all songs (Music, Societies tab). */
export function RegistrationsSection({ onOpen }: { onOpen: (r: SocietyRegistrationRec) => void }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<SocietyRegistrationRec>('society_registrations', { sort: '-updated', expand: 'song' });
  const [create, setCreate] = useState(false);
  const [status, setStatus] = useHashParam('regstatus', '');
  const rowsShown = useMemo(() => (status === '' ? list.records : list.records.filter((r) => r.status === status)), [list.records, status]);
  return (
    <Section
      title={t('Work registrations')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setCreate(true)}>
            <Plus size={13} aria-hidden /> {t('Add registration')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-3 py-2">
            <div className="w-full sm:w-56">
              <Select aria-label={t('Status')} value={status} placeholder={t('Every status')} options={societyOptions('society_registrations.status')} onChange={(e) => setStatus(e.target.value)} />
            </div>
          </div>
          <RegistrationsTable
            regs={rowsShown}
            showSong
            onOpen={onOpen}
            empty={
              <EmptyHint
                icon={FileMusic}
                title={t('No work registrations yet')}
                message={t('Register each song with JASRAC or NexTone (or mark it self-managed) so performance and mechanical income is paid.')}
                action={
                  can.edit ? (
                    <Button size="sm" onClick={() => setCreate(true)}>
                      <Plus size={13} aria-hidden /> {t('Add registration')}
                    </Button>
                  ) : undefined
                }
                compact
              />
            }
          />
        </>
      )}
      {create && <RegistrationDialog reg={null} onClose={() => setCreate(false)} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Society contracts                                                   */
/* ------------------------------------------------------------------ */

export function ContractDialog({ contract, readOnly = false, onClose }: { contract: SocietyContractRec | null; readOnly?: boolean | undefined; onClose: () => void }): React.JSX.Element {
  const [society, setSociety] = useState<string>(contract?.society || 'jasrac');
  const [model, setModel] = useState<string>(contract?.model || (contract?.society === 'nextone' ? 'per_work' : 'trust_all'));
  const [memberNo, setMemberNo] = useState(contract?.member_no ?? '');
  const [entity, setEntity] = useState(contract?.our_entity ?? '');
  const [start, setStart] = useState(d10(contract?.term_start));
  const [end, setEnd] = useState(d10(contract?.term_end));
  const [renewal, setRenewal] = useState(contract !== null && contract.renewal_years > 0 ? String(contract.renewal_years) : '');
  const [auto, setAuto] = useState(contract?.auto_renew ?? true);
  const [notes, setNotes] = useState(contract?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    const data: Record<string, unknown> = {
      society,
      model,
      member_no: memberNo.trim(),
      our_entity: entity.trim(),
      term_start: toPb(start),
      term_end: toPb(end),
      renewal_years: renewal.trim() === '' ? 0 : Number(renewal),
      auto_renew: auto,
      notes,
    };
    try {
      if (contract === null) await createRecord('society_contracts', data);
      else await updateRecord('society_contracts', contract.id, data);
      toast.success(contract === null ? t('Contract added') : t('Saved'));
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
      title={contract === null ? t('New society contract') : t('Society contract')}
      description={t('Our membership contract with a collecting society. The term end and the notice date for non-renewal become deadlines.')}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          {contract !== null && <FooterDelete collection="society_contracts" id={contract.id} onDeleted={onClose} />}
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
          <Field label={t('Society')} required>
            <Select
              value={society}
              options={societyOptions('society_contracts.society')}
              onChange={(e) => {
                const v = e.target.value;
                setSociety(v);
                if (v === 'jasrac') setModel('trust_all');
                if (v === 'nextone') setModel('per_work');
              }}
            />
          </Field>
          <Field label={t('Model|society')} help={t('JASRAC holds all of a member\'s works on trust; NexTone takes works one by one.')}>
            <Select value={model} options={societyOptions('society_contracts.model')} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field label={t('Member number')}>
            <Input value={memberNo} onChange={(e) => setMemberNo(e.target.value)} className="font-mono" />
          </Field>
          <Field label={t('Our contracting entity')}>
            <Input value={entity} onChange={(e) => setEntity(e.target.value)} />
          </Field>
          <Field label={t('Term start')}>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('Term end')}>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={t('Renews for (years)')}>
            <Input type="number" min={0} value={renewal} onChange={(e) => setRenewal(e.target.value)} />
          </Field>
        </div>
        <CheckRow checked={auto} onChange={setAuto} label={t('Renews automatically')} help={t('Unless written notice is given 3 months before the term ends. That notice date becomes a deadline.')} />
        <Field label={t('Notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
}

export function ContractsSection({ onOpen }: { onOpen: (c: SocietyContractRec) => void }): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<SocietyContractRec>('society_contracts', { sort: 'society' });
  const dead = useOpenDeadlinesBy('society_contract');
  const dl = useDeadlineActions();
  const [create, setCreate] = useState(false);
  return (
    <Section
      title={t('Society contracts')}
      meta={list.records.length ? String(list.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setCreate(true)}>
            <Plus size={13} aria-hidden /> {t('Add contract')}
          </Button>
        ) : undefined
      }
    >
      {list.loading ? (
        <Loading />
      ) : list.records.length === 0 ? (
        <EmptyHint
          icon={Building2}
          title={t('No society contracts yet')}
          message={t('Add our contract with JASRAC or NexTone: member number, term and renewal. The renewal and notice dates are then tracked.')}
          action={
            can.edit ? (
              <Button size="sm" onClick={() => setCreate(true)}>
                <Plus size={13} aria-hidden /> {t('Add contract')}
              </Button>
            ) : undefined
          }
          compact
        />
      ) : (
        list.records.map((c) => {
          const ds = dead.byId.get(c.id) ?? [];
          return (
            <ListRow
              key={c.id}
              onClick={() => onOpen(c)}
              leading={<Tag>{enumLabel('society_contracts.society', c.society)}</Tag>}
              primary={
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span>{enumLabel('society_contracts.model', c.model) || enumLabel('society_contracts.society', c.society)}</span>
                  {c.member_no !== '' && <Ref>{c.member_no}</Ref>}
                </span>
              }
              secondary={[
                c.our_entity,
                d10(c.term_start) !== '' || d10(c.term_end) !== '' ? t('Term {from} to {to}', { from: fmtDate(c.term_start) || '-', to: fmtDate(c.term_end) || '-' }) : '',
                c.auto_renew ? t('Renews automatically') : '',
                c.renewal_years > 0 ? t('{n}-year renewals', { n: c.renewal_years }) : '',
              ]
                .filter((x) => x !== '')
                .join(' · ')}
              trailing={
                ds.length > 0 ? (
                  <div className="hidden max-w-[18rem] flex-col items-end gap-0.5 sm:flex">
                    {ds.slice(0, 2).map((d) => (
                      <DeadlineChip key={d.id} d={d} onWhy={dl.actions.onWhy} />
                    ))}
                  </div>
                ) : undefined
              }
              hoverActions={
                can.edit ? (
                  <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit')} onClick={() => onOpen(c)}>
                    <Pencil size={13} aria-hidden />
                  </Button>
                ) : undefined
              }
            />
          );
        })
      )}
      {list.records.some((c) => (dead.byId.get(c.id) ?? []).length > 0) && (
        <div className="flex flex-col gap-1 border-t border-[var(--agent-app-border)] px-4 py-2 sm:hidden">
          {list.records.flatMap((c) => (dead.byId.get(c.id) ?? []).slice(0, 2)).map((d) => (
            <DeadlineChip key={d.id} d={d} onWhy={dl.actions.onWhy} />
          ))}
        </div>
      )}
      {create && <ContractDialog contract={null} onClose={() => setCreate(false)} />}
      {dl.dialogs}
    </Section>
  );
}
