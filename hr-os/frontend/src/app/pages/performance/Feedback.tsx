/**
 * Feedback: the praise wall (filter by company value), what you received
 * and gave, requests to answer and what you asked for, and for managers
 * what was shared about a report. One primary action: give praise.
 */
import { useState } from 'react';
import { Heart, Inbox, MessageSquarePlus, Send, Sparkle, Trash2, X } from 'lucide-react';
import { Button, Empty, IconButton, LinkButton, LoadError, Loading, PageBody, PageHeader, PersonChip, Segmented, Tabs, Tag, confirmAsk, toast } from '../../components/ui.tsx';
import { FeedbackDialog, RequestDialog } from '../../components/performance/dialogs.tsx';
import { dueText, MoreOnScroll, ValueTag, valueIcon } from '../../components/performance/bits.tsx';
import type { CompanyValue, FeedbackRow } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, changed, drop, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';

type View = 'wall' | 'received' | 'given' | 'requests' | 'asked' | 'about';
const PAGE = 30;

export function FeedbackPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const employee = query.get('employee') ?? '';
  const wanted = ((query.get('view') as View | null) ?? (employee !== '' ? 'about' : 'wall')) as View;
  const view: View = me.employee === null && wanted !== 'wall' && wanted !== 'about' ? 'wall' : wanted;
  const value = query.get('value') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const [give, setGive] = useState<{ open: boolean; request?: FeedbackRow | null | undefined }>({ open: false });
  const [ask, setAsk] = useState(false);
  const live = useOp<{ feedback: FeedbackRow[]; has_more: boolean; values: CompanyValue[] }>('feedback.list', { view, employee: employee === '' ? undefined : employee, value: value === '' ? undefined : value, limit }, READS.feedback, { name: `perf.feedback.${view}` });
  const requests = useOp<{ feedback: FeedbackRow[] }>('feedback.list', { view: 'requests' }, READS.feedback, { name: 'perf.feedback.requests.count', skip: me.employee === null });
  const openRequests = (requests.data?.feedback ?? []).filter((f) => f.status === 'open').length;
  const data = live.data;
  const values = data?.values ?? [];
  const aboutName = view === 'about' ? data?.feedback[0]?.to?.name ?? '' : '';
  const tabs: { value: View; label: string; count?: number | undefined }[] = [{ value: 'wall', label: t('perf.fb.wall') }];
  if (me.employee !== null) tabs.push({ value: 'received', label: t('perf.fb.received') }, { value: 'given', label: t('perf.fb.given') }, { value: 'requests', label: t('perf.fb.requests'), count: openRequests }, { value: 'asked', label: t('perf.fb.asked_tab') });
  if (view === 'about') tabs.push({ value: 'about', label: aboutName !== '' ? t('perf.fb.about', { name: aboutName }) : t('perf.fb.about_person') });

  const remove = async (f: FeedbackRow): Promise<void> => {
    if (!(await confirmAsk(t('perf.fb.delete_text'), t('perf.fb.delete')))) return;
    await act([drop(f.id)], () => op('feedback.delete', { feedback: f.id }), READS.feedback);
  };
  const decline = async (f: FeedbackRow): Promise<void> => {
    try {
      await op('feedback.decline', { request: f.id });
      changed(...READS.feedback);
      toast.success(t('perf.fb.declined'));
    } catch {
      /* toast shown */
    }
  };

  return (
    <>
      <PageHeader title={t('perf.fb.title')} meta={view === 'wall' ? t('perf.fb.wall_meta') : ''}>
        {me.employee !== null && (
          <>
            <Button icon={MessageSquarePlus} onClick={() => setAsk(true)}>
              {t('perf.fb.ask')}
            </Button>
            <Button variant="primary" icon={Heart} onClick={() => setGive({ open: true })}>
              {t('perf.fb.give_praise')}
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody className="max-w-[980px]">
        <Tabs value={view} onChange={(v) => (setLimit(PAGE), setQuery({ view: v === 'wall' ? undefined : v, value: undefined, employee: v === 'about' ? employee : undefined }))} tabs={tabs} label={t('perf.fb.title')} className="mb-3" />
        {view === 'wall' && values.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Segmented
              value={value}
              onChange={(v) => setQuery({ value: v === '' ? undefined : v })}
              label={t('perf.fb.values')}
              size="sm"
              options={[{ value: '', label: t('perf.fb.all_values') }, ...values.map((v) => ({ value: v.code, label: v.name, icon: valueIcon(v.icon) }))]}
            />
          </div>
        )}
        {data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : data.feedback.length === 0 ? (
          <Empty
            icon={view === 'wall' ? Sparkle : Inbox}
            title={t(`perf.fb.empty.${view}`)}
            action={
              me.employee !== null && (view === 'wall' || view === 'given') ? (
                <Button icon={Heart} onClick={() => setGive({ open: true })}>
                  {t('perf.fb.first_praise')}
                </Button>
              ) : me.employee !== null && view === 'asked' ? (
                <Button icon={MessageSquarePlus} onClick={() => setAsk(true)}>
                  {t('perf.fb.ask')}
                </Button>
              ) : undefined
            }
          >
            {t(`perf.fb.empty_text.${view}`)}
          </Empty>
        ) : (
          <>
            <ul className={view === 'wall' ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'flex flex-col gap-2'}>
              {data.feedback.map((f) => (
                <li key={f.id} className="hr-panel hr-in flex min-w-0 flex-col gap-2 p-3.5">
                  <div className="flex items-start gap-2">
                    {f.kind === 'request' ? (
                      <PersonChip name={view === 'asked' ? f.to?.name ?? '' : f.from?.name ?? ''} size={26} sub={view === 'asked' ? t('perf.fb.you_asked') : f.about !== null && f.about.id !== f.from?.id ? t('perf.fb.asks_about', { name: f.about.name }) : t('perf.fb.asks_you')} />
                    ) : (
                      <PersonChip name={view === 'given' ? f.to?.name ?? '' : f.to?.name ?? ''} size={26} sub={view === 'given' ? t('perf.fb.you_wrote') : t('perf.fb.from', { name: f.from?.name ?? f.from_name })} />
                    )}
                    <span className="flex-1" />
                    {f.kind !== 'request' && <Tag tone={f.visibility === 'public' ? 'neutral' : 'faint'}>{t(`perf.fb.vis_tag.${f.visibility}`)}</Tag>}
                    {f.kind === 'request' && <Tag tone={f.status === 'open' ? 'warn' : f.status === 'answered' ? 'good' : 'faint'}>{t(`perf.fb.req.${f.status || 'open'}`)}</Tag>}
                    <span className="hr-label shrink-0 pt-1">{ago(f.created)}</span>
                    {f.can_delete && <IconButton icon={Trash2} label={t('perf.fb.delete')} tone="danger" size={26} onClick={() => void remove(f)} />}
                  </div>
                  <p className="hr-wrap whitespace-pre-wrap text-[13px] leading-5">{f.text}</p>
                  {f.values.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {f.values.map((v) => (
                        <ValueTag key={v.code} name={v.name} icon={v.icon} />
                      ))}
                    </div>
                  )}
                  {f.answer !== undefined && f.answer !== null && (
                    <div className="border-l-2 border-[var(--hr-line-2)] pl-2.5">
                      <div className="text-[12px] text-[var(--hr-muted)]">{t('perf.fb.answer_from', { name: f.answer.from?.name ?? '' })}</div>
                      <p className="hr-wrap whitespace-pre-wrap text-[13px] leading-5">{f.answer.text}</p>
                    </div>
                  )}
                  {view === 'requests' && f.status === 'open' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" icon={Send} onClick={() => setGive({ open: true, request: f })}>
                        {t('perf.fb.answer')}
                      </Button>
                      <LinkButton className="h-6" onClick={() => void decline(f)}><X size={12} strokeWidth={2} aria-hidden />{t('perf.fb.decline')}</LinkButton>
                      {f.due !== '' && <span className="hr-label">{dueText(f.due, me.today)}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <MoreOnScroll hasMore={data.has_more} loading={live.loading} onMore={() => setLimit((l) => l + PAGE)} />
          </>
        )}
      </PageBody>
      <FeedbackDialog open={give.open} onClose={() => setGive({ open: false })} request={give.request} />
      <RequestDialog open={ask} onClose={() => setAsk(false)} />
    </>
  );
}
