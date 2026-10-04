/**
 * Shared pieces for the matter, family and portfolio screens: small label
 * tables the foundation does not carry, date and class inputs, the priority
 * claims editor, and the family member chip.
 */
import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, cn } from '../../kit/index.ts';
import { d10 } from '../lib/format.ts';
import { RELATION_LABEL, ROUTE_LABEL, STATUS_LABEL, statusTone } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { FamilyRec, GoodsServicesRec, IpType, MatterRec, PriorityClaim } from '../lib/types.ts';
import { JurisdictionSelect } from './pickers.tsx';
import { Dot, Field, JurChip, Ref } from './ui.tsx';

export type PortfolioType = 'patent' | 'trademark' | 'design' | 'copyright';
export type FamilyKind = FamilyRec['kind'];

export const FAMILY_KIND_LABEL: Record<FamilyKind, string> = {
  patent: 'Patent family',
  design: 'Design family',
  trademark: 'Mark',
};

/** Which family kind groups a right of this type (null: no families). */
export function familyKindOf(t: IpType): FamilyKind | null {
  if (t === 'patent' || t === 'utility_model') return 'patent';
  if (t === 'design') return 'design';
  if (t === 'trademark') return 'trademark';
  return null;
}

export function portfolioPageOf(t: IpType): Page {
  if (t === 'trademark' || t === 'domain') return 'trademarks';
  if (t === 'design') return 'designs';
  if (t === 'copyright') return 'copyrights';
  return 'patents';
}

/** The event that records the registration date for this type of right. */
export function registrationCode(t: IpType): 'GRANTED' | 'REGISTERED' {
  return t === 'patent' || t === 'utility_model' ? 'GRANTED' : 'REGISTERED';
}

export function isPatentLike(t: IpType): boolean {
  return t === 'patent' || t === 'utility_model';
}

/** Office numbers compared without punctuation or spaces (same as the server). */
export function normNum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Route used by default for a new filing at this office. */
export function defaultRoute(t: IpType, jurisdiction: string): string {
  const j = jurisdiction.toUpperCase();
  if (j === 'WO') return t === 'trademark' ? 'madrid' : t === 'design' ? 'hague' : 'pct';
  if (j === 'EP') return 'ep';
  if (j === 'EM' || j === 'BX' || j === 'OA' || j === 'AP' || j === 'EA' || j === 'GC') return 'regional';
  return 'national';
}

export const TM_BASIS_LABEL: Record<string, string> = {
  '1a': '1(a) use in commerce',
  '1b': '1(b) intent to use',
  '44d': '44(d) foreign application',
  '44e': '44(e) foreign registration',
  '66a': '66(a) Madrid extension',
};

export const TM_REGISTER_LABEL: Record<string, string> = {
  principal: 'Principal Register',
  supplemental: 'Supplemental Register',
  na: 'Not applicable',
};

export const ENTITY_SIZE_LABEL: Record<string, string> = {
  large: 'Large entity',
  small: 'Small entity',
  micro: 'Micro entity',
  na: 'Not applicable',
};

export const CLASS_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  registered: 'Registered',
  refused: 'Refused',
  partially_refused: 'Partly refused',
  deleted: 'Deleted',
  cancelled: 'Cancelled',
};

export const CLASS_STATUS_TONE: Record<string, Tone> = {
  pending: 'info',
  registered: 'good',
  refused: 'bad',
  partially_refused: 'warn',
  deleted: 'neutral',
  cancelled: 'neutral',
};

export const STRATEGY_LABEL: Record<string, string> = {
  maintain: 'Maintain',
  review: 'Review',
  prune: 'Prune',
  abandoned: 'Abandoned',
};

export const STRATEGY_TONE: Record<string, Tone> = {
  maintain: 'good',
  review: 'warn',
  prune: 'bad',
  abandoned: 'neutral',
};

export const INVOLVEMENT_ROLE_LABEL: Record<string, string> = {
  inventor: 'Inventor',
  author: 'Author',
  applicant: 'Applicant',
  owner: 'Owner',
  assignee: 'Assignee',
  licensee: 'Licensee',
  licensor: 'Licensor',
  counsel: 'Counsel',
  agent: 'Agent',
  talent: 'Talent',
  contributor: 'Contributor',
  claimant: 'Claimant',
  other: 'Other',
};

export const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  negotiating: 'Negotiating',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
  renewed: 'Renewed',
  superseded: 'Superseded',
};

export const RENEWAL_DECISION_TONE: Record<string, Tone> = {
  pending: 'warn',
  renew: 'good',
  renew_partial: 'good',
  lapse: 'bad',
  defer: 'neutral',
};

/** Short headings of the Nice Classification (12th edition). */
export const NICE_HEADING: Record<number, string> = {
  1: 'Chemicals',
  2: 'Paints and coatings',
  3: 'Cosmetics and cleaning preparations',
  4: 'Industrial oils and fuels',
  5: 'Pharmaceuticals',
  6: 'Common metals',
  7: 'Machines and motors',
  8: 'Hand tools',
  9: 'Scientific and electronic apparatus, software',
  10: 'Medical apparatus',
  11: 'Lighting, heating and cooling apparatus',
  12: 'Vehicles',
  13: 'Firearms and fireworks',
  14: 'Jewellery and watches',
  15: 'Musical instruments',
  16: 'Paper goods and printed matter',
  17: 'Rubber, plastics and insulation',
  18: 'Leather goods and bags',
  19: 'Non-metallic building materials',
  20: 'Furniture',
  21: 'Household utensils and glassware',
  22: 'Ropes, tents and sacks',
  23: 'Yarns and threads',
  24: 'Textiles',
  25: 'Clothing, footwear and headwear',
  26: 'Lace, buttons and haberdashery',
  27: 'Carpets and wall hangings',
  28: 'Games, toys and sporting goods',
  29: 'Meat, dairy and preserved foods',
  30: 'Coffee, bakery and confectionery',
  31: 'Agricultural products and live animals',
  32: 'Beers and non-alcoholic beverages',
  33: 'Alcoholic beverages (except beers)',
  34: "Tobacco and smokers' articles",
  35: 'Advertising and business services',
  36: 'Financial, insurance and real estate services',
  37: 'Construction and repair',
  38: 'Telecommunications',
  39: 'Transport and travel',
  40: 'Treatment of materials',
  41: 'Education and entertainment',
  42: 'Scientific and technology services, software',
  43: 'Food and drink services, accommodation',
  44: 'Medical, beauty and agricultural services',
  45: 'Legal and security services',
};

