/**
 * Hiring outside its own pages: the decision context of the two approval
 * kinds (requisition, offer) in the Inbox, the Inbox sections (scorecards
 * you owe, people ready to hire), and the Home widgets (your interviews and
 * open roles to refer to; your openings; the pipeline).
 */
import { useMemo } from 'react';
import { ChevronRight, Handshake } from 'lucide-react';
import { Fact, Notice, Panel, RowCue, Tag } from '../../components/ui.tsx';
import { AsideLink, PayAmount, PayRange, StageStrip, whenText } from '../../components/hiring/bits.tsx';
import { fmtDay } from '../../lib/format.ts';
import type { ApprovalViewProps, InboxItem } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { HiringHome, Owed } from './types.ts';
import { READS } from './types.ts';

/* ------------------------------------------------------- approval views */

export function RequisitionApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] ?? {}) as { title?: string; headcount?: number; reason?: string; department_name?: string; entity_name?: string; replaces_name?: string; currency?: string; pay_min_minor?: number; pay_max_minor?: number; pay_per?: string; budget_minor?: number; target_start_day?: string; justification?: string; plan?: string };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('hiring.role_title')}>{p.title ?? ''}</Fact>
        <Fact label={t('hiring.headcount')} mono>
          {p.headcount ?? 1}
        </Fact>
        <Fact label={t('hiring.why_needed')}>{p.reason !== undefined ? t(`hiring.req_reason.${p.reason}`) + (p.replaces_name ? ': ' + p.replaces_name : '') : ''}</Fact>
        <Fact label={t('hiring.department')}>{[p.department_name, p.entity_name].filter((x) => x !== undefined && x !== '').join(' · ')}</Fact>
        {((p.pay_min_minor ?? 0) > 0 || (p.pay_max_minor ?? 0) > 0) && (
          <Fact label={t('hiring.pay_range_short')}>
            <PayRange lo={p.pay_min_minor} hi={p.pay_max_minor} currency={p.currency ?? ''} per={p.pay_per} />
          </Fact>
        )}
        {(p.budget_minor ?? 0) > 0 && (
          <Fact label={t('hiring.budget_short')}>
            <PayAmount minor={p.budget_minor} currency={p.currency ?? ''} />
          </Fact>
        )}
        {p.target_start_day !== undefined && p.target_start_day !== '' && <Fact label={t('hiring.target_start')}>{fmtDay(p.target_start_day)}</Fact>}
        {p.plan !== undefined && p.plan !== '' && <Fact label={t('hiring.plan')}>{p.plan}</Fact>}
      </div>
      {p.justification !== undefined && p.justification !== '' && <p className="hr-wrap text-[13px] text-[var(--hr-ink-2)]">{p.justification}</p>}
    </div>
  );
}

