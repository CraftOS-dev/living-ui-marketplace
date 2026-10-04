/**
 * Third-party permissions (inbound): what game publishers, music rights
 * holders and platforms allow our talents to stream. The form covers every
 * field; "Re-checked today" records a guideline check (public guidelines
 * change without notice); CraftBot can re-read the guideline and propose
 * the changes in the Inbox; the drawer shows the permission's deadlines.
 */
import { useState } from 'react';
import { Bot, CheckCheck, Copy, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, Dialog, Drawer, Input, Select, Switch, Textarea, cn, toast } from '../../kit/index.ts';
import { useDeleteRecord } from './deleteRecord.tsx';
import { createRecord, opToast, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { addDays, d10, daysUntil, fmtDate, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, joinList, t } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, CharacterRec, DeadlineRec, PartyRec, PermissionRec, TalentRec } from '../lib/records.ts';
import { AgentStatus } from './craftbot.tsx';
import { DeadlineList, useDeadlineActions } from './deadlines.tsx';
import { DocumentsPanel } from './documents.tsx';
import { MultiRecordPicker, PartyPicker, RecordPicker } from './pickers.tsx';
import { EnumPill, Fact, FactGrid, Field, Notice, Pill, Prose, Segmented, Tag } from './ui.tsx';
import { DateField, NumField, copyText, num } from './rightsShared.tsx';

export const MONETIZATION = ['ads', 'super_chat', 'membership', 'sponsored', 'paid_download'] as const;

export function monetizationLabel(m: string): string {
  switch (m) {
    case 'ads':
      return t('Ads');
    case 'super_chat':
    case 'superchat':
      return t('Super Chat');
    case 'membership':
      return t('Memberships');
    case 'sponsored':
    case 'sponsorship':
      return t('Sponsored');
    case 'paid_download':
      return t('Paid downloads');
    default:
      return m;
  }
}

/** Last checked plus recheck_days has passed (or it was never checked). */
export function needsRecheck(p: PermissionRec): boolean {
  if (p.recheck_days <= 0) return false;
  const last = d10(p.last_checked);
  if (last === '') return true;
  return addDays(last, p.recheck_days) <= today();
}

export function nextCheck(p: PermissionRec): string {
  const last = d10(p.last_checked);
  if (p.recheck_days <= 0 || last === '') return '';
  return addDays(last, p.recheck_days);
}

export function endsSoon(p: PermissionRec, days: number): boolean {
  const end = d10(p.end_date);
  if (end === '') return false;
  const n = daysUntil(end);
  return n >= 0 && n <= days;
}

export function counterpartyName(p: PermissionRec): string {
  const c = ((p.expand ?? {}) as Record<string, unknown>)['counterparty'] as PartyRec | undefined;
  return c?.name ?? '';
}

export function usePlatformLabel(): (code: string) => string {
  const { dimLabel } = useApp();
  return (code: string) => dimLabel('platform', code.toUpperCase());
}

export function talentsText(p: PermissionRec, nameOf: (type: 'talent', id: string) => string): string {
  if (p.all_talents) return t('All talents');
  return joinList(p.talents.map((id) => nameOf('talent', id)).filter((x) => x !== ''));
}

const TALENT_SEARCH = ['stage_name'];
const CHARACTER_SEARCH = ['name'];
const AGREEMENT_SEARCH = ['ref', 'title'];
const talentLabel = (r: TalentRec): string => r.stage_name;
const characterLabel = (r: CharacterRec): string => r.name;
const agreementLabel = (r: AgreementRec): string => `${r.ref} ${r.title}`.trim();

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

