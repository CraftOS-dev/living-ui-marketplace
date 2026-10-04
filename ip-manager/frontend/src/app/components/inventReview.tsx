/**
 * The IP team's side of an invention: committee scoring against the
 * organization's criteria, every reviewer's view side by side, converting
 * an approved invention into a filing, and the change history.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, History, Scale } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDateTime, plural } from '../lib/format.ts';
import { DISCLOSURE_STAGE_LABEL, IP_TYPE_LABEL, ROUTE_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { AuditRec, CriterionLevel, DisclosureRec, DisclosureReviewRec, DisclosureStage, ScoringCriterionRec } from '../lib/types.ts';
import { JurisdictionSelect, UserSelect } from './pickers.tsx';
import { EmptyHint, ErrorBox, Field, IdentityChip, Loading, Notice, Pill, Section, Segmented } from './ui.tsx';

type Recommendation = DisclosureReviewRec['recommendation'];

export const RECOMMENDATION_LABEL: Record<Exclude<Recommendation, ''>, string> = {
  file: 'File',
  hold: 'Hold',
  reject: 'Do not pursue',
  more_info: 'Needs more information',
};

const RECOMMENDATION_TONE: Record<Exclude<Recommendation, ''>, Tone> = {
  file: 'good',
  hold: 'warn',
  reject: 'bad',
  more_info: 'info',
};

const DEFAULT_LEVELS: CriterionLevel[] = [0, 25, 50, 75, 100].map((v) => ({ value: v, label: String(v) }));

function levelsOf(c: ScoringCriterionRec): CriterionLevel[] {
  return c.levels !== null && c.levels.length > 0 ? c.levels : DEFAULT_LEVELS;
}

function weighted(criteria: ScoringCriterionRec[], scores: Record<string, number>): number | null {
  let sum = 0;
  let w = 0;
  for (const c of criteria) {
    const v = scores[c.key];
    if (v === undefined) continue;
    const weight = c.weight || 1;
    sum += v * weight;
    w += weight;
  }
  return w > 0 ? Math.round((sum / w) * 10) / 10 : null;
}

function Bar({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="h-1.5 w-20 bg-[var(--agent-app-border)]" aria-hidden>
      <span className="block h-full bg-[var(--agent-app-text)]/55" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

export function ReviewPanel({ d, onSaved }: { d: DisclosureRec; onSaved: () => void }): React.JSX.Element {
  const { me, userName } = useApp();
  const criteria = useCollection<ScoringCriterionRec>('scoring_criteria', { filter: 'enabled = true', sort: 'order' });
  const reviews = useCollection<DisclosureReviewRec>('disclosure_reviews', { filter: `disclosure = ${q(d.id)}`, sort: 'created' });
  const mine = reviews.records.find((r) => r.reviewer === me?.id) ?? null;

  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [rec, setRec] = useState<Recommendation>('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (reviews.loading) return;
    const key = mine?.id ?? 'new';
    if (loadedFor === key) return;
    setScores({ ...(mine?.scores ?? {}) });
    setComment(mine?.comment ?? '');
    setRec(mine?.recommendation ?? '');
    setLoadedFor(key);
  }, [reviews.loading, mine, loadedFor]);

  const preview = weighted(criteria.records, scores);
  const scored = criteria.records.filter((c) => scores[c.key] !== undefined).length;

  const save = async (): Promise<void> => {
    if (scored === 0) {
      toast.error('Score at least one criterion.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ total: number; score: number; reviews: number }>('disclosures/review', {
        id: d.id,
        scores,
        comment: comment.trim(),
        ...(rec !== '' ? { recommendation: rec } : {}),
      });
      toast.success(`Review saved (${r.total}). Average is now ${r.score} from ${plural(r.reviews, 'review')}.`);
      reviews.refresh();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const averages = useMemo(() => {
    const out: { c: ScoringCriterionRec; avg: number | null; n: number }[] = [];
    for (const c of criteria.records) {
      const vals = reviews.records.map((r) => r.scores?.[c.key]).filter((v): v is number => typeof v === 'number');
      out.push({ c, avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, n: vals.length });
    }
    return out;
  }, [criteria.records, reviews.records]);

  if (criteria.loading && criteria.records.length === 0) return <Loading />;
  if (criteria.error !== null) return <ErrorBox message={criteria.error} onRetry={criteria.refresh} />;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Section title={mine !== null ? 'Your review' : 'Score this invention'} meta={preview !== null ? `Your score ${preview} of 100` : undefined}>
          {criteria.records.length === 0 ? (
            <EmptyHint
              compact
              icon={Scale}
              title="No scoring criteria are set up"
              message="An admin or IP manager sets the committee's criteria and weights in Settings."
              action={
                <a className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline" href={href('settings', undefined, { tab: 'scoring' })}>
                  Open invention scoring
                </a>
              }
            />
          ) : (
            <div className="flex flex-col gap-5">
              {criteria.records.map((c) => (
                <div key={c.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">{c.label}</span>
                    <span className="text-xs text-[var(--agent-app-muted)]">Weight {c.weight || 1}</span>
                  </div>
                  {c.description !== '' && <p className="mt-0.5 text-xs leading-relaxed text-[var(--agent-app-muted)]">{c.description}</p>}
                  <div className="mt-2 max-w-full overflow-x-auto">
                    <Segmented
                      size="sm"
                      ariaLabel={c.label}
                      value={scores[c.key] !== undefined ? String(scores[c.key]) : ''}
                      options={levelsOf(c).map((l) => ({
                        value: String(l.value),
                        label: (
                          <span>
                            {l.label}
                            {l.label !== String(l.value) && <span className="ml-1 tabular-nums opacity-60">{l.value}</span>}
                          </span>
                        ),
                      }))}
                      onChange={(v) => setScores((s) => ({ ...s, [c.key]: Number(v) }))}
                    />
                  </div>
                </div>
              ))}
              <Field label="Recommendation">
                <div className="max-w-full overflow-x-auto">
                  <Segmented<Recommendation>
                    size="sm"
                    ariaLabel="Recommendation"
                    value={rec}
                    options={(Object.keys(RECOMMENDATION_LABEL) as Exclude<Recommendation, ''>[]).map((k) => ({
                      value: k,
                      label: RECOMMENDATION_LABEL[k],
                      tone: RECOMMENDATION_TONE[k],
                    }))}
                    onChange={setRec}
                  />
                </div>
              </Field>
              <Field label="Comment" htmlFor="review-comment" help="Visible to the IP team, not to the inventor.">
                <Textarea id="review-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Prior art you know of, open questions, commercial context" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--agent-app-muted)]">
                  {scored} of {criteria.records.length} criteria scored
                </span>
                <Button onClick={() => void save()} loading={busy} disabled={scored === 0}>
                  {mine !== null ? 'Update my review' : 'Save my review'}
                </Button>
              </div>
            </div>
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Section title="Committee average" meta={d.review_count > 0 ? `${d.score} from ${plural(d.review_count, 'review')}` : 'Not scored yet'}>
          {averages.length === 0 || reviews.records.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">Averages per criterion appear after the first review.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {averages.map(({ c, avg, n }) => (
                <div key={c.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{c.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {avg !== null ? (
                      <>
                        <Bar value={avg} />
                        <span className="w-10 text-right font-medium tabular-nums">{avg}</span>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--agent-app-muted)]">No scores</span>
                    )}
                    <span className="sr-only">{plural(n, 'score')}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="All reviews" meta={reviews.records.length > 0 ? String(reviews.records.length) : undefined} flush>
          {reviews.records.length === 0 ? (
            <EmptyHint compact icon={ClipboardList} title="No reviews yet" message="Each committee member scores the invention. The average updates as reviews come in." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Reviewer</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Total</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Recommends</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.records.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--agent-app-border)]/60 align-top last:border-0">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <IdentityChip name={userName(r.reviewer) || '?'} size="xs" />
                          <span className="font-medium">{userName(r.reviewer) || 'Unknown'}</span>
                        </span>
                        {r.comment !== '' && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--agent-app-text)]/80">{r.comment}</p>}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.total}</td>
                      <td className="px-3 py-2">
                        {r.recommendation !== '' ? (
                          <Pill tone={RECOMMENDATION_TONE[r.recommendation]}>{RECOMMENDATION_LABEL[r.recommendation]}</Pill>
                        ) : (
                          <span className="text-xs text-[var(--agent-app-muted)]">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Convert to a filing                                                 */
