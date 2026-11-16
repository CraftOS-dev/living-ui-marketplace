/**
 * The module page contract (documented in full at the top of routes.tsx).
 * Each module's `pages/<module>/index.tsx` exports values of these types.
 */
import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PageProps {
  /** ':name' segments of the route path. */
  params: Record<string, string>;
  query: URLSearchParams;
}

export interface RouteDef {
  /** '/time' or '/time/attendance/:id'. Module paths start with the module's own segment. */
  path: string;
  page: ComponentType<PageProps>;
  /** The browser tab title (plain words, already through t()). */
  title: string;
  /** Who may open it, as in the catalog: 'time:view', 'admin', 'team', 'employee', 'signed' (default), alternatives with '|'. */
  perm?: string | undefined;
  /** 'print' renders the page alone on white A4 (no shell), for #/print/... routes. */
  frame?: 'app' | 'print' | undefined;
}

/** A static sub-page shown as a child row under the module's place in the sidebar. */
export interface NavChild {
  key: string;
  label: string;
  to: string;
  perm?: string | undefined;
}

/** Dynamic children (departments, pay schedules) with an inline "+" on the parent row. */
export interface NavTree {
  children: { id: string; label: string; to: string; count?: number | undefined }[];
  /** The "+" on the parent row (and on each child when `addTo` is given). */
  onAdd?: (() => void) | undefined;
  addLabel?: string | undefined;
  /** "+" on a child row ("Add a person to Sales", "Off-cycle run on Monthly"). */
  addTo?: ((id: string) => void) | undefined;
  addToLabel?: string | undefined;
}

/**
 * A module's fact about a person: what a module's backend `profileFacts`
 * (events_<module>.js) answers, shown in the profile's "At a glance" and on
 * Home. ONE shape for every module; the kernel formats it (FactValue in
 * components/ui.tsx):
 *   text   value as it is (no kind means text)
 *   money  value in integer minor units with `currency`, through <Money> (Hide pay blanks it)
 *   count  a number ("3")            days   a number of days ("14 days", "1.5 days")
 *   hours  a number of hours ("37.5 h")
 *   date   'YYYY-MM-DD', in the app's date style
 * `tone` colours the value; `link` makes it a link ("#/leave?tab=balances").
 * The period of a money fact belongs in its label ("Monthly pay").
 */
export interface ProfileFact {
  key: string;
  label: string;
  value: string | number;
  kind?: 'text' | 'money' | 'count' | 'days' | 'hours' | 'date' | undefined;
  currency?: string | undefined;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | undefined;
  link?: string | undefined;
}

export interface ProfileTabProps {
  /** The employee record id. */
  employee: string;
  /** The employment shown (primary, or the one chosen in the header). */
  employment: string;
  /** The employment's entity id and its currency. */
  entity: string;
  currency: string;
  /** True when the viewer is looking at their own profile. */
  self: boolean;
}

export interface ProfileTab {
  key: string;
  label: string;
  perm?: string | undefined;
  /** Also shown to the person themselves and to their managers (default true). */
  selfAndTeam?: boolean | undefined;
  order?: number | undefined;
  component: ComponentType<ProfileTabProps>;
}

/** The one strong black action at the top of the sidebar. */
export interface PrimaryAction {
  label: string;
  /** One or two words for the sidebar's black row ("Run payroll"); `label` is the tooltip. Piano Coach's is one word. */
  short?: string | undefined;
  icon: LucideIcon;
  /** Either a route or a function (Clock in). */
  to?: string | undefined;
  run?: (() => void | Promise<void>) | undefined;
  busy?: boolean | undefined;
}

export interface PrimaryDef {
  /** Which home it serves: payroll admins, managers or employees. */
  for: 'payroll' | 'manager' | 'employee';
  /** A hook (called once per render of the sidebar) returning the action, or null to fall back. */
  usePrimary: () => PrimaryAction | null;
}

export interface ApprovalViewProps {
  /** The approval as approvals.list returns it (kind, ref, payload, summary, amount). */
  approval: Record<string, unknown>;
}

/** One thing waiting for the viewer that is not an approval (a task, feedback owed, a review to write). */
export interface InboxItem {
  id: string;
  /** One line: what to do ("Write the review for Sam Wong"). */
  title: string;
  /** A muted second line (who, which cycle, from where). */
  sub?: string | undefined;
  /** Where "Open" goes ('#/lifecycle/tasks/abc'); the whole row opens it. */
  link?: string | undefined;
  /** 'YYYY-MM-DD': shown as "due in 3 days", red when past. */
  due?: string | undefined;
  /** A person the item is about (an initials chip). */
  person?: string | undefined;
  /**
   * Small actions on the row ("Done", "Skip"); a primary one is drawn in ink. A decision ("Agree",
   * "Decline") names its `outcome`: the button takes its icon, the row shows the outcome and folds
   * away (components/decision.tsx), then `run` goes; return act()'s promise so a failure brings the row back.
   */
  actions?: InboxAction[] | undefined;
}

/** What a decision on a row comes to (components/decision.tsx draws it). */
export type Outcome = 'approved' | 'accepted' | 'rejected' | 'declined' | 'dismissed' | 'done';

export interface InboxAction {
  label: string;
  run: () => unknown;
  primary?: boolean | undefined;
  outcome?: Outcome | undefined;
}

/** A module's block in the Inbox ("For you" view), below approvals; its count adds to the sidebar badge. */
export interface InboxSection {
  key: string;
  label: string;
  /** A hook returning the viewer's open items, kept live (null while loading). Called on every render, in a stable order. */
  useItems: () => InboxItem[] | null;
  order?: number | undefined;
  perm?: string | undefined;
}

/**
 * What the Home host passes to a widget: `index`, the widget's place in the
 * page's reading order ("03"), for its Panel (`<Panel index={index} ...>`),
 * so module widgets are numbered with Home's own panels. Undefined when the
 * host shows the widget unnumbered.
 */
export interface HomeWidgetProps {
  index?: string | undefined;
}

/** A panel the home-reports builder places on Home for one kind of viewer. */
export interface HomeWidget {
  key: string;
  for: 'admin' | 'manager' | 'employee';
  component: ComponentType<HomeWidgetProps>;
  order?: number | undefined;
  size: 'wide' | 'narrow';
}

export interface ModuleExports {
  routes: RouteDef[];
  /**
   * Pages that open before anyone signs in (the time kiosk on a shared office
   * tablet). Rendered alone, without the shell and without a session; their
   * operations must be `perm: 'public'`. `perm` and `frame` are not used here.
   */
  publicRoutes?: RouteDef[] | undefined;
  nav?: NavChild[] | undefined;
  useNavTree?: (() => NavTree | null) | undefined;
  profileTabs?: ProfileTab[] | undefined;
  primary?: PrimaryDef[] | undefined;
  /** Decision context inside an Inbox approval card, by approval kind ("leave_request"). */
  approvalViews?: Record<string, ComponentType<ApprovalViewProps>> | undefined;
  inboxSections?: InboxSection[] | undefined;
  homeWidgets?: HomeWidget[] | undefined;
}

export type { ReactNode };
