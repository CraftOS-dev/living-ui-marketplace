/**
 * "Can we?" results: the grid (assets by territory), the stacked list used
 * on narrow screens, and the verdict panel with every check in order, who
 * decides, trademark cover by class and the copyright line to print.
 */
import { AlertTriangle, CheckCircle2, Copy, Info, MinusCircle, Users, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Drawer, cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { bi, isJa, t } from '../lib/i18n.ts';
import { VERDICT_TONE } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { CanWeCell, CanWeResponse, CanWeRow, Check, Decider } from '../lib/shapes.ts';
import { JurChip, Notice, Pill, TONE_BG, TONE_TEXT } from './ui.tsx';
import { assetTypeLabel, copyText, useAssetHref } from './rightsShared.tsx';

/** What the server adds to a decider beyond the shared shape. */
export interface DeciderExt extends Decider {
  committee?: { id: string; name: string } | undefined;
  windows?: { grant_id: string; agreement_id: string; holders: { party: string; name: string }[]; fee_pct: number; fee_base: string; start: string; end: string }[] | undefined;
}

interface TmEntry {
  state: 'registered' | 'pending' | 'missing';
  marks?: { id: string; ref: string; registration_no?: string; application_no?: string }[];
}

export const STATUS_TONE: Record<string, Tone> = { available: 'good', partial: 'warn', unavailable: 'bad', no_rights: 'neutral' };

export function statusLabel(s: string): string {
  switch (s) {
    case 'available':
      return t('Available|rights');
    case 'partial':
      return t('Partly available');
    case 'unavailable':
      return t('Not available');
    case 'no_rights':
      return t('No rights');
    default:
      return s;
  }
}

export function verdictText(v: string | undefined): string {
  switch (v) {
    case 'yes':
      return t('Yes|verdict');
    case 'conditions':
      return t('Yes, with conditions');
    case 'consent':
      return t('Needs committee consent');
    case 'no':
      return t('No|verdict');
    default:
      return '';
  }
}

export function verdictTone(v: string | undefined): Tone {
  return v !== undefined ? (VERDICT_TONE[v] ?? 'neutral') : 'neutral';
}

/** One line: the window holder, or how many members must agree. */
export function deciderLine(row: CanWeRow, d: DeciderExt | null | undefined): string {
  if (d === null || d === undefined) {
    if (row.owned) return t('We decide');
    return t('Licensed in');
  }
  const live = (d.members ?? []).filter((m) => m.status !== 'exited').length;
  switch (d.mode) {
    case 'window':
    case 'shared_window': {
      const names = (d.windows?.[0]?.holders ?? d.holders ?? []).map((h) => h.name).filter((n) => n !== '');
      return names.length > 0 ? t('Window: {names}', { names: names.join(isJa() ? '・' : ' and ') }) : t('Window holder');
    }
    case 'conflict':
      return t('Two windows claim it');
    case 'partial':
      return t('Partly a window; others: {n} members', { n: live });
    default:
      return t('No window: {n} members', { n: live });
  }
}

export function checkLabel(key: string): string {
  switch (key) {
    case 'availability':
      return t('Availability');
    case 'decider':
      return t('Who decides');
    case 'upstream':
      return t('Original work');
    case 'chain':
      return t('Chain of title');
    case 'performer':
      return t('Performer consent');
    case 'talent':
      return t('Talent status');
    case 'trademark':
      return t('Trademark cover');
    case 'copyright':
      return t('Copyright line');
    default:
      return key;
  }
}

const LEVEL_ICON: Record<string, { icon: LucideIcon; tone: Tone; label: () => string }> = {
  ok: { icon: CheckCircle2, tone: 'good', label: () => t('OK') },
  info: { icon: Info, tone: 'info', label: () => t('Info') },
  warn: { icon: AlertTriangle, tone: 'warn', label: () => t('Check this') },
  block: { icon: XCircle, tone: 'bad', label: () => t('Blocks the use') },
  consent: { icon: Users, tone: 'info', label: () => t('Needs consent') },
  na: { icon: MinusCircle, tone: 'neutral', label: () => t('Not applicable') },
};

function AssetLink({ type, id, label, className }: { type: string; id: string; label: string; className: string }): React.JSX.Element {
  const linkOf = useAssetHref();
  const to = linkOf(type, id);
  return to === '' ? (
    <span className={className} title={label}>
      {label}
    </span>
  ) : (
    <a href={to} className={cn(className, 'hover:underline')} title={label}>
      {label}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

function CellButton({
  row,
  cell,
  selected,
  onClick,
  stacked = false,
}: {
  row: CanWeRow;
  cell: CanWeCell;
  selected: boolean;
  onClick: () => void;
  stacked?: boolean | undefined;
}): React.JSX.Element {
  const tone = verdictTone(cell.verdict);
  const dec = deciderLine(row, cell.decider as DeciderExt | null | undefined);
  const label = isJa() ? cell.label_ja || cell.label : cell.label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${row.label}, ${label}: ${verdictText(cell.verdict)}, ${statusLabel(cell.status)}, ${dec}`}
      className={cn(
        'flex w-full min-w-0 text-left transition-shadow hover:ring-1 hover:ring-[var(--agent-app-text)]/30',
        stacked ? 'items-center gap-3 px-3 py-2' : 'min-h-[4.25rem] flex-col items-start justify-center gap-0.5 px-2 py-1.5',
        TONE_BG[tone],
        selected && 'ring-2 ring-[var(--agent-app-accent)]',
      )}
    >
      {stacked && (
        <span className="flex w-24 shrink-0 items-center gap-1.5">
          {cell.code.length === 2 && <JurChip code={cell.code} />}
          <span className="truncate text-xs font-medium">{label}</span>
        </span>
      )}
      <span className={cn('min-w-0', stacked && 'flex-1')}>
        <span className={cn('block text-xs font-semibold', TONE_TEXT[tone])}>{verdictText(cell.verdict)}</span>
        <span className="block text-[11px] leading-tight text-[var(--agent-app-text)]/75">{statusLabel(cell.status)}</span>
        <span className="block max-w-full truncate text-[11px] leading-tight text-[var(--agent-app-muted)]" title={dec}>
          {dec}
        </span>
      </span>
    </button>
  );
}

export function CanWeGrid({
  result,
  selected,
  onSelect,
}: {
  result: CanWeResponse;
  selected: { r: number; c: number } | null;
  onSelect: (r: number, c: number) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--agent-app-border)]">
              <th className="sticky left-0 z-10 min-w-[11rem] max-w-[15rem] border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                {t('What|can we')}
              </th>
              {result.columns.map((c) => (
                <th key={c.code} className="min-w-[9rem] px-1 py-2 text-left align-bottom font-normal">
                  <div className="flex flex-col items-start gap-1">
                    {c.code.length === 2 && <JurChip code={c.code} />}
                    <span className="text-[11.5px] font-medium leading-tight">{isJa() ? c.label_ja || c.label : c.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, ri) => (
              <tr key={`${r.type}:${r.id}`} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                <th scope="row" className="sticky left-0 z-10 min-w-[11rem] max-w-[15rem] border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2 text-left align-top font-normal">
                  <AssetLink type={r.type} id={r.id} label={r.label} className="block truncate font-medium" />
                  <div className="mt-0.5 text-[11px] leading-snug text-[var(--agent-app-muted)]">
                    {assetTypeLabel(r.type)}
                    {r.owned ? ` · ${t('Ours via {name}', { name: r.owned_by })}` : ''}
                  </div>
                </th>
                {r.cells.map((c, ci) => (
                  <td key={c.code} className="p-1 align-top">
                    <CellButton row={r} cell={c} selected={selected?.r === ri && selected.c === ci} onClick={() => onSelect(ri, ci)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col md:hidden">
        {result.rows.map((r, ri) => (
          <div key={`${r.type}:${r.id}`} className="border-b border-[var(--agent-app-border)] last:border-0">
            <div className="px-4 py-2">
              <AssetLink type={r.type} id={r.id} label={r.label} className="block truncate text-sm font-medium" />
              <div className="text-[11px] text-[var(--agent-app-muted)]">
                {assetTypeLabel(r.type)}
                {r.owned ? ` · ${t('Ours via {name}', { name: r.owned_by })}` : ''}
              </div>
            </div>
            <div className="flex flex-col gap-1 px-3 pb-3">
              {r.cells.map((c, ci) => (
                <CellButton key={c.code} stacked row={r} cell={c} selected={selected?.r === ri && selected.c === ci} onClick={() => onSelect(ri, ci)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function CanWeLegend(): React.JSX.Element {
  const items: { v: string; text: string }[] = [
    { v: 'yes', text: t('free, and we or the window holder decide') },
    { v: 'conditions', text: t('possible once the flagged points are handled') },
    { v: 'consent', text: t('no window covers it, so the committee must agree') },
    { v: 'no', text: t('taken, held back, not acquired or blocked') },
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--agent-app-border)] px-4 py-2.5 text-xs text-[var(--agent-app-muted)]">
      {items.map((l) => (
        <span key={l.v} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-block size-3 border border-[var(--agent-app-border)]', TONE_BG[verdictTone(l.v)])} aria-hidden />
          <span className={cn('font-medium', TONE_TEXT[verdictTone(l.v)])}>{verdictText(l.v)}</span> {l.text}
        </span>
      ))}
      <span className="w-full sm:ml-auto sm:w-auto">{t('Click a cell for every check and who decides.')}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verdict panel                                                       */
/* ------------------------------------------------------------------ */

function CheckItem({ c, onNavigate }: { c: Check; onNavigate: () => void }): React.JSX.Element {
  const linkOf = useAssetHref();
  const linkHref = (type: string, id: string): string => (type === 'agreement' ? href('agreement', id) : linkOf(type, id));
  const lv = LEVEL_ICON[c.level] ?? LEVEL_ICON['info'];
  const Icon = lv?.icon ?? Info;
  const tone: Tone = lv?.tone ?? 'info';
  return (
    <li className="flex gap-2.5 border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
      <Icon size={15} className={cn('mt-0.5 shrink-0', TONE_TEXT[tone])} aria-label={lv?.label() ?? ''} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{checkLabel(c.key)}</div>
        <div className="mt-0.5 break-words text-[13px] leading-relaxed">{bi(c.text)}</div>
        {(c.links ?? []).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {(c.links ?? []).map((l) => {
              const to = linkHref(l.type, l.id);
              return to === '' ? (
                <span key={`${l.type}:${l.id}`}>{l.label}</span>
              ) : (
                <a key={`${l.type}:${l.id}`} href={to} onClick={onNavigate} className="font-medium text-[var(--agent-app-accent)] hover:underline">
                  {l.label !== '' ? l.label : t('Open|action')}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

function tmLabel(state: string): string {
  if (state === 'registered') return t('Registered');
  if (state === 'pending') return t('Pending');
  return t('Not filed');
}

export function VerdictPanel({
  result,
  row,
  cell,
  exclusive,
  canAsk,
  onAsk,
  onClose,
}: {
  result: CanWeResponse;
  row: CanWeRow;
  cell: CanWeCell;
  exclusive: boolean;
  canAsk: boolean;
  onAsk: (committeeId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { on } = useApp();
  const dec = (cell.decider ?? null) as DeciderExt | null;
  const label = isJa() ? cell.label_ja || cell.label : cell.label;
  const askable = dec !== null && (dec.mode === 'consent' || dec.mode === 'partial') && dec.committee !== undefined && on('committees');
  const tms = (cell.trademarks ?? null) as Record<string, TmEntry> | null;
  const line = cell.copyright_line ?? '';
  const checks = cell.checks ?? [];
  return (
    <Drawer open onClose={onClose} title={`${row.label}: ${label}`} width={540}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={verdictTone(cell.verdict)}>{verdictText(cell.verdict)}</Pill>
            <Pill tone={STATUS_TONE[cell.status] ?? 'neutral'}>{statusLabel(cell.status)}</Pill>
          </div>
          <p className="text-xs text-[var(--agent-app-muted)]">
            {t('{start} to {end}', { start: fmtDate(result.start), end: fmtDate(result.end) })}
            {exclusive ? `, ${t('checked for an exclusive deal')}` : ''}
          </p>
        </div>

        {dec !== null && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Who decides')}</div>
            <p className="mt-1 break-words text-[13px] leading-relaxed">{bi(dec.text)}</p>
            {dec.committee !== undefined && on('committees') && (
              <a href={href('committee', dec.committee.id)} onClick={onClose} className="mt-1 inline-block text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
                {dec.committee.name}
              </a>
            )}
            {(dec.mode === 'consent' || dec.mode === 'partial') && (dec.members ?? []).length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {(dec.members ?? [])
                  .filter((m) => m.status !== 'exited')
                  .map((m) => (
                    <li key={m.id} className="border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
                      {m.name}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Checks|can we')}</h3>
          {checks.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No checks ran for this cell.')}</p>
          ) : (
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {checks.map((c, i) => (
                <CheckItem key={`${c.key}-${i}`} c={c} onNavigate={onClose} />
              ))}
            </ul>
          )}
        </div>

        {tms !== null && Object.keys(tms).length > 0 && (
          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Trademark cover by class')}</h3>
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {Object.entries(tms).map(([k, v]) => (
                <li key={k} className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)]/70 px-3 py-2 text-[13px] last:border-0">
                  <span className="w-20 shrink-0 font-medium tabular-nums">{t('Class {n}', { n: k })}</span>
                  <Pill tone={v.state === 'registered' ? 'good' : v.state === 'pending' ? 'info' : 'warn'}>{tmLabel(v.state)}</Pill>
                  <span className="flex min-w-0 flex-wrap gap-2 text-xs">
                    {(v.marks ?? []).map((m) => (
                      <a key={m.id} href={href('matter', m.id)} onClick={onClose} className="font-mono text-[var(--agent-app-accent)] hover:underline">
                        {m.ref || m.registration_no || m.application_no || t('Open|action')}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cell.free.length > 0 && cell.status === 'partial' && (
          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Free periods')}</h3>
            <ul className="flex flex-col gap-1 text-[13px] tabular-nums">
              {cell.free.map(([a, b]) => (
                <li key={`${a}-${b}`}>{t('{start} to {end}', { start: fmtDate(a), end: fmtDate(b) })}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Copyright line')}</h3>
          {line !== '' ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-1.5 text-[13px]">{line}</code>
              <Button size="sm" variant="outline" onClick={() => void copyText(line)}>
                <Copy size={13} aria-hidden /> {t('Copy the © line')}
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No © line is recorded for this franchise, committee or character yet.')}</p>
          )}
        </div>

        {askable && (
          <div className="flex flex-col gap-2 border-t border-[var(--agent-app-border)] pt-4">
            <p className="text-[13px] leading-relaxed">{t('No window covers this use. Ask every member, and keep their answers with the request.')}</p>
            <div>
              <Button onClick={() => dec?.committee !== undefined && onAsk(dec.committee.id)} disabled={!canAsk} title={canAsk ? undefined : t('Your role cannot open consent requests.')}>
                <Users size={14} aria-hidden /> {t('Ask the committee')}
              </Button>
            </div>
          </div>
        )}

        <Notice tone="neutral">{t('Answers come from recorded agreements, windows and registrations only. They are not legal advice.')}</Notice>
      </div>
    </Drawer>
  );
}