/* ------------------------------------------------------------------ */

type ConvertType = 'patent' | 'utility_model' | 'design';
type ConvertRoute = 'national' | 'provisional' | 'pct';

export function ConvertDialog({ d, onClose }: { d: DisclosureRec; onClose: () => void }): React.JSX.Element {
  const { settings, me } = useApp();
  const preferred = settings?.jurisdictions ?? [];
  const [ipType, setIpType] = useState<ConvertType>('patent');
  const [jur, setJur] = useState(preferred[0] ?? 'US');
  const [route, setRoute] = useState<ConvertRoute>('national');
  const [title, setTitle] = useState(d.title);
  const [responsible, setResponsible] = useState(me?.id ?? '');
  const [busy, setBusy] = useState(false);

  const routes: ConvertRoute[] = ipType === 'design' ? ['national'] : ipType === 'utility_model' ? ['national', 'pct'] : ['national', 'provisional', 'pct'];

  const pickRoute = (r: ConvertRoute): void => {
    setRoute(r);
    if (r === 'pct') setJur('WO');
    if (r === 'provisional') setJur('US');
  };

  const submit = async (): Promise<void> => {
    if (jur === '') {
      toast.error('Choose the first filing office.');
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ matter_id: string; family_id: string; ref: string }>('disclosures/convert', {
        id: d.id,
        ip_type: ipType,
        jurisdiction: jur,
        route,
        title: title.trim() || d.title,
        responsible,
      });
      toast.success(`Filing ${r.ref} created`);
      onClose();
      navigate('matter', r.matter_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Convert to a filing"
      description="Creates a family and a first filing to prepare. Recorded inventors and their shares are copied, and the invention moves to Drafting."
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Create the filing
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type of right"
            value={ipType}
            options={(['patent', 'utility_model', 'design'] as const).map((t) => ({ value: t, label: IP_TYPE_LABEL[t] }))}
            onChange={(e) => {
              const t = e.target.value as ConvertType;
              setIpType(t);
              if (t === 'design' && route !== 'national') pickRoute('national');
              if (t === 'utility_model' && route === 'provisional') pickRoute('national');
            }}
          />
          <Select label="Route" value={route} options={routes.map((r) => ({ value: r, label: ROUTE_LABEL[r] ?? r }))} onChange={(e) => pickRoute(e.target.value as ConvertRoute)} />
        </div>
        <JurisdictionSelect label="First filing office" value={jur} onChange={setJur} preferred={preferred} />
        <p className="-mt-1 text-xs text-[var(--agent-app-muted)]">
          {route === 'pct'
            ? 'An international (PCT) application is filed with WIPO or a receiving office; national phases come later.'
            : route === 'provisional'
              ? 'A US provisional application holds a filing date for 12 months without examination.'
              : 'A regular application at one office.'}
        </p>
        <Input label="Title" value={title} maxLength={400} onChange={(e) => setTitle(e.target.value)} />
        <UserSelect label="Responsible" value={responsible} onChange={setResponsible} placeholder="Nobody" />
        {(d.public_disclosure_date !== '' || d.on_sale_date !== '') && (
          <Notice tone="warn">The invention was disclosed or offered for sale, so a 12-month filing deadline is added to the new filing.</Notice>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  summary: 'summary',
  problem: 'problem',
  solution: 'how it works',
  novelty: 'what is new',
  advantages: 'advantages',
  uses: 'uses',
  products: 'products',
  tech_tags: 'technology tags',
  property: 'property',
  public_disclosure_date: 'public disclosure date',
  on_sale_date: 'on-sale date',
  nda_date: 'NDA date',
  inventor_names: 'inventor names',
  answers: "CraftBot's draft",
  score: 'score',
  review_count: 'number of reviews',
  decision: 'decision note',
  decision_at: 'decision date',
  submitted_at: 'submission date',
  submitted_by: 'submitter',
  family: 'family',
  matter: 'filing',
};

function isStage(v: unknown): v is DisclosureStage {
  return typeof v === 'string' && v in DISCLOSURE_STAGE_LABEL;
}

function describe(a: AuditRec): string {
  if (a.action === 'create') return 'Created the invention';
  if (a.action === 'delete') return 'Deleted the invention';
  const ch = a.changes ?? {};
  const parts: string[] = [];
  const stage = ch['stage'];
  if (typeof stage === 'object' && stage !== null) {
    const s = stage as { from?: unknown; to?: unknown };
    if (isStage(s.from) && isStage(s.to)) parts.push(`Moved from ${DISCLOSURE_STAGE_LABEL[s.from]} to ${DISCLOSURE_STAGE_LABEL[s.to]}`);
  }
  const fields = Object.keys(ch)
    .filter((k) => k !== 'stage' && k !== 'decision_at' && k !== 'submitted_at')
    .map((k) => FIELD_LABEL[k] ?? k);
  if (fields.length) parts.push(`Changed ${fields.join(', ')}`);
  return parts.length ? parts.join('. ') : 'Updated the invention';
}

export function HistoryPanel({ recordId }: { recordId: string }): React.JSX.Element {
  const log = useCollection<AuditRec>('audit_log', { filter: `record_id = ${q(recordId)}`, sort: '-created' });
  if (log.loading && log.records.length === 0) return <Loading />;
  if (log.error !== null) return <ErrorBox message={log.error} onRetry={log.refresh} />;
  return (
    <Section title="History" meta={log.records.length > 0 ? String(log.records.length) : undefined} flush>
      {log.records.length === 0 ? (
        <EmptyHint compact icon={History} title="No history yet" message="Every change, stage move and decision is recorded here with who made it." />
      ) : (
        log.records.map((a) => (
          <div key={a.id} className="flex items-start gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
            <IdentityChip name={a.actor_name || 'System'} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">
                <span className="font-medium">{a.actor_name || 'System'}</span> <span className="text-[var(--agent-app-text)]/85">{describe(a)}</span>
              </div>
              {a.reason !== '' && <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--agent-app-text)]/80">“{a.reason}”</p>}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDateTime(a.created)}</span>
          </div>
        ))
      )}
    </Section>
  );
}
