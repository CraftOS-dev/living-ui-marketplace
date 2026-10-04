/**
 * Settings, Rights dimensions: the axes that describe licensed rights
 * (territory, media, language, channel, product category, field of use)
 * and the tree of values in each. Managers edit.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Layers3, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, cn, toast, useConfirm } from '../../kit/index.ts';
import { createRecord, deleteRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { DimensionRec, DimensionValueRec } from '../lib/types.ts';
import { EmptyHint, Section } from './ui.tsx';
import { ReadOnlyNote } from './adminShared.tsx';

export function DimensionsTab(): React.JSX.Element {
  const { can, dimensions, dimValues } = useApp();
  const sorted = useMemo(() => dimensions.slice().sort((a, b) => a.order - b.order), [dimensions]);
  const [selected, setSelected] = useState<string>('');
  const dim = sorted.find((d) => d.key === selected) ?? sorted[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      {!can.manage && <ReadOnlyNote>Only admins and IP managers can change rights dimensions.</ReadOnlyNote>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Section title="Dimensions" meta={String(sorted.length)} flush>
          {sorted.length === 0 ? (
            <EmptyHint compact icon={Layers3} title="No dimensions" message="Dimensions describe where, how and in what form rights may be used." />
          ) : (
            <div>
              {sorted.map((d) => (
                <DimensionRow key={d.id} dim={d} active={dim?.id === d.id} count={dimValues.filter((v) => v.dimension === d.key).length} onSelect={() => setSelected(d.key)} />
              ))}
            </div>
          )}
        </Section>
        {dim !== null && <ValueTree dim={dim} values={dimValues.filter((v) => v.dimension === dim.key)} />}
      </div>
    </div>
  );
}

function DimensionRow({ dim, active, count, onSelect }: { dim: DimensionRec; active: boolean; count: number; onSelect: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [label, setLabel] = useState(dim.label);
  useEffect(() => setLabel(dim.label), [dim.label]);

  const rename = async (): Promise<void> => {
    const v = label.trim();
    if (v === '' || v === dim.label) {
      setLabel(dim.label);
      return;
    }
    try {
      await updateRecord('dimensions', dim.id, { label: v });
      toast.success(`Renamed to ${v}`);
    } catch {
      setLabel(dim.label);
    }
  };

  const toggle = async (v: boolean): Promise<void> => {
    try {
      await updateRecord('dimensions', dim.id, { enabled: v });
      toast.success(`${dim.label} ${v ? 'switched on' : 'switched off'}`);
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <div
      onClick={onSelect}
      className={cn('flex cursor-pointer items-start gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0', active ? 'bg-[var(--agent-app-accent)]/5' : 'hover:bg-[var(--agent-app-border)]/15')}
    >
      <div className="min-w-0 flex-1">
        {can.manage ? (
          <input
            aria-label={`Name of the ${dim.key} dimension`}
            className="w-full border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-[var(--agent-app-border)] focus:border-[var(--agent-app-accent)] focus:outline-none"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setLabel(dim.label);
            }}
          />
        ) : (
          <div className="px-1 text-sm font-medium">{dim.label}</div>
        )}
        <div className="px-1 text-xs text-[var(--agent-app-muted)]">
          <span className="font-mono">{dim.key}</span> · {count} values{dim.description !== '' ? ` · ${dim.description}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <Switch checked={dim.enabled} disabled={!can.manage} onCheckedChange={(v) => void toggle(v)} />
        <Button size="sm" variant={active ? 'secondary' : 'ghost'} className="h-7 px-2" aria-label={`Show values of ${dim.label}`} onClick={onSelect}>
          <ChevronRight size={14} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function ValueTree({ dim, values }: { dim: DimensionRec; values: DimensionValueRec[] }): React.JSX.Element {
  const { can } = useApp();
  const [editing, setEditing] = useState<DimensionValueRec | 'new' | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const kids = useMemo(() => {
    const codes = new Set(values.map((v) => v.code));
    const m = new Map<string, DimensionValueRec[]>();
    for (const v of values.slice().sort((a, b) => a.order - b.order)) {
      const parent = v.parent_code !== '' && codes.has(v.parent_code) ? v.parent_code : '';
      const arr = m.get(parent) ?? [];
      arr.push(v);
      m.set(parent, arr);
    }
    return m;
  }, [values]);

  const labelOf = (code: string): string => values.find((v) => v.code === code)?.label ?? code;

  const remove = async (v: DimensionValueRec): Promise<void> => {
    const children = kids.get(v.code) ?? [];
    const msg =
      `Delete "${v.label}" (${v.code})? Grants that already use ${v.code} keep it and show the code instead of a name.` +
      (children.length > 0 ? ` Its ${children.length} sub-value${children.length === 1 ? '' : 's'} move up to ${v.parent_code !== '' ? labelOf(v.parent_code) : 'the top level'}.` : '');
    if (!(await confirm(msg, 'Delete value?'))) return;
    try {
      for (const c of children) await updateRecord('dimension_values', c.id, { parent_code: v.parent_code });
      await deleteRecord('dimension_values', v.id);
      toast.success(`${v.label} deleted`);
    } catch {
      /* the client already showed the server's message */
    }
  };

  const render = (v: DimensionValueRec, depth: number): React.JSX.Element => (
    <div key={v.id}>
      <div className="group flex min-h-9 items-center gap-2 border-b border-[var(--agent-app-border)]/60 py-1 pr-3" style={{ paddingLeft: 12 + depth * 18 }}>
        {depth > 0 && <span aria-hidden className="h-px w-2.5 shrink-0 bg-[var(--agent-app-border)]" />}
        <span className="w-32 shrink-0 truncate font-mono text-[11.5px] text-[var(--agent-app-muted)]">{v.code}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{v.label}</span>
        {can.manage && (
          <span className="flex shrink-0 gap-0.5 opacity-50 group-hover:opacity-100">
            <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Edit ${v.label}`} onClick={() => setEditing(v)}>
              <Pencil size={13} aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Delete ${v.label}`} onClick={() => void remove(v)}>
              <Trash2 size={13} aria-hidden />
            </Button>
          </span>
        )}
      </div>
      {(kids.get(v.code) ?? []).map((c) => render(c, depth + 1))}
    </div>
  );

  return (
    <Section
      title={`${dim.label} values`}
      meta={String(values.length)}
      flush
      actions={
        can.manage ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus size={13} aria-hidden /> Add value
          </Button>
        ) : undefined
      }
    >
      {confirmEl}
      {!dim.enabled && <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">This dimension is switched off, so it is hidden when describing rights.</p>}
      {values.length === 0 ? (
        <EmptyHint compact icon={Layers3} title="No values yet" message="Add the values people choose from, for example countries or media." action={can.manage ? <Button size="sm" onClick={() => setEditing('new')}>Add value</Button> : undefined} />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">{(kids.get('') ?? []).map((v) => render(v, 0))}</div>
      )}
      {editing !== null && (
        <ValueDialog dim={dim} value={editing === 'new' ? null : editing} values={values} onClose={() => setEditing(null)} />
      )}
    </Section>
  );
}

