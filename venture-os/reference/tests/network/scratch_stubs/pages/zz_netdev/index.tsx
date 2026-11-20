/** SCRATCH STUB (network builder only, NEVER copied to APP): pages that show the Today panel and a brief for screenshots. */
import { PageBody, PageHeader } from '../../components/ui.tsx';
import { TodayPanel } from '../../components/network/Today.tsx';
import { BriefSheet } from '../../components/network/BriefSheet.tsx';
import type { PageProps, RouteDef } from '../../lib/contract.ts';
import { navigate } from '../../lib/router.ts';

function TodayDev({ query }: PageProps): React.JSX.Element {
  return (
    <>
      <PageHeader title="Today" />
      <PageBody>
        <div className="max-w-[520px]">
          <TodayPanel />
        </div>
        <BriefSheet event={query.get('event') ?? ''} onClose={() => navigate('/zz-today')} />
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [{ path: '/zz-today', page: TodayDev }];