export function PermissionForm({ permission, onClose, onSaved }: { permission: PermissionRec | null; onClose: () => void; onSaved?: ((p: PermissionRec) => void) | undefined }): React.JSX.Element {
  const { dimValues, on } = useApp();
  const p = permission;
  const platformLabel = usePlatformLabel();
  const platformCodes = dimValues.filter((v) => v.dimension === 'platform' && v.parent_code !== '').map((v) => v.code);
  const [title, setTitle] = useState(p?.title ?? '');
  const [type, setType] = useState<string>(p?.permission_type ?? '');
  const [counterparty, setCounterparty] = useState(p?.counterparty ?? '');
  const [subject, setSubject] = useState(p?.subject_name ?? '');
  const [source, setSource] = useState<string>(p?.source || 'public_guideline');
  const [url, setUrl] = useState(p?.guideline_url ?? '');
  const [revision, setRevision] = useState(d10(p?.guideline_revision));
  const [approvalId, setApprovalId] = useState(p?.approval_id ?? '');
  const [agreement, setAgreement] = useState(p?.agreement ?? '');
  const [allTalents, setAllTalents] = useState(p?.all_talents ?? true);
  const [talents, setTalents] = useState<string[]>(p?.talents ?? []);
  const [characters, setCharacters] = useState<string[]>(p?.characters ?? []);
  const [platforms, setPlatforms] = useState<string[]>((p?.platforms ?? []).map((x) => String(x).toUpperCase()));
  const [money, setMoney] = useState<string[]>(p?.monetization ?? []);
  const [archive, setArchive] = useState<string>(p?.archive || 'yes');
  const [limits, setLimits] = useState(p?.content_limits ?? '');
  const [credit, setCredit] = useState(p?.credit_line ?? '');
  const [regions, setRegions] = useState(p?.regions ?? '');
  const [start, setStart] = useState(d10(p?.start_date));
  const [end, setEnd] = useState(d10(p?.end_date));
  const [status, setStatus] = useState<string>(p?.status || 'active');
  const [recheck, setRecheck] = useState<number | null>(p === null ? 90 : p.recheck_days > 0 ? p.recheck_days : null);
  const [lastChecked, setLastChecked] = useState(p === null ? today() : d10(p.last_checked));
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async (): Promise<void> => {
    const e: Record<string, string> = {};
    if (title.trim() === '') e['title'] = t('Give the permission a title.');
    if (type === '') e['type'] = t('Choose the type.');
    if (start !== '' && end !== '' && end < start) e['end'] = t('The end must be after the start.');
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      permission_type: type,
      counterparty,
      subject_name: subject.trim(),
      source,
      guideline_url: url.trim(),
      guideline_revision: toPb(revision),
      approval_id: approvalId.trim(),
      agreement,
      all_talents: allTalents,
      talents: allTalents ? [] : talents,
      characters,
      platforms,
      monetization: money,
      archive,
      content_limits: limits.trim(),
      credit_line: credit.trim(),
      regions: regions.trim(),
      start_date: toPb(start),
      end_date: toPb(end),
      status,
      recheck_days: num(recheck),
      // After creation the date moves only through "Re-checked today" (it also closes the re-check reminder).
      ...(p === null ? { last_checked: toPb(lastChecked) } : {}),
      notes: notes.trim(),
    };
    try {
      const saved = p === null ? await createRecord<PermissionRec>('permissions', payload) : await updateRecord<PermissionRec>('permissions', p.id, payload);
      toast.success(p === null ? t('Permission added') : t('Permission saved'));
      onSaved?.(saved);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const chip = (on2: boolean): string =>
    cn('border px-2 py-1 text-xs', on2 ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={p === null ? t('Add a permission') : t('Edit permission')}
      description={t('What the rights holder allows our talents to do: where, how they may earn from it, the archive, the limits and the credit to show.')}
      className="w-[min(94vw,46rem)]"
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
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Title|field')} value={title} error={errors['title']} onChange={(e) => setTitle(e.target.value)} placeholder={t('For example: Publisher streaming guideline for its RPG series')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Type')} value={type} error={errors['type']} placeholder={t('Choose')} options={enumOptions('permissions.permission_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
          <Select label={t('Source|permission')} value={source} options={enumOptions('permissions.source').map(([value, label]) => ({ value, label }))} onChange={(e) => setSource(e.target.value)} />
          <Select label={t('Status')} value={status} options={enumOptions('permissions.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PartyPicker label={t('Rights holder')} value={counterparty} onChange={(id) => setCounterparty(id)} />
          <Input label={t('Game, song or subject')} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('Use * for every work of the rights holder')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input label={t('Guideline URL')} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </div>
          <DateField label={t('Guideline revision')} value={revision} onChange={setRevision} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Application or approval number')} value={approvalId} onChange={(e) => setApprovalId(e.target.value)} />
          <RecordPicker<AgreementRec> collection="agreements" label={t('Agreement')} value={agreement} onChange={(id) => setAgreement(id)} labelOf={agreementLabel} searchFields={AGREEMENT_SEARCH} />
        </div>

        <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-3">
          <span className="text-[13px] font-medium">{t('Who it covers')}</span>
          <Switch checked={allTalents} onCheckedChange={setAllTalents} label={t('Every talent of ours')} />
          {!allTalents && (on('talents') || talents.length > 0) && (
            <MultiRecordPicker<TalentRec> collection="talents" label={t('Talents')} value={talents} onChange={setTalents} labelOf={talentLabel} searchFields={TALENT_SEARCH} />
          )}
          {(on('franchises') || characters.length > 0) && (
            <MultiRecordPicker<CharacterRec> collection="characters" label={t('Characters (optional)')} value={characters} onChange={setCharacters} labelOf={characterLabel} searchFields={CHARACTER_SEARCH} />
          )}
        </div>

        <Field label={t('Platforms')} help={t('Nothing selected means every platform.')}>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...platformCodes, ...platforms])].map((c) => (
              <button key={c} type="button" aria-pressed={platforms.includes(c)} className={chip(platforms.includes(c))} onClick={() => setPlatforms(toggle(platforms, c))}>
                {platformLabel(c)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('Monetization allowed')} help={t('Nothing selected means the guideline allows no monetization.')}>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...MONETIZATION, ...money])].map((m) => (
              <button key={m} type="button" aria-pressed={money.includes(m)} className={chip(money.includes(m))} onClick={() => setMoney(toggle(money, m))}>
                {monetizationLabel(m)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('Archive')}>
          <Segmented<string> value={archive} onChange={setArchive} ariaLabel={t('Archive')} options={enumOptions('permissions.archive').map(([value, label]) => ({ value, label }))} />
        </Field>
        <Textarea label={t('Content limits')} rows={3} value={limits} onChange={(e) => setLimits(e.target.value)} placeholder={t('For example: no streaming past chapter 5 before release; no spoilers of the ending')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Credit line to show')} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={t('For example: ©Publisher')} />
          <Input label={t('Regions|permission')} value={regions} onChange={(e) => setRegions(e.target.value)} placeholder={t('For example: worldwide except China')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label={t('From')} value={start} onChange={setStart} />
          <DateField label={t('Until|date')} value={end} error={errors['end']} onChange={setEnd} />
          <NumField label={t('Re-check every (days)')} value={recheck} onChange={setRecheck} help={t('Public guidelines change without notice.')} />
          {p === null ? (
            <DateField label={t('Last checked')} value={lastChecked} onChange={setLastChecked} />
          ) : (
            <Field label={t('Last checked')} help={t('Use Re-checked today to record a new check.')}>
              <div className="flex h-9 items-center text-sm tabular-nums">{fmtDate(p.last_checked) || '-'}</div>
            </Field>
          )}
        </div>
        <Textarea label={t('Notes')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Re-checked today                                                    */
/* ------------------------------------------------------------------ */

export function RecheckDialog({ permission: p, onClose }: { permission: PermissionRec; onClose: () => void }): React.JSX.Element {
  const [changed, setChanged] = useState<'no' | 'yes'>('no');
  const [note, setNote] = useState('');
  const [revision, setRevision] = useState(today());
  const [status, setStatus] = useState<string>(p.status || 'active');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (changed === 'yes' && note.trim() === '') {
      toast.error(t('Say what changed in the guideline.'));
      return;
    }
    setBusy(true);
    const r = await opToast<{ id: string; last_checked: string; closed: number; status: string }>('permissions/recheck', {
      permission_id: p.id,
      changed: changed === 'yes',
      note: note.trim(),
      revision: changed === 'yes' ? revision : '',
      status: changed === 'yes' ? status : '',
    });
    setBusy(false);
    if (r === null) return;
    toast.success(changed === 'yes' ? t('Recorded. The managers of the talents it covers are told about the change.') : t('Marked as re-checked today.'));
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Re-checked today')}
      description={p.title}
      className="w-[min(94vw,34rem)]"
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
      <div className="flex flex-col gap-3">
        <Field label={t('Did the guideline change?')}>
          <Segmented<'no' | 'yes'>
            value={changed}
            onChange={setChanged}
            ariaLabel={t('Did the guideline change?')}
            options={[
              { value: 'no', label: t('No change') },
              { value: 'yes', label: t('It changed'), tone: 'warn' },
            ]}
          />
        </Field>
        {changed === 'yes' && (
          <>
            <Textarea label={t('What changed')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: memberships are no longer allowed; archive must be private')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField label={t('Revision date')} value={revision} onChange={setRevision} />
              <Select label={t('Status now')} value={status} options={enumOptions('permissions.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
            </div>
            <p className="text-xs text-[var(--agent-app-muted)]">{t('Update the platforms, monetization and limits with Edit if they changed.')}</p>
          </>
        )}
        {changed === 'no' && <Textarea label={t('Note (optional)')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

function DrawerBlock({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{title}</h3>
      {children}
    </div>
  );
}

export function PermissionDrawer({
  permission: p,
  requestId,
  onAsk,
  onRecheck,
  onEdit,
  onClose,
}: {
  permission: PermissionRec;
  requestId: string | null;
  onAsk: () => void;
  onRecheck: () => void;
  onEdit: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { can, nameOf, on } = useApp();
  const platformLabel = usePlatformLabel();
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `permission = "${p.id}"`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  const del = useDeleteRecord();
  const due = needsRecheck(p);
  const next = nextCheck(p);
  const agreementRec = ((p.expand ?? {}) as Record<string, unknown>)['agreement'] as (RecordModel & { ref?: string; title?: string }) | undefined;

  const remove = (): void => del.ask('permissions', p.id, onClose);

  return (
    <Drawer
      open
      onClose={onClose}
      title={p.title}
      width={600}
      footer={
        can.edit ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {can.manage && (
              <Button variant="ghost" size="sm" className="mr-auto text-red-600" onClick={remove}>
                <Trash2 size={13} aria-hidden /> {t('Delete')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
            <Button size="sm" onClick={onRecheck}>
              <CheckCheck size={13} aria-hidden /> {t('Re-checked today')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {del.element}
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <EnumPill field="permissions.status" value={p.status} />
          <Tag>{enumLabel('permissions.permission_type', p.permission_type)}</Tag>
          {p.source !== '' && <Tag>{enumLabel('permissions.source', p.source)}</Tag>}
          {due && <Pill tone="warn">{t('Needs re-check')}</Pill>}
        </div>

        {due && (
          <Notice tone="warn">
            {d10(p.last_checked) === '' ? t('Never checked. Read the current guideline and record it.') : t('Last checked {date}. Public guidelines change without notice; read it again.', { date: fmtDate(p.last_checked) })}
          </Notice>
        )}

        <div className="flex flex-wrap gap-2">
          {p.guideline_url !== '' && (
            <a href={p.guideline_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 border border-[var(--agent-app-border)] px-3 text-sm hover:bg-[var(--agent-app-border)]/30">
              <ExternalLink size={13} aria-hidden /> {t('Open the guideline')}
            </a>
          )}
          {can.contribute && p.guideline_url !== '' && (
            <Button size="sm" variant="outline" onClick={onAsk} disabled={requestId !== null}>
              <Bot size={13} aria-hidden /> {t('Ask CraftBot to re-read the guideline')}
            </Button>
          )}
        </div>
        {requestId !== null && (
          <div className="flex flex-col gap-1">
            <AgentStatus requestId={requestId} workingText={t('CraftBot is reading the guideline...')} doneText={t('CraftBot filed a proposal in the Inbox.')} />
            <a href={href('inbox')} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
              {t('Open the Inbox')}
            </a>
          </div>
        )}

        <FactGrid cols={2}>
          <Fact label={t('Rights holder')} value={counterpartyName(p)} />
          <Fact label={t('Game, song or subject')} value={p.subject_name} />
          <Fact label={t('Talents')} value={talentsText(p, nameOf)} />
          <Fact label={t('Characters')} value={joinList(p.characters.map((id) => nameOf('character', id)).filter((x) => x !== ''))} />
          <Fact label={t('Period')} value={d10(p.start_date) !== '' || d10(p.end_date) !== '' ? t('{start} to {end}', { start: fmtDate(p.start_date) || '-', end: fmtDate(p.end_date) || t('no end date') }) : ''} />
          <Fact label={t('Regions|permission')} value={p.regions} />
          <Fact label={t('Guideline revision')} value={fmtDate(p.guideline_revision)} />
          <Fact label={t('Application or approval number')} value={p.approval_id} mono />
          <Fact label={t('Last checked')} value={fmtDate(p.last_checked)} />
          <Fact label={t('Next check')} value={next !== '' ? fmtDate(next) : p.recheck_days > 0 ? t('Now|recheck') : ''} />
          {p.agreement !== '' && (
            <Fact
              label={t('Agreement')}
              value={
                <a href={href('agreement', p.agreement)} className="hover:underline">
                  {agreementRec !== undefined ? `${agreementRec.ref ?? ''} ${agreementRec.title ?? ''}`.trim() : t('Open|action')}
                </a>
              }
            />
          )}
        </FactGrid>

        <DrawerBlock title={t('What is allowed')}>
          <div className="flex flex-col gap-2 text-[13px]">
            <div>
              <span className="text-[var(--agent-app-muted)]">{t('Platforms')}: </span>
              {(p.platforms ?? []).length > 0 ? joinList((p.platforms ?? []).map(platformLabel)) : t('Every platform')}
            </div>
            <div>
              <span className="text-[var(--agent-app-muted)]">{t('Monetization allowed')}: </span>
              {(p.monetization ?? []).length > 0 ? joinList((p.monetization ?? []).map(monetizationLabel)) : t('None')}
            </div>
            <div>
              <span className="text-[var(--agent-app-muted)]">{t('Archive')}: </span>
              {enumLabel('permissions.archive', p.archive) || '-'}
            </div>
          </div>
        </DrawerBlock>

        {p.content_limits !== '' && (
          <DrawerBlock title={t('Content limits')}>
            <Prose>{p.content_limits}</Prose>
          </DrawerBlock>
        )}

        {p.credit_line !== '' && (
          <DrawerBlock title={t('Credit line to show')}>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-1.5 text-[13px]">{p.credit_line}</code>
              <Button size="sm" variant="outline" onClick={() => void copyText(p.credit_line)}>
                <Copy size={13} aria-hidden /> {t('Copy')}
              </Button>
            </div>
          </DrawerBlock>
        )}

        {p.notes !== '' && (
          <DrawerBlock title={t('Notes')}>
            <Prose className="text-[var(--agent-app-text)]/85">{p.notes}</Prose>
          </DrawerBlock>
        )}

        <DrawerBlock title={t('Deadlines')}>
          <div className="border border-[var(--agent-app-border)]">
            <DeadlineList
              deadlines={deadlines.records}
              actions={dl.actions}
              canEdit={dl.canEdit}
              showSubject={false}
              bulk={false}
              empty={<p className="px-3 py-2 text-[13px] text-[var(--agent-app-muted)]">{t('No deadlines. The re-check and end date reminders appear here.')}</p>}
            />
          </div>
          {dl.dialogs}
        </DrawerBlock>

        {on('permissions') && <DocumentsPanel relation="permission" relationId={p.id} title={t('Guideline snapshots and documents')} defaultType="guideline_snapshot" />}
      </div>
    </Drawer>
  );
}
