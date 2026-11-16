/**
 * The tools at the right end of every page header: search (Ctrl K), the
 * "Hide pay" eye that blanks every money figure for screen sharing, and the
 * notifications bell.
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, BellOff, Eye, EyeOff, Search } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago, fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { kindLabel } from '../../lib/kinds.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { setUi, useUi } from '../../lib/store.tsx';
import { Button, Empty, IconButton, Kbd, Money, Popover, Spinner } from '../ui.tsx';
import type { ItemFact } from '../ui.tsx';
import { useShellCounts } from './counts.ts';
import { openSearch } from './SearchPalette.tsx';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Structured facts; the body (plain text for email and the CLI) shows only when there are none. */
  facts?: ItemFact[] | undefined;
  link: string;
  read: boolean;
  created: string;
}

/**
 * A notification's one meta line: at most three short facts. Counts read
 * with their unit ("4 filings due"), days and money go through format.ts and
 * Money, a long list becomes a count ("4 filings"), and long text is left out.
 */
function metaParts(n: Notification): ReactNode[] {
  const parts: ReactNode[] = [];
  for (const f of n.facts ?? []) {
    if (parts.length >= 3) break;
    const label = f.label ?? '';
    if (f.type === 'day') {
      if (String(f.value ?? '') === '') continue;
      parts.push(
        <>
          {label !== '' ? label + ' ' : ''}
          <span className="hr-mono">{fmtDay(String(f.value ?? ''))}</span>
        </>,
      );
    } else if (f.type === 'range') parts.push(<span className="hr-mono">{fmtRange(f.from ?? '', f.to ?? '')}</span>);
    else if (f.type === 'money') parts.push(<Money minor={typeof f.amount_minor === 'number' ? f.amount_minor : null} currency={f.currency ?? ''} />);
    else if (f.type === 'state') {
      const v = String(f.value ?? '').replace(/[_-]+/g, ' ');
      if (v !== '') parts.push(v.charAt(0).toUpperCase() + v.slice(1));
    } else if (f.type === 'number') {
      const x = Number(f.value);
      const text = Number.isFinite(x) ? x.toLocaleString('en', { maximumFractionDigits: 2 }) : String(f.value ?? '');
      parts.push(f.unit !== undefined && f.unit !== '' ? `${text} ${f.unit}` : label !== '' ? `${label} ${text}` : text);
    } else if (f.key === 'kind') {
      // A kind code reads as its name ("leave_request" -> "Leave request").
      if (String(f.value ?? '') !== '') parts.push(kindLabel(String(f.value)));
    } else {
      const v = String(f.value ?? '').trim();
      const items = v.split(/;\s+/).filter((x) => x !== '');
      if (items.length > 1) parts.push(`${items.length} ${label !== '' ? label.toLowerCase() : 'items'}`);
      else if (v !== '' && v.length <= 40) parts.push(v);
    }
  }
  return parts;
}

/** One notification: the unread dot on the title's first line, a one-line title (the whole of it on hover), one meta line, the time on the right. */
function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }): React.JSX.Element {
  const parts = metaParts(n);
  return (
    <li>
      <button type="button" onClick={() => onOpen(n)} className="hr-focus grid w-full grid-cols-[6px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--hr-hover)]">
        <span aria-hidden className={cn('mt-[6px] size-1.5 rounded-full', n.read ? 'bg-transparent' : 'bg-[var(--hr-rh)]')} />
        <span className="min-w-0">
          <span title={n.title} className={cn('block truncate text-[13px] leading-[18px]', n.read ? 'text-[var(--hr-ink-2)]' : 'font-medium text-[var(--hr-ink)]')}>
            {n.title}
          </span>
          {parts.length > 0 ? (
            <span className="mt-0.5 block truncate text-[12px] leading-4 text-[var(--hr-muted)]">
              {parts.map((p, i) => (
                <span key={i}>
                  {i > 0 && <span aria-hidden className="mx-1.5 text-[var(--hr-faint)]">{'\u00b7'}</span>}
                  {p}
                </span>
              ))}
            </span>
          ) : (
            n.body !== '' && <span className="mt-0.5 block truncate text-[12px] leading-4 text-[var(--hr-muted)]">{n.body}</span>
          )}
        </span>
        <span className="hr-label whitespace-nowrap leading-[18px]">{ago(n.created)}</span>
      </button>
    </li>
  );
}

