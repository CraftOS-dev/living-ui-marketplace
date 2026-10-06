/**
 * Issues — every problem in one place: the issue list, cases (related
 * serious issues grouped), and the fixes being planned or applied. One level
 * deeper, #/issues/all is every issue as a table with technical names.
 */
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { Breadcrumbs, DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { CodeIcon } from '../components/icons.tsx';
import { useMe } from '../lib/me.tsx';
import { go, to } from '../lib/nav.ts';
import { DetailScope } from '../lib/view.tsx';
import type { Finding, Incident, Remediation } from '../lib/types.ts';
import { Findings } from './Findings.tsx';
import { Fixes } from './Fixes.tsx';
import { Incidents } from './Incidents.tsx';

export type IssuesTab = 'list' | 'cases' | 'fixes';

/** Issues list pre-filtered from a link, e.g. #/issues/handled. */
export type IssuesFilter = 'acknowledged' | undefined;

export function Issues({ tab, filter, onTab }: { tab: IssuesTab; filter?: IssuesFilter; onTab: (t: IssuesTab) => void }): React.JSX.Element {
  const { can } = useMe();
  const open = useCollection<Finding>('findings', { filter: 'status = "open" || status = "acknowledged"' });
  const cases = useCollection<Incident>('incidents', { filter: '(status = "new" || status = "investigating") && finding_count > 1' });
  const decisions = useCollection<Remediation>('remediations', { filter: 'status = "planned" && risk_class != "guided"' });
  const n = (x: number): string => (x ? ` (${x})` : '');
  return (
    <>
      <Breadcrumbs trail={[{ label: 'Activity', to: 'activity' }, { label: 'All problems' }]} />
      <PageHeader title="All problems, one by one" subtitle="Every problem on its own, including the ones being handled. Home groups them by cause — that's the list to work from." />
      <Tabs value={tab} onValueChange={(v) => onTab(v as IssuesTab)}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="list">Problems{n(open.records.length)}</TabsTrigger>
          <TabsTrigger value="cases">Related{n(cases.records.length)}</TabsTrigger>
          <TabsTrigger value="fixes">Fixes{can('admin') && decisions.records.length ? ` (${decisions.records.length} to approve)` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Findings key={filter ?? 'all'} embedded onOpenFinding={(id) => go(to.issue(id))} initialStatus={filter} />
          <div className="mx-auto mt-4 max-w-3xl">
            <DrillList>
              <DrillRow to="issues/all" icon={<CodeIcon size={18} />} label="Every problem, in a table" hint="Technical names, detection rules, sortable" />
            </DrillList>
          </div>
        </TabsContent>
        <TabsContent value="cases">
          <Incidents embedded onOpenIncident={(id) => go(to.case(id))} />
        </TabsContent>
        <TabsContent value="fixes">
          <Fixes embedded />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** #/issues/all — the technical table, one level below Issues. */
export function AllIssues(): React.JSX.Element {
  return (
    <>
      <Breadcrumbs trail={[{ label: 'All problems', to: 'issues' }, { label: 'Table' }]} />
      <DetailScope on>
        <Findings embedded onOpenFinding={(id) => go(to.issue(id, true))} />
      </DetailScope>
    </>
  );
}
