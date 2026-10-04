/**
 * Platform rights-owner programs (Amazon Brand Registry, Mercari, Alibaba
 * IPP, AliExpress, eBay VeRO, Rakuten, Yahoo! Auctions...) with document
 * validity and takedown statistics, and customs recordations (輸入差止申立)
 * with their validity dates. Deadlines for both come from the server.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Ship, Store } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtPct, relLabel, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t, tf } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { CustomsRecordationRec, DeadlineRec, MatterRec, PlatformEnrollmentRec } from '../lib/records.ts';
import type { CollectionState } from '../../kit/index.ts';
import { FooterDelete } from './deleteRecord.tsx';
import { RecordPicker } from './pickers.tsx';
import { EmptyHint, EnumPill, ErrorBox, JurChip, Loading, Notice, Ref, Section, TONE_TEXT } from './ui.tsx';
import { DateField, opts, validityTone } from './protectShared.tsx';

function NextDue({ d }: { d: DeadlineRec | undefined }): React.JSX.Element {
  if (d === undefined) return <span className="text-[var(--agent-app-muted)]">-</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[12.5px]" title={tf(d, 'title')}>
        {tf(d, 'title')}
      </span>
      <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">
        {fmtDate(d.due_date)} ({relLabel(d.due_date)})
      </span>
    </span>
  );
}

function ValidUntil({ v }: { v: string }): React.JSX.Element {
  const d = d10(v);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
  const tone = validityTone(d);
  return (
    <span className={cn('whitespace-nowrap tabular-nums', tone !== 'neutral' && TONE_TEXT[tone])}>
      {fmtDate(d)}
      {tone !== 'neutral' && <span className="ml-1 text-xs">({relLabel(d)})</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

export function PlatformsPanel({ list, deadlines, openId }: { list: CollectionState<PlatformEnrollmentRec>; deadlines: DeadlineRec[]; openId: string }): React.JSX.Element {
  const { can } = useApp();
  const [editing, setEditing] = useState<PlatformEnrollmentRec | 'new' | null>(null);
  const nextOf = useMemo(() => {
    const m = new Map<string, DeadlineRec>();
    for (const d of deadlines) if (d.enrollment !== '' && !m.has(d.enrollment)) m.set(d.enrollment, d);
    return m;
  }, [deadlines]);

  // A deep link opens the record once (later live updates do not reopen it).
  const opened = useRef('');
  useEffect(() => {
    if (openId === '' || opened.current === openId) return;
    const r = list.records.find((x) => x.id === openId);
    if (r !== undefined) {
      opened.current = openId;
      setEditing(r);
    }
  }, [openId, list.records]);

  return (
    <div className="flex flex-col gap-3">
      <Notice icon={Store}>{t('Marketplaces remove listings faster for enrolled rights owners. Keep the documents fresh: Mercari, for example, wants a company registry extract issued within the last 3 months.')}</Notice>
      <Section
        title={t('Platform programs')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        flush
        actions={
          can.edit ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> {t('Add a platform')}
            </Button>
          ) : undefined
        }
      >
        {list.loading && list.records.length === 0 ? (
          <Loading />
        ) : list.error !== null ? (
          <div className="p-4">
            <ErrorBox message={list.error} onRetry={list.refresh} />
          </div>
        ) : list.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Store}
            title={t('No platform programs yet')}
            message={t('Record each rights-owner program you are enrolled in (Amazon Brand Registry, Mercari, Alibaba IPP, eBay VeRO...) with when its documents expire.')}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  {t('Add a platform')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-3 py-2">{t('Platform')}</th>
                  <th className="px-3 py-2">{t('Status')}</th>
                  <th className="px-3 py-2">{t('Enrolled')}</th>
                  <th className="px-3 py-2">{t('Documents valid until')}</th>
                  <th className="px-3 py-2 text-right">{t('Requests sent')}</th>
                  <th className="px-3 py-2 text-right">{t('Success rate')}</th>
                  <th className="px-3 py-2 text-right">{t('Counter-notice rate')}</th>
                  <th className="px-3 py-2">{t('Next deadline')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{enumLabel('platform_enrollments.platform', r.platform)}</div>
                      {r.account_id !== '' && <div className="font-mono text-xs text-[var(--agent-app-muted)]">{r.account_id}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <EnumPill field="platform_enrollments.status" value={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.enrolled_date) || '-'}</td>
                    <td className="px-3 py-2">
                      <ValidUntil v={r.documents_valid_until} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.requests_sent || 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.success_rate > 0 ? fmtPct(r.success_rate) : '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.counter_notice_rate > 0 ? fmtPct(r.counter_notice_rate) : '-'}</td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <NextDue d={nextOf.get(r.id)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {can.edit && (
                        <button type="button" className="inline-flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" aria-label={t('Edit')} onClick={() => setEditing(r)}>
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing !== null && <EnrollmentDialog record={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EnrollmentDialog({ record, onClose }: { record: PlatformEnrollmentRec | null; onClose: () => void }): React.JSX.Element {
  const [f, setF] = useState({
    platform: record?.platform ?? 'amazon_brand_registry',
    account_id: record?.account_id ?? '',
    status: (record?.status || 'applying') as PlatformEnrollmentRec['status'],
    enrolled_date: d10(record?.enrolled_date ?? ''),
    documents_valid_until: d10(record?.documents_valid_until ?? ''),
    requests_sent: String(record?.requests_sent ?? 0),
    success_rate: String(record?.success_rate ?? 0),
    counter_notice_rate: String(record?.counter_notice_rate ?? 0),
    notes: record?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const save = async (): Promise<void> => {
    setBusy(true);
    const data = {
      platform: f.platform,
      account_id: f.account_id.trim(),
      status: f.status,
      enrolled_date: toPb(f.enrolled_date),
      documents_valid_until: toPb(f.documents_valid_until),
      requests_sent: num(f.requests_sent),
      success_rate: num(f.success_rate),
      counter_notice_rate: num(f.counter_notice_rate),
      notes: f.notes.trim(),
    };
    try {
      if (record === null) await createRecord('platform_enrollments', data);
      else await updateRecord('platform_enrollments', record.id, data);
      toast.success(t('Saved'));
      onClose();
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={record === null ? t('Add a platform') : enumLabel('platform_enrollments.platform', record.platform)}
      className="w-[min(94vw,38rem)]"
      footer={
        <>
          {record !== null && <FooterDelete collection="platform_enrollments" id={record.id} onDeleted={onClose} />}
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Platform')} value={f.platform} options={opts(enumOptions('platform_enrollments.platform'))} onChange={(e) => set('platform', e.target.value as PlatformEnrollmentRec['platform'])} />
          <Input label={t('Account or brand ID')} value={f.account_id} onChange={(e) => set('account_id', e.target.value)} />
          <Select label={t('Status')} value={f.status} options={opts(enumOptions('platform_enrollments.status'))} onChange={(e) => set('status', e.target.value as PlatformEnrollmentRec['status'])} />
          <DateField label={t('Enrolled')} value={f.enrolled_date} onChange={(v) => set('enrolled_date', v)} />
          <DateField label={t('Documents valid until')} value={f.documents_valid_until} onChange={(v) => set('documents_valid_until', v)} help={t('A reminder to refresh the documents is created from this date.')} />
          <Input label={t('Requests sent')} type="number" min={0} value={f.requests_sent} onChange={(e) => set('requests_sent', e.target.value)} />
          <Input label={t('Success rate (%)')} type="number" min={0} max={100} value={f.success_rate} onChange={(e) => set('success_rate', e.target.value)} />
          <Input label={t('Counter-notice rate (%)')} type="number" min={0} max={100} value={f.counter_notice_rate} onChange={(e) => set('counter_notice_rate', e.target.value)} />
        </div>
        <Textarea label={t('Notes')} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Customs                                                             */
