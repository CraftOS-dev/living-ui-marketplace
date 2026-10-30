/**
 * Command palette (Ctrl K): find a symbol (shown on the focused widget, or
 * on link channel 1) or run a command: interval, widget, workspace, alert,
 * Ask AI, undo.
 */
import { useMemo, useRef, useState } from 'react';
import { Bell, Clock, LayoutGrid, Redo2, Search, Sparkles, Undo2, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { SymbolResults } from '../components/SymbolSearch.tsx';
import { Modal } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { short } from '../lib/format.ts';
import { useApp } from '../lib/store.tsx';
import { INTERVALS } from '../lib/types.ts';
import type { SearchResult } from '../lib/types.ts';
import { useDialogs } from './Dialogs.tsx';
import { WIDGET_DEFS } from './registry.tsx';

interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const app = useApp();
  const dialogs = useDialogs();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const symbols = useRef<SearchResult[]>([]);
  const [symCount, setSymCount] = useState(0);
  const focused = app.ws?.widgets.find((w) => w.id === app.focused) ?? null;
  const target = focused !== null && ['chart', 'chartgrid', 'details', 'news', 'analyst', 'watchlist', 'screener', 'heatmap'].includes(focused.type) ? focused : null;
  const shows = target !== null ? app.shows(target) : { symbol: app.ws?.links['1']?.symbol ?? 'AAPL', interval: app.ws?.links['1']?.interval ?? '1D' };

  const commands: Command[] = useMemo(() => {
    const out: Command[] = [];
    for (const iv of INTERVALS) out.push({ id: 'iv' + iv, label: 'Interval ' + iv, icon: Clock, keywords: 'interval timeframe ' + iv, run: () => app.show(target, { interval: iv }) });
    out.push({ id: 'ai', label: 'Ask AI about ' + short(shows.symbol) + ' · ' + shows.interval, icon: Sparkles, keywords: 'ai agent analyze analysis ask explain', run: () => dialogs.askAI({ symbol: shows.symbol, interval: shows.interval }) });
    out.push({ id: 'alert', label: 'New alert on ' + short(shows.symbol), icon: Bell, keywords: 'alert notify price', run: () => dialogs.newAlert({ symbol: shows.symbol, interval: shows.interval }) });
    for (const d of WIDGET_DEFS) out.push({ id: 'w' + d.type, label: 'Add widget: ' + d.label, icon: d.icon, keywords: 'add widget ' + d.label + ' ' + d.description, run: () => void app.addWidget(d.type) });
    for (const w of app.workspaces) out.push({ id: 'ws' + w.id, label: 'Go to workspace: ' + w.name, icon: Workflow, keywords: 'workspace switch tab ' + w.name, run: () => app.activate(w.id) });
    for (const t of ['markets', 'crypto', 'multi', 'research', 'blank'])
      out.push({
        id: 'new' + t,
        label: 'New workspace: ' + t[0]?.toUpperCase() + t.slice(1),
        icon: LayoutGrid,
        keywords: 'new workspace template ' + t,
        run: () =>
          void api
            .createWorkspace('', t)
            .then((r) => {
              app.reloadWorkspaces();
              app.activate(r.workspace.id);
            })
            .catch((err: unknown) => toast.error(errMessage(err))),
      });
    out.push({ id: 'undo', label: 'Undo', icon: Undo2, keywords: 'undo back revert', run: () => void api.undo().catch((err: unknown) => toast.error(errMessage(err))) });
    out.push({ id: 'redo', label: 'Redo', icon: Redo2, keywords: 'redo', run: () => void api.redo().catch((err: unknown) => toast.error(errMessage(err))) });
    out.push({ id: 'markup', label: (app.settings?.agent_markup !== false ? 'Hide' : 'Show') + ' AI markup on charts', icon: Sparkles, keywords: 'ai markup drawings hide show', run: () => app.updateSettings({ agent_markup: app.settings?.agent_markup === false }) });
    return out;
  }, [app, dialogs, target, shows.symbol, shows.interval]);

  const needle = q.trim().toLowerCase();
  const cmds = needle === '' ? commands.filter((c) => ['ai', 'alert'].includes(c.id) || c.id.startsWith('w')).slice(0, 6) : commands.filter((c) => c.label.toLowerCase().includes(needle) || c.keywords.toLowerCase().includes(needle)).slice(0, 8);
  const symShown = Math.min(symCount, needle === '' ? 8 : 10);
  const total = symShown + cmds.length;

  if (!open) return null;

  const pickSymbol = (s: string): void => {
    onClose();
    setQ('');
    app.show(target, { symbol: s });
  };
  const runCmd = (c: Command): void => {
    onClose();
    setQ('');
    c.run();
  };

  return (
    <Modal open top bare width="lg" title="Search symbols and commands" onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-[var(--tv-hair)] px-3">
        <Search size={15} className="text-[var(--tv-muted)]" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(total - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (active < symShown) {
                const r = symbols.current[active];
                if (r !== undefined) pickSymbol(r.symbol);
                else if (q.trim() !== '') pickSymbol(q.trim().toUpperCase());
              } else {
                const c = cmds[active - symShown];
                if (c !== undefined) runCmd(c);
              }
            }
          }}
          placeholder={'Symbol for ' + (target !== null ? 'the selected widget' : 'link 1') + ', or a command'}
          aria-label="Search symbols and commands"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
        />
      </div>
      <div className="max-h-[64vh] overflow-y-auto py-1">
        <div className="px-3 pb-0.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">Symbols</div>
        <SymbolResults
          query={q}
          onPick={pickSymbol}
          active={active < symShown ? active : -1}
          setActive={setActive}
          limit={needle === '' ? 8 : 10}
          onResults={(r) => {
            symbols.current = r.slice(0, needle === '' ? 8 : 10);
            setSymCount(symbols.current.length);
          }}
        />
        {cmds.length > 0 && <div className="px-3 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]">Commands</div>}
        {cmds.map((c, i) => (
          <button key={c.id} type="button" onMouseEnter={() => setActive(symShown + i)} onClick={() => runCmd(c)} className={cn('flex h-8 w-full items-center gap-2.5 px-3 text-left text-[12.5px] font-medium', active === symShown + i && 'bg-[var(--tv-row)]')}>
            <c.icon size={14} className={c.id === 'ai' || c.id === 'markup' ? 'text-[var(--tv-accent-text)]' : 'text-[var(--tv-ink-2)]'} />
            {c.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
