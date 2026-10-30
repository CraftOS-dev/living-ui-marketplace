/**
 * Dialogs any widget can open: symbol search, alert builder, AI request.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from '../../kit/index.ts';
import { AlertDialog } from '../components/AlertDialog.tsx';
import type { AlertPreset } from '../components/AlertDialog.tsx';
import { useSymbolSearch } from '../components/SymbolSearch.tsx';
import { Btn, Modal, area } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { short } from '../lib/format.ts';
import type { Interval } from '../lib/types.ts';

interface Dialogs {
  searchSymbol: (initial: string, onPick: (s: string) => void, title?: string) => void;
  newAlert: (preset: AlertPreset) => void;
  askAI: (p: { symbol?: string; interval?: Interval; watchlist?: string; watchlistName?: string; focus?: string }) => void;
}

const Ctx = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const c = useContext(Ctx);
  if (c === null) throw new Error('useDialogs outside DialogsProvider');
  return c;
}

const PRESETS = ["Explain today's move", 'Key levels and trend', 'What would invalidate the trend?', 'Risk check before a trade'];

export function DialogsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [searchEl, searchSymbol] = useSymbolSearch();
  const [alert, setAlert] = useState<AlertPreset | null>(null);
  const [ask, setAsk] = useState<{ symbol?: string; interval?: Interval; watchlist?: string; watchlistName?: string; focus: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const askAI = useCallback((p: { symbol?: string; interval?: Interval; watchlist?: string; watchlistName?: string; focus?: string }) => setAsk({ ...p, focus: p.focus ?? '' }), []);

  const send = async (): Promise<void> => {
    if (ask === null) return;
    setBusy(true);
    try {
      const r = await api.requestAnalysis(ask.watchlist !== undefined ? { watchlist: ask.watchlist, focus: ask.focus } : { symbol: ask.symbol ?? 'AAPL', interval: ask.interval ?? '1D', focus: ask.focus });
      toast.success(r.asked ? 'Asked your AI agent' : 'Queued for your AI agent' + (r.reason !== '' ? ' (' + r.reason + ')' : ''));
      setAsk(null);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo<Dialogs>(() => ({ searchSymbol, newAlert: setAlert, askAI }), [searchSymbol, askAI]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {searchEl}
      {alert !== null && <AlertDialog key={alert.alert?.id ?? alert.symbol + (alert.price ?? '') + (alert.drawing ?? '')} preset={alert} onClose={() => setAlert(null)} pickSymbol={(cb) => searchSymbol('', cb, 'Alert on')} />}
      {ask !== null && (
        <Modal
          open
          width="md"
          onClose={() => setAsk(null)}
          title={ask.watchlist !== undefined ? 'Ask AI to review ' + (ask.watchlistName ?? 'this watchlist') : 'Ask AI about ' + short(ask.symbol ?? '') + ' · ' + (ask.interval ?? '1D')}
          description={
            ask.watchlist !== undefined
              ? 'Your AI agent reads every symbol, flags what stands out and writes a short review.'
              : 'Your AI agent reads the chart (trend, momentum, levels, volume, news), marks it up and writes an analysis. It shows in the AI analyst widget and on the chart.'
          }
          footer={
            <>
              <Btn onClick={() => setAsk(null)}>Cancel</Btn>
              <Btn variant="accent" icon={Sparkles} loading={busy} onClick={() => void send()}>
                Ask AI
              </Btn>
            </>
          }
        >
          <textarea
            autoFocus
            rows={3}
            value={ask.focus}
            maxLength={1000}
            onChange={(e) => setAsk({ ...ask, focus: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
            placeholder="Your question (optional), e.g. Is the breakout holding?"
            aria-label="Question for the AI agent"
            className={area + ' w-full resize-none'}
          />
          {ask.watchlist === undefined && (
            <div className="mt-2 flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button key={p} type="button" onClick={() => setAsk({ ...ask, focus: p })} className="h-6 rounded-[4px] bg-[var(--tv-row)] px-2 text-[11.5px] font-semibold text-[var(--tv-ink-2)] hover:bg-[var(--tv-row-hover)] hover:text-[var(--tv-ink)]">
                  {p}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Ctx.Provider>
  );
}
