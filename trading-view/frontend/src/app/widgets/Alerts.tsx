/**
 * Alerts: the active list (pause, resume, edit, delete) and the log of what
 * fired, with the AI agent's explanation under alerts sent to it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bell, BellPlus, Pause, Pencil, Play, Sparkles, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Btn, Chip, Empty, IconBtn, Seg } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { ago, price, short } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import type { Alert, Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

const STATUS: Record<Alert['status'], { label: string; tone: 'ink' | 'neutral' | 'accent' | 'warn' }> = {
  active: { label: 'Active', tone: 'ink' },
  paused: { label: 'Paused', tone: 'neutral' },
  triggered: { label: 'Fired', tone: 'accent' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** The condition without the symbol (the row already names it). */
function conditionText(a: Alert): string {
  let t = a.text.replace(' of ' + a.symbol, '');
  if (t.startsWith(a.symbol + ' ')) t = t.slice(a.symbol.length + 1);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function AlertsWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const { symbol, interval } = app.shows(w);
  const tab = w.config.tab ?? 'active';
  const [onlyThis, setOnlyThis] = useState(false);
  const events = useLive(() => api.alertEvents({ limit: 120 }).then((r) => r.events), ['alert_events'], []);
  const alerts = useMemo(() => app.alerts.filter((a) => !onlyThis || a.symbol === symbol), [app.alerts, onlyThis, symbol]);
  const log = useMemo(() => (events.data ?? []).filter((e) => !onlyThis || e.symbol === symbol), [events.data, onlyThis, symbol]);

  // The log counts as read while it is on screen.
  useEffect(() => {
    if (tab === 'log' && app.unseen > 0) void api.seen().catch(() => undefined);
  }, [tab, app.unseen]);

  const setStatus = (a: Alert, status: 'active' | 'paused'): void => {
    api.updateAlert(a.id, { status }).catch((err: unknown) => toast.error(errMessage(err)));
  };

  return (
    <WidgetShell
      w={w}
      title={
        <span className="flex items-center gap-2">
          <Title>Alerts</Title>
          <Seg
            size="xs"
            value={tab}
            onChange={(v) => app.configure(w, { tab: v })}
            options={[
              { value: 'active', label: 'Alerts ' + app.alerts.filter((a) => a.status === 'active').length },
              { value: 'log', label: app.unseen > 0 ? 'Log · ' + app.unseen + ' new' : 'Log' },
            ]}
          />
        </span>
      }
      actions={
        <>
          <button type="button" onClick={() => setOnlyThis((v) => !v)} className={cn('h-6 rounded-[4px] px-1.5 text-[11px] font-bold hover:bg-[var(--tv-row)]', onlyThis ? 'bg-[var(--tv-row-hover)] text-[var(--tv-ink)]' : 'text-[var(--tv-muted)]')} title={'Only ' + short(symbol)}>
            {short(symbol).slice(0, 10)}
          </button>
          <IconBtn icon={BellPlus} label="New alert" size={24} onClick={() => dialogs.newAlert({ symbol, interval })} />
        </>
      }
    >
      <div className="h-full overflow-y-auto">
        {tab === 'active' ? (
          alerts.length === 0 ? (
            <Empty icon={Bell} title="No alerts" action={<Btn icon={BellPlus} onClick={() => dialogs.newAlert({ symbol, interval })}>New alert</Btn>}>
              Price levels, indicator readings, trend lines or the day's move. Checked every minute, also when the app is closed.
            </Empty>
          ) : (
            alerts.map((a) => (
              <div key={a.id} className="group flex items-start gap-2 border-b border-[var(--tv-hair)] px-2.5 py-1.5 hover:bg-[var(--tv-row)]">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => app.show(w, { symbol: a.symbol })}>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12px] font-bold">{short(a.symbol)}</span>
                    <Chip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Chip>
                    {a.notify_agent && (
                      <span title="Sent to your AI agent" className="text-[var(--tv-accent-text)]">
                        <Sparkles size={12} />
                      </span>
                    )}
                    {a.added_by === 'agent' && <Chip tone="accent">AI</Chip>}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-[var(--tv-ink-2)]">{conditionText(a)}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--tv-muted)]">
                    {a.interval} · {a.frequency === 'once' ? 'once' : a.frequency === 'once_per_bar' ? 'once per bar' : 'every time'}
                    {a.fired_count > 0 ? ' · fired ' + a.fired_count + '× · last ' + ago(a.last_fired) : ''}
                    {a.expires !== '' ? ' · until ' + new Date(a.expires.replace(' ', 'T')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                  {a.error !== '' && <span className="mt-0.5 block text-[11px] text-[var(--tv-warn)]">{a.error}</span>}
                </button>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {a.status === 'active' ? <IconBtn icon={Pause} label="Pause" size={22} onClick={() => setStatus(a, 'paused')} /> : <IconBtn icon={Play} label="Turn on" size={22} onClick={() => setStatus(a, 'active')} />}
                  <IconBtn icon={Pencil} label="Edit" size={22} onClick={() => dialogs.newAlert({ symbol: a.symbol, alert: a })} />
                  <IconBtn
                    icon={Trash2}
                    label="Delete"
                    size={22}
                    onClick={() =>
                      void api
                        .deleteAlert(a.id)
                        .then(() => toast.success('Alert deleted. Undo brings it back.'))
                        .catch((err: unknown) => toast.error(errMessage(err)))
                    }
                  />
                </span>
              </div>
            ))
          )
        ) : log.length === 0 ? (
          <Empty icon={Bell} title="Nothing fired yet">
            Alerts that fire are listed here with the price, and with your AI agent's explanation when you send them to it.
          </Empty>
        ) : (
          log.map((e) => (
            <div key={e.id} className={cn('border-b border-[var(--tv-hair)] px-2.5 py-1.5', !e.seen && 'bg-[var(--tv-row)]')}>
              <button type="button" className="flex w-full items-baseline justify-between gap-2 text-left" onClick={() => app.show(w, { symbol: e.symbol })}>
                <span className="text-[12px] font-bold">{short(e.symbol)}</span>
                <span className="text-[11px] text-[var(--tv-muted)]">{ago(e.created)}</span>
              </button>
              <p className="text-[12px] leading-4 text-[var(--tv-ink-2)]">
                {e.detail} <span className="num font-semibold text-[var(--tv-ink)]">@ {price(e.price)}</span>
              </p>
              {e.agent_state !== '' && (
                <div className="mt-1 border-l-2 border-[var(--tv-accent)] pl-2">
                  <span className="flex items-center gap-1 text-[10.5px] font-bold uppercase text-[var(--tv-accent-text)]">
                    <Sparkles size={11} /> AI agent
                  </span>
                  {e.agent_state === 'done' || e.agent_state === 'failed' ? (
                    <p className="tv-prose text-[12px] leading-[17px] text-[var(--tv-ink)]">{e.agent_note}</p>
                  ) : (
                    <p className="tv-pulse text-[11.5px] text-[var(--tv-muted)]">Looking into it</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </WidgetShell>
  );
}
