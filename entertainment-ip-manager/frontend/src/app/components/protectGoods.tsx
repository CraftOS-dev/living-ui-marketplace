/**
 * Goods and services of a trademark (Nice classes with their
 * specifications): the editor used when a mark is created, and the panel on
 * the trademark's page to add, correct or remove classes.
 */
import { useState } from 'react';
import { ListPlus, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { Button, Dialog, Select, Switch, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import type { Tone } from '../lib/labels.ts';
import type { GoodsServiceRec, MatterRec } from '../lib/records.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { EmptyHint, ErrorBox, Loading, Pill, Section } from './ui.tsx';
import { DEBUT_CLASSES, DateField, NICE_CLASSES, classLabel, niceHeading, opts } from './protectShared.tsx';

export interface ClassSpec {
  nice_class: number;
  spec: string;
}

const CLASS_TONE: Record<string, Tone> = { pending: 'info', registered: 'good', refused: 'bad', partially_refused: 'warn', deleted: 'neutral', cancelled: 'neutral' };

export function ClassStatusPill({ status }: { status: string }): React.JSX.Element | null {
  if (status === '') return null;
  return <Pill tone={CLASS_TONE[status] ?? 'neutral'}>{enumLabel('goods_services.class_status', status)}</Pill>;
}

/** Rows of class + specification, for the new mark form. */
export function ClassSpecEditor({ value, onChange }: { value: ClassSpec[]; onChange: (v: ClassSpec[]) => void }): React.JSX.Element {
  const [pick, setPick] = useState('');
  const used = new Set(value.map((r) => r.nice_class));
  const add = (n: number): void => {
    if (used.has(n)) return;
    onChange([...value, { nice_class: n, spec: '' }].sort((a, b) => a.nice_class - b.nice_class));
  };
  const addDebut = (): void => {
    const next = [...value];
    for (const n of DEBUT_CLASSES) if (!used.has(n)) next.push({ nice_class: n, spec: '' });
    onChange(next.sort((a, b) => a.nice_class - b.nice_class));
  };
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="border border-[var(--agent-app-border)]">
          {value.map((r, i) => (
            <div key={r.nice_class} className="flex items-start gap-2 border-b border-[var(--agent-app-border)]/70 px-2 py-2 last:border-0">
              <div className="w-20 shrink-0 pt-1.5">
                <div className="font-mono text-[13px] font-semibold tabular-nums">{classLabel(r.nice_class)}</div>
                <div className="text-[10.5px] leading-tight text-[var(--agent-app-muted)]">{niceHeading(r.nice_class)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <Textarea
                  rows={2}
                  className="min-h-[56px] text-[13px]"
                  value={r.spec}
                  aria-label={t('Specification for {cls}', { cls: classLabel(r.nice_class) })}
                  placeholder={t('Goods or services, as filed (optional)')}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, spec: e.target.value } : x)))}
                />
              </div>
              <button
                type="button"
                className="mt-1.5 flex size-7 shrink-0 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
                aria-label={t('Remove {cls}', { cls: classLabel(r.nice_class) })}
                onClick={() => onChange(value.filter((_x, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-64">
          <Select
            aria-label={t('Add a class')}
            value={pick}
            placeholder={t('Add a class')}
            options={NICE_CLASSES.filter((n) => !used.has(n)).map((n) => ({ value: String(n), label: `${n} · ${niceHeading(n)}` }))}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n > 0) add(n);
              setPick('');
            }}
          />
        </div>
        <Button size="sm" variant="outline" onClick={addDebut} title={DEBUT_CLASSES.join(', ')}>
          <Sparkles size={13} aria-hidden /> {t('Add the usual debut classes')}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
        {t('A VTuber debut set often covers classes {list}: goods, events and streaming.', { list: DEBUT_CLASSES.join(', ') })}
      </p>
    </div>
  );
}

/** Classes on a trademark's page. */
export function GoodsPanel({ matter }: { matter: MatterRec }): React.JSX.Element {
  const { can } = useApp();
  const goods = useCollection<GoodsServiceRec>('goods_services', { filter: `matter = ${q(matter.id)}`, sort: 'nice_class' });
  const [editing, setEditing] = useState<GoodsServiceRec | 'new' | null>(null);

  return (
    <Section
      title={t('Goods and services')}
      meta={goods.records.length > 0 ? String(goods.records.length) : undefined}
      flush
      actions={
        can.edit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <ListPlus size={13} aria-hidden /> {t('Add a class')}
          </Button>
        ) : undefined
      }
    >
      {goods.loading && goods.records.length === 0 ? (
        <Loading />
      ) : goods.error !== null ? (
        <div className="p-4">
          <ErrorBox message={goods.error} onRetry={goods.refresh} />
        </div>
      ) : goods.records.length === 0 ? (
        <EmptyHint
          compact
          icon={ListPlus}
          title={t('No classes yet')}
          message={t('Add each Nice class with the goods or services as filed. Coverage, renewals and watch results use them.')}
          action={
            can.edit ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus size={13} aria-hidden /> {t('Add a class')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        goods.records.map((g) => (
          <div key={g.id} className="flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0 sm:flex-row sm:items-start sm:gap-4">
            <div className="w-full shrink-0 sm:w-44">
              <div className="font-mono text-sm font-semibold tabular-nums">{classLabel(g.nice_class)}</div>
              <div className="text-xs text-[var(--agent-app-muted)]">{niceHeading(g.nice_class)}</div>
            </div>
            <div className="min-w-0 flex-1">
              {g.spec !== '' ? (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{g.spec}</p>
              ) : (
                <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No specification recorded.')}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--agent-app-muted)]">
                {g.in_use && <span>{t('In use')}</span>}
                {d10(g.first_use) !== '' && <span>{t('First use {date}', { date: fmtDate(g.first_use) })}</span>}
                {g.evidence_note !== '' && <span className="break-words">{g.evidence_note}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ClassStatusPill status={g.class_status} />
              {can.edit && (
                <button type="button" className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" aria-label={t('Edit {cls}', { cls: classLabel(g.nice_class) })} onClick={() => setEditing(g)}>
                  <Pencil size={13} />
                </button>
              )}
              <DeleteButton collection="goods_services" id={g.id} iconOnly label={t('Remove {cls}', { cls: classLabel(g.nice_class) })} />
            </div>
          </div>
        ))
      )}
      {editing !== null && <GoodsDialog matter={matter} record={editing === 'new' ? null : editing} taken={goods.records.map((g) => g.nice_class)} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function GoodsDialog({ matter, record, taken, onClose }: { matter: MatterRec; record: GoodsServiceRec | null; taken: number[]; onClose: () => void }): React.JSX.Element {
  const [cls, setCls] = useState(record !== null ? String(record.nice_class) : '');
  const [spec, setSpec] = useState(record?.spec ?? '');
  const [status, setStatus] = useState<string>(record?.class_status || (matter.status_group === 'live' ? 'registered' : 'pending'));
  const [inUse, setInUse] = useState(record?.in_use ?? false);
  const [firstUse, setFirstUse] = useState(d10(record?.first_use ?? ''));
  const [note, setNote] = useState(record?.evidence_note ?? '');
  const [busy, setBusy] = useState(false);
  const n = Number(cls);
  const valid = Number.isInteger(n) && n >= 1 && n <= 45;
  const dup = valid && taken.includes(n) && record?.nice_class !== n;

  const save = async (): Promise<void> => {
    if (!valid || dup) return;
    setBusy(true);
    const data = { nice_class: n, spec: spec.trim(), class_status: status, in_use: inUse, first_use: toPb(firstUse), evidence_note: note.trim() };
    try {
      if (record === null) await createRecord<GoodsServiceRec>('goods_services', { matter: matter.id, ...data });
      else await updateRecord<GoodsServiceRec>('goods_services', record.id, data);
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
      title={record === null ? t('Add a class') : t('Edit {cls}', { cls: classLabel(record.nice_class) })}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid || dup}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('Nice class')}
            value={cls}
            placeholder={t('Choose')}
            options={NICE_CLASSES.map((x) => ({ value: String(x), label: `${x} · ${niceHeading(x)}` }))}
            onChange={(e) => setCls(e.target.value)}
            error={dup ? t('This class is already on the mark.') : undefined}
          />
          <Select label={t('Status')} value={status} options={opts(enumOptions('goods_services.class_status'))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Textarea label={t('Goods and services')} rows={5} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={t('Goods or services, as filed (optional)')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end pb-2">
            <Switch checked={inUse} onCheckedChange={setInUse} label={t('In use')} />
          </div>
          <DateField label={t('First use')} value={firstUse} onChange={setFirstUse} />
        </div>
        <Textarea label={t('Use evidence note')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}