export function OfferApprovalView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = (approval['payload'] ?? {}) as { offer?: string; candidate_name?: string; title?: string; opening_title?: string; entity_name?: string; department_name?: string; start_day?: string; amount_minor?: number; currency?: string; pay_per?: string; components?: { name: string; amount_minor: number; per: string }[]; terms?: string[]; expires_day?: string; issues?: string[] };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={t('hiring.candidate')}>{p.candidate_name ?? ''}</Fact>
        <Fact label={t('hiring.job_title')}>{p.title ?? ''}</Fact>
        <Fact label={t('hiring.pay')}>
          <PayAmount minor={p.amount_minor} currency={p.currency ?? ''} per={p.pay_per} />
        </Fact>
        <Fact label={t('hiring.start_day')}>{p.start_day !== undefined && p.start_day !== '' ? fmtDay(p.start_day, { year: 'always' }) : ''}</Fact>
        {(p.components ?? []).length > 0 && (
          <Fact label={t('hiring.components')}>
            <span className="flex flex-col">
              {(p.components ?? []).map((c, i) => (
                <span key={i}>
                  {c.name}: <PayAmount minor={c.amount_minor} currency={p.currency ?? ''} per={c.per} />
                </span>
              ))}
            </span>
          </Fact>
        )}
        {(p.terms ?? []).length > 0 && <Fact label={t('hiring.terms')}>{(p.terms ?? []).join(', ')}</Fact>}
        <Fact label={t('hiring.entity')}>{[p.department_name, p.entity_name].filter((x) => x !== undefined && x !== '').join(' · ')}</Fact>
        {p.expires_day !== undefined && p.expires_day !== '' && <Fact label={t('hiring.answer_by')}>{fmtDay(p.expires_day)}</Fact>}
      </div>
      {(p.issues ?? []).length > 0 && <Notice tone="warn">{(p.issues ?? []).join(' ')}</Notice>}
      {p.offer !== undefined && (
        <a href={`#/hiring/offers/${p.offer}`} className="hr-link hr-focus inline-flex w-fit cursor-pointer items-center gap-1 rounded-[3px] text-[13px] text-[var(--hr-ink-2)]">
          {t('hiring.read_letter')}
          <ChevronRight size={13} aria-hidden />
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------- inbox sections */

export function useOwedItems(): InboxItem[] | null {
  const live = useOp<{ owed: Owed[] }>('scorecards.mine', { status: 'owed', limit: 50 }, READS, { name: 'hiring.inbox.owed' });
  return useMemo(() => (live.data === null ? null : live.data.owed.map((o) => ({ id: o.scorecard, title: t('hiring.inbox.scorecard', { name: o.candidate_name }), sub: [o.title, o.opening_title, whenText(o.day, o.start, o.timezone)].join(' · '), link: `#/hiring/interviews/${o.interview}`, due: o.day, person: o.candidate_name }))), [live.data]);
}

export function useReadyItems(): InboxItem[] | null {
  const live = useOp<HiringHome>('hiring.home', {}, READS, { name: 'hiring.home' });
  return useMemo(() => (live.data === null ? null : live.data.ready_to_hire.map((o) => ({ id: o.id, title: t('hiring.inbox.hire', { name: o.candidate_name }), sub: [o.title, o.start_day !== '' ? t('hiring.starts', { day: o.start_day }) : ''].filter((x) => x !== '').join(' · '), link: `#/hiring/offers/${o.id}`, due: o.start_day !== '' ? o.start_day : undefined, person: o.candidate_name, actions: [{ label: t('hiring.open'), run: () => navigate('/hiring/offers/' + o.id), primary: true }] }))), [live.data]);
}

/* --------------------------------------------------------- home widgets */

/** Employees: interviews you are on, scorecards you owe, open roles to refer people to. */
export function MyHiringWidget(): React.JSX.Element | null {
  const home = useOp<HiringHome>('hiring.home', {}, READS, { name: 'hiring.home' }).data;
  const roles = useOp<{ openings: unknown[] }>('openings.open-roles', {}, ['openings'], { name: 'hiring.roles' }).data;
  if (home === null) return null;
  const ivs = [...home.interviews_today, ...home.interviews_week].filter((i) => i.mine).slice(0, 3);
  const open = roles?.openings.length ?? 0;
  if (ivs.length === 0 && home.feedback_owed.length === 0 && open === 0) return null;
  return (
    <Panel label={t('hiring.widget.mine')}>
      <div className="flex flex-col gap-2">
        {home.feedback_owed.length > 0 && (
          <a href="#/hiring/interviews?mine=1" className="group hr-focus flex cursor-pointer items-center gap-2 rounded-[var(--hr-radius-sm)] px-1 py-1 hover:bg-[var(--hr-hover)]">
            <Tag tone="warn">{home.feedback_owed.length}</Tag>
            <span className="text-[13px]">{tn('hiring.widget.owed', home.feedback_owed.length)}</span>
            <RowCue />
          </a>
        )}
        {ivs.map((iv) => (
          <a key={iv.id} href={`#/hiring/interviews/${iv.id}`} className="group relative pr-10 hr-focus flex cursor-pointer flex-col rounded-[var(--hr-radius-sm)] px-1 py-1 hover:bg-[var(--hr-hover)]">
            <span className="hr-wrap text-[13px] font-medium">{iv.candidate_name}</span>
            <span className="hr-wrap text-[12px] text-[var(--hr-muted)]">{[iv.title, whenText(iv.day, iv.start, iv.timezone)].join(' · ')}</span>
            <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
          </a>
        ))}
        {open > 0 && (
          <a href="#/hiring/referrals" className="group hr-focus flex cursor-pointer items-center gap-2 rounded-[var(--hr-radius-sm)] px-1 py-1 text-[13px] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]">
            <Handshake size={14} aria-hidden />
            {tn('hiring.widget.refer', open)}
            <RowCue />
          </a>
        )}
      </div>
    </Panel>
  );
}

/** Managers and admins: open roles with candidates per stage. */
export function PipelineWidget(): React.JSX.Element | null {
  const home = useOp<HiringHome>('hiring.home', {}, READS, { name: 'hiring.home' }).data;
  if (home === null || home.openings.length === 0) return null;
  return (
    <Panel label={t('hiring.widget.pipeline')} flush aside={<AsideLink href="#/hiring">{t('hiring.title')}</AsideLink>}>
      <ul className="divide-y divide-[var(--hr-line)]">
        {home.openings.slice(0, 6).map((o) => (
          <li key={o.id}>
            <a href={`#/hiring/openings/${o.id}`} className="group relative pr-10 hr-focus flex min-w-0 cursor-pointer flex-col gap-1.5 px-4 py-2.5 hover:bg-[var(--hr-hover)]">
              <span className="hr-wrap text-[13px] font-medium">{o.title}</span>
              <StageStrip stages={o.stages} positions={o.positions} hired={o.hired} />
              <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
