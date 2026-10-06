/**
 * Settings — what configures NetSentry: its monitor on this server, alerts, the team,
 * general & fix policy. The finer controls (detection rules, checks, the
 * audit log) sit one level down, under Settings › More settings.
 */
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit/index.ts';
import { Breadcrumbs, DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { SlidersIcon } from '../components/icons.tsx';
import { DetailScope } from '../lib/view.tsx';
import { AlertsPanel } from './AlertsPanel.tsx';
import { Rules } from './Rules.tsx';
import { SensorsPanel } from './SensorsPanel.tsx';
import { AuditLog, Members, SettingsPanel } from './SettingsPanels.tsx';
import { Sources } from './Sources.tsx';
import { WindowsPanel } from '../components/Updates.tsx';

export const SETTINGS_TABS = ['monitor', 'alerts', 'team', 'general', 'updates', 'rules', 'checks', 'audit'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const ADVANCED: SettingsTab[] = ['rules', 'checks', 'audit'];

export function Settings({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }): React.JSX.Element {
  if (ADVANCED.includes(tab)) {
    return (
      <DetailScope on>
        <Breadcrumbs trail={[{ label: 'Settings', to: 'settings/monitor' }, { label: 'More settings' }]} />
        <PageHeader title="More settings" subtitle="The finer controls: which detection rules run, each check and its schedule, and the tamper-evident audit log." />
        <Tabs value={tab} onValueChange={(v) => onTab(v as SettingsTab)}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="rules">Detection rules</TabsTrigger>
            <TabsTrigger value="checks">Checks</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="rules">
            <Rules embedded />
          </TabsContent>
          <TabsContent value="checks">
            <Sources embedded />
          </TabsContent>
          <TabsContent value="audit">
            <AuditLog />
          </TabsContent>
        </Tabs>
      </DetailScope>
    );
  }
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(v) => onTab(v as SettingsTab)}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="monitor">Monitor</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="general">General & fixes</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
        </TabsList>
        <TabsContent value="monitor">
          <SensorsPanel />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsPanel />
        </TabsContent>
        <TabsContent value="team">
          <Members />
        </TabsContent>
        <TabsContent value="general">
          <SettingsPanel />
        </TabsContent>
        <TabsContent value="updates">
          <WindowsPanel />
        </TabsContent>
      </Tabs>
      <div className="mt-6">
        <DrillList>
          <DrillRow to="settings/rules" icon={<SlidersIcon size={18} />} label="More settings" hint="Detection rules, each check and its schedule, audit log" />
        </DrillList>
      </div>
    </>
  );
}
