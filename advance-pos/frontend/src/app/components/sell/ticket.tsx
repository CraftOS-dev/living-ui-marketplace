/**
 * The sale on screen ("the ticket"). It lives on the server as an open
 * order, so a refresh, a locked register or another device never loses
 * it; this device remembers which one it shows.
 *
 * Changes go one at a time, each carrying the version it was made against:
 * fast taps queue instead of racing, and a sale changed on another screen
 * (or by your AI agent) is reloaded rather than overwritten. The customer
 * display follows whatever this register shows.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from '../../../kit/index.ts';
import { OpError, api } from '../../lib/api.ts';
import type { LineChange, LineInput, OrderChange } from '../../lib/api.ts';
import { listen } from '../../lib/live.ts';
import { useSession } from '../../lib/session.tsx';
import type { DisplayMessage, Order } from '../../lib/types.ts';

function key(register: string): string {
  return 'pos.ticket.v1.' + register;
}

function readCurrent(register: string): string {
  try {
    return localStorage.getItem(key(register)) ?? '';
  } catch {
    return '';
  }
}

function writeCurrent(register: string, id: string): void {
  try {
    if (id === '') localStorage.removeItem(key(register));
    else localStorage.setItem(key(register), id);
  } catch {
    // Not remembered across reloads; the open ticket stays in Tickets.
  }
}

export interface TicketValue {
  order: Order | null;
  loading: boolean;
  /** A change is on its way to the server. */
  busy: boolean;
  /** Add a line (starts a sale when there is none). Resolves the sale as changed, or null when it was refused. */
  add: (input: LineInput) => Promise<Order | null>;
  changeLine: (change: LineChange) => Promise<Order | null>;
  removeLine: (line: string) => Promise<Order | null>;
  change: (change: OrderChange) => Promise<Order | null>;
  /** Bring items back from a paid sale into this one (or a new one). */
  startReturn: (from: string, input: { lines?: { line: string; qty: number; restock: boolean }[]; all?: boolean }) => Promise<Order | null>;
  /** Show another open ticket (or none for a fresh sale). */
  open: (id: string) => void;
  /** Take what the server answered (payments) as the ticket. */
  accept: (o: Order) => void;
  reload: () => void;
  /** The customer display: what to show besides the ticket. */
  announce: (message: DisplayMessage | null) => void;
}

const Ctx = createContext<TicketValue | null>(null);

export function useTicket(): TicketValue {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useTicket outside TicketProvider');
  return v;
}

export function TicketProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { register } = useSession();
  const reg = register?.id ?? '';
  const [currentId, setCurrentId] = useState(() => readCurrent(reg));
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(currentId !== '');
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<Order | null>(null);
  const pending = useRef(0);
  latest.current = order;

  const show = useCallback(
    (o: Order | null) => {
      const id = o !== null && o.status === 'open' ? o.id : o !== null && o.status === 'paid' ? o.id : '';
      setOrder(o);
      latest.current = o;
      setCurrentId(id);
      writeCurrent(reg, o !== null && o.status === 'open' ? o.id : '');
    },
    [reg],
  );

  // Load the remembered ticket (a paid or voided one is let go).
  const load = useCallback(
    async (id: string) => {
      if (id === '') {
        setOrder(null);
        latest.current = null;
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const r = await api.order(id, { quiet: true });
        if (r.order.status === 'open' || (latest.current !== null && latest.current.id === id)) show(r.order);
        else show(null);
      } catch {
        show(null);
      } finally {
        setLoading(false);
      }
    },
    [show],
  );

  useEffect(() => {
    const id = readCurrent(reg);
    setCurrentId(id);
    void load(id);
  }, [reg, load]);

  // Another screen or the agent changed this sale: reload it (not while our own change is in flight).
  useEffect(() => {
    if (currentId === '') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = (orderId: string): void => {
      if (orderId !== currentId || pending.current > 0) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending.current > 0) return;
        void api
          .order(currentId, { quiet: true })
          .then((r) => {
            const cur = latest.current;
            if (pending.current > 0 || cur === null || cur.id !== r.order.id) return;
            if (r.order.version !== cur.version || r.order.status !== cur.status) {
              setOrder(r.order);
              latest.current = r.order;
              if (r.order.status === 'void') {
                writeCurrent(reg, '');
                toast.info('This sale was cleared on another screen');
              }
            }
          })
          .catch(() => undefined);
      }, 200);
    };
    const offA = listen('orders', (e) => check(e.record.id));
    const offB = listen('order_lines', (e) => check(String(e.record['order'] ?? '')));
    const offC = listen('payments', (e) => check(String(e.record['order'] ?? '')));
    return () => {
      if (timer !== null) clearTimeout(timer);
      offA();
      offB();
      offC();
    };
  }, [currentId, reg]);

  // The customer display follows this register's ticket.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const id = order !== null && order.status === 'open' ? order.id : '';
    if (focused.current === id || reg === '') return;
    focused.current = id;
    void api.focus(id).catch(() => undefined);
  }, [order, reg]);

  /** Run one change after the ones before it; on a stale version reload and say so. */
  const run = useCallback(
    (fn: (cur: Order | null) => Promise<Order>): Promise<Order | null> => {
      pending.current += 1;
      setBusy(true);
      const next = queue.current.then(async () => {
        try {
          const o = await fn(latest.current);
          show(o);
          return o;
        } catch (err) {
          // The transport has already said what went wrong.
          const cur = latest.current;
          if (err instanceof OpError && cur !== null && (err.code === 'stale' || err.code === 'not_open')) {
            try {
              const r = await api.order(cur.id, { quiet: true });
              if (r.order.status === 'open') show(r.order);
              else {
                // Paid or cleared on another screen: this register starts a fresh sale.
                show(null);
              }
            } catch {
              show(null);
            }
          }
          return null;
        } finally {
          pending.current -= 1;
          if (pending.current === 0) setBusy(false);
        }
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [show],
  );

  const value = useMemo<TicketValue>(
    () => ({
      order,
      loading,
      busy,
      add: (input) => run((cur) => api.add({ ...input, order: cur !== null && cur.status === 'open' ? cur.id : undefined, expected_version: cur !== null && cur.status === 'open' ? cur.version : undefined })),
      changeLine: (change) => run((cur) => api.changeLine({ ...change, expected_version: cur?.version })),
      removeLine: (line) => run((cur) => api.removeLine(line, cur?.version)),
      change: (change) => run((cur) => api.changeOrder({ ...change, order: cur !== null && cur.status === 'open' ? cur.id : undefined, expected_version: cur !== null && cur.status === 'open' ? cur.version : undefined })),
      startReturn: (from, input) => run((cur) => api.startReturn(from, { ...input, order: cur !== null && cur.status === 'open' ? cur.id : undefined })),
      open: (id) => {
        writeCurrent(reg, id);
        setCurrentId(id);
        void load(id);
      },
      accept: (o) => show(o),
      reload: () => void load(latest.current?.id ?? currentId),
      announce: (message) => {
        const id = latest.current !== null ? latest.current.id : '';
        focused.current = id;
        void api.focus(id, message).catch(() => undefined);
      },
    }),
    [order, loading, busy, run, reg, load, show, currentId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
