/**
 * The approvals board (監修): one column per approval stage with the items
 * in play as cards, filters by licensee, franchise, status, "waiting on
 * me" and overdue, and the approval drawer to review and decide. Small
 * screens get the same items as a list grouped by stage.
 */
import { useMemo } from 'react';
import { Search, Stamp } from 'lucide-react';
import { Button, Select, cn } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10 } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { navigate, useHashParam, useRoute } from '../lib/router.ts';
import type { ApprovalRec, PartyRec, ProductRec } from '../lib/records.ts';
import { Checkbox, EmptyHint, ErrorBox, GroupHeader, Loading, PageHeader, Section, Toolbar } from '../components/ui.tsx';
import { ApprovalDrawer } from '../components/licApprovalDrawer.tsx';
import { APPROVAL_STAGES, ReplyDue, ReviewerChips, awaitingReviewers, expandOne, isOverdue } from '../components/licShared.tsx';

type StatusFilter = 'active' | 'open' | 'changes_requested' | 'approved' | 'rejected' | 'withdrawn' | 'all';

const STATUS_FILTERS: StatusFilter[] = ['active', 'open', 'changes_requested', 'approved', 'rejected', 'withdrawn', 'all'];

function statusFilterLabel(s: StatusFilter): string {
  switch (s) {
    case 'active':
      return t('In progress');
    case 'open':
      return t('Waiting on reviewers');
    case 'all':
      return t('All statuses');
    default:
      return enumLabel('approvals.status', s);
  }
}

/** Server filter for a status choice (keeps closed history out of the default view). */
function statusQuery(s: StatusFilter): string {
  switch (s) {
    case 'active':
      return 'status = "submitted" || status = "in_review" || status = "changes_requested"';
    case 'open':
      return 'status = "submitted" || status = "in_review"';
    case 'all':
      return '';
    default:
      return `status = "${s}"`;
  }
}

function ApprovalCard({ a, onOpen }: { a: ApprovalRec; onOpen: () => void }): React.JSX.Element {
  const product = expandOne<ProductRec>(a, 'product');
  const licensee = product !== null ? (expandOne<PartyRec>(product, 'licensee')?.name ?? '') : '';
  const late = isOverdue(a);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full min-w-0 flex-col gap-1.5 border bg-[var(--agent-app-surface)] p-2.5 text-left transition-colors hover:border-[var(--agent-app-accent)]/50',
        late ? 'border-red-500/40' : 'border-[var(--agent-app-border)]',
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{product?.name ?? t('Product')}</div>
        {licensee !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{licensee}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Round {n}', { n: a.round || 1 })}</span>
        {!awaitingReviewers(a.status) && <span className="text-xs font-medium">{enumLabel('approvals.status', a.status)}</span>}
        <ReplyDue a={a} />
      </div>
      <ReviewerChips reviewers={a.reviewers} />
    </button>
  );
}

