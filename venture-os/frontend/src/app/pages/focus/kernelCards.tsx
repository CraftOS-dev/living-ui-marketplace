/**
 * The kernel's own Next cards and their pages (kernel-core's lib_proposals
 * and lib_outbound send `card: 'proposal'` and `card: 'draft'` with these
 * `data` shapes and hrefs `#/next/proposal/<id>`, `#/next/draft/<id>`):
 *
 *   proposal: data { proposal, why, evidence (a quote, or { quote, file, page, url }), items }
 *   draft:    data { outbound, kind, to: [], subject, body, error, edit? }
 *
 * In Focus the card body shows what changes (before and after, loaded with
 * proposals.get), why, and the quote; a draft shows its recipients and any
 * send error (the body is the generic card's). The pages are one click
 * deeper: every item of a proposal, a draft in full to correct and send.
 */
import { AgentTag, Citation, Notice, Skeleton, Tag } from '../../components/ui.tsx';
import type { CardProps } from '../../lib/contract.ts';
import type { SourceRef } from '../../lib/source.ts';
import { useOp } from '../../lib/live.ts';

/* ------------------------------------------------------------- shapes */

export type Evidence = string | { quote?: string | undefined; file?: string | undefined; page?: number | undefined; url?: string | undefined; anchor?: string | undefined; message?: string | undefined } | null;

/** One change of a proposal as kernel-core sends it: the field label and both sides formatted for people. */
export interface ProposalField {
  name: string;
  label: string;
  before: string;
  after: string;
}

export interface ProposalView {
  id: string;
  kind: string;
  /** Plain words for the kind ("Deal update", "Merge", "From a meeting note"). */
  kind_label: string;
  /** The record's display id (D-0012) when it has one. */
  ref: string;
  title: string;
  why: string;
  evidence: Evidence;
  confidence: number | null;
  status: string;
  items: { index: number; op: string; label: string; fields: ProposalField[]; notes: string[]; state: string; error: string }[];
}

export interface OutboundView {
  id: string;
  kind: string;
  to: string[];
  subject: string;
  body: string;
  status: string;
  error?: string | undefined;
}

function quoteOf(e: Evidence): { text: string; label: string; href?: string | undefined; source?: SourceRef | undefined } | null {
  if (e === null || e === undefined) return null;
  if (typeof e === 'string') return e.trim() === '' ? null : { text: e, label: 'Source' };
  const text = e.quote ?? '';
  if (text === '') return null;
  const label = e.page !== undefined ? `p.${e.page}` : e.file !== undefined && e.file !== '' ? 'File' : e.url !== undefined && e.url !== '' ? 'Link' : 'Source';
  const source = e.file !== undefined && e.file !== '' ? { file: e.file, page: e.page, anchor: e.anchor, quote: text } : undefined;
  return { text, label, href: e.url !== undefined && e.url !== '' ? e.url : undefined, source };
}

export function Quote({ e }: { e: Evidence }): React.JSX.Element | null {
  const q = quoteOf(e);
  if (q === null) return null;
  return (
    <blockquote className="vo-wrap flex items-start gap-2 border-l-2 border-[var(--vo-line-2)] pl-3 text-[13px] leading-5 text-[var(--vo-ink-2)]">
      <span className="min-w-0 flex-1">{q.text}</span>
      <Citation label={q.label} quote={q.text} href={q.href} source={q.source} />
    </blockquote>
  );
}

/** "Field label: before -> after" lines of one change. */
export function Lines({ fields }: { fields: ProposalField[] }): React.JSX.Element | null {
  if (fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 rounded-[var(--vo-radius-sm)] bg-[var(--vo-sunk)] px-4 py-3 text-[13px]">
      {fields.map((f) => (
        <div key={f.name} className="contents">
          <dt className="text-[var(--vo-muted)]">{f.label}</dt>
          <dd className="vo-wrap min-w-0">
            {f.before !== '' && (
              <>
                <span className="text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)]">{f.before}</span>
                <span aria-hidden className="mx-1.5 text-[var(--vo-muted)]">
                  {'→'}
                </span>
              </>
            )}
            <span className="font-medium">{f.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------- cards */

/** Focus body of a proposal: what changes, why, the quote. */
export function ProposalCard({ item }: CardProps): React.JSX.Element {
  const id = typeof item.data?.['proposal'] === 'string' ? (item.data['proposal'] as string) : '';
  const live = useOp<{ proposal: ProposalView }>('proposals.get', { proposal: id }, ['proposals'], { name: 'next.proposal', skip: id === '' });
  const p = live.data?.proposal ?? null;
  const first = p?.items.find((i) => i.state === 'pending') ?? p?.items[0];
  const why = typeof item.data?.['why'] === 'string' ? (item.data['why'] as string) : '';
  return (
    <div className="flex flex-col gap-3">
      {first !== undefined ? <Lines fields={first.fields} /> : live.data === null && id !== '' ? <Skeleton className="h-16 w-full" /> : null}
      {p !== null && p.items.length > 1 && <span className="text-[12px] text-[var(--vo-muted)]">{`${p.items.length} changes`}</span>}
      {why !== '' && (
        <p className="vo-wrap flex items-start gap-2 text-[13px] leading-5 text-[var(--vo-ink-2)]">
          <AgentTag className="mt-0.5" />
          <span className="min-w-0">{why}</span>
        </p>
      )}
      <Quote e={(item.data?.['evidence'] as Evidence | undefined) ?? null} />
    </div>
  );
}

/** Focus body of a draft: its recipients as chips and a failed send's reason (the text is the generic card's body). */
export function DraftCard({ item }: CardProps): React.JSX.Element | null {
  const to = Array.isArray(item.data?.['to']) ? (item.data['to'] as string[]) : [];
  const error = typeof item.data?.['error'] === 'string' ? (item.data['error'] as string) : '';
  if (to.length === 0 && error === '') return null;
  return (
    <div className="flex flex-col gap-2">
      {to.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {to.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
      {error !== '' && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