export const NICE_CLASSES: number[] = Array.from({ length: 45 }, (_, i) => i + 1);

export function toOptions(rec: Record<string, string>): { value: string; label: string }[] {
  return Object.entries(rec).map(([value, label]) => ({ value, label }));
}

/** "PCT · National phase" style description of how a right was filed. */
export function routeText(m: Pick<MatterRec, 'route' | 'relation'>): string {
  const parts: string[] = [];
  if (m.route !== '') parts.push(ROUTE_LABEL[m.route] ?? m.route);
  if (m.relation !== '' && m.relation !== 'none') parts.push(RELATION_LABEL[m.relation] ?? m.relation);
  return parts.join(' · ');
}

/** Distinct Nice classes of a set of goods and services rows, sorted. */
export function classesOf(rows: GoodsServicesRec[]): number[] {
  return [...new Set(rows.map((g) => g.nice_class).filter((n) => n > 0))].sort((a, b) => a - b);
}

/** Plain text of a rich-text (editor) field. */
export function htmlToText(html: string): string {
  if (html === '') return '';
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '</p>\n'), 'text/html');
  return (doc.body.textContent ?? '').trim();
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export const DATE_INPUT_CLASS =
  'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm disabled:opacity-60';

export function DateField({
  label,
  value,
  onChange,
  help,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} required={required} htmlFor={id}>
      <input id={id} type="date" className={DATE_INPUT_CLASS} value={d10(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Nice classes 1 to 45 as toggle chips. */
export function NiceClassChips({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-9 gap-1 sm:grid-cols-15">
      {NICE_CLASSES.map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            title={`Class ${n}: ${NICE_HEADING[n] ?? ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => a - b))}
            className={cn(
              'h-7 border font-mono text-xs tabular-nums transition-colors',
              on
                ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 font-semibold text-[var(--agent-app-accent)]'
                : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/75 hover:bg-[var(--agent-app-border)]/30',
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** Priority claims: country, application number and date per row. */
export function PriorityClaimsEditor({
  value,
  onChange,
  preferred,
}: {
  value: PriorityClaim[];
  onChange: (v: PriorityClaim[]) => void;
  preferred?: string[] | undefined;
}): React.JSX.Element {
  const set = (i: number, patch: Partial<PriorityClaim>): void => {
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="hidden grid-cols-[10rem_minmax(0,1fr)_10rem_2rem] gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)] sm:grid">
          <span>Country</span>
          <span>Application number</span>
          <span>Date</span>
          <span />
        </div>
      )}
      {value.map((p, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 border border-[var(--agent-app-border)] p-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_2rem] sm:border-0 sm:p-0">
          <JurisdictionSelect value={p.country} onChange={(v) => set(i, { country: v })} preferred={preferred} placeholder="Country" />
          <input
            aria-label="Priority application number"
            className="h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 font-mono text-sm"
            value={p.number}
            placeholder="Application number"
            onChange={(e) => set(i, { number: e.target.value })}
          />
          <input
            aria-label="Priority date"
            type="date"
            className={DATE_INPUT_CLASS}
            value={d10(p.date)}
            onChange={(e) => set(i, { date: e.target.value })}
          />
          <button
            type="button"
            aria-label="Remove priority claim"
            className="flex h-9 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={() => onChange([...value, { country: '', number: '', date: '' }])}>
          <Plus size={13} aria-hidden /> Add priority claim
        </Button>
      </div>
    </div>
  );
}

/** Clean priority claims before saving: complete rows only, dates as days. */
export function cleanClaims(claims: PriorityClaim[]): PriorityClaim[] {
  return claims
    .map((p) => ({ country: p.country.toUpperCase(), number: p.number.trim(), date: d10(p.date) }))
    .filter((p) => p.country !== '' || p.number !== '' || p.date !== '');
}

/* ------------------------------------------------------------------ */
/* Family member chip                                                  */
/* ------------------------------------------------------------------ */

export function MatterChip({
  m,
  current = false,
  showRef = true,
}: {
  m: Pick<MatterRec, 'id' | 'ref' | 'jurisdiction' | 'status' | 'status_group'>;
  current?: boolean | undefined;
  showRef?: boolean | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate('matter', m.id);
      }}
      title={`${m.ref}: ${STATUS_LABEL[m.status]}`}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-xs transition-colors',
        current
          ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10'
          : 'border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] hover:bg-[var(--agent-app-border)]/30',
      )}
    >
      <JurChip code={m.jurisdiction} className="h-4 min-w-[22px] border-0 bg-transparent px-0" />
      <Dot tone={statusTone(m.status, m.status_group)} />
      {showRef && <Ref dead={m.status_group === 'dead'} className="text-[11px]">{m.ref}</Ref>}
    </button>
  );
}
