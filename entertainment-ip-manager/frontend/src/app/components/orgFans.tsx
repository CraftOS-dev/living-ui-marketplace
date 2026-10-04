/**
 * Clip channels and fan permits (切り抜き・個人許諾・当日版権): applications
 * from fans and clip channels under a published guideline. Editors record
 * applications and decide them through fan/decide (approve, activate,
 * reject, suspend, revoke; a reason is required except to approve or
 * activate). Permission numbers are issued by the server.
 */
import { useMemo, useState } from 'react';
import { BadgeCheck, ExternalLink, Pencil, Plus, Search } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, errText, op, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney, fmtPct, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, joinList, t } from '../lib/i18n.ts';
import { useHashParam } from '../lib/router.ts';
import type { CharacterRec, FanRegistrationRec, GuidelineRec, TalentRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { CatalogSelect, MultiRecordPicker } from './pickers.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Loading, Notice, Prose, Ref, Toolbar } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { DialogBody, SubHeading, num } from './orgShared.tsx';

type Decision = 'approve' | 'activate' | 'reject' | 'suspend' | 'revoke';

const NEXT: Record<string, Decision[]> = {
  applied: ['approve', 'reject'],
  approved: ['activate', 'suspend', 'revoke'],
  active: ['suspend', 'revoke'],
  suspended: ['activate', 'revoke'],
  rejected: ['approve'],
  expired: ['activate'],
  revoked: [],
};

const PLATFORMS = ['YouTube', 'X', 'TikTok', 'Twitch', 'niconico', 'Instagram', 'Bilibili', 'BOOTH', 'pixiv'];

function decisionLabel(d: Decision): string {
  return { approve: t('Approve'), activate: t('Activate'), reject: t('Reject'), suspend: t('Suspend'), revoke: t('Revoke') }[d];
}

function whereText(f: FanRegistrationRec): string {
  if (f.channel_url !== '') return f.channel_url;
  if (f.event_name !== '') return d10(f.event_date) !== '' ? `${f.event_name} (${fmtDate(f.event_date)})` : f.event_name;
  return '';
}

export function FansTab(): React.JSX.Element {
  const { can, nameOf, homeCurrency } = useApp();
  const regs = useCollection<FanRegistrationRec>('fan_registrations', { sort: '-created' });
  const guidelines = useCollection<GuidelineRec>('guidelines', { filter: 'template = false && status != "draft"', sort: '-effective_date' });
  const [openId, setOpen] = useHashParam('open', '');
  const [kind, setKind] = useHashParam('kind', '');
  const [status, setStatus] = useHashParam('status', '');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FanRegistrationRec | 'new' | null>(null);

  const guidelineName = (id: string): string => {
    const g = guidelines.records.find((x) => x.id === id);
    return g !== undefined ? `${g.title}${g.version !== '' ? ` v${g.version}` : ''}` : '';
  };

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return regs.records.filter((f) => {
      if (kind !== '' && f.kind !== kind) return false;
      if (status !== '' && f.status !== status) return false;
      if (term !== '') {
        const hay = `${f.permission_no} ${f.applicant_name} ${f.contact} ${f.channel_url} ${f.event_name} ${f.platform}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [regs.records, kind, status, query]);

  const subjects = (f: FanRegistrationRec): string => joinList([...f.characters.map((c) => nameOf('character', c)), ...f.talents.map((x) => nameOf('talent', x))].filter((x) => x !== ''));

  const columns: Col<FanRegistrationRec>[] = [
    { key: 'permission_no', label: t('Permission no.'), render: (r) => <Ref>{r.permission_no}</Ref> },
    {
      key: 'applicant_name',
      label: t('Applicant|fan permit'),
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.applicant_name}</div>
          <div className="truncate text-xs text-[var(--agent-app-muted)]">{enumLabel('fan_registrations.applicant_type', r.applicant_type)}</div>
        </div>
      ),
    },
    { key: 'kind', label: t('Kind'), value: (r) => enumLabel('fan_registrations.kind', r.kind) },
    { key: 'where', label: t('Channel or event'), value: (r) => whereText(r), render: (r) => <span className="line-clamp-1 max-w-[16rem] break-all text-xs">{whereText(r)}</span> },
    { key: 'platform', label: t('Platform') },
    { key: 'subjects', label: t('Characters and talents'), sortable: false, value: (r) => subjects(r), render: (r) => <span className="line-clamp-1 text-xs">{subjects(r)}</span> },
    { key: 'status', label: t('Status'), value: (r) => enumLabel('fan_registrations.status', r.status), render: (r) => <EnumPill field="fan_registrations.status" value={r.status} /> },
    { key: 'dates', label: t('Valid'), value: (r) => d10(r.start_date), render: (r) => <span className="whitespace-nowrap text-xs tabular-nums">{[fmtDate(r.start_date), fmtDate(r.end_date)].filter((x) => x !== '').join(' - ')}</span> },
    { key: 'guideline', label: t('Guideline'), optional: true, value: (r) => guidelineName(r.guideline) },
    { key: 'monetized', label: t('Monetized'), optional: true, value: (r) => (r.monetized ? t('Yes') : t('No')) },
    { key: 'monthly_revenue', label: t('Monthly revenue'), align: 'right', optional: true, value: (r) => r.monthly_revenue, render: (r) => (r.monthly_revenue > 0 ? fmtMoney(r.monthly_revenue, homeCurrency) : '') },
    { key: 'royalty_pct', label: t('Royalty'), align: 'right', optional: true, value: (r) => r.royalty_pct, render: (r) => (r.royalty_pct > 0 ? fmtPct(r.royalty_pct) : '') },
    { key: 'seals', label: t('Seals issued / returned'), align: 'right', optional: true, value: (r) => r.seals_issued, render: (r) => (r.seals_issued > 0 ? <span className="tabular-nums">{r.seals_issued} / {r.seals_returned}</span> : '') },
  ];

  const selected = openId !== '' ? (regs.records.find((r) => r.id === openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar className="mb-0">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
          <Input aria-label={t('Search fan permits')} placeholder={t('Search number, applicant, channel')} className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select aria-label={t('Kind')} value={kind} placeholder={t('Every kind')} options={enumOptions('fan_registrations.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-40">
          <Select aria-label={t('Status')} value={status} placeholder={t('Every status')} options={enumOptions('fan_registrations.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        {can.edit && (
          <Button className="sm:ml-auto" onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden /> {t('Record an application')}
          </Button>
        )}
      </Toolbar>

      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
        {regs.loading ? (
          <Loading />
        ) : regs.error !== null ? (
          <div className="p-4">
            <ErrorBox message={regs.error} onRetry={regs.refresh} />
          </div>
        ) : (
          <DataTable<FanRegistrationRec>
            tableId="eipm-fan-registrations"
            exportName="fan-permits"
            rows={rows}
            columns={columns}
            onRowClick={(r) => setOpen(r.id)}
            empty={
              <EmptyHint
                compact
                icon={BadgeCheck}
                title={regs.records.length === 0 ? t('No clip channels or fan permits yet') : t('Nothing matches')}
                message={
                  regs.records.length === 0
                    ? t('Record a clip channel registration, a fan permit (個人許諾) or a one-day event licence (当日版権) when an application arrives. A permission number is issued automatically.')
                    : t('Try another search or clear the filters.')
                }
                action={regs.records.length === 0 && can.edit ? <Button size="sm" onClick={() => setEditing('new')}>{t('Record an application')}</Button> : undefined}
              />
            }
          />
        )}
      </div>

      {selected !== null && <FanDrawer reg={selected} guidelineName={guidelineName} guidelines={guidelines.records} onClose={() => setOpen('')} onEdit={() => setEditing(selected)} />}
      {editing !== null && (
        <FanDialog
          reg={editing === 'new' ? null : editing}
          guidelines={guidelines.records.filter((g) => g.status === 'published')}
          onClose={() => setEditing(null)}
          onCreated={(id) => {
            setEditing(null);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function FanDrawer({
  reg,
  guidelineName,
  guidelines,
  onClose,
  onEdit,
}: {
  reg: FanRegistrationRec;
  guidelineName: (id: string) => string;
  guidelines: GuidelineRec[];
  onClose: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  const { can, nameOf, homeCurrency } = useApp();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const next = NEXT[reg.status] ?? [];
  const f = reg;

  return (
    <Drawer
      open
      onClose={onClose}
      title={f.permission_no !== '' ? `${f.permission_no} · ${f.applicant_name}` : f.applicant_name}
      width={640}
      footer={
        can.edit ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <DeleteButton collection="fan_registrations" id={f.id} onDeleted={onClose} />
            <Button size="sm" variant="ghost" className="mr-auto" onClick={onEdit}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
            {next.map((d) => (
              <Button key={d} size="sm" variant={d === 'approve' || d === 'activate' ? 'primary' : 'outline'} onClick={() => setDeciding(d)}>
                {decisionLabel(d)}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <EnumPill field="fan_registrations.status" value={f.status} />
          <span className="text-[13px]">{enumLabel('fan_registrations.kind', f.kind)}</span>
        </div>
        <FactGrid cols={2}>
          <Fact label={t('Permission no.')} value={f.permission_no} mono />
          <Fact label={t('Applicant|fan permit')} value={`${f.applicant_name}${f.applicant_type !== '' ? ` (${enumLabel('fan_registrations.applicant_type', f.applicant_type)})` : ''}`} />
          <Fact label={t('Contact')} value={f.contact} />
          <Fact label={t('Platform')} value={f.platform} />
          {f.channel_url !== '' && (
            <Fact
              label={t('Channel URL')}
              className="col-span-full"
              value={
                <a href={f.channel_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
                  <span className="min-w-0 truncate">{f.channel_url}</span> <ExternalLink size={11} aria-hidden className="shrink-0" />
                </a>
              }
            />
          )}
          {f.event_name !== '' && <Fact label={t('Event')} value={f.event_name} />}
          {d10(f.event_date) !== '' && <Fact label={t('Event date')} value={fmtDate(f.event_date)} />}
          <Fact label={t('Guideline')} value={guidelineName(f.guideline)} />
          {f.franchise !== '' && <Fact label={t('Franchise')} value={nameOf('franchise', f.franchise)} />}
          <Fact label={t('Characters')} value={joinList(f.characters.map((c) => nameOf('character', c)).filter((x) => x !== ''))} />
          {f.talents.length > 0 && <Fact label={t('Talents')} value={joinList(f.talents.map((x) => nameOf('talent', x)).filter((x) => x !== ''))} />}
          <Fact label={t('Valid from')} value={fmtDate(f.start_date)} />
          <Fact label={t('Valid until')} value={fmtDate(f.end_date)} />
          <Fact label={t('Monetized')} value={f.monetized ? t('Yes') : t('No')} />
          <Fact label={t('Monthly revenue')} value={f.monthly_revenue > 0 ? fmtMoney(f.monthly_revenue, homeCurrency) : ''} />
          <Fact label={t('Royalty')} value={f.royalty_pct > 0 ? fmtPct(f.royalty_pct) : ''} />
          <Fact label={t('Seals issued / returned')} value={f.seals_issued > 0 || f.seals_returned > 0 ? `${f.seals_issued} / ${f.seals_returned}` : ''} />
        </FactGrid>
        {f.notes !== '' && (
          <div>
            <SubHeading>{t('Notes and decisions')}</SubHeading>
            <Prose>{f.notes}</Prose>
          </div>
        )}
        {next.length === 0 && <Notice tone="neutral">{t('This permit is revoked. Record a new application if the applicant applies again.')}</Notice>}
      </div>
      {deciding !== null && <DecideDialog reg={f} decision={deciding} guidelines={guidelines.filter((g) => g.status === 'published')} onClose={() => setDeciding(null)} />}
    </Drawer>
  );
}

function DecideDialog({ reg, decision, guidelines, onClose }: { reg: FanRegistrationRec; decision: Decision; guidelines: GuidelineRec[]; onClose: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [endDate, setEndDate] = useState(d10(reg.end_date));
  const [royalty, setRoyalty] = useState(reg.royalty_pct > 0 ? String(reg.royalty_pct) : '');
  const [seals, setSeals] = useState(reg.seals_issued > 0 ? String(reg.seals_issued) : '');
  const [guideline, setGuideline] = useState(reg.guideline);
  const [busy, setBusy] = useState(false);
  const positive = decision === 'approve' || decision === 'activate';
  const ok = positive || reason.trim() !== '';

  const submit = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body: Record<string, unknown> = { registration_id: reg.id, decision, reason: reason.trim() };
    if (positive) {
      if (endDate !== '') body['end_date'] = endDate;
      if (royalty.trim() !== '') body['royalty_pct'] = num(royalty);
      if (seals.trim() !== '') body['seals_issued'] = Math.round(num(seals));
      if (guideline !== '') body['guideline_id'] = guideline;
    }
    try {
      const r = await op<{ permission_no: string; status: string }>('fan/decide', body);
      toast.success(t('{no} is now {status}', { no: r.permission_no || reg.applicant_name, status: enumLabel('fan_registrations.status', r.status) }));
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={`${decisionLabel(decision)}: ${reg.applicant_name}`}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant={positive ? 'primary' : 'danger'} loading={busy} disabled={!ok} onClick={() => void submit()}>
            {decisionLabel(decision)}
          </Button>
        </>
      }
    >
      <DialogBody>
        {positive && (
          <>
            <Select label={t('Guideline')} value={guideline} placeholder={t('None')} options={guidelines.map((g) => ({ value: g.id, label: `${g.title}${g.version !== '' ? ` v${g.version}` : ''}` }))} onChange={(e) => setGuideline(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label={t('Valid until')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <Input label={t('Royalty %')} type="number" min={0} max={100} step="any" value={royalty} onChange={(e) => setRoyalty(e.target.value)} />
              <Input label={t('Seals issued')} type="number" min={0} value={seals} onChange={(e) => setSeals(e.target.value)} />
            </div>
          </>
        )}
        <Textarea
          label={positive ? t('Note (optional)') : t('Reason')}
          rows={3}
          placeholder={positive ? '' : t('For example: the channel kept full episodes up after a warning')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {!positive && <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('The reason is kept with the permit and in the audit log.')}</p>}
      </DialogBody>
    </Dialog>
  );
}

function FanDialog({ reg, guidelines, onClose, onCreated }: { reg: FanRegistrationRec | null; guidelines: GuidelineRec[]; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const { on, homeCurrency } = useApp();
  const [kind, setKind] = useState<string>(reg?.kind || 'clip_channel');
  const [applicant, setApplicant] = useState(reg?.applicant_name ?? '');
  const [applicantType, setApplicantType] = useState<string>(reg?.applicant_type || 'individual');
  const [contact, setContact] = useState(reg?.contact ?? '');
  const [channel, setChannel] = useState(reg?.channel_url ?? '');
  const [platform, setPlatform] = useState(reg?.platform ?? '');
  const [eventName, setEventName] = useState(reg?.event_name ?? '');
  const [eventDate, setEventDate] = useState(d10(reg?.event_date));
  const [guideline, setGuideline] = useState(reg?.guideline ?? '');
  const [franchise, setFranchise] = useState(reg?.franchise ?? '');
  const [characters, setCharacters] = useState<string[]>(reg?.characters ?? []);
  const [talents, setTalents] = useState<string[]>(reg?.talents ?? []);
  const [monetized, setMonetized] = useState(reg?.monetized ?? false);
  const [revenue, setRevenue] = useState(reg !== null && reg.monthly_revenue > 0 ? String(reg.monthly_revenue) : '');
  const [sealsReturned, setSealsReturned] = useState(reg !== null ? String(reg.seals_returned) : '0');
  const [notes, setNotes] = useState(reg?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const isEvent = kind === 'event_permit';
  const ok = applicant.trim() !== '';

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      kind,
      applicant_name: applicant.trim(),
      applicant_type: applicantType,
      contact: contact.trim(),
      channel_url: channel.trim(),
      platform: platform.trim(),
      event_name: eventName.trim(),
      event_date: eventDate !== '' ? toPb(eventDate) : '',
      guideline,
      franchise,
      characters,
      talents,
      monetized,
      monthly_revenue: num(revenue),
      notes,
    };
    try {
      if (reg === null) {
        const rec = await createRecord<FanRegistrationRec>('fan_registrations', { ...body, status: 'applied' });
        toast.success(t('Application recorded as {no}', { no: rec.permission_no || rec.applicant_name }));
        onCreated(rec.id);
      } else {
        await updateRecord('fan_registrations', reg.id, { ...body, seals_returned: Math.round(num(sealsReturned)) });
        toast.success(t('Saved'));
        onClose();
      }
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={reg === null ? t('Record an application') : t('Edit {name}', { name: reg.applicant_name })}
      description={reg === null ? t('The application starts as Applied. Approve or reject it from its page.') : undefined}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Kind')} value={kind} options={enumOptions('fan_registrations.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
          <Select label={t('Applicant type')} value={applicantType} options={enumOptions('fan_registrations.applicant_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setApplicantType(e.target.value)} />
          <Input label={t('Applicant|fan permit')} placeholder={t('Name or circle name')} value={applicant} onChange={(e) => setApplicant(e.target.value)} />
          <Input label={t('Contact')} placeholder={t('Email or account')} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        {isEvent ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('Event')} placeholder={t('For example: Wonder Festival')} value={eventName} onChange={(e) => setEventName(e.target.value)} />
            <Input label={t('Event date')} type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Input label={t('Channel URL')} placeholder="https://" value={channel} onChange={(e) => setChannel(e.target.value)} />
            <div className="flex flex-col gap-1.5">
              <Input label={t('Platform')} list="eipm-fan-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} />
              <datalist id="eipm-fan-platforms">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          </div>
        )}
        <Select label={t('Guideline')} value={guideline} placeholder={t('None')} options={guidelines.map((g) => ({ value: g.id, label: `${g.title}${g.version !== '' ? ` v${g.version}` : ''}` }))} onChange={(e) => setGuideline(e.target.value)} />
        {guidelines.length === 0 && <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('No guideline is published yet. Publish one on the Guidelines tab so permits can refer to it.')}</p>}
        {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} placeholder={t('None')} value={franchise} onChange={setFranchise} />}
        <MultiRecordPicker<CharacterRec> collection="characters" label={t('Characters')} placeholder={t('Add a character')} value={characters} onChange={setCharacters} labelOf={(c) => c.name} searchFields={['name']} />
        {on('talents') && <MultiRecordPicker<TalentRec> collection="talents" label={t('Talents')} placeholder={t('Add a talent')} value={talents} onChange={setTalents} labelOf={(x) => x.stage_name} searchFields={['stage_name']} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end pb-2">
            <Checkbox checked={monetized} onChange={setMonetized} label={t('Monetized (ads, memberships or sales)')} />
          </div>
          <Input label={t('Monthly revenue ({currency})', { currency: homeCurrency })} type="number" min={0} step="any" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </div>
        {reg !== null && reg.seals_issued > 0 && <Input label={t('Seals returned')} type="number" min={0} value={sealsReturned} onChange={(e) => setSealsReturned(e.target.value)} />}
        <Textarea label={t('Notes')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}

/** Used by the Guidelines page to count open applications. */
export function useOpenFanApplications(): number {
  const regs = useCollection<FanRegistrationRec>('fan_registrations', { filter: `status = ${q('applied')}` });
  return regs.records.length;
}
