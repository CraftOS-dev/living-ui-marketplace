/**
 * Renewals of trademarks and designs: the list grouped by decision
 * (pending first) with bulk decisions, instructions to the provider and
 * payments, and the five-year cost forecast by office.
 */
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t, tn } from '../lib/i18n.ts';
import { useHashParam } from '../lib/router.ts';
import { PageHeader } from '../components/ui.tsx';
import { ForecastPanel, RenewalList } from '../components/protectRenewals.tsx';

export function RenewalsPage(): React.JSX.Element {
  const { can } = useApp();
  const [tab, setTab] = useHashParam('tab', 'list');
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ refreshed: number }>('renewals/refresh-costs', {});
      toast.success(tn(r.refreshed, 'Costs recalculated for {n} renewal', 'Costs recalculated for {n} renewals'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('Renewals')}
        subtitle={t('Decide which marks and designs to keep, instruct your provider, and record each payment. Lapsing needs a reason.')}
        actions={
          can.edit ? (
            <Button variant="outline" onClick={() => void refresh()} loading={busy} title={t('Re-price renewals not yet instructed from the fee schedule and exchange rates')}>
              <RefreshCw size={14} aria-hidden /> {t('Refresh costs')}
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="min-w-0">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="list">{t('Renewals')}</TabsTrigger>
            <TabsTrigger value="forecast">{t('Forecast')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="list">
          <RenewalList showFilters />
        </TabsContent>
        <TabsContent value="forecast">
          <ForecastPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
