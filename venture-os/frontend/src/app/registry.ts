/**
 * The module registry (SPEC 13.2). Every `pages/<module>/index.tsx` is
 * collected here at build time; a module plugs in by exporting any of:
 *
 *   export const routes: RouteDef[]            { path: '/deals/:id', page, perm?, title?, dense? }
 *   export const nav: NavItem                  { key, label, icon, path, order, count? }
 *   export const cards: Record<string, CardRenderer>   Focus card bodies keyed by NextItem.card
 *   export const dealTabs: DealTab[]           { key, label, order, component: ({ deal }) => JSX, show? }
 *   export const companyTabs: CompanyTab[]
 *   export const personTabs: PersonTab[]
 *   export const settings: SettingsSection[]   { key, label, order, component }
 *   export const drops: DropHandler[]          { key, label, accepts(input), handle(input) => href }
 *   export const commands: CommandDef[]        Ctrl K actions
 *   export const primary: PrimaryAction        intake only: Add deal
 *   export const homeBlocks: HomeBlock[]       home only
 *   export const reader: ComponentType<ReaderProps>   the citation reader (diligence)
 *
 * Types: lib/contract.ts. Routes resolve in this order: module routes (by
 * folder name), then the kernel's fallback Home placeholder for '/', so a
 * module's '/' route wins.
 */
import { createElement } from 'react';
import { House } from 'lucide-react';
import type { ComponentType } from 'react';
import type { CardRenderer, CommandDef, CompanyTab, DealTab, DropHandler, HomeBlock, ModuleExports, NavItem, PersonTab, PrimaryAction, ReaderProps, RouteDef, SettingsSection } from './lib/contract.ts';
import { HomePlaceholder } from './components/shell/HomePlaceholder.tsx';
import { SourcePage } from './components/shell/SourceHost.tsx';

export type * from './lib/contract.ts';

// setup and auth are the screens before the app (App loads them), not modules.
const FOUND = import.meta.glob<ModuleExports>(['./pages/*/index.tsx', '!./pages/setup/index.tsx', '!./pages/auth/index.tsx'], { eager: true });

/** Module key (its folder name) to its exports, in folder order. */
export const MODULES: Record<string, ModuleExports> = Object.fromEntries(
  Object.entries(FOUND)
    .map(([p, m]) => [/\.\/pages\/([^/]+)\/index\.tsx$/.exec(p)?.[1] ?? p, m] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
);

const all = (): ModuleExports[] => Object.values(MODULES);
const byOrder = <T extends { order?: number | undefined }>(list: T[]): T[] => [...list].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/** The kernel's '/' until the home module brings its own. */
const FALLBACK: RouteDef[] = [
  { path: '/', page: () => createElement(HomePlaceholder), title: 'Home' },
  { path: '/source', page: SourcePage, title: 'Source' },
];

let routeCache: RouteDef[] | null = null;
/** Every route: module routes first, then the kernel fallbacks. */
export function routes(): RouteDef[] {
  if (routeCache === null) routeCache = [...all().flatMap((m) => m.routes ?? []), ...FALLBACK];
  return routeCache;
}

/** The sidebar places, in order. Home shows even before the home module lands. */
export function navItems(): NavItem[] {
  const items = all().flatMap((m) => (m.nav !== undefined ? [m.nav] : []));
  if (!items.some((n) => n.path === '/')) items.push({ key: 'home', label: 'Home', icon: House, path: '/', order: 10 });
  return byOrder(items);
}

export function cards(): Record<string, CardRenderer> {
  return Object.assign({}, ...all().map((m) => m.cards ?? {})) as Record<string, CardRenderer>;
}

export function dealTabs(): DealTab[] {
  return byOrder(all().flatMap((m) => m.dealTabs ?? []));
}

export function companyTabs(): CompanyTab[] {
  return byOrder(all().flatMap((m) => m.companyTabs ?? []));
}

export function personTabs(): PersonTab[] {
  return byOrder(all().flatMap((m) => m.personTabs ?? []));
}

export function settingsSections(): SettingsSection[] {
  return byOrder(all().flatMap((m) => m.settings ?? []));
}

export function drops(): DropHandler[] {
  return byOrder(all().flatMap((m) => m.drops ?? []));
}

export function commands(): CommandDef[] {
  return all().flatMap((m) => m.commands ?? []);
}

/** The sidebar's black action (the first module that brings one: intake's Add deal). */
export function primary(): PrimaryAction | null {
  return all().find((m) => m.primary !== undefined)?.primary ?? null;
}

export function homeBlocks(): HomeBlock[] {
  return byOrder(all().flatMap((m) => m.homeBlocks ?? []));
}

/** The citation reader a module registered (null until one does). */
export function reader(): ComponentType<ReaderProps> | null {
  return all().find((m) => m.reader !== undefined)?.reader ?? null;
}
