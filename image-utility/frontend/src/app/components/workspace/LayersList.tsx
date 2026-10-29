/**
 * The Layers list, top layer first, as in a design tool: click to select,
 * drag to restack, the eye shows or hides a layer, the lock keeps it from
 * being dragged by accident, double-click the name to rename it. Under the
 * layers sits the photo (its own edits are listed below the list).
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Circle, CircleDot, Eye, EyeOff, GripVertical, Highlighter, ImageIcon, Lock, Minus, Pencil, Sparkles, Square, Stamp, Trash2, Type, Unlock } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { layerTitle } from '../../lib/layers.ts';
import type { LayerType } from '../../lib/types.ts';
import { IconButton } from '../ui.tsx';
import type { LayerView } from './LayersOverlay.tsx';

export const LAYER_ICON: Record<LayerType, LucideIcon> = {
  text: Type,
  rect: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  highlight: Highlighter,
  step: CircleDot,
  pen: Pencil,
  redact: EyeOff,
  logo: Stamp,
};

export interface LayerRow extends LayerView {
  author: string;
}

export function LayersList({
  layers,
  selected,
  onSelect,
  onVisible,
  onLock,
  onRename,
  onRemove,
  onRestack,
}: {
  /** Bottom first. */
  layers: LayerRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onVisible: (id: string, on: boolean) => void;
  onLock: (id: string, on: boolean) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** Put a layer just above (or below) another one. */
  onRestack: (id: string, target: string, above: boolean) => void;
}): React.JSX.Element {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; above: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const top = [...layers].reverse();
  if (top.length === 0) return <p className="px-3 pb-2 text-[12px] leading-4 text-[var(--iu-muted)]">No layers yet. Add text, an arrow, a box or a redaction from the toolbar; each one stays movable, resizable and turnable.</p>;
  return (
    <ul className="flex flex-col gap-px px-1" onDragEnd={() => setOver(null)}>
      {top.map((l) => {
        const type = String(l.params['type'] ?? 'rect') as LayerType;
        const Icon = LAYER_ICON[type] ?? ImageIcon;
        const on = l.id === selected;
        return (
          <li
            key={l.id}
            draggable={renaming !== l.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', l.id);
              setDragging(l.id);
            }}
            onDragOver={(e) => {
              if (dragging === null || dragging === l.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOver({ id: l.id, above: e.clientY < r.top + r.height / 2 });
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null && over !== null && dragging !== over.id) onRestack(dragging, over.id, over.above);
              setDragging(null);
              setOver(null);
            }}
            className={cn('group relative flex h-8 items-center gap-1 rounded-[var(--iu-r-sm)] px-1 transition-colors', on ? 'bg-[var(--iu-row-hover)]' : 'hover:bg-[var(--iu-row)]', !l.visible && 'opacity-55')}
          >
            {over !== null && over.id === l.id && <span aria-hidden className={cn('absolute inset-x-1 h-0.5 rounded-full bg-[var(--iu-ink)]', over.above ? '-top-px' : '-bottom-px')} />}
            <GripVertical size={12} aria-hidden className="shrink-0 cursor-grab text-[var(--iu-muted)] opacity-0 group-hover:opacity-100" />
            <Icon size={14} aria-hidden className={cn('shrink-0', on ? 'text-[var(--iu-accent-text)]' : 'text-[var(--iu-ink-2)]')} />
            {renaming === l.id ? (
              <input
                autoFocus
                aria-label="Layer name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  onRename(l.id, name.trim());
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                className="h-6 min-w-0 flex-1 rounded-[var(--iu-r-sm)] border border-[var(--iu-ink)] bg-[var(--iu-card)] px-1.5 text-[13px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(l.id)}
                onDoubleClick={() => {
                  setName(typeof l.params['name'] === 'string' ? l.params['name'] : '');
                  setRenaming(l.id);
                }}
                title="Click to select; double-click to rename"
                className={cn('min-w-0 flex-1 truncate text-left text-[13px]', on ? 'font-semibold' : 'font-medium')}
              >
                {layerTitle(l.params)}
              </button>
            )}
            {l.author === 'agent' && <Sparkles size={12} aria-label="Made by your AI agent" className="shrink-0 text-[var(--iu-accent-text)]" />}
            <span className="flex shrink-0 items-center">
              <span className={cn('flex', !l.locked && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                <IconButton icon={l.locked ? Lock : Unlock} size={22} label={l.locked ? 'Unlock' : 'Lock'} active={l.locked} onClick={() => onLock(l.id, !l.locked)} />
              </span>
              <span className={cn('flex', l.visible && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                <IconButton icon={l.visible ? Eye : EyeOff} size={22} label={l.visible ? 'Hide' : 'Show'} onClick={() => onVisible(l.id, !l.visible)} />
              </span>
              <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <IconButton icon={Trash2} size={22} variant="danger" label="Delete layer" onClick={() => onRemove(l.id)} />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
