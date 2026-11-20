/**
 * Portfolio module (SPEC 7.10, 13.2): the Portfolio page, the portfolio
 * company page, the unfiled update page, the deal page's Investment tab, a
 * Portfolio tab on company pages, Focus cards (kpis, alert), the Settings
 * section, the drop of a founder update on a company page and two Ctrl K
 * commands.
 */
import { ArrowUpRight, Building2, Inbox, Send } from 'lucide-react';
import { Button, ChipPicker, Empty, LoadError, PageBody, PageHeader, Panel, Skeleton } from '../../components/ui.tsx';
import { AlertCard, KpisCard } from '../../components/portfolio/cards.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { CardRenderer, CommandDef, CompanyTab, DealTab, DropHandler, NavItem, PageProps, RecordLike, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { addUpdate } from './AddUpdate.tsx';
import { CompanyPage } from './CompanyPage.tsx';
import { Investment, showInvestment } from './Investment.tsx';
import { Overview } from './Overview.tsx';
import { LIST_READS, PortfolioPage } from './PortfolioPage.tsx';
import { PortfolioSettings } from './Settings.tsx';
import { UPDATE_READS, UpdateView } from './Updates.tsx';
import type { PortfolioList, UpdateDetail } from './types.ts';

/** An update that came without a known company: read it, file it to a company in one click. */
function UnfiledUpdate({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['update'] ?? '';
  const live = useOp<{ update: UpdateDetail }>('updates.get', { update: id }, UPDATE_READS, { name: 'updates.get' });
  const list = useOp<PortfolioList>('holdings.list', {}, LIST_READS, { name: 'holdings.list' });
  const edit = allowed(me, 'portfolio:edit');
  const u = live.data?.update;
  const options = (list.data?.rows ?? []).map((r) => ({ value: r.company.id, label: r.company.name })).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i);
  const file = (company: string): void => {
    void act([], () => op('updates.assign', { update: id, company }), UPDATE_READS).then((r) => {
      if (r !== null) navigate('/portfolio/' + company, { tab: 'updates', update: id });
    });
  };
  return (
    <>
      <PageHeader title={u?.from_name || u?.from_email || 'Update'} back="#/portfolio">
        {edit && u !== undefined && u.status !== 'dismissed' && (
          <Button onClick={() => void act([], () => op('updates.dismiss', { update: id }), UPDATE_READS).then(() => navigate('/portfolio'))}>
            Not an update
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : u === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            {u.company === null && edit && options.length > 0 && (
              <Panel label="Company">
                <ChipPicker label="File to" options={options} value="" onChange={file} keys />
              </Panel>
            )}
            <UpdateView update={id} />
          </>
        )}
      </PageBody>
    </>
  );
}

/* Company pages (network): a Portfolio tab for companies the firm holds. */
let held: Set<string> | null = null;
let loading = false;
function heldIds(): Set<string> | null {
  if (held === null && !loading) {
    loading = true;
    void op<PortfolioList>('holdings.list', { status: 'all' }, { quiet: true })
      .then((r) => {
        held = new Set(r.rows.map((x) => x.company.id));
      })
      .catch(() => {
        held = new Set();
      })
      .finally(() => {
        loading = false;
      });
  }
  return held;
}

function CompanyTabBody({ company }: { company: RecordLike }): React.JSX.Element {
  const me = useMe();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon={ArrowUpRight} onClick={() => navigate('/portfolio/' + company.id)}>
          Open in Portfolio
        </Button>
      </div>
      <Overview company={company.id} baseCurrency={me.firm.base_currency || 'USD'} onAdd={() => navigate('/portfolio/' + company.id)} />
    </div>
  );
}

function NoAccess(): React.JSX.Element {
  return <Empty icon={Building2} title="Not in portfolio" />;
}

export const routes: RouteDef[] = [
  { path: '/portfolio', page: PortfolioPage, perm: 'portfolio:view', dense: true },
  { path: '/portfolio/updates/:update', page: UnfiledUpdate, title: 'Update', perm: 'portfolio:view' },
  { path: '/portfolio/:company', page: CompanyPage, title: 'Company', perm: 'portfolio:view' },
];

export const nav: NavItem = { key: 'portfolio', label: 'Portfolio', icon: Building2, path: '/portfolio', order: 50, perm: 'portfolio:view' };

export const cards: Record<string, CardRenderer> = {
  kpis: { body: KpisCard, figures: false },
  alert: AlertCard,
};

export const dealTabs: DealTab[] = [{ key: 'investment', label: 'Investment', order: 60, component: Investment, show: showInvestment, perm: 'portfolio:view' }];

export const companyTabs: CompanyTab[] = [
  {
    key: 'portfolio',
    label: 'Portfolio',
    order: 30,
    perm: 'portfolio:view',
    component: ({ company }) => (heldIds()?.has(company.id) === false ? <NoAccess /> : <CompanyTabBody company={company} />),
    show: ({ company }) => heldIds()?.has(company.id) === true,
  },
];

export const settings: SettingsSection[] = [{ key: 'portfolio', label: 'Portfolio', order: 65, component: PortfolioSettings, perm: 'portfolio:view' }];

/** A founder update file dropped on a portfolio company page becomes an update of that company. */
export const drops: DropHandler[] = [
  {
    key: 'portfolio-update',
    label: 'Founder update',
    order: 10,
    accepts: (i) => /^\/portfolio\/[a-z0-9]{15}$/.test(i.path) && (i.files.length > 0 || (i.text !== null && i.text.trim().length > 40)),
    handle: async (i) => {
      const company = i.path.split('/')[2] ?? '';
      const id = await addUpdate(company, i.files, i.files.length === 0 ? (i.text ?? '').trim() : '');
      return '#/portfolio/' + company + (id !== null ? '?tab=updates&update=' + id : '');
    },
  },
];

export const commands: CommandDef[] = [
  { key: 'portfolio-open', label: 'Portfolio', icon: Building2, keywords: 'holdings companies kpis runway', perm: 'portfolio:view', run: () => navigate('/portfolio') },
  { key: 'portfolio-gmail', label: 'Check Gmail for founder updates', icon: Inbox, keywords: 'updates sweep mail', perm: 'portfolio:edit', run: () => void act([], () => op('updates.sweep', {}), LIST_READS) },
  { key: 'portfolio-requests', label: 'Request updates', icon: Send, keywords: 'founders kpis email', perm: 'portfolio:edit', run: () => navigate('/portfolio') },
];
