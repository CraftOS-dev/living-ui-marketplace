/**
 * Your AI agent's page (AgentPage.tsx, loaded on demand) and its Ctrl K command.
 */
import { Sparkle } from 'lucide-react';
import { openAgent } from '../../components/shell/AgentPanel.tsx';
import type { CommandDef, RouteDef } from '../../lib/contract.ts';
import { lazyPage } from '../../lib/lazy.ts';

const AgentPage = lazyPage(() => import('./AgentPage.tsx'), 'AgentPage');

export const routes: RouteDef[] = [{ path: '/agent', page: AgentPage, title: 'Your AI agent' }];

export const commands: CommandDef[] = [{ key: 'agent', label: 'Your AI agent', icon: Sparkle, keywords: 'ask requests questions', run: () => openAgent() }];