function descendants(values: DimensionValueRec[], code: string): Set<string> {
  const out = new Set<string>([code]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of values) {
      if (v.parent_code !== '' && out.has(v.parent_code) && !out.has(v.code)) {
        out.add(v.code);
        grew = true;
      }
    }
  }
  return out;
}

function ValueDialog({ dim, value, values, onClose }: { dim: DimensionRec; value: DimensionValueRec | null; values: DimensionValueRec[]; onClose: () => void }): React.JSX.Element {
  const [code, setCode] = useState(value?.code ?? '');
  const [label, setLabel] = useState(value?.label ?? '');
  const [parent, setParent] = useState(value?.parent_code ?? '');
  const [busy, setBusy] = useState(false);
  const blocked = value !== null ? descendants(values, value.code) : new Set<string>();
  const clash = value === null && values.some((v) => v.code === code);
  const ok = /^[A-Z0-9_]{1,40}$/.test(code) && label.trim() !== '' && !clash;

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      if (value === null) {
        const order = values.reduce((m, v) => Math.max(m, v.order), 0) + 1;
        await createRecord('dimension_values', { dimension: dim.key, code, label: label.trim(), parent_code: parent, order });
        toast.success(`${label.trim()} added`);
      } else {
        await updateRecord('dimension_values', value.id, { label: label.trim(), parent_code: parent });
        toast.success('Value saved');
      }
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
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={value === null ? `Add a ${dim.label.toLowerCase()} value` : `Edit ${value.label}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {value === null ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Code"
          className="font-mono uppercase"
          disabled={value !== null}
          value={code}
          maxLength={40}
          error={clash ? 'This code already exists.' : undefined}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
        />
        {value !== null && <p className="-mt-1 text-xs text-[var(--agent-app-muted)]">Codes cannot change because grants store them.</p>}
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Select
          label="Part of"
          value={parent}
          placeholder="Top level"
          options={values.filter((v) => !blocked.has(v.code)).map((v) => ({ value: v.code, label: `${v.label} (${v.code})` }))}
          onChange={(e) => setParent(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