export function ApprovalsPage(): React.JSX.Element {
  const { can, me, on, franchises } = useApp();
  const route = useRoute();
  const [statusParam, setStatus] = useHashParam('status', 'active');
  const [licensee, setLicensee] = useHashParam('licensee', '');
  const [franchise, setFranchise] = useHashParam('franchise', '');
  const [mine, setMine] = useHashParam('mine', '');
  const [overdue, setOverdue] = useHashParam('overdue', '');
  const [openParam, setOpen] = useHashParam('open', '');
  const status: StatusFilter = (STATUS_FILTERS as string[]).includes(statusParam) ? (statusParam as StatusFilter) : 'active';
  const openId = openParam !== '' ? openParam : route.id;

  const query = statusQuery(status);
  const all = useCollection<ApprovalRec>('approvals', { ...(query !== '' ? { filter: query } : {}), sort: 'due_date', expand: 'product,product.licensee' });

  const waitingOnMe = (a: ApprovalRec): boolean =>
    awaitingReviewers(a.status) &&
    (a.reviewers ?? []).some((r) => r.decision === 'pending' && ((me !== null && r.user === me.id) || (can.licensing && r.kind === 'internal')));

  const licenseeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of all.records) {
      const p = expandOne<ProductRec>(a, 'product');
      const party = p !== null ? expandOne<PartyRec>(p, 'licensee') : null;
      if (party !== null) m.set(party.id, party.name);
    }
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label }));
  }, [all.records]);

  const rows = useMemo(
    () =>
      all.records
        .filter((a) => {
          const p = expandOne<ProductRec>(a, 'product');
          if (licensee !== '' && p?.licensee !== licensee) return false;
          if (franchise !== '' && p?.franchise !== franchise) return false;
          if (mine === '1' && !waitingOnMe(a)) return false;
          if (overdue === '1' && !isOverdue(a)) return false;
          return true;
        })
        .sort((x, y) => {
          const dx = d10(x.due_date);
          const dy = d10(y.due_date);
          if (dx === '' && dy !== '') return 1;
          if (dy === '' && dx !== '') return -1;
          return dx.localeCompare(dy);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all.records, licensee, franchise, mine, overdue, me, can.licensing],
  );

  const mineCount = all.records.filter(waitingOnMe).length;
  const overdueCount = all.records.filter(isOverdue).length;
  const filtered = licensee !== '' || franchise !== '' || mine === '1' || overdue === '1' || status !== 'active';
  const clear = (): void => {
    setStatus('active');
    setLicensee('');
    setFranchise('');
    setMine('');
    setOverdue('');
  };
  // A deep link (#/approvals/<id>) carries the id in the path: drop it, keep the filters.
  const close = (): void => {
    if (route.id === '') {
      setOpen('');
      return;
    }
    const params: Record<string, string> = {};
    route.params.forEach((v, k) => {
      if (k !== 'open') params[k] = v;
    });
    navigate('approvals', undefined, params);
  };
  const byStage = APPROVAL_STAGES.map((s) => ({ stage: s, items: rows.filter((a) => a.stage === s) }));

  const noMatch = (
    <Section title={t('Approvals')}>
      <EmptyHint
        compact
        icon={Search}
        title={t('Nothing matches these filters')}
        message={t('Try another status, licensee or franchise.')}
        action={
          <Button size="sm" variant="outline" onClick={clear}>
            {t('Clear filters')}
          </Button>
        }
      />
    </Section>
  );

  return (
    <div>
      <PageHeader
        title={t('Approvals')}
        meta={all.loading ? undefined : String(rows.length)}
        subtitle={t('Every product stage under review (監修): who still has to answer, and when the reply is due in Japanese business days.')}
      />

      <Toolbar>
        <div className="w-full sm:w-48">
          <Select aria-label={t('Status')} value={status} options={STATUS_FILTERS.map((s) => ({ value: s, label: statusFilterLabel(s) }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label={t('Licensee')} value={licensee} placeholder={t('All licensees')} options={licenseeOptions} onChange={(e) => setLicensee(e.target.value)} />
        </div>
        {on('franchises') && (
          <div className="w-full sm:w-44">
            <Select aria-label={t('Franchise')} value={franchise} placeholder={t('All franchises')} options={franchises.map((f) => ({ value: f.id, label: f.name }))} onChange={(e) => setFranchise(e.target.value)} />
          </div>
        )}
        <Checkbox checked={mine === '1'} onChange={(v) => setMine(v ? '1' : '')} label={t('Waiting on me ({n})', { n: mineCount })} />
        <Checkbox checked={overdue === '1'} onChange={(v) => setOverdue(v ? '1' : '')} label={t('Overdue only ({n})', { n: overdueCount })} />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      {all.error !== null && all.records.length === 0 ? (
        <ErrorBox message={all.error} onRetry={all.refresh} />
      ) : all.loading ? (
        <Loading />
      ) : all.records.length === 0 && status === 'active' ? (
        <Section title={t('Approvals')}>
          <EmptyHint
            icon={Stamp}
            title={t('Nothing under review')}
            message={t('Submit a stage from a product page (or a licensee submits one from the portal) and it appears here until every reviewer has answered.')}
            action={
              <Button size="sm" variant="outline" onClick={() => navigate('products')}>
                {t('Open products')}
              </Button>
            }
          />
        </Section>
      ) : rows.length === 0 ? (
        noMatch
      ) : (
        <>
          <div className="hidden overflow-x-auto pb-2 md:block">
            <div className="flex min-w-max gap-3">
              {byStage.map(({ stage, items }) => (
                <div key={stage} className="flex w-64 shrink-0 flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10">
                  <GroupHeader label={enumLabel('approvals.stage', stage)} count={items.length} tone={items.some(isOverdue) ? 'bad' : undefined} />
                  <div className="flex flex-col gap-2 p-2">
                    {items.length === 0 ? (
                      <p className="px-1 py-3 text-center text-xs text-[var(--agent-app-muted)]">{t('Nothing at this stage')}</p>
                    ) : (
                      items.map((a) => <ApprovalCard key={a.id} a={a} onOpen={() => setOpen(a.id)} />)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {byStage
              .filter((g) => g.items.length > 0)
              .map(({ stage, items }) => (
                <div key={stage} className="border border-[var(--agent-app-border)]">
                  <GroupHeader label={enumLabel('approvals.stage', stage)} count={items.length} tone={items.some(isOverdue) ? 'bad' : undefined} />
                  <div className="flex flex-col gap-2 p-2">
                    {items.map((a) => (
                      <ApprovalCard key={a.id} a={a} onOpen={() => setOpen(a.id)} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {openId !== '' && <ApprovalDrawer key={openId} id={openId} onClose={close} />}
    </div>
  );
}
