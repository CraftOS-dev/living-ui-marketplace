/**
 * Company OS primitive layer, v2. The rules distilled from the SOTA research
 * (Linear, Stripe, Mercury, Attio, Notion, Shopify):
 * - hierarchy from weight + muted grays, not size jumps; one accent, used
 *   only for interaction and the current thing
 * - color otherwise means STATE only: green good, amber caution, red bad
 * - every enum renders as a dot + tinted pill, identical app-wide
 * - rows are one clickable object: identity chip, medium-weight name,
 *   muted metadata, right-aligned tabular numbers, actions only on hover
 * - money is signed, tabular, right-aligned; dates are relative
 * - empty states: icon, one headline, two lines max, ONE call to action
 */
import type { ReactNode } from 'react';
import { Download, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { Button, Card, CardContent, DropdownMenu, Tooltip, cn } from '../../kit/index.ts';
import type { DropdownMenuItem } from '../../kit/index.ts';

/* ------------------------------------------------------------------ */
/* Tones: the app's entire status color language lives here.           */
/* ------------------------------------------------------------------ */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  info: 'text-sky-700 dark:text-sky-400',
  accent: 'text-[var(--lui-accent)]',
  neutral: 'text-[var(--lui-muted)]',
};

const TONE_BG: Record<Tone, string> = {
  good: 'bg-emerald-500/10',
  warn: 'bg-amber-500/10',
  bad: 'bg-red-500/10',
  info: 'bg-sky-500/10',
  accent: 'bg-[var(--lui-accent)]/10',
  neutral: 'bg-[var(--lui-border)]/40',
};

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-sky-500',
  accent: 'bg-[var(--lui-accent)]',
  neutral: 'bg-[var(--lui-muted)]/60',
};

export function Dot({ tone, className }: { tone: Tone; className?: string | undefined }): React.JSX.Element {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}

/** Status pill: dot + label on a tinted background. The ONLY way an enum renders. */
export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 text-xs font-medium',
        TONE_BG[tone],
        TONE_TEXT[tone],
        className,
      )}
    >
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Identity chip: deterministic initials avatar (Attio-style row face). */
/* ------------------------------------------------------------------ */

const CHIP_HUES = [
  'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  'bg-amber-500/15 text-amber-700 dark:text-amber-500',
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  const first = parts[0]?.charAt(0) ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}

export function IdentityChip({
  name,
  size = 'md',
  square = false,
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | undefined;
  /** Squares for organizations/things, circles for people. */
  square?: boolean | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = CHIP_HUES[Math.abs(hash) % CHIP_HUES.length];
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-semibold',
        size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-[11px]',
        square ? '' : 'rounded-full',
        hue,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers and dates                                                   */
/* ------------------------------------------------------------------ */

export function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Signed, colored, tabular money amount (Mercury convention). */
export function MoneyAmount({
  amount,
  kind,
  className,
}: {
  amount: number;
  /** 'in' renders +green, 'out' renders muted, 'plain' renders neutral. */
  kind: 'in' | 'out' | 'plain';
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'whitespace-nowrap text-right tabular-nums',
        kind === 'in' && 'font-medium text-emerald-700 dark:text-emerald-400',
        kind === 'out' && 'text-[var(--lui-text)]',
        className,
      )}
    >
      {kind === 'in' ? '+' : kind === 'out' ? '−' : ''}
      {fmtMoney(amount)}
    </span>
  );
}

const DAY_MS = 24 * 3600 * 1000;

