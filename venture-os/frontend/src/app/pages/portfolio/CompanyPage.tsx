/**
 * A portfolio company. On every tab the hero says who the company is
 * (logo, name, one line, sector, stage, HQ, founded, founders) with its
 * quick links (website, latest deck, data room, latest update, board deck,
 * email the founders) and the fund position beside it. Tabs: Overview (the
 * dashboard: KPI tiles, the latest update, open asks, the next board
 * meeting, files and news, KPIs over time), Updates, Holdings, Asks, Board.
 * The black button is Add update; while an update with staged values is
 * open it is Verify all. A file dropped on the page becomes an update
 * (drops in index.tsx). Fix 5: Edit in the hero (and the More menu) opens
 * the company's edit sheet (logo, basics, details, founders and team);
 * Edit beside the fund position opens Edit investment; Edit numbers (More
 * menu and the KPI section) opens the KPI table.
 */
import { Suspense, useState } from 'react';
import { Check, Landmark, MoreHorizontal, Pencil, Plus, Send, Table2, Trash2 } from 'lucide-react';
import { Button, LoadError, Menu, MenuItem, PageBody, PageHeader, Skeleton, Tabs } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import type { PageProps } from '../../lib/contract.ts';
import { lazyPage } from '../../lib/lazy.ts';
import { AddUpdate } from './AddUpdate.tsx';
import { Asks } from './Asks.tsx';
import { BoardTab } from './BoardTab.tsx';
import { CompanyHero } from './CompanyHero.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Holdings } from './Holdings.tsx';
import { RequestDialog } from './RequestDialog.tsx';
import { UPDATE_READS, UpdateView, UpdatesList } from './Updates.tsx';
import type { CompanyView, UpdateDetail } from './types.ts';

// The edit sheets load on first use (and are prefetched after the first paint).
const EditCompanySheet = lazyPage(() => import('../../components/company/EditCompany.tsx'), 'EditCompanySheet');
const EditNumbers = lazyPage(() => import('./EditNumbers.tsx'), 'EditNumbers');
const EditInvestment = lazyPage(() => import('./EditInvestment.tsx'), 'EditInvestment');

type Tab = 'overview' | 'updates' | 'holdings' | 'asks' | 'board';
const TABS: Tab[] = ['overview', 'updates', 'holdings', 'asks', 'board'];

/** What the company page reads (portfolio.company reloads when any of these change). */
export const PAGE_READS = ['companies', 'people', 'deal_people', 'deals', 'holdings', 'securities', 'ownership', 'rounds', 'marks', 'updates', 'kpi_values', 'asks', 'board_meetings', 'files', 'file_texts'];

