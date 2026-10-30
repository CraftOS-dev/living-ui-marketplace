/**
 * Indicators: the catalogue to add from (searchable, by group) and the
 * settings of one indicator on a chart (parameters, color, visibility).
 */
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import * as ta from '../lib/ta.js';
import { chartColors } from '../lib/themeColors.ts';
import type { IndicatorConf } from '../lib/types.ts';
import { Btn, Field, input, Modal, Select, Toggle } from './ui.tsx';

const GROUPS = ['Trend', 'Momentum', 'Volatility', 'Volume'] as const;

export function IndicatorPicker({ open, onClose, current, onAdd }: { open: boolean; onClose: () => void; current: IndicatorConf[]; onAdd: (id: string) => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ta.CATALOGUE.filter((d) => needle === '' || d.name.toLowerCase().includes(needle) || d.short.toLowerCase().includes(needle) || d.id.includes(needle));
  }, [q]);
  const counts = new Map<string, number>();
  for (const c of current) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  return (
    <Modal open={open} onClose={onClose} title="Indicators" top bare width="lg">
      <div className="flex items-center gap-2 border-b border-[var(--tv-hair)] px-3">
        <Search size={15} className="text-[var(--tv-muted)]" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              const d = list[active];
              if (d !== undefined) onAdd(d.id);
            }
          }}
          placeholder="Search indicators: RSI, MACD, Bollinger, VWAP..."
          aria-label="Search indicators"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
        />
        <span className="text-[11px] font-semibold text-[var(--tv-muted)]">Click to add, keep open for more</span>
      </div>
      <div className="max-h-[62vh] overflow-y-auto py-1">
        {GROUPS.map((g) => {
          const items = list.filter((d) => d.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">{g}</div>
              {items.map((d) => {
                const i = list.indexOf(d);
                const n = counts.get(d.id) ?? 0;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onAdd(d.id)}
                    className={cn('flex h-8 w-full items-center gap-3 px-3 text-left', i === active && 'bg-[var(--tv-row)]')}
                  >
                    <span className="w-16 shrink-0 text-[12px] font-bold">{d.short}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--tv-ink-2)]">{d.name}</span>
                    <span className="text-[11px] text-[var(--tv-muted)]">{d.overlay ? 'On price' : 'Own pane'}</span>
                    {n > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] font-bold text-[var(--tv-ink)]">
                        <Check size={12} strokeWidth={2.4} />
                        {n > 1 ? n : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function IndicatorSettings({ conf, onClose, onSave }: { conf: IndicatorConf | null; onClose: () => void; onSave: (c: IndicatorConf) => void }): React.JSX.Element | null {
  const def = conf === null ? null : ta.find(conf.id);
  const [draft, setDraft] = useState<IndicatorConf | null>(conf);
  if (conf === null || def === null) return null;
  const cur = draft !== null && draft.id === conf.id ? draft : conf;
  const prm = ta.params(cur.id, cur.params);
  const colors = chartColors().lines;
  return (
    <Modal
      open
      width="sm"
      onClose={onClose}
      title={def.name}
      description={def.overlay ? 'Drawn on the price' : 'Drawn in its own pane'}
      footer={
        <>
          <Btn
            variant="ghost"
            onClick={() => {
              setDraft({ ...cur, params: ta.params(cur.id, {}) });
            }}
          >
            Defaults
          </Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              onSave({ ...cur, params: ta.params(cur.id, cur.params) });
              onClose();
            }}
          >
            Apply
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {def.params.map((p) =>
          p.options !== undefined ? (
            <Field key={p.key} label={p.label}>
              <Select label={p.label} value={String(prm[p.key])} onChange={(v) => setDraft({ ...cur, params: { ...cur.params, [p.key]: v } })} options={p.options.map((o) => ({ value: o, label: o }))} />
            </Field>
          ) : (
            <Field key={p.key} label={p.label} hint={`${p.min} to ${p.max}`}>
              <input
                type="number"
                className={input + ' num'}
                min={p.min}
                max={p.max}
                step={p.step}
                value={String(cur.params[p.key] ?? prm[p.key])}
                onChange={(e) => setDraft({ ...cur, params: { ...cur.params, [p.key]: e.target.value === '' ? '' : Number(e.target.value) } })}
              />
            </Field>
          ),
        )}
      </div>
      {def.params.length === 0 && <p className="text-[12px] text-[var(--tv-muted)]">This indicator has no settings.</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-semibold text-[var(--tv-ink-2)]">Line color</span>
        <div className="flex items-center gap-1">
          <button type="button" title="Automatic" aria-label="Automatic color" onClick={() => setDraft({ ...cur, color: '' })} className={cn('h-6 rounded-[4px] px-1.5 text-[11px] font-semibold hover:bg-[var(--tv-row)]', (cur.color ?? '') === '' && 'bg-[var(--tv-row-hover)]')}>
            Auto
          </button>
          {colors.map((c) => {
            const hex = toHex(c);
            return (
              <button key={c} type="button" aria-label={'Color ' + hex} title={hex} onClick={() => setDraft({ ...cur, color: hex })} className={cn('flex size-6 items-center justify-center rounded-[4px] hover:bg-[var(--tv-row)]', cur.color === hex && 'bg-[var(--tv-row-hover)]')}>
                <span className="size-3 rounded-full" style={{ background: c }} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold text-[var(--tv-ink-2)]">Visible</span>
        <Toggle label="Visible" checked={cur.hidden !== true} onChange={(v) => setDraft({ ...cur, hidden: !v })} />
      </div>
    </Modal>
  );
}

function toHex(rgb: string): string {
  const m = /rgb\((\d+)\s+(\d+)\s+(\d+)\)/.exec(rgb);
  if (m === null) return rgb;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}