function NotificationList({ onClose }: { onClose: () => void }): React.JSX.Element {
  const live = useOp<{ notifications: Notification[]; unread: number }>('notifications.list', { limit: 30 }, ['notifications'], { name: 'shell.notifications' });
  const list = live.data?.notifications ?? null;
  const unread = list?.filter((n) => !n.read).length ?? 0;
  const open = (n: Notification): void => {
    if (!n.read) void act([patch(n.id, { read: true })], () => op('notifications.read', { notification: n.id }, { quiet: true }), ['notifications']);
    if (n.link !== '') {
      onClose();
      window.location.hash = n.link.startsWith('#') ? n.link.slice(1) : n.link;
    }
  };
  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-[var(--hr-hair)] pl-3 pr-1.5">
        <span className="hr-label flex-1">{t('notify.title')}</span>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void act(list?.filter((n) => !n.read).map((n) => patch(n.id, { read: true })) ?? [], () => op('notifications.read-all', {}, { quiet: true }), ['notifications'])}>
            {t('notify.mark_all')}
          </Button>
        )}
      </div>
      {list === null ? (
        <div className="flex h-24 items-center justify-center text-[var(--hr-muted)]">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Empty icon={BellOff} title={t('notify.none')} className="py-8" />
      ) : (
        <ul className="hr-scroll max-h-[380px] divide-y divide-[var(--hr-hair)] overflow-y-auto">
          {list.map((n) => (
            <NotificationRow key={n.id} n={n} onOpen={open} />
          ))}
        </ul>
      )}
      <div className="border-t border-[var(--hr-hair)] p-1">
        <button
          type="button"
          onClick={() => {
            onClose();
            navigate('/settings/notifications');
          }}
          className="hr-focus h-8 w-full rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]"
        >
          {t('notify.settings')}
        </button>
      </div>
    </div>
  );
}

function Bellbutton(): React.JSX.Element {
  const counts = useShellCounts();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <span className="relative inline-flex">
      <IconButton ref={ref} icon={Bell} label={counts.unread > 0 ? t('notify.title_n', { n: counts.unread }) : t('notify.title')} active={open} onClick={() => setOpen((v) => !v)} />
      {counts.unread > 0 && <span aria-hidden className="pointer-events-none absolute right-1 top-1 size-2 rounded-full bg-[var(--hr-rh)] ring-2 ring-[var(--hr-page)]" />}
      <Popover anchor={ref} open={open} onClose={close} align="end" width={360} label={t('notify.title')} className="p-0">
        <NotificationList onClose={close} />
      </Popover>
    </span>
  );
}

export function HeaderTools(): React.JSX.Element {
  const { hidePay } = useUi();
  return (
    <>
      <button type="button" onClick={openSearch} aria-label={t('search.open')} title={t('search.open')} className="hr-focus hidden h-8 items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-2.5 pr-1.5 text-[12px] text-[var(--hr-muted)] transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)] xl:inline-flex">
        <Search size={13} aria-hidden />
        <span className="w-28 text-left">{t('search.short')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <IconButton icon={Search} label={t('search.open')} onClick={openSearch} className="xl:hidden" />
      <IconButton icon={hidePay ? EyeOff : Eye} label={hidePay ? t('shell.show_pay') : t('shell.hide_pay')} active={hidePay} onClick={() => setUi({ hidePay: !hidePay })} aria-pressed={hidePay} />
      <Bellbutton />
    </>
  );
}
