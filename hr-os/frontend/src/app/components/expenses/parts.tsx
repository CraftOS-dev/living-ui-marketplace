/**
 * Small expenses parts: receipt images fetched with the session (protected
 * files are served by claim-lines.receipt, never by a public URL), the
 * receipt viewer, flags, status dots and the category icon.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BedDouble, BookOpen, Briefcase, Car, CarTaxiFront, ChevronRight, Coffee, Dumbbell, FileText, Fuel, Gift, GraduationCap, Handshake, HeartPulse, ImageOff, Laptop, Package, Paperclip, ParkingMeter, Plane, Printer, Receipt, Smartphone, TrainFront, Utensils, Wifi } from 'lucide-react';
import { getPbClient } from '../../../kit/index.ts';
import { AgentMark, Button, Dialog, Money, Spinner, StatusDot, Tag, Toggle } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { download } from '../../lib/api.ts';
import { t } from '../../lib/i18n.ts';
import type { Advance, Claim, Flag, Line, Trip } from '../../pages/expenses/types.ts';

/* --------------------------------------------------------------- receipts */

const cache = new Map<string, string>();
const order: string[] = [];

async function fetchReceipt(line: string): Promise<string> {
  const pb = getPbClient().pb;
  const url = new URL(pb.buildURL('/api/ops/claim-lines/receipt'));
  url.searchParams.set('line', line);
  const res = await fetch(url.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {} });
  if (!res.ok) throw new Error(String(res.status));
  const link = URL.createObjectURL(await res.blob());
  return link;
}

