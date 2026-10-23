/**
 * Manufacturing pieces: the build status words, the components editor of a
 * bill of materials (item and quantity per batch, add and remove rows), and
 * the full screen that creates a bill of materials.
 */
import { useState } from 'react';
import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { errMessage, op } from '../../lib/api.ts';
import { normalizeNumber, plain } from '../../lib/format.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import type { BomDetail, BuildStatus } from '../../lib/types/stock.ts';
import { useFullScreen, ScreenBar } from '../FullScreen.tsx';
import { ItemPicker, MoneyInput, NumberInput, itemOption } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Card, CircleButton, Field, Notice, PillButton, softArea, softInput } from '../ui.tsx';
import type { Tone } from '../ui.tsx';

export const BUILD_STATUS: Record<BuildStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Planned', tone: 'info' },
  done: { label: 'Done', tone: 'good' },
  void: { label: 'Void', tone: 'neutral' },
};

export function buildStatus(s: string): { label: string; tone: Tone } {
  return BUILD_STATUS[s as BuildStatus] ?? { label: s, tone: 'neutral' };
}

/* ------------------------------------------------------- components editor */

export interface LineDraft {
  key: string;
  item: Option | null;
  qty: string;
}

let seq = 0;
export function newLine(item: Option | null = null, qty = '1'): LineDraft {
  seq += 1;
  return { key: `c${seq}`, item, qty };
}

/** Lines from a bill of materials, ready to edit. */
export function linesOf(b: BomDetail): LineDraft[] {
  return b.components.map((c) => newLine(c.item !== null ? { ...itemOption(c.item), data: c.item } : null, plain(c.qty)));
}

/** The lines as the operations take them, or a message saying what to fix. */
export function linesParam(lines: LineDraft[]): { lines: { item: string; qty: string }[] } | { error: string } {
  const out: { item: string; qty: string }[] = [];
  for (const [i, l] of lines.entries()) {
    if (l.item === null && (l.qty === '' || l.qty === '1')) continue;
    if (l.item === null) return { error: `Choose the item on line ${i + 1}` };
    const n = normalizeNumber(l.qty, 3);
    if (n === null || Number(n) <= 0) return { error: `Enter how much ${l.item.label} it takes` };
    out.push({ item: l.item.id, qty: n });
  }
  if (out.length === 0) return { error: 'Add at least one component' };
  return { lines: out };
}

export function ComponentsEditor({ lines, onChange, exclude }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; exclude?: string | undefined }): React.JSX.Element {
  const set = (key: string, patch: Partial<LineDraft>): void => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_140px_40px] gap-2 px-1 text-[12px] font-semibold text-[var(--erp-muted)] @min-[480px]:grid">
        <span>Component</span>
        <span className="text-right">Qty per batch</span>
        <span />
      </div>
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-center gap-2 @min-[480px]:grid-cols-[minmax(0,1fr)_140px_40px]">
          <ItemPicker value={l.item} onChange={(o) => set(l.key, { item: o !== null && o.id === exclude ? null : o })} kind="stock" size="cell" placeholder="Choose a stock item" />
          <NumberInput value={l.qty} onChange={(v) => set(l.key, { qty: v })} ariaLabel={`Quantity of ${l.item?.label ?? 'component'}`} size="cell" suffix={unitOf(l.item)} />
          <CircleButton icon={Trash2} label="Remove component" variant="ghost" size={36} onClick={() => onChange(lines.filter((x) => x.key !== l.key))} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="mt-1 flex items-center gap-2 self-start rounded-full px-3 py-2 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]">
        <Plus size={15} aria-hidden /> Add a component
      </button>
    </div>
  );
}

function unitOf(o: Option | null): string | undefined {
  const d = o?.data as { unit?: string | undefined } | undefined;
  return d?.unit !== undefined && d.unit !== '' ? d.unit : undefined;
}

/* ----------------------------------------------------- new bill of materials */

export function useNewBom(onCreated: (id: string) => void): { open: (from: Element | null, item?: Option | null) => void; node: React.ReactNode } {
  const [state, setState] = useState<{ n: number; item: Option | null }>({ n: 0, item: null });
  const fs = useFullScreen();
  const open = (from: Element | null, item: Option | null = null): void => {
    setState((s) => ({ n: s.n + 1, item }));
    fs.open(from);
  };
  const node = fs.node(
    <NewBomScreen
      key={state.n}
      start={state.item}
      onClose={fs.close}
      onCreated={(id) => {
        fs.close();
        onCreated(id);
      }}
    />,
    { title: 'New bill of materials' },
  );
  return { open, node };
}

function NewBomScreen({ start, onClose, onCreated }: { start: Option | null; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const currency = baseCurrency(useMe());
  const [item, setItem] = useState<Option | null>(start);
  const [name, setName] = useState('');
  const [output, setOutput] = useState('1');
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine(), newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (item === null) {
      setError('Choose the item this makes');
      return;
    }
    const lp = linesParam(lines);
    if ('error' in lp) {
      setError(lp.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ id: string; name: string }>('boms.add', { item: item.id, name: name.trim() === '' ? undefined : name.trim(), output_qty: output === '' ? '1' : output, extra_cost: extra === '' ? '0' : extra, notes: notes.trim(), lines: lp.lines }, { quiet: true });
      toast.success(`${r.name} added`);
      onCreated(r.id);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-28 md:pb-12">
      <ScreenBar title="New bill of materials" onClose={onClose} />
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-5 px-4 @min-[640px]:px-8 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <Card className="@min-[900px]:col-span-5" delay={1}>
          <h2 className="mb-4 text-[15px] font-bold">What it makes</h2>
          <div className="flex flex-col gap-4">
            <Field label="Finished item" hint="A stock item; building adds it to stock">
              <ItemPicker value={item} onChange={setItem} kind="stock" placeholder="Choose what this makes" />
            </Field>
            <Field label="Name" optional hint="Empty uses the item's name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={item?.label ?? 'e.g. Grinder, standard build'} aria-label="Name" className={softInput} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="One batch makes">
                <NumberInput value={output} onChange={setOutput} ariaLabel="One batch makes" suffix={unitOf(item)} />
              </Field>
              <Field label="Labor and overhead" hint="Per unit made">
                <MoneyInput value={extra} onChange={setExtra} currency={currency} decimals={4} ariaLabel="Labor and overhead per unit" />
              </Field>
            </div>
            <Field label="Notes" optional>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} placeholder="How it is put together, checks to run" aria-label="Notes" className={softArea} />
            </Field>
          </div>
        </Card>
        <div className="flex flex-col gap-5 @min-[900px]:col-span-7">
          <Card delay={2}>
            <h2 className="mb-4 text-[15px] font-bold">Components</h2>
            <ComponentsEditor lines={lines} onChange={setLines} exclude={item?.id} />
          </Card>
          {error !== null && (
            <div className="erp-shake">
              <Notice tone="bad" icon={AlertTriangle}>
                {error}
              </Notice>
            </div>
          )}
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--erp-line)] bg-[var(--erp-shell)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <PillButton icon={Check} dot loading={busy} disabled={item === null} onClick={() => void save()} className="h-14 w-full text-[15px]">
              Add bill of materials
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}
