/**
 * Server → Terminal (v4 plan §6, N-B20). A real shell on the server for admins:
 *   - only when it is switched on at the server itself (NETSENTRY_TERMINAL=on — the installer asks);
 *   - your password again before it opens; recorded (output only, secrets hidden on the server);
 *   - closes after 15 minutes without typing, 4 hours at most.
 * Output arrives live (terminal_io records only you can follow); what you type goes straight to it.
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, Dialog, Input, Pill, Spinner, getPbClient, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { newerVersion, ReconnectDrawer } from './Reconnect.tsx';
import type { Sensor } from '../lib/types.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';

interface Cap {
  available?: boolean;
  reason?: string;
  user?: string;
  mode?: string;
}
interface SessionRow {
  id: string;
  user: string;
  status: string;
  started_at: string;
  ended_at: string;
  reason: string;
  run_as: string;
  size: number;
}

const enc = new TextEncoder();
function b64(s: string): string {
  let bin = '';
  for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function LiveTerminal({ sessionId, lineMode, onClosed }: { sessionId: string; lineMode: boolean; onClosed: (reason: string) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState('Starting the shell on the server…');
  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', convertEol: false, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    fit.fit();
    term.focus();
    const pb = getPbClient().pb;
    let last = 0;
    const pending: Array<{ seq: number; data: string }> = [];
    const write = (rec: { seq: number; data: string }): void => {
      if (rec.seq <= last) return;
      pending.push(rec);
      pending.sort((a, b) => a.seq - b.seq);
      while (pending.length && pending[0]!.seq === last + 1) {
        const r = pending.shift()!;
        last = r.seq;
        term.write(unb64(r.data));
      }
      setState('');
    };
    let unsub: (() => void) | null = null;
    void pb
      .collection('terminal_io')
      .subscribe<{ seq: number; data: string; session: string }>('*', (e) => e.action === 'create' && e.record.session === sessionId && write(e.record), { filter: `session = "${sessionId}"` })
      .then((u) => (unsub = u));
    // Anything that arrived before we were listening — and, every half second, anything newer: a live
    // update lost on a busy page (they can be) must never leave output unseen until the next key.
    let fetching = false;
    const catchUp = (): void => {
      if (fetching) return;
      fetching = true;
      void pb
        .collection('terminal_io')
        .getFullList<{ seq: number; data: string }>({ filter: `session = "${sessionId}" && seq > ${last}`, sort: 'seq' })
        .then((rows) => rows.forEach(write))
        .catch(() => undefined)
        .finally(() => (fetching = false));
    };
    catchUp();
    const poll = window.setInterval(catchUp, 500);
    // Typing: sent in small batches (every 30 ms) so a paste is one request.
    let typed = '';
    let timer = 0;
    const flush = (): void => {
      timer = 0;
      if (!typed) return;
      const chunk = typed;
      typed = '';
      void pb.send('/api/netsentry/terminal/input', { method: 'POST', body: { session_id: sessionId, data: b64(chunk) } }).catch((e: unknown) => {
        if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) setState('This terminal is closed.');
        else setState("What you typed didn't reach the server — try again.");
      });
    };
    const send = (d: string): void => {
      typed += d;
      if (!timer) timer = window.setTimeout(flush, 30);
    };
    // Windows (line by line): the shell has no console to echo keys, so the line is edited here —
    // shown as you type (after the server's "PS C:\\path> "), Backspace works, Enter sends it.
    let line = '';
    let lastWasCR = false;
    const editLine = (d: string): void => {
      if (d.startsWith('\x1b')) return; // arrow keys and other escape sequences: no line history here
      for (const ch of d) {
        if (ch === '\n' && lastWasCR) {
          lastWasCR = false;
          continue;
        }
        lastWasCR = ch === '\r';
        if (ch === '\r' || ch === '\n') {
          term.write('\r\n');
          send(line + '\r');
          line = '';
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) {
            line = line.slice(0, -1);
            term.write('\b \b');
          }
        } else if (ch === '\x03') {
          term.write('^C');
          line = '';
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    };
    const onData = term.onData((d) => (lineMode ? editLine(d) : send(d)));
    const onResize = (): void => {
      fit.fit();
      void runOp('terminal.resize', { session_id: sessionId, cols: term.cols, rows: term.rows }, { silent: true }).catch(() => undefined);
    };
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(() => onResize());
    observer.observe(box.current!);
    onResize();
    // Is it still open? (the server closes it when idle, too long, or the shell exits)
    const watch = window.setInterval(() => {
      void pb
        .collection('terminal_sessions')
        .getOne<{ status: string; reason: string }>(sessionId)
        .then((s) => {
          if (s.status === 'closed') {
            term.write(`\r\n\x1b[2m[closed: ${s.reason}]\x1b[0m\r\n`);
            window.clearInterval(watch);
            onClosed(s.reason);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      onData.dispose();
      window.removeEventListener('resize', onResize);
      window.clearInterval(watch);
      window.clearInterval(poll);
      observer.disconnect();
      if (unsub) unsub();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  return (
    <div className="flex flex-col gap-2">
      {state && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> {state}
        </p>
      )}
      <div className="h-[60vh] min-h-[320px] w-full rounded-lg bg-black p-2">
        <div ref={box} className="h-full w-full overflow-hidden" />
      </div>
    </div>
  );
}

export function TerminalPanel({ cap, online }: { cap: Cap | null; online: boolean }): React.JSX.Element {
  const { can } = useMe();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const sessionList = useOp<{ sessions: SessionRow[] }>('terminal.sessions', {});
  const sessions = sessionList.data ? sessionList.data.sessions : sessionList.error ? [] : null;
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null);

  const load = sessionList.reload;
  // An older monitor has the older terminal (no path, typed text garbled on Windows): say so, with the update.
  const monitors = useCollection<Sensor>('sensors', { filter: 'status != "revoked"', sort: '-last_seen' });
  const latest = useOp<{ version?: string }>('sensors.install-info', {}, { freshMs: 300000 }).data?.version || '';
  const [updating, setUpdating] = useState(false);
  const mon = monitors.records[0];
  const outdated = !!mon && !!latest && newerVersion(latest, mon.version);

  if (!can('admin')) return <p className="text-[14px] text-[var(--agent-app-muted)]">The terminal is for admins.</p>;

  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ session_id: string }>('terminal.open', { password, cols: 120, rows: 32 });
      setAsking(false);
      setPassword('');
      setSession(r.session_id);
      setEnded(null);
      load();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  const close = (): void => {
    if (session) void runOp('terminal.close', { session_id: session }, { silent: true }).catch(() => undefined);
    setSession(null);
    window.setTimeout(load, 1500);
  };

  return (
    <div className="flex flex-col gap-4">
      {outdated && cap?.available && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1">
            This server's monitor is version {mon?.version || '?'}; NetSentry has {latest}. Update it for the newer terminal{cap.mode === 'line' ? ' (it shows where you are, and keeps accented letters intact)' : ''}.
          </span>
          <Button size="sm" variant="secondary" onClick={() => setUpdating(true)}>
            Update the monitor
          </Button>
        </div>
      )}
      <ReconnectDrawer open={updating} mode="update" onClose={() => setUpdating(false)} />
      {!cap?.available ? (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4 text-[14px]">
          <p className="font-medium">The terminal is switched off on this server.</p>
          <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">
            {cap?.reason ? `${cap.reason.charAt(0).toUpperCase()}${cap.reason.slice(1)}. ` : ''}It can only be switched on at the server itself: run the monitor's installer again (Settings → Monitor) and answer "yes" to the terminal. NetSentry can never switch it on from here.
          </p>
        </div>
      ) : session ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {ended ? (
              <span className="text-[var(--agent-app-muted)]">This terminal closed: {ended}.</span>
            ) : (
              <>
                <Pill tone="warn">recorded</Pill>
                <span className="text-[var(--agent-app-muted)]">
                  On the server as {cap.user || 'its account'}
                  {cap.mode === 'line' ? ' · Windows: line by line (no full-screen programs)' : ''} · closes after 15 minutes without typing
                </span>
              </>
            )}
            <Button size="sm" variant="secondary" className="ml-auto" onClick={close}>
              {ended ? 'Done' : 'Close terminal'}
            </Button>
          </div>
          <LiveTerminal
            sessionId={session}
            lineMode={cap.mode === 'line'}
            onClosed={(reason) => {
              setEnded(reason);
              load();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
          <span className="min-w-0 flex-1 text-[14px]">
            A shell on the server as <strong>{cap.user || 'its account'}</strong> — for anything the buttons don't cover. You'll be asked for your password again; everything it shows is recorded (secrets hidden).
          </span>
          <Button disabled={!online} onClick={() => setAsking(true)}>
            Open terminal
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[13px] font-semibold">Sessions</h2>
        {sessions === null ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <p className="text-[14px] text-[var(--agent-app-muted)]">No terminal has been opened yet.</p>
        ) : (
          <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
            {sessions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)] px-4 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1">
                  {s.user} as {s.run_as || 'the server account'} · {relTime(s.started_at)}
                  {s.status === 'closed' && s.reason ? ` · ${s.reason}` : ''}
                </span>
                {s.status !== 'closed' && <Pill tone="good">open</Pill>}
                {s.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runOp<{ transcript: string }>('terminal.transcript', { session_id: s.id }).then((t) => setShown({ id: s.id, text: t.transcript }))}
                  >
                    What it showed
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={asking}
        onOpenChange={(o) => (setAsking(o), setPassword(''))}
        title="Your password, please"
        description="A terminal is full control of the server, so NetSentry asks again before opening one."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!password} onClick={() => void open()}>
              Open terminal
            </Button>
          </div>
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), void open())}>
          <Input label="NetSentry password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </form>
      </Dialog>
      <Dialog
        open={shown !== null}
        onOpenChange={(o) => !o && setShown(null)}
        title="What the terminal showed"
        description="Recorded on the server, with passwords, tokens and keys hidden."
        className="max-w-4xl"
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setShown(null)}>
              Close
            </Button>
          </div>
        }
      >
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--agent-app-surface-2)] p-3 font-mono text-[12px]">{shown?.text || '(nothing)'}</pre>
      </Dialog>
    </div>
  );
}