/** An object URL for a line's receipt (kept for the session; the key changes when the receipt does). */
export function useReceiptUrl(line: string | null, version: string): { url: string | null; failed: boolean } {
  const key = line === null ? '' : `${line}:${version}`;
  const [url, setUrl] = useState<string | null>(() => (key !== '' ? (cache.get(key) ?? null) : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (key === '' || line === null) return;
    const have = cache.get(key);
    if (have !== undefined) {
      setUrl(have);
      return;
    }
    let live = true;
    setFailed(false);
    fetchReceipt(line)
      .then((u) => {
        cache.set(key, u);
        order.push(key);
        while (order.length > 80) {
          const old = order.shift();
          if (old !== undefined) {
            const v = cache.get(old);
            if (v !== undefined) URL.revokeObjectURL(v);
            cache.delete(old);
          }
        }
        if (live) setUrl(u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [key, line]);
  return { url, failed };
}

/** A receipt thumbnail (image), a document mark (PDF) or an empty slot. */
export function ReceiptThumb({ line, size = 40, onOpen }: { line: Line; size?: number | undefined; onOpen?: (() => void) | undefined }): React.JSX.Element {
  const image = line.receipt && line.receipt_kind === 'image';
  const { url, failed } = useReceiptUrl(image ? line.id : null, line.updated);
  const box = 'hr-focus relative flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] text-[var(--hr-muted)]';
  const inner = !line.receipt ? (
    <Receipt size={Math.round(size * 0.42)} strokeWidth={1.7} aria-hidden className="opacity-60" />
  ) : line.receipt_kind === 'pdf' ? (
    <FileText size={Math.round(size * 0.45)} strokeWidth={1.7} aria-hidden />
  ) : failed ? (
    <ImageOff size={Math.round(size * 0.42)} strokeWidth={1.7} aria-hidden />
  ) : url === null ? (
    <Spinner size={12} />
  ) : (
    <img src={url} alt="" className="size-full object-cover" draggable={false} />
  );
  if (!line.receipt || onOpen === undefined)
    return (
      <span className={box} style={{ width: size, height: size }} aria-label={line.receipt ? t('exp.receipt') : t('exp.no_receipt')}>
        {inner}
      </span>
    );
  return (
    <button type="button" onClick={onOpen} className={`${box} hit cursor-pointer hover:border-[var(--hr-ink-2)]`} style={{ width: size, height: size }} aria-label={t('exp.open_receipt')} title={t('exp.open_receipt')}>
      {inner}
    </button>
  );
}

/** The receipt at full size: an image, or a PDF opened in a new tab. */
export function ReceiptView({ line, className }: { line: Line; className?: string | undefined }): React.JSX.Element {
  const image = line.receipt && line.receipt_kind === 'image';
  const { url, failed } = useReceiptUrl(image ? line.id : null, line.updated);
  if (!line.receipt)
    return (
      <div className={`flex min-h-48 flex-col items-center justify-center gap-2 rounded-[var(--hr-radius-sm)] border border-dashed border-[var(--hr-line-2)] text-[12px] text-[var(--hr-muted)] ${className ?? ''}`}>
        <Receipt size={20} strokeWidth={1.7} aria-hidden />
        {t('exp.no_receipt')}
      </div>
    );
  if (line.receipt_kind === 'pdf')
    return (
      <div className={`flex min-h-48 flex-col items-center justify-center gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] ${className ?? ''}`}>
        <FileText size={28} strokeWidth={1.6} aria-hidden className="text-[var(--hr-muted)]" />
        <Button size="sm" onClick={() => void download('claim-lines.receipt', { line: line.id }, 'open', 'receipt.pdf')}>
          {t('exp.open_pdf')}
        </Button>
      </div>
    );
  return (
    <div className={`hr-grid flex min-h-48 items-center justify-center overflow-hidden rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] ${className ?? ''}`}>
      {failed ? <ImageOff size={22} aria-hidden className="text-[var(--hr-muted)]" /> : url === null ? <Spinner /> : <img src={url} alt={t('exp.receipt_of', { what: line.merchant || line.category_name || t('exp.expense') })} className="max-h-[62vh] w-full object-contain" />}
    </div>
  );
}

/** The receipt in a dialog (phones and thumbnails). */
export function ReceiptDialog({ line, onClose }: { line: Line | null; onClose: () => void }): React.JSX.Element | null {
  if (line === null) return null;
  return (
    <Dialog open onClose={onClose} title={line.merchant || line.category_name || t('exp.receipt')} meta={line.day} width={720}>
      <ReceiptView line={line} />
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void download('claim-lines.receipt', { line: line.id }, 'save', 'receipt')}>
          {t('exp.download')}
        </Button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ flags */

export function flagText(f: Flag): string {
  const key = `exp.flag.${f.code}`;
  const text = t(key);
  return text === key ? f.message : text;
}

/** Flags as small tags: red for what blocks, amber for policy, ink for your AI agent's. A wait has its own mark. */
export function Flags({ flags: all, max = 3, className }: { flags: Flag[]; max?: number | undefined; className?: string | undefined }): React.JSX.Element | null {
  const flags = all.filter((f) => f.severity !== 'wait');
  if (flags.length === 0) return null;
  const shown = flags.slice(0, max);
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${className ?? ''}`}>
      {shown.map((f, i) => (
        <Tag key={f.code + i} tone={f.severity === 'blocker' ? 'bad' : f.source === 'agent' ? 'agent' : 'warn'}>
          {flagText(f)}
        </Tag>
      ))}
      {flags.length > max && <Tag tone="faint">+{flags.length - max}</Tag>}
    </span>
  );
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/** One flag as a sentence: words from the catalog, money through Money (Hide pay blanks it). */
function FlagSentence({ f }: { f: Flag }): React.JSX.Element {
  const p = f.params;
  const cur = String(p['currency'] ?? '');
  if (f.code === 'over_limit')
    return (
      <>
        {t('exp.fs.over_limit')} <Money minor={num(p['limit_minor'])} currency={cur} />
      </>
    );
  if (f.code === 'over_day_limit')
    return (
      <>
        <Money minor={num(p['total_minor'])} currency={cur} /> {t('exp.fs.over_day_limit')} <Money minor={num(p['limit_minor'])} currency={cur} />
      </>
    );
  if (f.code === 'missing_receipt')
    return num(p['over_minor']) > 0 ? (
      <>
        {t('exp.fs.receipt_from')} <Money minor={num(p['over_minor'])} currency={cur} />
      </>
    ) : (
      <>{t('exp.fs.receipt_always')}</>
    );
  if (f.code === 'duplicate') return <>{t('exp.fs.duplicate', { n: String(p['claim_number'] ?? '') })}</>;
  if (f.code === 'old') return <>{t('exp.fs.old', { n: num(p['days']) })}</>;
  if (f.code === 'no_rate') return <>{t('exp.fs.no_rate', { from: String(p['from'] ?? ''), to: String(p['to'] ?? '') })}</>;
  const key = `exp.fs.${f.code}`;
  const text = t(key);
  return <>{text === key ? flagText(f) : text}</>;
}

/** Flags as sentences (detail panes); your AI agent's note follows its flag. */
export function FlagList({ flags: all }: { flags: Flag[] }): React.JSX.Element | null {
  const flags = all.filter((f) => f.severity !== 'wait');
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {flags.map((f, i) => (
        <li key={f.code + i} className="flex items-start gap-2 text-[13px] leading-[18px]">
          <span aria-hidden className={`mt-[6px] size-1.5 shrink-0 rounded-full ${f.severity === 'blocker' ? 'bg-[var(--hr-bad)]' : f.source === 'agent' ? 'bg-[var(--hr-agent)]' : 'bg-[var(--hr-warn)]'}`} />
          <span className="hr-wrap min-w-0 flex-1">
            <FlagSentence f={f} />
            {typeof f.params['note'] === 'string' && f.params['note'] !== '' && <span className="text-[var(--hr-muted)]"> ({String(f.params['note'])})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Your AI agent at work on a receipt, quietly: its mark and a word (no coloured tag). */
export function ReadingMark({ l }: { l: Line }): React.JSX.Element | null {
  const state = readingState(l);
  if (state !== 'reading' && state !== 'suggested') return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
      <AgentMark size={14} working={state === 'reading' ? true : undefined} />
      {state === 'reading' ? t('exp.reading.short') : t('exp.reading.check')}
    </span>
  );
}

/* ----------------------------------------------------------------- status */

const CLAIM_TONE: Record<string, Tone> = { draft: 'faint', submitted: 'warn', approved: 'rh', rejected: 'bad', paid: 'good', cancelled: 'faint' };
const ADV_TONE: Record<string, Tone> = { requested: 'warn', approved: 'rh', paid: 'lh', settled: 'good', rejected: 'bad', cancelled: 'faint' };
const TRIP_TONE: Record<string, Tone> = { draft: 'faint', requested: 'warn', approved: 'good', rejected: 'bad', cancelled: 'faint' };

export function ClaimStatus({ c }: { c: Pick<Claim, 'status' | 'paid_via'> }): React.JSX.Element {
  return <StatusDot tone={CLAIM_TONE[c.status] ?? 'neutral'} label={t(`exp.status.${c.status}`)} />;
}

export function AdvanceStatus({ a }: { a: Pick<Advance, 'status'> }): React.JSX.Element {
  return <StatusDot tone={ADV_TONE[a.status] ?? 'neutral'} label={t(`exp.adv.status.${a.status}`)} />;
}

export function TripStatus({ trip }: { trip: Pick<Trip, 'status'> }): React.JSX.Element {
  return <StatusDot tone={TRIP_TONE[trip.status] ?? 'neutral'} label={t(`exp.trip.status.${trip.status}`)} />;
}

/** The lucide icons a category may use, by the name it stores. */
const ICONS: Record<string, LucideIcon> = { Utensils, Coffee, Plane, TrainFront, CarTaxiFront, BedDouble, Car, Fuel, ParkingMeter, Smartphone, Wifi, GraduationCap, BookOpen, Paperclip, Printer, Package, Handshake, Gift, Laptop, HeartPulse, Dumbbell, Briefcase, Receipt };

/** A category's icon (Receipt when the name is not one of the curated icons). */
export function categoryIcon(name: string): LucideIcon {
  return ICONS[name] ?? Receipt;
}

export function CategoryIcon({ name, size = 15, className }: { name: string; size?: number | undefined; className?: string | undefined }): React.JSX.Element {
  const Icon = categoryIcon(name);
  return <Icon size={size} strokeWidth={1.8} aria-hidden className={className} />;
}

/** Where a line stands with your AI agent's reading. */
export function readingState(l: Line): 'none' | 'reading' | 'suggested' | 'filled' | 'failed' {
  if (l.receipt_status === 'waiting' || l.receipt_status === 'reading') return 'reading';
  const s = l.agent_read?.state;
  if (s === 'proposed') return 'suggested';
  if (s === 'applied') return 'filled';
  if (s === 'failed') return 'failed';
  return 'none';
}

/** Whether a line has a reading of your AI agent to show: it is reading, it suggested or filled the line, it failed, or the person used it. A line the person typed in shows none. */
export function shownReading(l: Line): boolean {
  const s = l.agent_read?.state;
  return readingState(l) !== 'none' || s === 'accepted' || s === 'late';
}

/** A claim in a list: its number, then its title when it has one. */
export function ClaimName({ c }: { c: Pick<Claim, 'number' | 'title'> }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{c.number}</span>
      {c.title !== '' && <span className="truncate">{c.title}</span>}
    </span>
  );
}

/** The link on a panel's label line, in the one style every module uses: mono caps, no underline, ink on hover, a 40 px touch area. */
export function AsideLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} className="hr-focus hr-label hit inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">
      {children}
      <ChevronRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

/** The icon names for the settings picker. */
export const CATEGORY_ICONS = Object.keys(ICONS);

/** What a line is called in lists: the merchant, the distance, your AI agent's suggestion, or the category. */
export function lineTitle(l: Line): string {
  if (l.kind === 'mileage') return t('exp.line.mileage', { n: String(l.distance), unit: t(`exp.unit.${l.unit}`) });
  if (l.merchant !== '') return l.merchant;
  const r = l.agent_read;
  if (r !== null && r.state === 'proposed' && r.merchant !== undefined && r.merchant !== '') return r.merchant;
  if (l.category_name !== '') return l.category_name;
  return readingState(l) === 'reading' ? t('exp.line.being_read') : t('exp.line.unread');
}

/** A line's amount, or your AI agent's suggested amount (muted) while the person has not used it. */
export function LineAmount({ l, currency, className }: { l: Line; currency: string; className?: string | undefined }): React.JSX.Element | null {
  const r = l.agent_read;
  if (l.base_minor <= 0 && r !== null && r.state === 'proposed' && (r.amount_minor ?? 0) > 0 && r.currency !== undefined)
    return (
      <span className={`text-[var(--hr-muted)] ${className ?? ''}`} title={t('exp.reading.suggested')}>
        <Money minor={r.amount_minor ?? 0} currency={r.currency} />
      </span>
    );
  if (l.base_minor <= 0 && l.kind !== 'mileage') return <span className={`hr-mono text-[var(--hr-faint)] ${className ?? ''}`}>{t('exp.line.no_amount')}</span>;
  return <Money minor={l.base_minor} currency={currency} className={className} />;
}

/** A trip's name: where it goes (or what for). */
export function tripName(x: { destinations: { city: string }[]; purpose: string }): string {
  const where = x.destinations.map((d) => d.city).filter((c) => c !== '').join(', ');
  return where !== '' ? where : t(`exp.purpose.${x.purpose}`);
}
/** An advance's amount, and what is left to settle once it is paid out. */
export function AdvanceAmount({ a }: { a: Pick<Advance, 'status' | 'amount_minor' | 'balance_minor' | 'currency'> }): React.JSX.Element {
  if (a.status === 'paid')
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <Money minor={a.balance_minor} currency={a.currency} />
        <span className="text-[12px] text-[var(--hr-muted)]">{t('exp.adv.left_short')}</span>
      </span>
    );
  return <Money minor={a.amount_minor} currency={a.currency} />;
}

/** A switch with its words beside it; the words toggle it too. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <label className={`inline-flex items-center gap-2 text-[13px] text-[var(--hr-ink-2)] ${disabled === true ? '' : 'cursor-pointer'}`}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

/** Totals per currency in one line ("INR 8,268.00 · SGD 4,494.40"), each one a Money figure. */
export function Totals({ list }: { list: { currency: string; amount_minor: number }[] }): React.JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {list.map((x, i) => (
        <span key={x.currency} className="inline-flex items-baseline gap-1.5">
          {i > 0 && <span aria-hidden className="text-[var(--hr-faint)]">·</span>}
          <Money minor={x.amount_minor} currency={x.currency} />
        </span>
      ))}
    </span>
  );
}

/** A page's actions on a phone: one row at the top of the body, 40 px tall (the header keeps only the title). */
export function PhoneActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-3 flex flex-wrap items-center gap-2 empty:hidden md:hidden [&>*]:min-h-10 [&>*]:flex-1">{children}</div>;
}
