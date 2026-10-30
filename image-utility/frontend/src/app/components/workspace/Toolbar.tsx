/**
 * The editing toolbar: the photo's tools grouped as in an image editor
 * (frame, size, tone, cut out), then the layer tools (select, text, arrow,
 * line, box, ellipse, highlighter, numbered step, pen, redaction, logo),
 * each with its shortcut in the tooltip. The open tool stays lit.
 */
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { GROUPS, LAYER_TOOLS, QUICK, TOOLS } from './tools.ts';
import type { LayerTool, PixelKind, QuickId } from './tools.ts';

function ToolButton({ on, wide, label, short, keyHint, icon: Icon, disabled, onClick }: { on: boolean; wide: boolean; label: string; short: string; keyHint: string; icon: LucideIcon; disabled: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      title={label + ' (' + keyHint + ')'}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative flex h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--iu-r-sm)] px-1 text-[12px] leading-none transition-colors disabled:cursor-default disabled:opacity-40',
        wide ? 'min-w-[52px]' : 'min-w-[40px]',
        on ? 'bg-[var(--iu-row-hover)] text-[var(--iu-ink)]' : 'text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)]',
      )}
    >
      <Icon size={17} strokeWidth={1.75} aria-hidden className={on ? 'text-[var(--iu-accent-text)]' : undefined} />
      <span className={cn('whitespace-nowrap', on && 'font-semibold')}>{short}</span>
      {on && <span aria-hidden className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--iu-accent)]" />}
    </button>
  );
}

export function Toolbar({
  active,
  layerTool,
  disabled,
  onTool,
  onQuick,
  onLayerTool,
}: {
  active: PixelKind | null;
  layerTool: LayerTool;
  disabled: boolean;
  onTool: (k: PixelKind) => void;
  onQuick: (q: QuickId) => void;
  onLayerTool: (t: LayerTool) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {GROUPS.map((g, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-7 w-px bg-[var(--iu-line)]" />}
          {g.map((id) => {
            const isTool = id in TOOLS;
            const def = isTool ? TOOLS[id as PixelKind] : QUICK[id as QuickId];
            return (
              <ToolButton
                key={id}
                on={isTool && active === id}
                wide={isTool}
                label={def.label}
                short={def.short}
                keyHint={def.key}
                icon={def.icon}
                disabled={disabled}
                onClick={() => (isTool ? onTool(id as PixelKind) : onQuick(id as QuickId))}
              />
            );
          })}
        </div>
      ))}
      <span className="mx-1.5 h-7 w-px bg-[var(--iu-ink-2)]/40" />
      <div role="group" aria-label="Layers" className="flex items-center gap-0.5">
        {LAYER_TOOLS.map((t) => (
          <ToolButton key={t.id} on={layerTool === t.id && active === null} wide={t.id !== 'select'} label={t.label} short={t.short} keyHint={t.key} icon={t.icon} disabled={disabled} onClick={() => onLayerTool(t.id)} />
        ))}
      </div>
    </div>
  );
}
