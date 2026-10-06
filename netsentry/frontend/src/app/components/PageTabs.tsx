/**
 * Tabs that are links (v4 §5.2–5.3): each tab is its own address, so Back works and a tab can be
 * shared. `tabs` are [key, label]; the first is the default (no part in the address).
 */
import { href } from '../lib/nav.ts';

export function PageTabs({ base, tabs, current }: { base: string; tabs: Array<[string, string]>; current: string }): React.JSX.Element {
  return (
    <nav aria-label="Sections" className="-mx-1 mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--agent-app-border)] px-1">
      {tabs.map(([key, label], i) => {
        const on = key === current;
        return (
          <a
            key={key}
            href={href(i === 0 ? base : `${base}/${key}`)}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[14px] ${
              on ? 'border-[var(--agent-app-accent)] font-medium text-[var(--agent-app-fg)]' : 'border-transparent text-[var(--agent-app-muted)] hover:text-[var(--agent-app-fg)]'
            }`}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
