/**
 * The right-click menu over the model: what can be done with the thing
 * under the pointer (a face, an edge, a profile) or, over empty space, with
 * the view. The workspace builds the entries; this places and closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { menuItem } from '../ui.tsx';

export type MenuEntry = { label: string; icon: LucideIcon; shortcut?: string; onClick: () => void } | 'separator' | { header: string };

export function ContextMenu({ at, entries, onClose }: { at: { x: number; y: number }; entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at]);
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('contextmenu', onDoc);
    }, 0);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('contextmenu', onDoc);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} className="cw-pop cw-on-card fixed z-[60] w-56 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-1 text-[var(--cw-ink)] shadow-[var(--cw-shadow)]" onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) => {
        if (e === 'separator') return <div key={'s' + i} className="my-1 border-t border-[var(--cw-hair)]" />;
        if ('header' in e)
          return (
            <p key={'h' + i} className="truncate px-2 pb-0.5 pt-1 text-[12px] font-semibold text-[var(--cw-muted)]">
              {e.header}
            </p>
          );
        const Icon = e.icon;
        return (
          <button
            key={e.label}
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              onClose();
              e.onClick();
            }}
          >
            <Icon size={14} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            {e.shortcut !== undefined && <span className="text-[12px] text-[var(--cw-muted)]">{e.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