/** Scroll to the page's Files (the Data room link), on the Overview tab. */
function showFiles(): void {
  setQuery({ tab: null, update: null });
  let tries = 0;
  const look = (): void => {
    const el = document.getElementById('company-files');
    if (el !== null) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    else if (tries++ < 30) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

export function CompanyPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const company = params['company'] ?? '';
  const tab = (TABS.includes(query.get('tab') as Tab) ? query.get('tab') : 'overview') as Tab;
  const update = query.get('update') ?? '';
  const edit = allowed(me, 'portfolio:edit');
  const editCompany = allowed(me, 'network:edit');
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [numbers, setNumbers] = useState(false);
  const [investing, setInvesting] = useState(false);
  const page = useOp<CompanyView>('portfolio.company', { company }, PAGE_READS, { name: 'portfolio.company', keep: true });
  const openUpdate = tab === 'updates' ? update : '';
  const upd = useOp<{ update: UpdateDetail }>('updates.get', { update: openUpdate }, UPDATE_READS, { name: 'updates.get', skip: openUpdate === '' });
  const u = openUpdate !== '' ? upd.data?.update : undefined;
  const stagedOpen = u !== undefined ? u.values.filter((v) => v.status === 'staged').length : 0;
  const updates = useOp<{ updates: { status: string }[] }>('updates.list', { company, status: 'open' }, UPDATE_READS, { name: 'updates.open' });
  const v = page.data;
  const name = v?.company.name ?? '';
  const staged = (updates.data?.updates ?? []).filter((x) => x.status === 'staged').length;
  const openAsks = v !== null ? v.asks.open + v.asks.in_progress : 0;
  const readUpdate = (id: string): void => setQuery({ tab: 'updates', update: id });

  return (
    <>
      <PageHeader back={update !== '' && tab === 'updates' ? '#/portfolio/' + company + '?tab=updates' : '#/portfolio'} title={name !== '' ? name : 'Company'}>
        {(edit || editCompany) && (
          <Menu label="More" icon={MoreHorizontal}>
            {(close) => (
              <>
                {editCompany && (
                  <MenuItem icon={Pencil} onClick={() => (close(), setEditing(true))}>
                    Edit company
                  </MenuItem>
                )}
                {edit && (
                  <MenuItem icon={Table2} onClick={() => (close(), setNumbers(true))}>
                    Edit numbers
                  </MenuItem>
                )}
                {edit && (
                  <MenuItem icon={Landmark} onClick={() => (close(), setInvesting(true))}>
                    Edit investment
                  </MenuItem>
                )}
                {edit && (
                  <MenuItem icon={Send} onClick={() => (close(), setRequesting(true))}>
                    Request updates
                  </MenuItem>
                )}
                {u !== undefined && u.status !== 'dismissed' && (
                  <MenuItem icon={Trash2} danger onClick={() => (close(), void act([], () => op('updates.dismiss', { update: u.id }), UPDATE_READS).then(() => setQuery({ update: null })))}>
                    Not an update
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
        {edit &&
          (stagedOpen > 0 && u !== undefined ? (
            <Button variant="primary" icon={Check} onClick={() => void act([], () => op('kpis.verify', { update: u.id }), UPDATE_READS)}>
              Verify all
            </Button>
          ) : (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add update
            </Button>
          ))}
      </PageHeader>
      <PageBody>
        {page.error !== null && v === null ? (
          <LoadError message={page.error} onRetry={page.reload} />
        ) : v === null ? (
          <>
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-9 w-80" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <CompanyHero v={v} onFiles={showFiles} onUpdate={readUpdate} onEdit={editCompany ? () => setEditing(true) : undefined} onEditInvestment={edit ? () => setInvesting(true) : undefined} />
            <Tabs
              label="Company"
              value={tab}
              onChange={(t) => setQuery({ tab: t === 'overview' ? null : t, update: null })}
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'updates', label: 'Updates', count: staged > 0 ? staged : undefined },
                { value: 'holdings', label: 'Holdings' },
                { value: 'asks', label: 'Asks', count: openAsks > 0 ? openAsks : undefined },
                { value: 'board', label: 'Board' },
              ]}
            />
            {tab === 'overview' && <Dashboard company={company} v={v} baseCurrency={me.firm.base_currency || 'USD'} edit={edit} onAdd={() => setAdding(true)} onUpdate={readUpdate} onEditNumbers={edit ? () => setNumbers(true) : undefined} />}
            {tab === 'updates' && (update !== '' ? <UpdateView update={update} /> : <UpdatesList company={company} />)}
            {tab === 'holdings' && <Holdings company={company} />}
            {tab === 'asks' && <Asks company={company} />}
            {tab === 'board' && <BoardTab company={company} />}
          </>
        )}
      </PageBody>
      <AddUpdate company={company} open={adding} onClose={() => setAdding(false)} />
      <Suspense fallback={null}>
        {editing && <EditCompanySheet company={v?.company.id ?? company} open onClose={() => setEditing(false)} />}
        {numbers && <EditNumbers company={v?.company.id ?? company} name={name} open onClose={() => setNumbers(false)} />}
        {investing && <EditInvestment company={v?.company.id ?? company} name={name} open onClose={() => setInvesting(false)} />}
      </Suspense>
      <RequestDialog open={requesting} onClose={() => setRequesting(false)} only={company} />
    </>
  );
}
