/**
 * Building blocks shared by the Settings tabs, People and companies,
 * Guidelines and the external portal: setting groups, read-only notes, a
 * whole-number chips editor, a translated confirm dialog, HTML sanitizing
 * for guideline previews, an image chooser for multipart ops, and the
 * label tables for roles, party roles and collections.
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ImagePlus, Lock, Plus, X } from 'lucide-react';
import { Button, Dialog, Input, cn, toast } from '../../kit/index.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { fmtDate, fmtDateTime } from '../lib/format.ts';
import type { ModuleKey, Profile, Role } from '../lib/shapes.ts';
import { Notice } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** One line explaining why controls are read-only. */
export function ReadOnlyNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Notice tone="neutral" icon={Lock}>
      {children}
    </Notice>
  );
}

/** Heading + body block used inside settings sections. */
export function SettingGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <div className={cn('grid gap-4 border-b border-[var(--agent-app-border)] py-5 first:pt-0 last:border-0 last:pb-0 md:grid-cols-[200px_minmax(0,1fr)]', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description !== undefined && <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

/** Scrolling body for long dialog forms. */
export function DialogBody({ children, className }: { children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return <div className={cn('flex max-h-[68vh] min-w-0 flex-col gap-4 overflow-y-auto pr-1', className)}>{children}</div>;
}

/** Small uppercase heading inside drawers and dialogs. */
export function SubHeading({ children, right }: { children: ReactNode; right?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h4>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** Parse a number input; '' becomes 0. */
export function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Editable list of whole numbers shown as chips (reminder days). */
export function NumberChips({
  value,
  onChange,
  disabled = false,
  suffix,
  max = 3650,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean | undefined;
  suffix?: string | undefined;
  max?: number | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n <= 0 || n > max) {
      toast.error(t('Enter a whole number from 1 to {max}.', { max }));
      return;
    }
    if (!value.includes(n)) onChange([...value, n].sort((a, b) => b - a));
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-[var(--agent-app-muted)]">{t('None')}</span>}
        {value.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs tabular-nums">
            {n}
            {suffix !== undefined && <span className="text-[var(--agent-app-muted)]">{suffix}</span>}
            {!disabled && (
              <button type="button" aria-label={t('Remove')} className="text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => onChange(value.filter((x) => x !== n))}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex max-w-xs items-center gap-2">
          <Input
            type="number"
            min={1}
            max={max}
            value={draft}
            aria-label={t('Add a number')}
            placeholder={t('For example 45')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={add} disabled={draft.trim() === ''}>
            <Plus size={13} aria-hidden /> {t('Add')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Choose images to send with a multipart op (nothing is uploaded until the op runs). */
export function ImagesField({
  files,
  onChange,
  label,
  help,
  max = 10,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string | undefined;
  help?: string | undefined;
  max?: number | undefined;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label ?? t('Images')}</span>
      {files.length > 0 && (
        <ul className="flex flex-col border border-[var(--agent-app-border)]">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-2 border-b border-[var(--agent-app-border)]/70 px-2 py-1 text-xs last:border-0">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 tabular-nums text-[var(--agent-app-muted)]">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              <button type="button" aria-label={t('Remove')} className="shrink-0 text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()}>
            <ImagePlus size={13} aria-hidden /> {t('Choose images')}
          </Button>
        </div>
      )}
      {help !== undefined && <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</p>}
      <input
        ref={ref}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length) onChange([...files, ...list].slice(0, max));
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm (translated)                                                */
/* ------------------------------------------------------------------ */

interface AskState {
  message: string;
  title: string;
  confirmLabel: string;
  danger: boolean;
}

/** `const [el, ask] = useAsk()`; `await ask(message, title, { confirmLabel, danger })`. */
export function useAsk(): [ReactNode, (message: string, title: string, opts?: { confirmLabel?: string | undefined; danger?: boolean | undefined }) => Promise<boolean>] {
  const [state, setState] = useState<AskState | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback(
    (message: string, title: string, opts?: { confirmLabel?: string | undefined; danger?: boolean | undefined }): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState({ message, title, confirmLabel: opts?.confirmLabel ?? t('Confirm'), danger: opts?.danger ?? true });
      }),
    [],
  );
  const settle = (ok: boolean): void => {
    resolver.current?.(ok);
    resolver.current = null;
    setState(null);
  };
  const el =
    state === null ? null : (
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v) settle(false);
        }}
        title={state.title}
        className="w-[min(94vw,28rem)]"
        footer={
          <>
            <Button variant="outline" onClick={() => settle(false)}>
              {t('Cancel')}
            </Button>
            <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {state.confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--agent-app-muted)]">{state.message}</p>
      </Dialog>
    );
  return [el, ask];
}

/* ------------------------------------------------------------------ */
/* HTML preview (guidelines): sanitized before innerHTML               */
/* ------------------------------------------------------------------ */

const DROP_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset', 'noscript', 'template'];
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background'];

/** Parse with DOMParser, drop dangerous elements, on* handlers and javascript: URLs. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const tag of DROP_TAGS) for (const el of Array.from(doc.body.querySelectorAll(tag))) el.remove();
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\u0000- ]/g, '').toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (name === 'style' && /expression|url\s*\(/i.test(attr.value)) el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && (value.startsWith('javascript:') || value.startsWith('vbscript:') || (value.startsWith('data:') && !value.startsWith('data:image/')))) el.removeAttribute(attr.name);
    }
    if (el.tagName.toLowerCase() === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  }
  return doc.body.innerHTML;
}

/** Rendered, sanitized HTML (guideline bodies). */
export function HtmlPreview({ html, className }: { html: string; className?: string | undefined }): React.JSX.Element {
  const clean = sanitizeHtml(html);
  if (clean.trim() === '') return <p className={cn('text-[13px] text-[var(--agent-app-muted)]', className)}>{t('Nothing to show yet.')}</p>;
  return (
    <div
      className={cn(
        'ipm-html min-w-0 break-words text-[13px] leading-relaxed [&_a]:text-[var(--agent-app-accent)] [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-[var(--agent-app-border)] [&_td]:px-2 [&_th]:border [&_th]:border-[var(--agent-app-border)] [&_th]:px-2 [&_ul]:list-disc [&_img]:max-w-full',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** Modules each business profile switches on (mirrors the onboarding op). */
export const PROFILE_MODULES: Record<Profile, ModuleKey[]> = {
  anime: ['titles', 'committees', 'franchises', 'music', 'products', 'royalties', 'approvals'],
  talent: ['talents', 'permissions', 'guidelines', 'music', 'products', 'royalties', 'approvals'],
  character: ['franchises', 'guidelines', 'products', 'royalties', 'approvals', 'music'],
};

export const INTERNAL_ROLES: readonly Role[] = ['admin', 'manager', 'rights', 'licensing', 'talent_manager', 'contributor', 'viewer'];
export const EXTERNAL_ROLE_LIST: readonly Role[] = ['licensee', 'committee_member', 'reviewer'];

export function roleLabel(r: string): string {
  return enumLabel('users.role', r);
}

/** The fixed roles a person or company can play. */
export const PARTY_ROLES = [
  'licensor',
  'licensee',
  'committee_member',
  'publisher',
  'label',
  'studio',
  'agency',
  'creator',
  'illustrator',
  'modeler',
  'composer',
  'lyricist',
  'voice_actor',
  'performer',
  'counsel',
  'distributor',
  'platform',
  'other',
] as const;

export function partyRoleLabel(k: string): string {
  const map: Record<string, string> = {
    licensor: t('Licensor'),
    licensee: t('Licensee'),
    committee_member: t('Committee member'),
    publisher: t('Publisher'),
    label: t('Label'),
    studio: t('Studio|party role'),
    agency: t('Agency'),
    creator: t('Creator'),
    illustrator: t('Illustrator'),
    modeler: t('Modeler'),
    composer: t('Composer'),
    lyricist: t('Lyricist'),
    voice_actor: t('Voice actor'),
    performer: t('Performer'),
    counsel: t('Counsel'),
    distributor: t('Distributor'),
    platform: t('Platform'),
    other: t('Other'),
  };
  return map[k] ?? k;
}

/** Record type of an audit entry, in words. */
export function collectionLabel(c: string): string {
  const map: Record<string, string> = {
    matters: t('Trademark or design'),
    families: t('Mark family'),
    franchises: t('Franchise'),
    titles: t('Title'),
    characters: t('Character'),
    character_assets: t('Character asset'),
    talents: t('Talent'),
    castings: t('Casting'),
    committees: t('Committee'),
    committee_members: t('Committee member'),
    agreements: t('Agreement'),
    grants: t('Rights grant'),
    goods_services: t('Goods and services'),
    deadlines: t('Deadline'),
    renewals: t('Renewal'),
    documents: t('Document'),
    parties: t('Person or company'),
    involvements: t('Involvement'),
    clearances: t('Clearance'),
    products: t('Product'),
    approvals: t('Approval'),
    seal_orders: t('Seal order'),
    royalty_reports: t('Royalty statement'),
    royalty_lines: t('Statement line'),
    songs: t('Song'),
    recordings: t('Recording'),
    releases: t('Release'),
    society_contracts: t('Society contract'),
    society_registrations: t('Society registration'),
    content_id_assets: t('Content ID asset'),
    content_id_claims: t('Content ID claim'),
    permissions: t('Third-party permission'),
    guidelines: t('Guideline'),
    fan_registrations: t('Fan permit'),
    enforcement_cases: t('Enforcement case'),
    evidence: t('Evidence'),
    platform_enrollments: t('Platform enrollment'),
    customs_recordations: t('Customs recordation'),
    watch_hits: t('Watch hit'),
    rules: t('Deadline rule'),
    settings: t('Organization settings'),
    users: t('User'),
    fee_schedule: t('Fee'),
    fx_rates: t('Exchange rate'),
    office_calendars: t('Closure day'),
    dimension_values: t('Dimension value'),
    events: t('Event'),
    inbox_items: t('Inbox item'),
    office_connections: t('Office connection'),
    consent_requests: t('Consent request'),
    distributions: t('Distribution statement'),
  };
  return map[c] ?? c;
}

const PB_DAY = /^\d{4}-\d{2}-\d{2} 00:00:00(\.000)?Z$/;
const PB_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

/** Human text for any stored value (audit changes, snapshots). */
export function fmtAny(v: unknown): string {
  if (v === null || v === undefined || v === '') return t('empty');
  if (typeof v === 'boolean') return v ? t('Yes') : t('No');
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string') {
    if (PB_DAY.test(v)) return fmtDate(v);
    if (PB_TIME.test(v)) return fmtDateTime(v);
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return t('empty');
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

/** Hours of the day as select options. */
export function hourOptions(): { value: string; label: string }[] {
  return Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));
}

/** A one-line description of a rule's offset ("3 years 2 months", "30 business days"). */
export function offsetText(y: number, m: number, d: number, business: boolean): string {
  const parts: string[] = [];
  if (y !== 0) parts.push(t('{n} y', { n: y }));
  if (m !== 0) parts.push(t('{n} mo', { n: m }));
  if (d !== 0) parts.push(business ? t('{n} business days', { n: d }) : t('{n} d', { n: d }));
  return parts.length ? parts.join(' ') : t('Same day');
}
