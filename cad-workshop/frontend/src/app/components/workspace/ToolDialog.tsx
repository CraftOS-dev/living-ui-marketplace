/**
 * The open tool: a small dialog floating over the top-left of the model, as
 * in desktop CAD. The fields that matter come first, the rest wait under
 * More options; clicks in the view fill the active pick field; the model
 * shows a live preview of the result as values change; Enter is OK and Esc
 * cancels. The dialog is controlled: the workspace owns the params so the
 * drag handles and the preview follow the same values.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { friendly } from '../../lib/errors.ts';
import { volume } from '../../lib/format.ts';
import type { Unit } from '../../lib/format.ts';
import { iconByName } from '../../lib/icons.ts';
import { featureTitle } from '../../lib/keys.ts';
import type { EditResult, Feature, FeatureKind, FieldDef, Json, Params, Schema } from '../../lib/types.ts';
import { Button, Spinner } from '../ui.tsx';
import { FieldInput, FieldLabel, inlineField, isVisible, withDefaults } from './fields.tsx';
import type { FormContext } from './fields.tsx';
import { TOOLS } from './tools.ts';

export interface ToolState {
  kind: FeatureKind;
  /** The feature being edited; null when adding. */
  feature: Feature | null;
  params: Params;
  /** Top-level params changed by hand (automatic choices leave these alone). */
  touched: string[];
  /** The pick field clicks in the view fill. */
  active: string | null;
}

export interface PreviewState {
  busy: boolean;
  result: EditResult | null;
  /** Why OK cannot run yet (a refused request), shown under the fields. */
  problem: string | null;
}

/** Required fields that are visible and still empty. */
export function missingFields(def: FieldDef[], params: Params): FieldDef[] {
  const shown = withDefaults(def, params);
  return def.filter((f) => f.required === true && isVisible(f, shown) && (shown[f.key] === undefined || shown[f.key] === null));
}

export function ToolDialog({
  schema,
  tool,
  ctx,
  unit,
  preview,
  applying,
  ready,
  onParams,
  onOk,
  onCancel,
}: {
  schema: Schema;
  tool: ToolState;
  ctx: FormContext;
  unit: Unit;
  preview: PreviewState;
  applying: boolean;
  /** False while the params would change nothing yet (OK waits). */
  ready: boolean;
  onParams: (params: Params, key: string) => void;
  onOk: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const def = schema.kinds[tool.kind];
  const Icon = iconByName(def.icon);
  const [more, setMore] = useState(false);
  const shown = useMemo(() => withDefaults(def.fields, tool.params), [def.fields, tool.params]);
  const visible = def.fields.filter((f) => isVisible(f, shown));
  const essentials = TOOLS[tool.kind].essentials;
  const front = essentials.map((k) => visible.find((f) => f.key === k)).filter((f): f is FieldDef => f !== undefined);
  const rest = visible.filter((f) => !essentials.includes(f.key));
  const missing = missingFields(def.fields, tool.params);
  const result = preview.result;
  const err = result?.error ?? null;
  const fr = err !== null ? friendly(err, tool.kind) : null;

  // Enter is OK, Esc cancels (Enter in a list or button keeps its own meaning).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && !e.shiftKey && t?.tagName !== 'TEXTAREA' && t?.tagName !== 'BUTTON' && t?.getAttribute('role') !== 'button') {
        e.preventDefault();
        if (missing.length === 0 && ready && !applying) onOk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOk, onCancel, missing.length, ready, applying]);

  const field = (f: FieldDef): React.JSX.Element => (
    <FieldLabel key={f.key} def={f} inline={inlineField(f)}>
      <FieldInput def={f} ctx={ctx} siblings={shown} path={f.key} value={tool.params[f.key]} onChange={(v: Json | undefined) => onParams(setKey(tool.params, f.key, v), f.key)} />
    </FieldLabel>
  );

  return (
    <section aria-label={def.label} className="pointer-events-auto flex max-h-full w-[min(284px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] shadow-[var(--cw-shadow)]">
      <header className={cn('flex h-8 shrink-0 items-center gap-1.5 border-b px-2', fr !== null ? 'border-[var(--cw-red)] bg-[var(--cw-red)]/8' : 'border-[var(--cw-hair)]')}>
        <Icon size={14} aria-hidden className={fr !== null ? 'text-[var(--cw-red-text)]' : 'text-[var(--cw-ink-2)]'} />
        <h2 className={cn('min-w-0 flex-1 truncate text-[13px] font-bold', fr !== null && 'text-[var(--cw-red-text)]')}>{tool.feature === null ? def.label : 'Edit ' + featureTitle(tool.feature.name)}</h2>
        {preview.busy && <Spinner size={12} className="text-[var(--cw-muted)]" />}
        <button type="button" aria-label="Cancel (Esc)" title="Cancel (Esc)" onClick={onCancel} className="flex size-6 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-muted)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]">
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="flex flex-col gap-1.5">
          {front.map(field)}
          {rest.length > 0 && (
            <>
              <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className="-mx-0.5 mt-0.5 flex h-6 items-center gap-1 rounded-[var(--cw-r-sm)] px-0.5 text-[12px] font-semibold text-[var(--cw-ink-2)] hover:text-[var(--cw-ink)]">
                <ChevronRight size={13} aria-hidden className={cn('transition-transform', more && 'rotate-90')} />
                More options
              </button>
              {more && rest.map(field)}
            </>
          )}
        </div>
      </div>
      {(fr !== null || preview.problem !== null || (result !== null && err === null && (result.delta !== null || result.warnings.length > 0))) && (
        <div className="shrink-0 border-t border-[var(--cw-hair)] px-2 py-1.5 text-[12px] leading-4">
          {fr !== null ? (
            <div role="alert">
              <p className="font-bold text-[var(--cw-red-text)]">{fr.title}</p>
              <p className="text-[var(--cw-ink)]">{fr.message}</p>
              {fr.tip !== null && <p className="text-[var(--cw-ink-2)]">{fr.tip}</p>}
            </div>
          ) : preview.problem !== null ? (
            <p role="alert" className="text-[var(--cw-red-text)]">
              {preview.problem}
            </p>
          ) : (
            result !== null && (
              <>
                {result.delta !== null && (
                  <p className="num text-[var(--cw-ink-2)]">
                    {(result.delta.volume_mm3 >= 0 ? '+' : '−') + volume(Math.abs(result.delta.volume_mm3), unit)}
                    {result.summary !== null ? ' → ' + volume(result.summary.volume_mm3, unit) : ''}
                  </p>
                )}
                {result.warnings.map((w) => (
                  <p key={w} className="text-[var(--cw-amber-text)]">
                    {w}
                  </p>
                ))}
              </>
            )
          )}
        </div>
      )}
      <footer className="flex shrink-0 items-center justify-end gap-1 border-t border-[var(--cw-hair)] px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={applying} disabled={missing.length > 0 || !ready || applying} onClick={onOk}>
          OK
        </Button>
      </footer>
    </section>
  );
}

function setKey(params: Params, key: string, v: Json | undefined): Params {
  const next: Params = { ...params };
  if (v === undefined) delete next[key];
  else next[key] = v;
  return next;
}
