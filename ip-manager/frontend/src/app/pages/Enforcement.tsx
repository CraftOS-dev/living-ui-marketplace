/**
 * Watch and disputes: triage the trademark watch reports your provider
 * sends, and track every opposition, cancellation, lawsuit and takedown
 * with its own deadlines and documents.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit/index.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import { PageHeader } from '../components/ui.tsx';
import { WatchTab } from '../components/enforceWatch.tsx';
import { DisputesTab } from '../components/enforceDisputes.tsx';

export function EnforcementPage(): React.JSX.Element {
  const [tab, setTab] = useHashParam('tab', 'watch');
  return (
    <div>
      <PageHeader
        title="Watch and disputes"
        subtitle="Triage the similar marks your watch provider reports, and follow oppositions, cancellations, lawsuits and takedowns through to the outcome."
      />
      <Tabs value={tab === 'disputes' ? 'disputes' : 'watch'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="watch">Watch</TabsTrigger>
          <TabsTrigger value="disputes">Disputes</TabsTrigger>
        </TabsList>
        <TabsContent value="watch">
          <WatchTab onOpenDispute={(id) => navigate('enforcement', undefined, { tab: 'disputes', dispute: id })} />
        </TabsContent>
        <TabsContent value="disputes">
          <DisputesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
