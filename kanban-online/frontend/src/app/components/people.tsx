/**
 * Who is who: picking an assignee (you, a teammate, one agent, any agent or
 * nobody), a person or agent shown by avatar and name, and the small lookups
 * between a card's party and the key the operations take.
 */
import type { ReactNode } from 'react';
import { UserMinus } from 'lucide-react';
import { useApp } from '../lib/context.tsx';
import type { AssigneeKey, Party } from '../lib/types.ts';
import { AgentAvatar, MenuItem, MenuLabel, MenuSep, PartyAvatar, PersonAvatar, PoolAvatar, partyName } from './ui.tsx';

/** The key the operations take for a party: '' (nobody), 'pool', 'user:<id>' or 'agent:<id>'. */
export function assigneeKey(party: Party | null | undefined): AssigneeKey {
  if (party === null || party === undefined) return '';
  if (party.kind === 'pool') return 'pool';
  if (party.kind === 'person') return 'user:' + party.id;
  if (party.kind === 'agent') return 'agent:' + party.id;
  return '';
}

/** True when the key hands the card to agents (one agent or any agent). */
export function forAgents(key: AssigneeKey): boolean {
  return key === 'pool' || key.startsWith('agent:');
}

/** The party a key stands for, from the team the app knows. */
export function usePartyOf(): (key: AssigneeKey) => Party | null {
  const app = useApp();
  return (key: AssigneeKey): Party | null => {
    if (key === '') return null;
    if (key === 'pool') return { kind: 'pool', name: 'Any agent' };
    const meKey = app.me ? 'user:' + app.me.id : '';
    if (key === 'me' || key === meKey) return app.me ? { kind: 'person', id: app.me.id, name: app.me.name, tone: app.me.tone } : null;
    if (key.startsWith('user:')) {
      const p = app.people.find((x) => x.id === key.slice(5));
      return p ? { kind: 'person', id: p.id, name: p.name, tone: p.tone } : null;
    }
    if (key.startsWith('agent:')) {
      const a = app.agents.find((x) => x.id === key.slice(6));
      return a ?? null;
    }
    return null;
  };
}

/** An avatar and a name on one line. */
export function PartyChip({ party, size = 18, you, muted }: { party: Party | null | undefined; size?: number; you?: boolean; muted?: ReactNode }): React.JSX.Element {
  const app = useApp();
  if (party === null || party === undefined) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--kb-muted)]">
        <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--kb-line)]" style={{ width: size, height: size }}>
          <UserMinus size={Math.round(size * 0.55)} aria-hidden />
        </span>
        <span className="truncate">{muted ?? 'Nobody'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PartyAvatar party={party} size={size} />
      <span className="truncate">{partyName(party, you === false ? undefined : app.me?.id)}</span>
    </span>
  );
}

/**
 * The assignee menu: you, the team's people, any agent, each agent, nobody.
 * `only` limits it to agents (a column agents work) and `lock` to one agent.
 */
export function AssigneeMenu({ value, onPick, only, lock, hideNone }: { value: AssigneeKey; onPick: (key: AssigneeKey) => void; only?: 'agents' | undefined; lock?: string | undefined; hideNone?: boolean }): React.JSX.Element {
  const app = useApp();
  const me = app.me;
  const meKey = me ? 'user:' + me.id : '';
  const current = value === 'me' ? meKey : value;
  const others = app.people.filter((p) => p.id !== me?.id && p.status === 'active');
  const agents = app.agents.filter((a) => (lock === undefined ? true : a.id === lock));
  return (
    <div role="menu" aria-label="Assign to">
      {only !== 'agents' && (
        <>
          {me !== null && (
            <MenuItem selected={current === meKey} onClick={() => onPick(meKey)} hint="me">
              <span className="inline-flex items-center gap-2">
                <PersonAvatar person={me} size={18} /> {me.name}
              </span>
            </MenuItem>
          )}
          {others.length > 0 && <MenuLabel>People</MenuLabel>}
          {others.map((p) => (
            <MenuItem key={p.id} selected={current === 'user:' + p.id} onClick={() => onPick('user:' + p.id)}>
              <span className="inline-flex items-center gap-2">
                <PersonAvatar person={p} size={18} online={p.online} /> {p.name}
              </span>
            </MenuItem>
          ))}
          <MenuSep />
        </>
      )}
      <MenuLabel>Agents</MenuLabel>
      {lock === undefined && (
        <MenuItem selected={current === 'pool'} onClick={() => onPick('pool')} hint="first free">
          <span className="inline-flex items-center gap-2">
            <PoolAvatar size={18} /> Any agent
          </span>
        </MenuItem>
      )}
      {agents.map((a) => (
        <MenuItem key={a.id} selected={current === 'agent:' + a.id} onClick={() => onPick('agent:' + a.id)} hint={a.paused ? 'paused' : a.status === 'working' ? 'busy' : undefined}>
          <span className="inline-flex items-center gap-2">
            <AgentAvatar agent={a} size={18} /> {a.name}
          </span>
        </MenuItem>
      ))}
      {agents.length === 0 && lock === undefined && <div className="px-2 py-1.5 text-[12px] leading-4 text-[var(--kb-muted)]">No agent has connected yet. Any agent queues the card for the first one that does.</div>}
      {hideNone !== true && only !== 'agents' && (
        <>
          <MenuSep />
          <MenuItem selected={current === ''} onClick={() => onPick('')}>
            <span className="inline-flex items-center gap-2 text-[var(--kb-ink-2)]">
              <UserMinus size={14} aria-hidden className="text-[var(--kb-muted)]" /> Nobody
            </span>
          </MenuItem>
        </>
      )}
    </div>
  );
}
