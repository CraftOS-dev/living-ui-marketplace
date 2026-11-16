/**
 * Time: the clock (employees), the attendance board (HR and managers), the
 * schedule, attendance by month, timesheets, requests, time settings and
 * the kiosk for a shared tablet. The module page contract is documented at
 * the top of routes.tsx.
 *
 * `publicRoutes` (beyond the contract): pages that must open before anyone
 * signs in. The kiosk tablet runs signed out; the app frame renders these
 * alone, without the shell, when their path matches.
 */
import { useMemo } from 'react';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { InboxItem, InboxSection, NavChild, PageProps, PrimaryDef, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, useOp } from '../../lib/live.ts';
import { AttendanceRequestView, OvertimeView, ShiftRequestView, TimesheetView } from './Approvals.tsx';
import { AttendancePage } from './Attendance.tsx';
import { BoardPage } from './Board.tsx';
import { ClockPage, useClockAction } from './Clock.tsx';
import { KioskPage } from './Kiosk.tsx';
import { TimeTab } from './ProfileTab.tsx';
import { RequestsPage } from './Requests.tsx';
import { SchedulePage } from './Schedule.tsx';
import { SettingsPage } from './Settings.tsx';
import { PersonSheetPage, TimesheetsPage } from './Timesheets.tsx';
import type { ShiftRequest } from './types.ts';
import { READS, seesOthers } from './util.ts';

/** /time: the board for people who see others, the clock for everyone else. */
function TimeHome(props: PageProps): React.JSX.Element {
  const me = useMe();
  return seesOthers(me) ? <BoardPage {...props} /> : <ClockPage {...props} />;
}

export const routes: RouteDef[] = [
  { path: '/time', page: TimeHome, title: t('time.title') },
  { path: '/time/clock', page: ClockPage, title: t('time.clock.title'), perm: 'employee' },
  { path: '/time/schedule', page: SchedulePage, title: t('time.sched.title') },
  { path: '/time/attendance', page: AttendancePage, title: t('time.att.title') },
  { path: '/time/timesheets', page: TimesheetsPage, title: t('time.ts.title') },
  { path: '/time/timesheets/:employment', page: PersonSheetPage, title: t('time.ts.title') },
  { path: '/time/requests', page: RequestsPage, title: t('time.req.title') },
  { path: '/time/settings', page: SettingsPage, title: t('time.set.title'), perm: 'time:view' },
  { path: '/time/kiosk/:code', page: KioskPage, title: t('time.kiosk.title') },
];

/** Opened before sign-in (the kiosk tablet), rendered without the shell. */
export const publicRoutes: RouteDef[] = [{ path: '/time/kiosk/:code', page: KioskPage, title: t('time.kiosk.title') }];

export const nav: NavChild[] = [
  { key: 'clock', label: t('time.nav.clock'), to: '/time/clock', perm: 'employee' },
  { key: 'schedule', label: t('time.nav.schedule'), to: '/time/schedule' },
  { key: 'attendance', label: t('time.nav.attendance'), to: '/time/attendance' },
  { key: 'timesheets', label: t('time.nav.timesheets'), to: '/time/timesheets' },
  { key: 'requests', label: t('time.nav.requests'), to: '/time/requests' },
  { key: 'settings', label: t('time.nav.settings'), to: '/time/settings', perm: 'time:view' },
];

export const profileTabs: ProfileTab[] = [{ key: 'time', label: t('time.tab.label'), component: TimeTab, perm: 'time:view', order: 30 }];

export const primary: PrimaryDef[] = [{ for: 'employee', usePrimary: useClockAction }];

export const approvalViews = {
  attendance_request: AttendanceRequestView,
  shift_request: ShiftRequestView,
  timesheet: TimesheetView,
  overtime: OvertimeView,
};

/** Swaps colleagues asked the viewer for (answered in place). */
function useSwapAsks(): InboxItem[] | null {
  const me = useMe();
  const live = useOp<{ requests: ShiftRequest[] }>('shift-requests.list', { view: 'mine', status: 'awaiting_peer' }, READS.requests, { skip: me.employee === null, name: 'time.inbox.swaps' });
  const mine = useMemo(() => new Set((me.employee?.employments ?? []).map((e) => e.id)), [me.employee]);
  return useMemo(() => {
    if (me.employee === null) return [];
    if (live.data === null) return null;
    return live.data.requests
      .filter((r) => r.status === 'awaiting_peer' && mine.has(r.swap_with))
      .map((r) => ({
        id: r.id,
        title: t('time.inbox.swap_title', { name: r.name }),
        sub: t('time.inbox.swap_sub', { mine: fmtDay(r.swap_day, { weekday: true }), theirs: fmtDay(r.from_day, { weekday: true }) }) + (r.reason !== '' ? ' · ' + r.reason : ''),
        person: r.name,
        link: '#/time/schedule',
        actions: [
          { label: t('time.sched.decline'), outcome: 'declined', run: () => act([], () => op('shift-requests.respond', { request: r.id, answer: 'decline' }), READS.requests) },
          { label: t('time.sched.accept'), primary: true, outcome: 'accepted', run: () => act([], () => op('shift-requests.respond', { request: r.id, answer: 'accept' }), READS.requests) },
        ],
      }));
  }, [live.data, mine, me.employee]);
}

export const inboxSections: InboxSection[] = [{ key: 'time_swaps', label: t('time.inbox.swaps'), useItems: useSwapAsks, order: 40 }];
