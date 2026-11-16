/**
 * The module page contract (SPEC 13.2). Each module's
 * `pages/<module>/index.tsx` may export values of these types; registry.ts
 * collects them. Full example: reference/notes/kernel-frontend.md.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SourceRef } from './source.ts';
import type { NextItem, NextKind } from './types.ts';

export type { SourceRef };

export interface PageProps {
  /** ':name' segments of the route path. */
  params: Record<string, string>;
  query: URLSearchParams;
}

export interface RouteDef {
  /** '/deals' or '/deals/:id'. Module paths start with the module's own segment ('/' is Home's). */
  path: string;
  page: ComponentType<PageProps>;
  /** The browser tab title (plain words). Defaults to the nav label. */
  title?: string | undefined;
  /** Who may open it, as in the catalog: 'pipeline:view', 'admin', 'signed' (default), alternatives with '|'. */
  perm?: string | undefined;
  /** A dense page (a board, a wide table). Informational only: the sidebar folds only by the person's click. */
  dense?: boolean | undefined;
}

/**
 * A count beside a sidebar place: Next items of these kinds (Inbox: verdicts;
 * Committee: votes), read from next.count by the shell; or a hook returning
 * a number (null while loading). A hook is called once per sidebar render.
 */
export type CountSource = { kinds: NextKind[] } | (() => number | null);

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Place order (SPEC 3): home 10, inbox 20, deals 30, committee 40, portfolio 50, funds 60, network 70, markets 80. */
  order: number;
  count?: CountSource | undefined;
  perm?: string | undefined;
  /** Child rows shown as a tree under the place while you are in it. */
  children?: { key: string; label: string; path: string }[] | undefined;
}

/** What a custom Focus card body receives. The frame around it draws title, chips and actions. */
export interface CardProps {
  item: NextItem;
}
/** A card body, or { body, figures: false } when the body shows the figures its own way (a proposal's before and after). */
export type CardRenderer = ComponentType<CardProps> | { body: ComponentType<CardProps>; figures?: boolean | undefined };

/** A record as tabs receive it: at least its id; the owning module defines the rest. */
export type RecordLike = { id: string } & Record<string, unknown>;

export interface TabDef<P> {
  key: string;
  label: string;
  order: number;
  component: ComponentType<P>;
  show?: ((props: P) => boolean) | undefined;
  perm?: string | undefined;
}

export type DealTab = TabDef<{ deal: RecordLike }>;
export type CompanyTab = TabDef<{ company: RecordLike }>;
export type PersonTab = TabDef<{ person: RecordLike }>;

export interface SettingsSection {
  key: string;
  label: string;
  /** Kernel: firm 10, funds 20, members 30, your AI agent 70, data 90, security 100. Modules fill the gaps (pipelines 40, theses 50, templates 60, capture 80). */
  order: number;
  component: ComponentType;
  perm?: string | undefined;
}

/** What was dropped or pasted anywhere in the app. */
export interface DropInput {
  files: File[];
  /** A pasted or dropped URL. */
  url: string | null;
  /** Pasted or dropped plain text (not a URL). */
  text: string | null;
  /** The route it happened on ('/portfolio/c1'). */
  path: string;
}

export interface DropHandler {
  key: string;
  /** The chip shown when more than one handler takes the drop ("New deal"). */
  label: string;
  accepts: (input: DropInput) => boolean;
  /** Does the work and answers where its result is (the shell goes there). */
  handle: (input: DropInput) => Promise<string>;
  /** Lower first when several accept. */
  order?: number | undefined;
}

/** A Ctrl K action. */
export interface CommandDef {
  key: string;
  label: string;
  icon?: LucideIcon | undefined;
  /** Extra words that find it. */
  keywords?: string | undefined;
  perm?: string | undefined;
  run: () => void;
}

/** The one black action at the top of the sidebar (intake: Add deal). */
export interface PrimaryAction {
  label: string;
  icon: LucideIcon;
  run?: (() => void) | undefined;
  to?: string | undefined;
  perm?: string | undefined;
}

/**
 * The one reader for citations (a module that has one registers it; diligence's
 * page view). It is mounted by the shell and opened by `openSource(ref)`, by any
 * Citation with `source`, and by the #/source route. It renders its own Sheet.
 */
export interface ReaderProps {
  source: SourceRef;
  onClose: () => void;
}

/** A Home block (home builder only; SPEC 3.1). */
export interface HomeBlock {
  key: string;
  order: number;
  size: 'wide' | 'narrow';
  component: ComponentType;
}

/** Everything a module index may export. */
export interface ModuleExports {
  routes?: RouteDef[] | undefined;
  nav?: NavItem | undefined;
  cards?: Record<string, CardRenderer> | undefined;
  dealTabs?: DealTab[] | undefined;
  companyTabs?: CompanyTab[] | undefined;
  personTabs?: PersonTab[] | undefined;
  settings?: SettingsSection[] | undefined;
  drops?: DropHandler[] | undefined;
  commands?: CommandDef[] | undefined;
  primary?: PrimaryAction | undefined;
  homeBlocks?: HomeBlock[] | undefined;
  /** The citation reader (one module brings it). */
  reader?: ComponentType<ReaderProps> | undefined;
}
