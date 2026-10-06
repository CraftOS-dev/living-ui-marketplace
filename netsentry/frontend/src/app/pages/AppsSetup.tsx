/**
 * Setup › Your apps (plan §4.1 J2–J3, §10.1–10.2): "we found N apps" and one question per app —
 * who should be able to open it. Our suggestion for each kind of app is preselected; confirming or
 * changing it is what makes the reach verdicts the person's own.
 */
import { useEffect, useState } from 'react';
import { EmptyState, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { AppIcon, ReachChooser } from '../components/Apps.tsx';
import { Breadcrumbs } from '../components/Breadcrumbs.tsx';
import { TONE_COLOR } from '../components/visual.tsx';
import { appName, loadCatalogue } from '../lib/apps.ts';
import { useMe } from '../lib/me.tsx';
import type { AppRecord, CatalogueApp, IntentRecord } from '../lib/types.ts';

export function AppsSetup(): React.JSX.Element {
  const { can } = useMe();
  const apps = useCollection<AppRecord>('apps', { filter: 'status = "active"', sort: 'display_name' });
  const intents = useCollection<IntentRecord>('intents');
  const [cat, setCat] = useState<CatalogueApp[]>([]);
  useEffect(() => void loadCatalogue().then(setCat), []);

  const confirmed = (a: AppRecord): boolean => intents.records.some((i) => i.app === a.id && i.source !== 'default');
  const todo = apps.records.filter((a) => !confirmed(a));

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: 'Who should reach your apps' }]} />
      <h1 className="text-[20px] font-semibold">We found {apps.records.length} app{apps.records.length === 1 ? '' : 's'}</h1>
      <p className="mb-4 mt-1 text-[14px] text-[var(--agent-app-muted)]">
        For each one, choose who should be able to open it. NetSentry then checks that only they can — and tells you when that changes.
      </p>
      {apps.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : apps.records.length === 0 ? (
        <EmptyState title="No apps found yet" message="Apps appear here once the monitor on this server has reported (a minute or two after it starts)." />
      ) : (
        <div className="flex flex-col gap-4">
          {todo.length === 0 && (
            <p className="rounded-xl bg-[var(--agent-app-surface-2)] px-4 py-3 text-[14px]" style={{ color: TONE_COLOR.good }}>
              All done — every app has your answer. You can change any of them from the app's page.
            </p>
          )}
          {[...todo, ...apps.records.filter(confirmed)].map((a) => {
            const entry = cat.find((c) => c.id === a.app_type);
            const intent = intents.records.find((i) => i.app === a.id);
            return (
              <div key={a.id} className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-[var(--agent-app-muted)]">
                    <AppIcon category={entry?.category ?? ''} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{appName(a)}</span>
                    <span className="block text-[12px] text-[var(--agent-app-muted)]">{entry?.what ?? a.app_type}</span>
                  </span>
                  {confirmed(a) && <span className="text-[12px]" style={{ color: TONE_COLOR.good }}>Answered</span>}
                </div>
                <ReachChooser
                  key={`${intent?.reach}-${intent?.source}`}
                  app={a}
                  current={intent?.reach ?? entry?.default_intent ?? 'local_network'}
                  source={intent?.source ?? 'default'}
                  canEdit={can('analyst')}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
