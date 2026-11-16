/**
 * The employee's own Home (also the Home of anyone without admin or team
 * pages): the clock and the leave balance first (on a phone the first two
 * things), then what to do (documents to acknowledge and every module's
 * items for me), the modules' employee widgets, my requests and the answers
 * from your AI agent. One combined read (home.me) draws this module's
 * panels; the modules' parts follow once it answered.
 */
import { useMemo } from 'react';
import { ClockCard, NeedsYou, useModuleGroups, widgetsFor } from '../../components/home/parts.tsx';
import { HomeGrid } from '../../components/home/grid.tsx';
import type { Place } from '../../components/home/grid.tsx';
import { usePageOp } from '../../components/home/load.tsx';
import type { MeHomeData } from '../../components/home/types.ts';
import { LoadError, PageBody, PageHeader } from '../../components/ui.tsx';
import { useMe } from '../../lib/auth.tsx';
import { fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { NotLinked } from '../people/Start.tsx';
import { AskPanel, documentGroup, ME_READS, RequestsPanel } from './parts.tsx';

export function useMeHome(places = false): { data: MeHomeData | null; error: string | null; reload: () => void; answered: boolean } {
  const live = usePageOp<MeHomeData>('home.me', places ? { places: true } : {}, ME_READS, places ? 'home.me.places' : 'home.me');
  return { data: live.data, error: live.error, reload: live.reload, answered: live.answered };
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const first = name.split(' ')[0] ?? name;
  return t(h < 12 ? 'me.hello.morning' : h < 18 ? 'me.hello.afternoon' : 'me.hello.evening', { name: first });
}

function MeHomeBody(): React.JSX.Element {
  const me = useMe();
  const live = useMeHome();
  const d = live.data;
  const mod = useModuleGroups();
  const groups = useMemo(() => (d === null ? [] : documentGroup(d.documents)).concat(mod.groups), [d, mod.groups]);
  const main = d?.employments.find((x) => x.primary) ?? d?.employments[0] ?? null;
  const metaLine = [main?.title ?? '', main?.department_name ?? '', main?.entity_name ?? '', fmtDay(me.today, { weekday: true })]
    .filter((x) => x !== '')
    .join(' · ')
    .toUpperCase();
  // Every place in reading order (the clock and the leave balance first, the first two things on a phone);
  // the grid numbers the ones this person sees, and mounts the widgets once this visit's read is in.
  const places: Place[] = [{ key: 'clock', span: 4, numbers: 1, render: ([i]) => <ClockCard index={i} clock={d?.clock ?? null} /> }];
  for (const w of widgetsFor('employee', 20, 29)) places.push({ key: 'w.' + w.key, widget: w });
  for (const w of widgetsFor('employee', undefined, 19)) places.push({ key: 'w.' + w.key, widget: w });
  places.push({ key: 'needs', span: 4, numbers: 1, render: ([i]) => <NeedsYou index={i} groups={groups} loading={d === null} settled={mod.done} emptyText={t('me.todo_clear')} /> });
  for (const w of widgetsFor('employee', 30)) places.push({ key: 'w.' + w.key, widget: w });
  places.push({ key: 'requests', span: 6, numbers: 1, render: ([i]) => <RequestsPanel index={i} limit={6} data={d} /> });
  places.push({ key: 'ask', span: 6, numbers: 1, render: ([i]) => <AskPanel index={i} answers={d?.answers ?? null} /> });
  return (
    <>
      <PageHeader title={greeting(me.employee?.name ?? me.member.name)} meta={metaLine} />
      <PageBody>{live.error !== null && d === null ? <LoadError message={live.error} onRetry={live.reload} /> : <HomeGrid places={places} ready={live.answered && d !== null} painted={d !== null} />}</PageBody>
    </>
  );
}

export function MeHome(): React.JSX.Element {
  const me = useMe();
  if (me.employee === null)
    return (
      <>
        <PageHeader title={greeting(me.member.name)} meta={fmtDay(me.today, { weekday: true }).toUpperCase()} />
        <PageBody>
          <NotLinked />
        </PageBody>
      </>
    );
  return <MeHomeBody />;
}