/* ------------------------------------------------------------------ */

export function CustomsPanel({ list, deadlines, openId }: { list: CollectionState<CustomsRecordationRec>; deadlines: DeadlineRec[]; openId: string }): React.JSX.Element {
  const { can } = useApp();
  const [editing, setEditing] = useState<CustomsRecordationRec | 'new' | null>(null);
  const nextOf = useMemo(() => {
    const m = new Map<string, DeadlineRec>();
    for (const d of deadlines) if (d.recordation !== '' && !m.has(d.recordation)) m.set(d.recordation, d);
    return m;
  }, [deadlines]);

  // A deep link opens the record once (later live updates do not reopen it).
  const opened = useRef('');
  useEffect(() => {
    if (openId === '' || opened.current === openId) return;
    const r = list.records.find((x) => x.id === openId);
    if (r !== undefined) {
      opened.current = openId;
      setEditing(r);
    }
  }, [openId, list.records]);

  return (
    <div className="flex flex-col gap-3">
      <Notice icon={Ship}>{t('A Japanese customs recordation (輸入差止申立) lasts up to 4 years and can be renewed from 3 months before it ends. Keep each one linked to the mark it relies on.')}</Notice>
      <Section
        title={t('Customs recordations')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        flush
        actions={
          can.edit ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> {t('Add a recordation')}
            </Button>
          ) : undefined
        }
      >
        {list.loading && list.records.length === 0 ? (
          <Loading />
        ) : list.error !== null ? (
          <div className="p-4">
            <ErrorBox message={list.error} onRetry={list.refresh} />
          </div>
        ) : list.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Ship}
            title={t('No customs recordations yet')}
            message={t('Record the marks you have recorded with customs so counterfeit imports can be stopped, with the dates they are valid.')}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  {t('Add a recordation')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          list.records.map((r) => {
            const m = r.expand?.['matter'] as MatterRec | undefined;
            return (
              <div key={r.id} className="grid gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <JurChip code={r.jurisdiction === 'other' ? '' : r.jurisdiction} />
                    <span className="text-[13px] font-medium">{r.jurisdiction === 'other' ? enumLabel('customs_recordations.jurisdiction', 'other') : jurisdictionName(r.jurisdiction)}</span>
                    <EnumPill field="customs_recordations.status" value={r.status} />
                  </div>
                  {r.right_desc !== '' && <div className="mt-0.5 break-words text-[13px]">{r.right_desc}</div>}
                  {m !== undefined && (
                    <a href={href('matter', m.id)} className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs hover:underline">
                      <Ref>{m.ref}</Ref> <span className="truncate text-[var(--agent-app-muted)]">{m.title}</span>
                    </a>
                  )}
                </div>
                <div className="text-xs tabular-nums">
                  {r.application_no !== '' && <div className="font-mono">{r.application_no}</div>}
                  <div className="text-[var(--agent-app-muted)]">
                    {t('Filed|customs')}: {fmtDate(r.filed_date) || '-'}
                  </div>
                  <div className="text-[var(--agent-app-muted)]">
                    {t('Accepted|customs')}: {fmtDate(r.accepted_date) || '-'}
                  </div>
                </div>
                <div className="min-w-0 text-[13px]">
                  <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Valid until')}</div>
                  <ValidUntil v={r.valid_until} />
                  <div className="mt-1">
                    <NextDue d={nextOf.get(r.id)} />
                  </div>
                </div>
                <div className="flex justify-end">
                  {can.edit && (
                    <button type="button" className="inline-flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" aria-label={t('Edit')} onClick={() => setEditing(r)}>
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Section>
      {editing !== null && <RecordationDialog record={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecordationDialog({ record, onClose }: { record: CustomsRecordationRec | null; onClose: () => void }): React.JSX.Element {
  const [f, setF] = useState({
    jurisdiction: (record?.jurisdiction || 'JP') as CustomsRecordationRec['jurisdiction'],
    matter: record?.matter ?? '',
    right_desc: record?.right_desc ?? '',
    application_no: record?.application_no ?? '',
    filed_date: d10(record?.filed_date ?? ''),
    accepted_date: d10(record?.accepted_date ?? ''),
    valid_until: d10(record?.valid_until ?? ''),
    status: (record?.status || 'preparing') as CustomsRecordationRec['status'],
    notes: record?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]): void => setF((x) => ({ ...x, [k]: v }));

  const save = async (): Promise<void> => {
    setBusy(true);
    const data = {
      ...f,
      right_desc: f.right_desc.trim(),
      application_no: f.application_no.trim(),
      filed_date: toPb(f.filed_date),
      accepted_date: toPb(f.accepted_date),
      valid_until: toPb(f.valid_until),
      notes: f.notes.trim(),
    };
    try {
      if (record === null) await createRecord('customs_recordations', data);
      else await updateRecord('customs_recordations', record.id, data);
      toast.success(t('Saved'));
      onClose();
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={record === null ? t('Add a recordation') : t('Customs recordation')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          {record !== null && <FooterDelete collection="customs_recordations" id={record.id} onDeleted={onClose} />}
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('Customs office')}
            value={f.jurisdiction}
            options={enumOptions('customs_recordations.jurisdiction').map(([value, label]) => ({ value, label: value === 'other' ? label : `${value} · ${jurisdictionName(value)}` }))}
            onChange={(e) => set('jurisdiction', e.target.value as CustomsRecordationRec['jurisdiction'])}
          />
          <Select label={t('Status')} value={f.status} options={opts(enumOptions('customs_recordations.status'))} onChange={(e) => set('status', e.target.value as CustomsRecordationRec['status'])} />
        </div>
        <RecordPicker<MatterRec>
          collection="matters"
          label={t('Linked mark')}
          value={f.matter}
          onChange={(id) => set('matter', id)}
          labelOf={(m) => `${m.ref} ${m.jurisdiction} ${m.title}`}
          searchFields={['ref', 'title', 'application_no', 'registration_no']}
          filter='ip_type = "trademark"'
        />
        <Input label={t('Right recorded')} value={f.right_desc} onChange={(e) => set('right_desc', e.target.value)} placeholder={t('For example: trademark registration and the goods it covers')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Application number')} value={f.application_no} className="font-mono" onChange={(e) => set('application_no', e.target.value)} />
          <DateField label={t('Filed|customs')} value={f.filed_date} onChange={(v) => set('filed_date', v)} />
          <DateField label={t('Accepted|customs')} value={f.accepted_date} onChange={(v) => set('accepted_date', v)} />
          <DateField label={t('Valid until')} value={f.valid_until} onChange={(v) => set('valid_until', v)} help={t('Japan: up to 4 years from acceptance; renew from 3 months before.')} />
        </div>
        <Textarea label={t('Notes')} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}
