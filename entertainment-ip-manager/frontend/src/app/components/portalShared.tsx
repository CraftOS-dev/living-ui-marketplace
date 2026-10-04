/**
 * Shared pieces of the external portal: the live portal context (one op,
 * refreshed whenever the records it summarizes change), stage and status
 * wording an outside company understands, the section switcher (segments
 * on wide screens, a select on phones), and the approval detail (stage,
 * reviewers' comments, submitted images, earlier rounds).
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Select } from '../../kit/index.ts';
import { fileUrl, getRecord, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, t, tf } from '../lib/i18n.ts';
import type { ApprovalRec, ApprovalRoundRec } from '../lib/records.ts';
import type { ApprovalReviewer, PortalContext, StageTemplate } from '../lib/shapes.ts';
import { EnumPill, Pill, Prose, Segmented } from './ui.tsx';
import type { Tone } from '../lib/labels.ts';

export const PORTAL_SOURCES = ['products', 'approvals', 'approval_rounds', 'royalty_reports', 'royalty_lines', 'seal_orders', 'consent_requests', 'distributions', 'agreements', 'committees', 'parties'];

/** The portal context, live. */
export function usePortal(): { data: PortalContext | null; loading: boolean; error: string | null; reload: () => void } {
  return useLiveAsync(() => op<PortalContext>('portal/context', {}), [], PORTAL_SOURCES);
}

/** Stage templates in force for an agreement (its own, else the organization's, else the plain order). */
export function useStageList(agreementStages: StageTemplate[] | undefined): StageTemplate[] {
  const { settings, meta } = useApp();
  return useMemo(() => {
    if (agreementStages !== undefined && agreementStages.length > 0) return agreementStages;
    const org = settings?.approval_stages ?? [];
    if (org.length > 0) return org;
    return (meta?.approval_stages ?? []).map((k) => ({ key: k, label: enumLabel('approvals.stage', k) }));
  }, [agreementStages, settings?.approval_stages, meta?.approval_stages]);
}

export function stageName(key: string, stages?: StageTemplate[] | undefined): string {
  const tpl = stages?.find((s) => s.key === key);
  if (tpl !== undefined) {
    const label = tf(tpl, 'label');
    if (label !== '') return label;
  }
  return enumLabel('approvals.stage', key);
}

const DECISION_TONE: Record<string, Tone> = { pending: 'info', approved: 'good', changes: 'warn', rejected: 'bad', deemed_approved: 'good', deemed_refused: 'bad' };

export function decisionLabel(d: string): string {
  return (
    {
      pending: t('Waiting'),
      approved: t('Approved'),
      changes: t('Changes requested'),
      rejected: t('Not approved'),
      deemed_approved: t('Approved (no reply in time)'),
      deemed_refused: t('Refused (no reply in time)'),
    }[d] ?? d
  );
}

export function DecisionPill({ decision }: { decision: string }): React.JSX.Element {
  return <Pill tone={DECISION_TONE[decision] ?? 'neutral'}>{decisionLabel(decision)}</Pill>;
}

/** Section switcher: segments from md up, a select below. */
export function PortalTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="hidden md:block">
        <Segmented<T> ariaLabel={label} value={value} onChange={onChange} options={options} />
      </div>
      <div className="md:hidden">
        <Select
          aria-label={label}
          value={value}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(e) => {
            const v = options.find((o) => o.value === e.target.value);
            if (v !== undefined) onChange(v.value);
          }}
        />
      </div>
    </div>
  );
}

/** A plain card-like row list used across the portal. */
export function PortalList({ children }: { children: ReactNode }): React.JSX.Element {
  return <ul className="flex flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">{children}</ul>;
}

/** The approval record itself (reviewers, comments, images), live. */
export function useApprovalRecord(id: string): { approval: ApprovalRec | null; loading: boolean; error: string | null } {
  const r = useLiveAsync(() => getRecord<ApprovalRec>('approvals', id), [id], ['approvals']);
  return { approval: r.data, loading: r.loading, error: r.error };
}

/** Reviewers' decisions and comments, submitted images and earlier rounds. */
export function ApprovalDetail({ approval, stages }: { approval: ApprovalRec; stages?: StageTemplate[] | undefined }): React.JSX.Element {
  const rounds = useCollection<ApprovalRoundRec>('approval_rounds', { filter: `approval = ${q(approval.id)}`, sort: '-created' });
  const reviewers: ApprovalReviewer[] = approval.reviewers ?? [];
  const images = approval.images ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <EnumPill field="approvals.status" value={approval.status} />
        <span className="text-[13px]">{stageName(approval.stage, stages)}</span>
        <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Round {n}', { n: approval.round || 1 })}</span>
        {approval.due_date !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Reply due {date}', { date: fmtDate(approval.due_date) })}</span>}
      </div>

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Reviewers')}</h4>
        {reviewers.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No reviewers are listed for this stage yet.')}</p>
        ) : (
          <ul className="flex flex-col border border-[var(--agent-app-border)]">
            {reviewers.map((r) => (
              <li key={r.key} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{tf(r, 'label') || r.key}</span>
                  <DecisionPill decision={r.decision} />
                  {r.decided_at !== undefined && r.decided_at !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(r.decided_at)}</span>}
                </div>
                {r.comment !== undefined && r.comment !== '' && <Prose className="text-[13px]">{r.comment}</Prose>}
                {r.previous_comment !== undefined && r.previous_comment !== '' && (
                  <div className="border-l-2 border-[var(--agent-app-border)] pl-2 text-xs text-[var(--agent-app-muted)]">
                    <span className="font-medium">{t('Earlier comment')}: </span>
                    <span className="whitespace-pre-wrap">{r.previous_comment}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {approval.notes !== '' && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Notes from the submitter')}</h4>
          <Prose className="text-[13px]">{approval.notes}</Prose>
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Submitted images')}</h4>
        {images.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No images were submitted with this round.')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((f) => (
              <a key={f} href={fileUrl(approval, f)} target="_blank" rel="noreferrer" className="block min-w-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
                {/\.pdf$/i.test(f) ? (
                  <span className="flex h-28 items-center justify-center px-2 text-center text-xs break-all">{f}</span>
                ) : (
                  <img src={fileUrl(approval, f, '400x0')} alt={f} loading="lazy" className="h-28 w-full object-contain" />
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {rounds.records.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Earlier rounds and decisions')}</h4>
          <ul className="flex flex-col border border-[var(--agent-app-border)]">
            {rounds.records.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums text-[var(--agent-app-muted)]">{t('Round {n}', { n: r.round || 1 })}</span>
                  <EnumPill field="approval_rounds.status" value={r.status} />
                  {r.decided_by_name !== '' && <span className="text-[var(--agent-app-muted)]">{r.decided_by_name}</span>}
                  <span className="tabular-nums text-[var(--agent-app-muted)]">{fmtDate(r.created)}</span>
                </div>
                {r.comment !== '' && <Prose className="text-[13px]">{r.comment}</Prose>}
                {(r.images ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(r.images ?? []).map((f) => (
                      <a key={f} href={fileUrl(r, f)} target="_blank" rel="noreferrer" className="max-w-full truncate text-xs text-[var(--agent-app-accent)] hover:underline">
                        {f}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
