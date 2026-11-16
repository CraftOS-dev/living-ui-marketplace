/**
 * Hiring: staffing plans and requisitions, job openings with their
 * pipeline, candidates, interviews and scorecards, offers to the kernel's
 * hire, referrals and settings. In the sidebar, Hiring expands to its
 * places; interviewers and referrers reach their pages from Home, the
 * Inbox and their profile.
 */
import type { HomeWidget, InboxSection, NavChild, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { CandidatePage } from './Candidate.tsx';
import { CandidatesPage } from './Candidates.tsx';
import { HiringHomePage } from './Home.tsx';
import { InterviewPage, InterviewsPage } from './Interviews.tsx';
import { OfferPage, OfferPrint, OffersPage } from './Offers.tsx';
import { OpeningPage } from './Opening.tsx';
import { OpeningsPage } from './Openings.tsx';
import { PlansPage, RequisitionsPage } from './Plans.tsx';
import { ReferralsPage } from './Referrals.tsx';
import { HiringSettingsPage } from './Settings.tsx';
import { MyHiringWidget, OfferApprovalView, PipelineWidget, RequisitionApprovalView, useOwedItems, useReadyItems } from './Widgets.tsx';

const TEAM = 'hiring:view|team';

export const routes: RouteDef[] = [
  { path: '/hiring', page: HiringHomePage, title: t('hiring.title'), perm: TEAM },
  { path: '/hiring/openings', page: OpeningsPage, title: t('hiring.openings'), perm: TEAM },
  { path: '/hiring/openings/:id', page: OpeningPage, title: t('hiring.opening'), perm: TEAM },
  { path: '/hiring/candidates', page: CandidatesPage, title: t('hiring.candidates'), perm: TEAM },
  { path: '/hiring/candidates/:id', page: CandidatePage, title: t('hiring.candidate') },
  { path: '/hiring/interviews', page: InterviewsPage, title: t('hiring.interviews') },
  { path: '/hiring/interviews/:id', page: InterviewPage, title: t('hiring.interview') },
  { path: '/hiring/offers', page: OffersPage, title: t('hiring.offers'), perm: TEAM },
  { path: '/hiring/offers/:id', page: OfferPage, title: t('hiring.offer'), perm: TEAM },
  { path: '/hiring/requisitions', page: RequisitionsPage, title: t('hiring.requisitions'), perm: TEAM },
  { path: '/hiring/plans', page: PlansPage, title: t('hiring.plans'), perm: 'hiring:full' },
  { path: '/hiring/referrals', page: ReferralsPage, title: t('hiring.referrals') },
  { path: '/hiring/settings', page: HiringSettingsPage, title: t('hiring.settings'), perm: 'hiring:view' },
  { path: '/print/hiring/offer/:id', page: OfferPrint, title: t('hiring.offer_letter'), perm: TEAM, frame: 'print' },
];

export const nav: NavChild[] = [
  { key: 'openings', label: t('hiring.openings'), to: '/hiring/openings', perm: TEAM },
  { key: 'candidates', label: t('hiring.candidates'), to: '/hiring/candidates', perm: TEAM },
  { key: 'interviews', label: t('hiring.interviews'), to: '/hiring/interviews', perm: TEAM },
  { key: 'offers', label: t('hiring.offers'), to: '/hiring/offers', perm: TEAM },
  { key: 'requisitions', label: t('hiring.requisitions'), to: '/hiring/requisitions', perm: TEAM },
  { key: 'plans', label: t('hiring.plans'), to: '/hiring/plans', perm: 'hiring:full' },
  { key: 'referrals', label: t('hiring.referrals'), to: '/hiring/referrals', perm: TEAM },
  { key: 'settings', label: t('hiring.settings'), to: '/hiring/settings', perm: 'hiring:full' },
];

export const profileTabs: ProfileTab[] = [];

export const approvalViews = { requisition: RequisitionApprovalView, offer: OfferApprovalView };

export const inboxSections: InboxSection[] = [
  { key: 'hiring_scorecards', label: t('hiring.inbox.scorecards'), useItems: useOwedItems, order: 40 },
  { key: 'hiring_ready', label: t('hiring.inbox.ready'), useItems: useReadyItems, order: 41, perm: 'people:full' },
];

export const homeWidgets: HomeWidget[] = [
  { key: 'hiring_mine', for: 'employee', component: MyHiringWidget, order: 60, size: 'narrow' },
  { key: 'hiring_mine_mgr', for: 'manager', component: MyHiringWidget, order: 60, size: 'narrow' },
  { key: 'hiring_pipeline_mgr', for: 'manager', component: PipelineWidget, order: 61, size: 'wide' },
  { key: 'hiring_pipeline', for: 'admin', component: PipelineWidget, order: 60, size: 'wide' },
];