/** Relative day phrasing; ISO date in, human out. */
export function relDay(isoDate: string): { label: string; overdue: boolean; days: number } {
  const d = isoDate.slice(0, 10);
  if (d === '') return { label: '', overdue: false, days: 0 };
  const target = new Date(d + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (days === 0) return { label: 'Today', overdue: false, days };
  if (days === 1) return { label: 'Tomorrow', overdue: false, days };
  if (days === -1) return { label: 'Yesterday', overdue: true, days };
  if (days < 0) return { label: `${-days}d overdue`, overdue: true, days };
  if (days < 15) return { label: `in ${days}d`, overdue: false, days };
  return { label: target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: false, days };
}

export function RelDate({ iso, className }: { iso: string; className?: string | undefined }): React.JSX.Element {
  const { label, overdue } = relDay(iso);
  if (label === '') return <span className={cn('text-xs text-[var(--lui-muted)]', className)}>-</span>;
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs tabular-nums',
        overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-[var(--lui-muted)]',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Past-tense relative date ("2d ago"): history is never "overdue". */
export function AgoDate({ iso, className }: { iso: string; className?: string | undefined }): React.JSX.Element {
  const { label, days } = relDay(iso);
  if (label === '') return <span className={cn('text-xs text-[var(--lui-muted)]', className)}>-</span>;
  const text =
    days === 0
      ? 'Today'
      : days === -1
        ? 'Yesterday'
        : days < 0 && days > -15
          ? `${-days}d ago`
          : new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });
  return <span className={cn('whitespace-nowrap text-xs tabular-nums text-[var(--lui-muted)]', className)}>{text}</span>;
}

