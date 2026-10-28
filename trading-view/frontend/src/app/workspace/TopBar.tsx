/**
 * The one bar above the workspace: workspace tabs, symbol search and the
 * command palette, adding widgets, undo and redo, alerts, the AI agent's
 * runs, data status and settings.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, CandlestickChart, Copy, Lock, LayoutGrid, Pencil, Plus, Redo2, RotateCcw, Search, Settings2, Sparkles, Trash2, Undo2, Unlock } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Btn, IconBtn, Kbd, MenuList, Popover, Seg, Toggle, useConfirm } from '../components/ui.tsx';
import type { MenuEntry } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { ago, price, short } from '../lib/format.ts';
import { useHealth, useLive } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import { localZone, zoneLabel } from '../lib/time.ts';
import type { Palette, TzMode } from '../lib/types.ts';
import { useDialogs } from './Dialogs.tsx';
import { WIDGET_DEFS } from './registry.tsx';

const TEMPLATES = [
  { id: 'markets', name: 'Markets', detail: 'Chart, watchlist, details, news, AI analyst' },
  { id: 'crypto', name: 'Crypto', detail: 'Binance pairs, heatmap, two charts' },
  { id: 'multi', name: 'Multi-timeframe', detail: 'Four intervals of one symbol' },
  { id: 'research', name: 'Research', detail: 'Chart, AI analyst, screener, heatmap' },
  { id: 'blank', name: 'Blank', detail: 'One chart' },
];

function Pop({ trigger, children, align = 'right', className }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  return (
    <span ref={ref} className="relative inline-flex">
      {trigger(open, () => setOpen((o) => !o))}
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} align={align} className={className}>
        {children(() => setOpen(false))}
      </Popover>
    </span>
  );
}

export function WidgetCatalogue({ onPick }: { onPick: (type: (typeof WIDGET_DEFS)[number]['type']) => void }): React.JSX.Element {
  return (
    <div className="grid w-[420px] max-w-[90vw] grid-cols-2 gap-0.5 p-0.5">
      {WIDGET_DEFS.map((d) => (
        <button key={d.type} type="button" onClick={() => onPick(d.type)} className="flex items-start gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-[var(--tv-row)]">
          <d.icon size={15} className={cn('mt-0.5 shrink-0', d.type === 'analyst' ? 'text-[var(--tv-accent-text)]' : 'text-[var(--tv-ink-2)]')} />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold">{d.label}</span>
            <span className="block text-[11px] leading-[15px] text-[var(--tv-muted)]">{d.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Tabs(): React.JSX.Element {
  const app = useApp();
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: HTMLElement } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const [dragId, setDragId] = useState('');

  const create = (template: string): void => {
    api
      .createWorkspace('', template)
      .then((r) => {
        app.reloadWorkspaces();
        app.activate(r.workspace.id);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const rename = (): void => {
    if (renaming === null) return;
    const v = renaming.value.trim();
    setRenaming(null);
    if (v === '') return;
    api.updateWorkspace(renaming.id, { name: v }).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const ws = menu === null ? undefined : app.workspaces.find((w) => w.id === menu.id);
  const items: MenuEntry[] =
    ws === undefined
      ? []
      : [
          { label: 'Rename', icon: Pencil, onClick: () => setRenaming({ id: ws.id, value: ws.name }) },
          {
            label: 'Duplicate',
            icon: Copy,
            onClick: () =>
              void api
                .duplicateWorkspace(ws.id)
                .then((r) => {
                  app.reloadWorkspaces();
                  app.activate(r.workspace.id);
                })
                .catch((err: unknown) => toast.error(errMessage(err))),
          },
          { label: ws.locked ? 'Unlock layout' : 'Lock layout', icon: ws.locked ? Unlock : Lock, onClick: () => void api.updateWorkspace(ws.id, { locked: !ws.locked }).catch((err: unknown) => toast.error(errMessage(err))) },
          'divider',
          {
            label: 'Delete workspace',
            icon: Trash2,
            danger: true,
            disabled: app.workspaces.length <= 1,
            onClick: () =>
              void confirm('"' + ws.name + '" and its widgets go away. Watchlists, drawings and alerts stay. Undo brings it back.', 'Delete workspace?').then((ok) => {
                if (!ok) return;
                api
                  .deleteWorkspace(ws.id)
                  .then((r) => {
                    app.reloadWorkspaces();
                    if (app.activeId === ws.id) app.activate(r.active);
                  })
                  .catch((err: unknown) => toast.error(errMessage(err)));
              }),
          },
        ];

  return (
    <nav className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]" aria-label="Workspaces">
      {app.workspaces.map((w) =>
        renaming?.id === w.id ? (
          <input
            key={w.id}
            autoFocus
            value={renaming.value}
            maxLength={80}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            aria-label="Workspace name"
            className="my-1 w-32 rounded-[4px] border border-[var(--tv-line)] bg-[var(--tv-card)] px-2 text-[12.5px] font-semibold outline-none"
          />
        ) : (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={w.id === app.activeId}
            draggable
            onDragStart={() => setDragId(w.id)}
            onDragOver={(e) => dragId !== '' && e.preventDefault()}
            onDrop={() => {
              if (dragId === '' || dragId === w.id) return;
              const ids = app.workspaces.map((x) => x.id).filter((x) => x !== dragId);
              ids.splice(ids.indexOf(w.id), 0, dragId);
              setDragId('');
              api
                .reorderWorkspaces(ids)
                .then(() => app.reloadWorkspaces())
                .catch((err: unknown) => toast.error(errMessage(err)));
            }}
            onClick={() => app.activate(w.id)}
            onDoubleClick={() => setRenaming({ id: w.id, value: w.name })}
            onContextMenu={(e) => {
              e.preventDefault();
              anchor.current = e.currentTarget;
              setMenu({ id: w.id, at: e.currentTarget });
            }}
            className={cn(
              'relative flex shrink-0 items-center gap-1 px-2.5 text-[12.5px] transition-colors',
              w.id === app.activeId ? 'font-bold text-[var(--tv-ink)] after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-[var(--tv-ink)]' : 'font-semibold text-[var(--tv-ink-2)] hover:text-[var(--tv-ink)]',
            )}
          >
            {w.locked && <Lock size={11} className="text-[var(--tv-muted)]" />}
            {w.name}
          </button>
        ),
      )}
      <Pop
        align="left"
        trigger={(open, toggle) => <IconBtn icon={Plus} label="New workspace" size={26} active={open} onClick={toggle} className="my-auto" />}
      >
        {(close) => (
          <div className="w-64">
            <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">New workspace</div>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  close();
                  create(t.id);
                }}
                className="flex w-full flex-col rounded-[4px] px-2 py-1 text-left hover:bg-[var(--tv-row)]"
              >
                <span className="text-[12.5px] font-semibold">{t.name}</span>
                <span className="text-[11px] text-[var(--tv-muted)]">{t.detail}</span>
              </button>
            ))}
          </div>
        )}
      </Pop>
      <Popover open={menu !== null} onClose={() => setMenu(null)} anchor={anchor}>
        <MenuList items={items} onPicked={() => setMenu(null)} />
      </Popover>
      {confirmEl}
    </nav>
  );
}

function AlertsButton(): React.JSX.Element {
  const app = useApp();
  const events = useLive(() => api.alertEvents({ limit: 12 }).then((r) => r.events), ['alert_events'], []);
  return (
    <Pop
      className="w-[340px]"
      trigger={(open, toggle) => (
        <IconBtn
          icon={Bell}
          label={app.unseen > 0 ? app.unseen + ' alerts fired' : 'Alerts'}
          active={open}
          onClick={() => {
            toggle();
            if (!open && app.unseen > 0) void api.seen().catch(() => undefined);
          }}
          badge={app.unseen > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--tv-accent)] px-1 text-[9.5px] font-bold text-[var(--tv-on-accent)]">{app.unseen > 9 ? '9+' : app.unseen}</span> : undefined}
        />
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">Fired alerts</span>
            <span className="text-[11px] text-[var(--tv-muted)]">{app.alerts.filter((a) => a.status === 'active').length} active</span>
          </div>
          {(events.data ?? []).length === 0 && <p className="px-2 pb-2 text-[12px] text-[var(--tv-muted)]">Nothing fired yet.</p>}
          {(events.data ?? []).map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                close();
                app.focusChannel('1', { symbol: e.symbol });
              }}
              className="flex w-full flex-col rounded-[4px] px-2 py-1 text-left hover:bg-[var(--tv-row)]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-bold">{short(e.symbol)}</span>
                <span className="text-[11px] text-[var(--tv-muted)]">{ago(e.created)}</span>
              </span>
              <span className="text-[11.5px] leading-4 text-[var(--tv-ink-2)]">
                {e.detail} @ {price(e.price)}
              </span>
              {e.agent_note !== '' && (
                <span className="mt-0.5 line-clamp-2 border-l-2 border-[var(--tv-accent)] pl-1.5 text-[11.5px] leading-4">
                  {e.agent_note}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Pop>
  );
}

function AgentButton(): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const runs = useLive(() => api.runs().then((r) => r.runs), ['activity'], []);
  const working = useLive(() => api.analyses({ state: 'working', limit: 5 }).then((r) => r.analyses), ['analyses'], []);
  const waiting = useLive(() => api.analyses({ state: 'waiting', limit: 5 }).then((r) => r.analyses), ['analyses'], []);
  const [confirmEl, confirm] = useConfirm();
  const busy = (working.data ?? []).length + (waiting.data ?? []).length;
  const ch = app.ws?.links['1'];
  return (
    <>
      <Pop
        className="w-[360px]"
        trigger={(open, toggle) => (
          <button type="button" onClick={toggle} className={cn('flex h-[26px] items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-bold text-[var(--tv-accent-text)] hover:bg-[var(--tv-accent-soft)]', open && 'bg-[var(--tv-accent-soft)]')} title="Your AI agent">
            <Sparkles size={14} className={busy > 0 ? 'tv-pulse' : ''} />
            <span className="hidden lg:inline">AI agent</span>
            {busy > 0 && <span className="rounded-full bg-[var(--tv-accent)] px-1.5 text-[10px] text-[var(--tv-on-accent)]">{busy}</span>}
          </button>
        )}
      >
        {(close) => (
          <div className="p-1">
            {ch !== undefined && (
              <Btn
                variant="accent"
                icon={Sparkles}
                className="w-full"
                onClick={() => {
                  close();
                  dialogs.askAI({ symbol: ch.symbol, interval: ch.interval });
                }}
              >
                Ask AI about {short(ch.symbol)} · {ch.interval}
              </Btn>
            )}
            {busy > 0 && (
              <div className="mt-1.5 rounded-[5px] bg-[var(--tv-row)] px-2 py-1.5">
                {[...(working.data ?? []), ...(waiting.data ?? [])].map((a) => (
                  <p key={a.id} className="text-[11.5px] leading-4">
                    <span className="font-semibold">{a.state === 'working' ? 'Working on' : 'Waiting:'}</span> {a.kind === 'watchlist' ? 'a watchlist review' : short(a.symbol) + ' · ' + a.interval}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between px-1">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">Recent runs</span>
              <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--tv-ink-2)]">
                Markup on charts
                <Toggle label="Show AI markup on charts" checked={app.settings?.agent_markup !== false} onChange={(v) => app.updateSettings({ agent_markup: v })} />
              </label>
            </div>
            {(runs.data ?? []).length === 0 && <p className="px-1 py-2 text-[12px] text-[var(--tv-muted)]">Your AI agent has not changed anything yet. Everything it does is listed here and can be reverted.</p>}
            {(runs.data ?? []).slice(0, 6).map((r) => (
              <div key={r.run} className="mt-1 rounded-[5px] border border-[var(--tv-hair)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold">
                    {r.changes} change{r.changes === 1 ? '' : 's'}
                    {r.symbols.length > 0 ? ' · ' + r.symbols.slice(0, 4).map(short).join(', ') : ''}
                  </span>
                  <span className="text-[11px] text-[var(--tv-muted)]">{ago(r.started)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-[var(--tv-ink-2)]">{r.summaries.slice(0, 3).join(' · ')}</p>
                {r.undone < r.changes && (
                  <button
                    type="button"
                    className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[var(--tv-ink-2)] hover:text-[var(--tv-ink)]"
                    onClick={() =>
                      void confirm('Undo the ' + (r.changes - r.undone) + ' changes of this run?', 'Revert AI agent run', 'Revert').then((ok) => {
                        if (ok)
                          api
                            .revertRun(r.run)
                            .then((x) => toast.success('Reverted ' + x.reverted + ' changes'))
                            .catch((err: unknown) => toast.error(errMessage(err)));
                      })
                    }
                  >
                    <RotateCcw size={11} /> Revert run
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Pop>
      {confirmEl}
    </>
  );
}

function Health(): React.JSX.Element {
  const h = useHealth();
  const bad = Object.values(h).filter((x) => x.state === 'throttled' || x.state === 'down');
  const label = bad.length === 0 ? 'Data: Yahoo Finance (delayed for most exchanges) and Binance (live)' : bad.map((x) => x.provider + ' ' + x.state + (x.message !== '' ? ' (' + x.message + ')' : '')).join('; ') + '. Showing cached data.';
  return (
    <span title={label} className="flex h-[26px] items-center gap-1.5 px-1.5 text-[11px] font-semibold text-[var(--tv-muted)]">
      <span className={cn('size-1.5 rounded-full', bad.length === 0 ? 'bg-[var(--tv-up)]' : 'tv-pulse bg-[var(--tv-warn)]')} />
      <span className="hidden xl:inline">{bad.length === 0 ? 'Live' : 'Data delayed'}</span>
    </span>
  );
}

function SettingsButton(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const swatch = (up: string, down: string): React.JSX.Element => (
    <span className="flex gap-0.5">
      <span className="size-2.5 rounded-[2px]" style={{ background: up }} />
      <span className="size-2.5 rounded-[2px]" style={{ background: down }} />
    </span>
  );
  return (
    <Pop className="w-[300px]" trigger={(open, toggle) => <IconBtn icon={Settings2} label="Settings" active={open} onClick={toggle} />}>
      {() => (
        <div className="flex flex-col gap-3 p-2">
          <div>
            <div className="mb-1 text-[11.5px] font-semibold text-[var(--tv-ink-2)]">Up and down colors</div>
            <Seg<Palette>
              value={s?.palette ?? 'green_red'}
              onChange={(v) => app.updateSettings({ palette: v })}
              options={[
                { value: 'green_red', label: swatch('#089981', '#f23645'), title: 'Green up, red down' },
                { value: 'red_green', label: swatch('#f23645', '#089981'), title: 'Red up, green down (East Asian markets)' },
                { value: 'blue_orange', label: swatch('#2962ff', '#f57c00'), title: 'Blue up, orange down (color-blind friendly)' },
              ]}
            />
          </div>
          <div>
            <div className="mb-1 text-[11.5px] font-semibold text-[var(--tv-ink-2)]">Chart time zone</div>
            <Seg<TzMode>
              value={s?.tz_mode ?? 'exchange'}
              onChange={(v) => app.updateSettings({ tz_mode: v })}
              options={[
                { value: 'exchange', label: 'Exchange', title: "Each market's own time" },
                { value: 'local', label: zoneLabel(localZone()), title: 'This computer' },
                { value: 'utc', label: 'UTC' },
              ]}
            />
            <p className="mt-1 text-[11px] leading-4 text-[var(--tv-muted)]">Daily and longer bars always show the exchange's trading date.</p>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">Alert sound</span>
            <Toggle label="Alert sound" checked={s?.sound !== false} onChange={(v) => app.updateSettings({ sound: v })} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">AI markup on charts</span>
            <Toggle label="AI markup on charts" checked={s?.agent_markup !== false} onChange={(v) => app.updateSettings({ agent_markup: v })} />
          </label>
          <div className="border-t border-[var(--tv-hair)] pt-2">
            <div className="mb-1 text-[11.5px] font-semibold text-[var(--tv-ink-2)]">Keyboard</div>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11.5px] text-[var(--tv-ink-2)]">
              <span>Command palette</span>
              <Kbd>Ctrl K</Kbd>
              <span>Change symbol (on a chart)</span>
              <Kbd>type letters</Kbd>
              <span>Change interval (on a chart)</span>
              <Kbd>type digits</Kbd>
              <span>Trend, horizontal, vertical, Fibonacci</span>
              <Kbd>Alt T H V F</Kbd>
              <span>Alert at last price</span>
              <Kbd>Alt A</Kbd>
              <span>Reset chart view</span>
              <Kbd>Alt R</Kbd>
              <span>Undo, redo</span>
              <Kbd>Ctrl Z, Ctrl Y</Kbd>
              <span>Step through a watchlist</span>
              <Kbd>↑ ↓</Kbd>
            </div>
          </div>
        </div>
      )}
    </Pop>
  );
}

export function TopBar({ onPalette }: { onPalette: () => void }): React.JSX.Element {
  const app = useApp();
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const f = (): void => setWide(window.innerWidth >= 900);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const undo = (): void => {
    api
      .undo()
      .then((r) => toast.success('Undone: ' + r.entry.summary))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const redo = (): void => {
    api
      .redo()
      .then((r) => toast.success('Redone: ' + r.entry.summary))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <header className="flex h-9 shrink-0 items-stretch gap-1 border-b border-[var(--tv-line)] pl-2 pr-1">
      <span className="flex items-center pr-1 text-[var(--tv-ink)]" title="Trading View">
        <CandlestickChart size={17} strokeWidth={2.1} />
      </span>
      <Tabs />
      <span className="flex-1" />
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={onPalette} className="flex h-[26px] items-center gap-2 rounded-[5px] border border-[var(--tv-line)] px-2 text-[12px] font-semibold text-[var(--tv-muted)] hover:border-[var(--tv-ink-2)] hover:text-[var(--tv-ink)]" title="Search symbols and commands (Ctrl K)">
          <Search size={13} />
          {wide && <span className="w-[140px] text-left">Symbol, command</span>}
          {wide && <Kbd>Ctrl K</Kbd>}
        </button>
        <Pop
          trigger={(open, toggle) =>
            wide ? (
              <button type="button" onClick={toggle} className={cn('flex h-[26px] items-center gap-1 rounded-[5px] px-2 text-[12px] font-bold text-[var(--tv-ink-2)] hover:bg-[var(--tv-row)] hover:text-[var(--tv-ink)]', open && 'bg-[var(--tv-row)]')}>
                <LayoutGrid size={14} /> Widget
              </button>
            ) : (
              <IconBtn icon={LayoutGrid} label="Add widget" active={open} onClick={toggle} />
            )
          }
        >
          {(close) => (
            <WidgetCatalogue
              onPick={(t) => {
                close();
                void app.addWidget(t);
              }}
            />
          )}
        </Pop>
        <IconBtn icon={Undo2} label="Undo (Ctrl Z)" onClick={undo} />
        <IconBtn icon={Redo2} label="Redo (Ctrl Y)" onClick={redo} />
        <AlertsButton />
        <AgentButton />
        <Health />
        <SettingsButton />
      </div>
    </header>
  );
}
