/**
 * Referrals for everyone: the open roles with "Refer someone" on each, and
 * the people you referred with where they are (submitted, in process,
 * hired, not moving forward). The hiring team also sees every referral.
 */
import { useState } from 'react';
import { Briefcase, Handshake } from 'lucide-react';
import { Button, Dialog, Empty, LoadError, Loading, PageBody, PageHeader, Panel, RowCue, Tabs } from '../../components/ui.tsx';
import { ReferDialog } from '../../components/hiring/forms.tsx';
import { Markdown } from '../../components/hiring/Markdown.tsx';
import { PayRange, Status } from '../../components/hiring/bits.tsx';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import type { OpenRole, Referral } from './types.ts';
import { READS } from './types.ts';

function RoleDialog({ role, onClose, onRefer }: { role: OpenRole | null; onClose: () => void; onRefer: () => void }): React.JSX.Element | null {
  if (role === null) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={role.title}
      meta={[role.entity_name, role.location, t(`hiring.remote.${role.remote}`)].filter((x) => x !== '').join(' · ')}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.close')}</Button>
          <Button variant="primary" icon={Handshake} onClick={onRefer}>
            {t('hiring.refer_someone')}
          </Button>
        </>
      }
    >
      <PayRange lo={role.salary_min_minor} hi={role.salary_max_minor} currency={role.currency} per={role.pay_per} className="mb-3 text-[13px]" />
      {role.description.trim() === '' ? <p className="text-[13px] text-[var(--hr-muted)]">{t('hiring.post_empty')}</p> : <Markdown text={role.description} />}
    </Dialog>
  );
}

export function ReferralsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const team = can(me, 'hiring', 'view');
  const tab = (query.get('tab') ?? 'roles') as 'roles' | 'mine' | 'all';
  const roles = useOp<{ openings: OpenRole[] }>('openings.open-roles', {}, READS, { name: 'hiring.roles' });
  const mine = useOp<{ referrals: Referral[] }>('referrals.mine', {}, READS, { name: 'hiring.referrals.mine' });
  const all = useOp<{ referrals: Referral[] }>('referrals.list', {}, READS, { name: 'hiring.referrals.all', skip: !team || tab !== 'all' });
  const [view, setView] = useState<OpenRole | null>(null);
  const [refer, setRefer] = useState<OpenRole | null>(null);
  const list = roles.data?.openings ?? null;
  const myRefs = mine.data?.referrals ?? [];
  return (
    <>
      <PageHeader title={t('hiring.referrals')} meta={list !== null ? tn('hiring.meta_open', list.length) : undefined} />
      <PageBody>
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'roles' ? undefined : v })}
          label={t('hiring.referrals')}
          className="mb-3"
          tabs={[{ value: 'roles', label: t('hiring.open_roles'), count: list?.length }, { value: 'mine', label: t('hiring.your_referrals'), count: myRefs.length }, ...(team ? [{ value: 'all' as const, label: t('hiring.all_referrals') }] : [])]}
        />
        {tab === 'roles' &&
          (list === null ? (
            roles.error !== null ? <LoadError message={roles.error} onRetry={roles.reload} /> : <Loading />
          ) : list.length === 0 ? (
            <div className="hr-panel">
              <Empty icon={Briefcase} title={t('hiring.no_open_roles')}>
                {t('hiring.no_roles_to_refer')}
              </Empty>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => (
                <article key={r.id} className="hr-panel hr-in flex min-w-0 flex-col gap-2 p-3">
                  <button type="button" onClick={() => setView(r)} className="hr-focus cursor-pointer rounded-[3px] text-left">
                    <span className="hr-link hr-wrap block text-[14px] font-semibold">{r.title}</span>
                    <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[r.department_name, r.entity_name, r.location, t(`hiring.remote.${r.remote}`)].filter((x) => x !== '').join(' · ')}</span>
                  </button>
                  <PayRange lo={r.salary_min_minor} hi={r.salary_max_minor} currency={r.currency} per={r.pay_per} className="text-[12px]" />
                  <span className="flex-1" />
                  <div className="flex items-center gap-2">
                    <Button size="sm" icon={Handshake} onClick={() => setRefer(r)}>
                      {t('hiring.refer_someone')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setView(r)}>
                      {t('hiring.read_post')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ))}
        {tab === 'mine' && (
          <Panel index="01" label={t('hiring.your_referrals')} flush>
            {myRefs.length === 0 ? (
              <Empty icon={Handshake} title={t('hiring.no_referrals')} action={list !== null && list.length > 0 ? <Button onClick={() => setQuery({ tab: undefined })}>{t('hiring.see_open_roles')}</Button> : undefined} />
            ) : (
              <ul className="divide-y divide-[var(--hr-line)]">
                {myRefs.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="hr-wrap block text-[13px] font-medium">{r.name}</span>
                      <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[r.opening_title, fmtDay(r.created)].join(' · ')}</span>
                    </span>
                    <Status kind="referral" status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        {tab === 'all' && team && (
          <Panel index="01" label={t('hiring.all_referrals')} flush>
            {all.data === null ? (
              <Loading />
            ) : all.data.referrals.length === 0 ? (
              <Empty icon={Handshake} title={t('hiring.no_referrals')} />
            ) : (
              <ul className="divide-y divide-[var(--hr-line)]">
                {all.data.referrals.map((r) => (
                  <li key={r.id}>
                    <a href={`#/hiring/candidates/${r.candidate ?? ''}`} className="group relative pr-10 hr-focus flex cursor-pointer flex-col gap-1 px-4 py-2.5 hover:bg-[var(--hr-hover)] sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="hr-wrap block text-[13px] font-medium">{r.name}</span>
                        <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[t('hiring.referred_by_name', { name: r.referrer_name ?? '' }), r.opening_title, fmtDay(r.created)].join(' · ')}</span>
                      </span>
                      <Status kind="referral" status={r.status} />
                      <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </PageBody>
      <RoleDialog role={view} onClose={() => setView(null)} onRefer={() => (setRefer(view), setView(null))} />
      <ReferDialog open={refer !== null} onClose={() => setRefer(null)} role={refer} />
    </>
  );
}
