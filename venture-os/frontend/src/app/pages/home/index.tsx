/**
 * Home module (SPEC 3.1, 7.13, 13.2): the '/' route with its dashboard, the
 * Home place in the sidebar and the Digest section of Settings. Questions
 * for your AI agent go through its own panel (the agent module's command).
 */
import { House } from 'lucide-react';
import type { NavItem, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { lazyPage } from '../../lib/lazy.ts';
import { HomePage } from './HomePage.tsx';

/** Home is the first screen, so it ships in the main chunk (its constellation loads after); the Digest section loads on demand. */
const DigestSettings = lazyPage(() => import('../../components/home/DigestSettings.tsx'), 'DigestSettings');

export const routes: RouteDef[] = [{ path: '/', page: HomePage, title: 'Home' }];

export const nav: NavItem = { key: 'home', label: 'Home', icon: House, path: '/', order: 10 };

export const settings: SettingsSection[] = [{ key: 'digest', label: 'Digest', order: 75, component: DigestSettings }];