export function fmtDayHeading(isoDate: string): string {
  const { label, days } = relDay(isoDate);
  if (days === 0 || days === -1) return label;
  return new Date(isoDate.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/* Tiny progress ring (Linear's project donut).                        */
/* ------------------------------------------------------------------ */

export function ProgressRing({
  value,
  size = 16,
  className,
}: {
  /** 0..1 */
  value: number;
  size?: number | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lui-border)" strokeWidth={2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={v >= 1 ? 'rgb(16 185 129)' : 'var(--lui-accent)'}
        strokeWidth={2}
        strokeDasharray={`${c * v} ${c}`}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

export function PageHeader({
  icon: Icon,
  title,
  meta,
  subtitle,
  actions,
}: {
  /** Page identity icon, shown before the title (mirrors the sidebar). */
  icon?: LucideIcon | undefined;
  title: string;
  /** Small muted counter next to the title, e.g. "8". */
  meta?: string | undefined;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {Icon !== undefined && <Icon size={20} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />}
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {meta !== undefined && (
            <span className="text-sm tabular-nums text-[var(--lui-muted)]">{meta}</span>
          )}
        </div>
        {subtitle !== undefined && (
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--lui-muted)]">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  meta,
  actions,
  children,
  className,
  flush = false,
}: {
  title: string;
  meta?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** flush: no inner padding (for row lists that own their padding). */
  flush?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--lui-border)] px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {meta !== undefined && <span className="text-xs tabular-nums text-[var(--lui-muted)]">{meta}</span>}
        </div>
        {actions !== undefined && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      <CardContent className={flush ? 'p-0' : 'p-4'}>{children}</CardContent>
    </Card>
  );
}

/** Slim grouped-list header: label + count (Linear group headers). */
export function GroupHeader({
  label,
  count,
  right,
}: {
  label: string;
  count?: number | undefined;
  right?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between bg-[var(--lui-border)]/25 px-4 py-1.5">
      <span className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">
        {label}
        {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
      </span>
      {right}
    </div>
  );
}

/**
 * The canonical row: one clickable object, identity + content + right-side
 * metadata, actions revealed on hover.
 */
export function ListRow({
  leading,
  primary,
  secondary,
  trailing,
  hoverActions,
  onClick,
  className,
}: {
  leading?: ReactNode | undefined;
  primary: ReactNode;
  secondary?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  hoverActions?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex min-h-11 items-center gap-3 border-b border-[var(--lui-border)]/70 px-4 py-2 transition-colors last:border-0',
        onClick !== undefined && 'cursor-pointer hover:bg-[var(--lui-border)]/20',
        className,
      )}
      onClick={onClick}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      onKeyDown={
        onClick !== undefined
          ? (e) => {
              if (e.key === 'Enter') onClick();
            }
          : undefined
      }
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{primary}</div>
        {secondary !== undefined && (
          <div className="truncate text-xs text-[var(--lui-muted)]">{secondary}</div>
        )}
      </div>
      {trailing !== undefined && (
        <div className="flex shrink-0 items-center gap-3">{trailing}</div>
      )}
      {hoverActions !== undefined && (
        <div
          className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {hoverActions}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile: label, verdict number, delta, optional spark (Stripe).    */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  sub,
  tone,
  spark,
  big = false,
}: {
  label: string;
  value: string;
  /** Small line under the number: delta, goal, hint. */
  sub?: ReactNode | undefined;
  tone?: Tone | undefined;
  spark?: ReactNode | undefined;
  big?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-end justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">{label}</p>
          <p
            className={cn(
              'mt-1 whitespace-nowrap font-semibold tabular-nums tracking-tight',
              big ? 'text-[26px] leading-8' : 'text-lg leading-6',
              tone !== undefined ? TONE_TEXT[tone] : undefined,
            )}
          >
            {value}
          </p>
          {sub !== undefined && <div className="mt-0.5 text-xs text-[var(--lui-muted)]">{sub}</div>}
        </div>
        {spark !== undefined && <div className="shrink-0 pb-1 opacity-80">{spark}</div>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state: icon, headline, two lines, ONE action.                  */
/* ------------------------------------------------------------------ */

export function EmptyHint({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon?: LucideIcon | undefined;
  title: string;
  message: string;
  action?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {Icon !== undefined && (
        <span className="mb-1 flex size-10 items-center justify-center bg-[var(--lui-border)]/30 text-[var(--lui-muted)]">
          <Icon size={18} aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-[var(--lui-muted)]">{message}</p>
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row/card actions: Edit + Delete render as icons (universal glyphs),  */
/* everything else stays labelled text.                                 */
/* ------------------------------------------------------------------ */

/** Compact ghost icon button used for Edit actions on rows/cards. */
export function EditButton({
  onClick,
  label = 'Edit',
  className,
}: {
  onClick: () => void;
  label?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('size-8 shrink-0 p-0 text-[var(--lui-muted)] hover:text-[var(--lui-text)]', className)}
    >
      <Pencil size={15} aria-hidden />
    </Button>
  );
}

/** Compact ghost icon button used for Delete/Remove actions (reddens on hover). */
export function DeleteButton({
  onClick,
  label = 'Delete',
  className,
}: {
  onClick: () => void;
  label?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('size-8 shrink-0 p-0 text-[var(--lui-muted)] hover:text-red-600 dark:hover:text-red-400', className)}
    >
      <Trash2 size={15} aria-hidden />
    </Button>
  );
}

/**
 * Export affordance: a "Download" dropdown offering one or more export
 * formats. Kept identical across pages so "Export" always looks the same.
 */
export function ExportMenu({
  items,
  disabled = false,
}: {
  items: ReadonlyArray<DropdownMenuItem>;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <DropdownMenu
      align="right"
      trigger={
        <Button size="sm" variant="secondary" disabled={disabled}>
          <Download size={14} aria-hidden />
          Export
        </Button>
      }
      items={items}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Empty states that SHOW the structure (skeleton chrome + one CTA).   */
/* The rule: "empty" means no items in the real UI, never a blank void.*/
/* Ghosts are shapes, never fake data, so nothing reads as real.       */
/* ------------------------------------------------------------------ */

const GHOST_W = ['w-40', 'w-52', 'w-32', 'w-44', 'w-36', 'w-48'];

/** N skeleton rows shaped like a ListRow (chip + two lines + trailing pill). */
export function GhostRows({ rows = 4, chip = true }: { rows?: number | undefined; chip?: boolean | undefined }): React.JSX.Element {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-3 border-b border-[var(--lui-border)]/60 px-4 py-2.5 last:border-0">
          {chip && <span className="size-7 shrink-0 rounded-full bg-[var(--lui-border)]/50" />}
          <div className="min-w-0 flex-1">
            <span className={cn('block h-2.5 max-w-[45%] rounded bg-[var(--lui-border)]/60', GHOST_W[i % GHOST_W.length])} />
            <span className="mt-1.5 block h-2 w-24 max-w-[28%] rounded bg-[var(--lui-border)]/35" />
          </div>
          <span className="h-4 w-14 shrink-0 rounded bg-[var(--lui-border)]/35" />
        </div>
      ))}
    </div>
  );
}

/** A grid of skeleton cards for card/grid pages. */
export function GhostCards({
  count = 3,
  columns = 3,
}: {
  count?: number | undefined;
  columns?: 1 | 2 | 3 | undefined;
}): React.JSX.Element {
  const cols = columns === 1 ? '' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div aria-hidden className={cn('grid gap-3', cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-[var(--lui-border)] bg-[var(--lui-surface)] p-4">
          <span className="block h-3 w-1/2 rounded bg-[var(--lui-border)]/60" />
          <span className="mt-2.5 block h-2 w-3/4 rounded bg-[var(--lui-border)]/35" />
          <span className="mt-1.5 block h-2 w-2/3 rounded bg-[var(--lui-border)]/35" />
          <div className="mt-3 flex gap-2">
            <span className="h-4 w-16 rounded bg-[var(--lui-border)]/30" />
            <span className="h-4 w-10 rounded bg-[var(--lui-border)]/30" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Real stage columns (like a kanban) with faint placeholder cards inside. */
export function GhostBoard({ columns }: { columns: string[] }): React.JSX.Element {
  return (
    <div aria-hidden className="flex gap-3 overflow-x-auto pb-1">
      {columns.map((label, ci) => (
        <div key={label} className="flex min-w-44 flex-1 flex-col border border-[var(--lui-border)] bg-[var(--lui-surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--lui-border)] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">{label}</span>
            <span className="size-1.5 rounded-full bg-[var(--lui-border)]/60" />
          </div>
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: ci === 0 ? 2 : 1 }).map((_, i) => (
              <div key={i} className="border border-[var(--lui-border)] bg-[var(--lui-bg)] p-2.5">
                <span className="block h-2.5 w-3/4 rounded bg-[var(--lui-border)]/55" />
                <span className="mt-1.5 block h-2 w-1/2 rounded bg-[var(--lui-border)]/35" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Wrap skeleton chrome; floats one calm CTA card over it so the user sees
 * how the page looks, just without items. Same {icon,title,message,action}
 * contract as EmptyHint — drop-in replacement for a blank empty state.
 */
export function GhostState({
  icon: Icon,
  title,
  message,
  action,
  children,
}: {
  icon?: LucideIcon | undefined;
  title: string;
  message: string;
  action?: ReactNode | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="relative min-h-72">
      <div aria-hidden className="pointer-events-none select-none opacity-70">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[var(--lui-bg)]/10 via-[var(--lui-bg)]/45 to-[var(--lui-bg)]/75 px-4 py-6">
        <div className="flex max-w-sm flex-col items-center gap-2 border border-[var(--lui-border)] bg-[var(--lui-surface)] px-6 py-5 text-center shadow-md">
          {Icon !== undefined && (
            <span className="mb-1 flex size-10 items-center justify-center bg-[var(--lui-border)]/30 text-[var(--lui-muted)]">
              <Icon size={18} aria-hidden />
            </span>
          )}
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[13px] leading-relaxed text-[var(--lui-muted)]">{message}</p>
          {action !== undefined && <div className="mt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/** Two-level disclosure helper: the one and only "advanced" expansion. */
export function Advanced({
  label,
  children,
  open,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-3">
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onToggle}>
        {open ? `Hide ${label.toLowerCase()}` : label}
      </Button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function IconHint({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return <Tooltip content={label}>{children}</Tooltip>;
}
