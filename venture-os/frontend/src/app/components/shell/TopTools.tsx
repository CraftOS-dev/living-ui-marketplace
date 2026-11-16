/**
 * The top bar's right side (SPEC 3): search (Ctrl K), the Next count (opens
 * Focus mode) and notifications.
 */
import { useCallback, useRef, useState } from 'react';
import { Bell, BellOff, ListTodo, Search } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { act, patch } from '../../lib/live.ts';
import { go, navigate } from '../../lib/router.ts';
import { Button, Empty, IconButton, Kbd, Popover, Spinner } from '../ui.tsx';
import { useShellCounts } from './counts.ts';
import type { Notification } from './counts.ts';
import { openSearch } from './SearchPalette.tsx';

function NotificationList({ onClose }: { onClose: () => void }): React.JSX.Element {
  const counts = useShellCounts();
  const list = counts.notifications;
  const unread = list?.filter((n) => !n.read).length ?? 0;
  const open = (n: Notification): void => {
    if (!n.read) void act([patch(n.id, { read: true })], () => op('notifications.read', { notification: n.id }, { quiet: true }), ['notifications']);
    if (n.link !== '') {
      onClose();
      go(n.link);
    }
  };
  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-[var(--vo-hair)] pl-3 pr-1.5">
        <span className="vo-label flex-1">Notifications</span>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void act(list?.filter((n) => !n.read).map((n) => patch(n.id, { read: true })) ?? [], () => op('notifications.read-all', {}, { quiet: true }), ['notifications'])}>
            Mark all read
          </Button>
        )}
      </div>
      {list === null ? (
        <div className="flex h-24 items-center justify-center text-[var(--vo-muted)]">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Empty icon={BellOff} title="Nothing new" className="py-8" />
      ) : (
        <ul className="vo-scroll max-h-[380px] divide-y divide-[var(--vo-hair)] overflow-y-auto">
          {list.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className="vo-focus grid w-full grid-cols-[6px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                <span aria-hidden className={cn('mt-[6px] size-1.5 rounded-full', n.read ? 'bg-transparent' : 'bg-[var(--vo-a)]')} />
                <span title={n.title} className={cn('vo-wrap block text-[13px] leading-[18px]', n.read ? 'text-[var(--vo-ink-2)]' : 'font-medium text-[var(--vo-ink)]')}>
                  {n.title}
                </span>
                <span className="vo-mono whitespace-nowrap text-[12px] leading-[18px] text-[var(--vo-muted)]">{ago(n.created)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BellButton(): React.JSX.Element {
  const counts = useShellCounts();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <span className="relative inline-flex">
      <IconButton ref={ref} icon={Bell} label={counts.unread > 0 ? `Notifications, ${counts.unread} new` : 'Notifications'} active={open} onClick={() => setOpen((v) => !v)} />
      {counts.unread > 0 && <span aria-hidden className="pointer-events-none absolute right-1 top-1 size-2 rounded-full bg-[var(--vo-a)] ring-2 ring-[var(--vo-page)]" />}
      <Popover anchor={ref} open={open} onClose={close} align="end" width={360} label="Notifications" className="p-0">
        <NotificationList onClose={close} />
      </Popover>
    </span>
  );
}

/** The Next count: a mono number that opens Focus mode. */
export function NextButton(): React.JSX.Element {
  const counts = useShellCounts();
  return (
    <button type="button" onClick={() => navigate('/focus')} aria-label={`Next, ${counts.next} waiting`} title="Next" className="vo-focus vo-tap inline-flex h-8 items-center gap-1.5 rounded-[var(--vo-radius-sm)] px-2 text-[13px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
      <ListTodo size={15} strokeWidth={1.8} aria-hidden />
      <span className="vo-mono vo-num">{counts.next}</span>
    </button>
  );
}

export function TopTools(): React.JSX.Element {
  return (
    <>
      <button type="button" onClick={openSearch} aria-label="Search" title="Search" className="vo-focus hidden h-8 items-center gap-2 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] pl-2.5 pr-1.5 text-[12px] text-[var(--vo-muted)] transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)] lg:inline-flex">
        <Search size={13} aria-hidden />
        <span className="w-24 text-left">Search</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <IconButton icon={Search} label="Search" onClick={openSearch} className="lg:hidden" />
      <NextButton />
      <BellButton />
    </>
  );
}
