/**
 * Add a feature: a palette of the feature kinds (Ctrl+K), searchable and
 * keyboard driven. Kinds that need something selected say so.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { iconByName } from '../../lib/icons.ts';
import type { FeatureKind, Schema } from '../../lib/types.ts';
import { Kbd } from '../ui.tsx';
import { TOOLS } from './tools.ts';

const GROUPS: { title: string; kinds: FeatureKind[] }[] = [
  { title: 'Shape', kinds: ['sketch', 'extrude', 'revolve', 'primitive', 'import_step'] },
  { title: 'Detail', kinds: ['hole', 'fillet', 'chamfer', 'shell'] },
  { title: 'Repeat and arrange', kinds: ['pattern_linear', 'pattern_circular', 'mirror', 'boolean', 'transform'] },
];

export function AddFeature({ open, onClose, schema, onPick, hint }: { open: boolean; onClose: () => void; schema: Schema; onPick: (k: FeatureKind) => void; hint: Partial<Record<FeatureKind, string>> }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
    }
  }, [open]);
  const flat = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: FeatureKind[] = [];
    for (const g of GROUPS) {
      for (const k of g.kinds) {
        const d = schema.kinds[k];
        if (needle === '' || d.label.toLowerCase().includes(needle) || d.summary.toLowerCase().includes(needle)) out.push(k);
      }
    }
    return out;
  }, [q, schema]);
  const pick = (k: FeatureKind | undefined): void => {
    if (k === undefined) return;
    onPick(k);
    onClose();
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/35" />
        <RadixDialog.Content className="cw-pop fixed left-1/2 top-[12vh] z-[61] flex max-h-[72vh] w-[min(94vw,32rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--cw-r-lg)] border border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink)] shadow-[var(--cw-shadow)]">
          <RadixDialog.Title className="sr-only">Add a feature</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Pick the kind of feature to add.</RadixDialog.Description>
          <div className="flex h-11 items-center gap-2 border-b border-[var(--cw-line)] px-3">
            <Search size={15} aria-hidden className="text-[var(--cw-muted)]" />
            <input
              autoFocus
              aria-label="Search features"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(flat.length - 1, c + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  pick(flat[cursor]);
                }
              }}
              placeholder="Add a feature"
              className="h-8 flex-1 bg-transparent text-[14px] outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
            {GROUPS.map((g) => {
              const items = g.kinds.filter((k) => flat.includes(k));
              if (items.length === 0) return null;
              return (
                <div key={g.title} className="pb-1">
                  <p className="px-2 pb-0.5 pt-1.5 text-[12px] font-bold text-[var(--cw-muted)]">{g.title}</p>
                  {items.map((k) => {
                    const d = schema.kinds[k];
                    const Icon = iconByName(d.icon);
                    const i = flat.indexOf(k);
                    const on = i === cursor;
                    return (
                      <button
                        key={k}
                        type="button"
                        onMouseMove={() => setCursor(i)}
                        onClick={() => pick(k)}
                        className={cn('flex w-full items-center gap-2.5 rounded-[var(--cw-r)] px-2 py-1.5 text-left', on && 'bg-[var(--cw-row-hover)]')}
                      >
                        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-[var(--cw-r)]', on ? 'cw-on-ink bg-[var(--cw-ink)] text-[var(--cw-accent)]' : 'border border-[var(--cw-line)] bg-[var(--cw-card)] text-[var(--cw-ink-2)]')}>
                          <Icon size={15} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={hint[k] ?? d.summary}>
                          {d.label}
                        </span>
                        {TOOLS[k].key !== null && <Kbd>{TOOLS[k].key}</Kbd>}
                        {on && <CornerDownLeft size={13} aria-hidden className="shrink-0 text-[var(--cw-muted)]" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {flat.length === 0 && <p className="px-3 py-5 text-center text-[12px] text-[var(--cw-muted)]">No feature matches.</p>}
          </div>
          <div className="flex h-8 items-center gap-3 border-t border-[var(--cw-line)] px-3 text-[12px] text-[var(--cw-muted)]">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Enter</Kbd> to add
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
