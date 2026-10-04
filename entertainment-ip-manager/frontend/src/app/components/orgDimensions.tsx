/**
 * Settings, Rights dimensions: the vocabularies grants, windows and "Can
 * we?" use (territory, media, language, product category, sales channel,
 * platform), each a tree of values with English and Japanese labels.
 * Product categories map to the Nice classes a trademark needs. Managers
 * add and edit values.
 */
import { useMemo, useState } from 'react';
import { Layers3, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t, tf } from '../lib/i18n.ts';
import type { DimensionRec, DimensionValueRec } from '../lib/records.ts';
import { EmptyHint, Loading, Ref, Section, Segmented } from './ui.tsx';
import { useDeleteRecord } from './deleteRecord.tsx';
import { DialogBody, ReadOnlyNote, num } from './orgShared.tsx';

function parseClasses(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(/[^0-9]+/)) {
    const n = parseInt(part, 10);
    if (n >= 1 && n <= 45) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function DimensionsTab(): React.JSX.Element {
  const { can, dimValues } = useApp();
  const dims = useCollection<DimensionRec>('dimensions', { sort: 'order' });
  const [current, setCurrent] = useState('');
  const [editing, setEditing] = useState<DimensionValueRec | 'new' | null>(null);
  const del = useDeleteRecord();

  const dimKey = current !== '' ? current : (dims.records[0]?.key ?? '');
  const dim = dims.records.find((d) => d.key === dimKey);
  const values = useMemo(() => dimValues.filter((v) => v.dimension === dimKey), [dimValues, dimKey]);

  const tree = useMemo(() => {
    const children = new Map<string, DimensionValueRec[]>();
    const codes = new Set(values.map((v) => v.code));
    for (const v of values) {
      const parent = v.parent_code !== '' && codes.has(v.parent_code) ? v.parent_code : '';
      children.set(parent, [...(children.get(parent) ?? []), v]);
    }
    const out: { v: DimensionValueRec; depth: number }[] = [];
    const walk = (parent: string, depth: number, seen: Set<string>): void => {
      for (const v of (children.get(parent) ?? []).slice().sort((a, b) => a.order - b.order)) {
        if (seen.has(v.code)) continue;
        seen.add(v.code);
        out.push({ v, depth });
        walk(v.code, depth + 1, seen);
      }
    };
    walk('', 0, new Set());
    return out;
  }, [values]);

  const remove = (v: DimensionValueRec): void => {
    const kids = values.filter((x) => x.parent_code === v.code).length;
    del.ask(
      'dimension_values',
      v.id,
      undefined,
      kids > 0
        ? t('Its {n} sub-values move to the top level. Grants that name this code keep it but it shows as a bare code.', { n: kids })
        : t('Grants that name this code keep it but it shows as a bare code.'),
    );
  };

  if (dims.loading) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      {del.element}
      {!can.manage && <ReadOnlyNote>{t('Only administrators and managers can change dimension values.')}</ReadOnlyNote>}
      {dims.records.length === 0 ? (
        <EmptyHint icon={Layers3} title={t('No dimensions')} message={t('The rights dimensions ship with the app. If none appear, the reference data has not loaded.')} />
      ) : (
        <>
          <div className="hidden lg:block">
            <Segmented<string> ariaLabel={t('Dimension')} size="sm" value={dimKey} onChange={setCurrent} options={dims.records.map((d) => ({ value: d.key, label: tf(d, 'label') }))} />
          </div>
          <div className="w-full sm:w-64 lg:hidden">
            <Select aria-label={t('Dimension')} value={dimKey} options={dims.records.map((d) => ({ value: d.key, label: tf(d, 'label') }))} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <Section
            title={dim !== undefined ? tf(dim, 'label') : dimKey}
            meta={String(values.length)}
            flush
            actions={
              can.manage ? (
                <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
                  <Plus size={13} aria-hidden /> {t('Add a value')}
                </Button>
              ) : undefined
            }
          >
            {dim !== undefined && dim.description !== '' && <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">{dim.description}</p>}
            {tree.length === 0 ? (
              <EmptyHint compact icon={Layers3} title={t('No values yet')} message={t('Add the first value of this dimension.')} />
            ) : (
              <div>
                {tree.map(({ v, depth }) => (
                  <div key={v.id} className="group flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 py-1.5 pr-4 last:border-0" style={{ paddingLeft: `${16 + Math.min(depth, 4) * 18}px` }}>
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="truncate text-[13px] font-medium">{v.label}</div>
                      <div className="truncate text-xs text-[var(--agent-app-muted)]">{v.label_ja || '-'}</div>
                    </div>
                    <Ref>{v.code}</Ref>
                    {dimKey === 'category' && (v.classes ?? []).length > 0 && (
                      <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Classes {list}', { list: (v.classes ?? []).join(', ') })}</span>
                    )}
                    {can.manage && (
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100">
                        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Edit {name}', { name: v.label })} onClick={() => setEditing(v)}>
                          <Pencil size={13} aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Delete {code}', { code: v.code })} onClick={() => remove(v)}>
                          <Trash2 size={13} aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
      {editing !== null && dimKey !== '' && <ValueDialog dimension={dimKey} value={editing === 'new' ? null : editing} siblings={values} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ValueDialog({ dimension, value, siblings, onClose }: { dimension: string; value: DimensionValueRec | null; siblings: DimensionValueRec[]; onClose: () => void }): React.JSX.Element {
  const [code, setCode] = useState(value?.code ?? '');
  const [label, setLabel] = useState(value?.label ?? '');
  const [labelJa, setLabelJa] = useState(value?.label_ja ?? '');
  const [parent, setParent] = useState(value?.parent_code ?? '');
  const [order, setOrder] = useState(String(value?.order ?? (Math.max(0, ...siblings.map((s) => s.order)) + 1)));
  const [classes, setClasses] = useState((value?.classes ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const codeOk = /^[a-z0-9_.-]{1,40}$/i.test(code.trim());
  const dup = value === null && siblings.some((s) => s.code === code.trim());
  const ok = codeOk && !dup && label.trim() !== '';

  // A value cannot sit under itself or its own descendants.
  const blocked = new Set<string>();
  if (value !== null) {
    const stack = [value.code];
    while (stack.length) {
      const c = stack.pop() ?? '';
      if (blocked.has(c)) continue;
      blocked.add(c);
      for (const s of siblings) if (s.parent_code === c) stack.push(s.code);
    }
  }

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      dimension,
      code: code.trim(),
      label: label.trim(),
      label_ja: labelJa.trim(),
      parent_code: parent,
      order: Math.round(num(order)),
    };
    if (dimension === 'category') body['classes'] = parseClasses(classes);
    try {
      if (value === null) await createRecord('dimension_values', body);
      else await updateRecord('dimension_values', value.id, body);
      toast.success(t('Value saved'));
      onClose();
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
      title={value === null ? t('Add a value') : t('Edit value')}
      className="w-[min(94vw,34rem)]"
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
        <Input
          label={t('Code')}
          className="font-mono"
          value={code}
          disabled={value !== null}
          placeholder="figure"
          error={code !== '' && !codeOk ? t('Use letters, digits, dots, dashes or underscores.') : dup ? t('This code already exists.') : undefined}
          onChange={(e) => setCode(e.target.value)}
        />
        {value !== null && <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('Codes cannot change because grants refer to them.')}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Label (English)')} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input label={t('Label (Japanese)')} value={labelJa} onChange={(e) => setLabelJa(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('Parent')}
            value={parent}
            placeholder={t('Top level')}
            options={siblings.filter((s) => !blocked.has(s.code)).map((s) => ({ value: s.code, label: `${tf(s, 'label')} (${s.code})` }))}
            onChange={(e) => setParent(e.target.value)}
          />
          <Input label={t('Order')} type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
        {dimension === 'category' && (
          <Input
            label={t('Nice classes')}
            placeholder="16, 21, 28"
            value={classes}
            onChange={(e) => setClasses(e.target.value)}
          />
        )}
        {dimension === 'category' && <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('The trademark classes goods in this category fall into. Used to check trademark coverage before licensing.')}</p>}
      </DialogBody>
    </Dialog>
  );
}
