/**
 * The kiosk for a shared office tablet (#/time/kiosk/<kiosk code>): big
 * tiles of the people who work here today, tap your face or name, type your
 * personal kiosk PIN, done. Works for people without a sign-in. HR starts a
 * tablet once (signed in); the tablet then keeps its own token and anyone
 * may sign HR out of it. Nothing else is reachable from the kiosk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Coffee, Delete, LogIn, LogOut, MonitorSmartphone, Play, Search, Users, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, Field, Input, Spinner } from '../../components/ui.tsx';
import { kioskCall, kioskPhoto, kioskToken, setKioskToken } from '../../components/time/kioskApi.ts';
import { op, OpError } from '../../lib/api.ts';
import { can, signOut, useSession } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, initials } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { navigate } from '../../lib/router.ts';
import type { ClockState, KioskPerson, KioskRoster, PunchKind } from './types.ts';
import { punchLabel } from './util.ts';

const ICON: Record<PunchKind, LucideIcon> = { in: LogIn, out: LogOut, break_start: Coffee, break_end: Play };
const NEXT: Record<ClockState, PunchKind[]> = { out: ['in'], in: ['out', 'break_start'], break: ['break_end', 'out'] };
const IDLE_MS = 25000;

export function KioskPage({ params }: PageProps): React.JSX.Element {
  const code = (params['code'] ?? '').toUpperCase();
  const [token, setToken] = useState(() => kioskToken(code));
  if (token === '') return <StartKiosk code={code} onStarted={(c, tok) => (setKioskToken(c, tok), setToken(tok), c !== code && navigate('/time/kiosk/' + c))} />;
  return <KioskScreen code={code} onStopped={() => (setKioskToken(code, ''), setToken(''))} />;
}

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex min-h-[100dvh] flex-col bg-[var(--hr-page)] text-[var(--hr-ink)]">{children}</div>;
}

function StartKiosk({ code, onStarted }: { code: string; onStarted: (code: string, token: string) => void }): React.JSX.Element {
  const s = useSession();
  const me = s.me;
  const [name, setName] = useState(t('time.kiosk.default_name'));
  const [busy, setBusy] = useState(false);
  const allowed = me !== null && can(me, 'time', 'edit');
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ token: string; code: string }>('kiosk.start', { location: code, name: name.trim() });
      onStarted(r.code, r.token);
    } catch {
      /* the toast says why */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="hr-panel hr-in w-full max-w-md p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-muted)]">
              <MonitorSmartphone size={18} aria-hidden />
            </span>
            <div>
              <div className="text-[15px] font-semibold">{t('time.kiosk.start_title')}</div>
              <div className="hr-label">{t('time.kiosk.code', { code })}</div>
            </div>
          </div>
          {allowed ? (
            <div className="flex flex-col gap-3">
              <Field label={t('time.kiosk.tablet_name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 text-[15px]" />
              </Field>
              <Button variant="primary" size="lg" busy={busy} onClick={() => void start()} disabled={name.trim() === ''}>
                {t('time.kiosk.start')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] leading-5 text-[var(--hr-ink-2)]">{t('time.kiosk.not_started')}</p>
              <Button size="lg" onClick={() => navigate('/time/settings', { tab: 'kiosk' })}>
                {me === null ? t('time.kiosk.sign_in_hr') : t('time.kiosk.back')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function useNow(): Date {
  const [d, setD] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setD(new Date()), 15000);
    return () => clearInterval(h);
  }, []);
  return d;
}

function KioskScreen({ code, onStopped }: { code: string; onStopped: () => void }): React.JSX.Element {
  const s = useSession();
  const [roster, setRoster] = useState<KioskRoster | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [who, setWho] = useState<KioskPerson | null>(null);
  const [done, setDone] = useState<{ name: string; label: string; time: string } | null>(null);
  const now = useNow();
  const load = useCallback(async () => {
    try {
      const r = await kioskCall<KioskRoster>('kiosk.roster', code, { code, all: all ? 'true' : undefined });
      setRoster(r);
      setError('');
    } catch (e) {
      const err = e as OpError;
      if (err.code === 'kiosk_not_started') onStopped();
      else setError(err.message);
    }
  }, [code, all, onStopped]);
  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), 30000);
    return () => clearInterval(h);
  }, [load]);
  // Back to the tiles after a while without a tap.
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = useCallback(() => {
    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      setWho(null);
      setDone(null);
      setQ('');
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => {
      if (idle.current !== null) clearTimeout(idle.current);
    };
  }, [who, done, poke]);
  const people = useMemo(() => {
    const list = roster?.people ?? [];
    const n = q.trim().toLowerCase();
    return n === '' ? list : list.filter((p) => p.name.toLowerCase().includes(n) || p.number.toLowerCase().includes(n));
  }, [roster, q]);
  const local = roster !== null ? roster.time : '';
  // The location's wall clock (the tablet may be set to another zone).
  let time = '';
  try {
    time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: roster?.zone ?? undefined });
  } catch {
    time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return (
    <Shell>
      <header className="flex flex-wrap items-end gap-4 border-b border-[var(--hr-line)] px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="hr-label">{roster?.entity.name ?? ''}</div>
          <h1 className="hr-wrap text-[26px] font-semibold leading-7">{roster?.location.name ?? t('time.kiosk.title')}</h1>
        </div>
        <div className="text-right">
          <div className="hr-mono hr-num text-[26px] font-light leading-none">{local !== '' ? time : ''}</div>
          <div className="hr-label mt-1">{roster !== null ? fmtDay(roster.day, { weekday: true }) : ''}</div>
        </div>
      </header>
      {done !== null ? (
        <Done done={done} onClose={() => (setDone(null), setWho(null))} />
      ) : who !== null ? (
        <PinPad code={code} person={who} onCancel={() => setWho(null)} onDone={(d) => (setDone(d), void load())} poke={poke} />
      ) : (
        <main className="flex flex-1 flex-col gap-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative min-w-[240px] flex-1">
              <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--hr-muted)]" />
              <input value={q} onChange={(e) => (setQ(e.target.value), poke())} placeholder={t('time.kiosk.find')} aria-label={t('time.kiosk.find')} className="h-12 w-full rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-10 pr-3 text-[15px] outline-none focus:border-[var(--hr-ink-2)]" />
            </span>
            <Button size="lg" variant={all ? 'primary' : 'default'} icon={Users} onClick={() => setAll((x) => !x)}>
              {all ? t('time.kiosk.only_here') : t('time.kiosk.everyone')}
            </Button>
          </div>
          {error !== '' && <p className="text-[13px] text-[var(--hr-bad)]">{error}</p>}
          {roster === null ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner size={20} />
            </div>
          ) : people.length === 0 ? (
            <Empty icon={Users} title={q !== '' ? t('time.kiosk.nobody_found') : t('time.kiosk.nobody')} action={q === '' && !all ? <Button size="lg" onClick={() => setAll(true)}>{t('time.kiosk.everyone')}</Button> : undefined} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {people.map((p) => (
                <li key={p.employee}>
                  <Tile code={code} p={p} onPick={() => setWho(p)} />
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
      {s.me !== null && (
        <footer className="flex items-center gap-3 border-t border-[var(--hr-line)] px-6 py-3 text-[12px] text-[var(--hr-muted)]">
          <span className="flex-1">{t('time.kiosk.signed_in_as', { name: s.me.member.name })}</span>
          <Button size="sm" onClick={() => void signOut()}>
            {t('time.kiosk.sign_out_keep')}
          </Button>
        </footer>
      )}
    </Shell>
  );
}

function Tile({ code, p, onPick }: { code: string; p: KioskPerson; onPick: () => void }): React.JSX.Element {
  const [photo, setPhoto] = useState('');
  useEffect(() => {
    if (p.photo) void kioskPhoto(code, p.employee).then(setPhoto);
  }, [code, p.employee, p.photo]);
  return (
    <button type="button" onClick={onPick} className="hr-panel hr-focus flex h-36 w-full flex-col items-center justify-center gap-2 px-2 text-center transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]">
      <span className="relative">
        {photo !== '' ? (
          <img src={photo} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-full border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[15px] font-medium text-[var(--hr-ink-2)]">{initials(p.name)}</span>
        )}
        <span aria-hidden className={cn('absolute bottom-0.5 right-0.5 size-3.5 rounded-full ring-2 ring-[var(--hr-panel)]', p.state === 'in' ? 'bg-[var(--hr-good)]' : p.state === 'break' ? 'bg-[var(--hr-warn)]' : 'bg-[var(--hr-line-2)]')} />
      </span>
      <span className="hr-wrap line-clamp-2 text-[15px] font-medium leading-5">{p.name}</span>
      <span className="hr-label">{t('time.kiosk.state.' + p.state)}</span>
    </button>
  );
}

function PinPad({ code, person, onCancel, onDone, poke }: { code: string; person: KioskPerson; onCancel: () => void; onDone: (d: { name: string; label: string; time: string }) => void; poke: () => void }): React.JSX.Element {
  const options = NEXT[person.state];
  const [kind, setKind] = useState<PunchKind>(options[0] ?? 'in');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const press = (d: string): void => {
    poke();
    setErr('');
    setPin((x) => (x.length < 6 ? x + d : x));
  };
  const send = async (): Promise<void> => {
    if (pin.length < 4) return;
    setBusy(true);
    try {
      const r = await kioskCall<{ name: string; label: string; time: string }>('kiosk.punch', code, { code, employee: person.employee, pin, kind });
      onDone(r);
    } catch (e) {
      const x = e as OpError;
      setErr(x.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((x) => x.slice(0, -1));
      else if (e.key === 'Enter') void send();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <main className="flex flex-1 flex-col items-center gap-5 px-6 py-6">
      <div className="text-center">
        <div className="hr-wrap text-[26px] font-semibold">{person.name}</div>
        <div className="hr-label mt-1">{t('time.kiosk.state.' + person.state)}</div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((k) => {
          const Icon = ICON[k];
          return (
            <button key={k} type="button" onClick={() => (setKind(k), poke())} aria-pressed={kind === k} className={cn('hr-focus flex h-14 min-w-[160px] items-center justify-center gap-2 rounded-[var(--hr-radius)] border px-5 text-[15px] font-semibold transition-colors', kind === k ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)] text-[var(--hr-on-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] hover:bg-[var(--hr-hover)]')}>
              <Icon size={18} aria-hidden />
              {punchLabel(k)}
            </button>
          );
        })}
      </div>
      <div className="flex h-8 items-center gap-3" aria-label={t('time.kiosk.pin_entered', { n: pin.length })}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn('size-3.5 rounded-full border', i < pin.length ? 'border-[var(--hr-ink)] bg-[var(--hr-ink)]' : 'border-[var(--hr-line-2)]', i >= 4 && i >= pin.length && 'opacity-40')} />
        ))}
      </div>
      <div className="min-h-5 text-center text-[14px] text-[var(--hr-bad)]" role="alert">
        {err}
      </div>
      <div className="grid w-full max-w-[340px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)}>
            {d}
          </Key>
        ))}
        <Key onClick={() => (setPin(''), onCancel())} label={t('ui.cancel')}>
          <X size={22} aria-hidden />
        </Key>
        <Key onClick={() => press('0')}>0</Key>
        <Key onClick={() => setPin((x) => x.slice(0, -1))} label={t('time.kiosk.delete')}>
          <Delete size={22} aria-hidden />
        </Key>
      </div>
      <Button variant="primary" size="lg" className="h-14 w-full max-w-[340px] text-[15px]" disabled={pin.length < 4} busy={busy} onClick={() => void send()}>
        {punchLabel(kind)}
      </Button>
      {!person.has_pin && <p className="max-w-sm text-center text-[13px] text-[var(--hr-muted)]">{t('time.kiosk.no_pin')}</p>}
    </main>
  );
}

function Key({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="hr-focus hr-mono flex h-[72px] items-center justify-center rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] text-[26px] font-light transition-colors hover:bg-[var(--hr-hover)] active:bg-[var(--hr-active)]">
      {children}
    </button>
  );
}

function Done({ done, onClose }: { done: { name: string; label: string; time: string }; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const h = setTimeout(onClose, 4000);
    return () => clearTimeout(h);
  }, [onClose]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
      <span className="hr-in flex size-20 items-center justify-center rounded-full bg-[var(--hr-good-soft)] text-[var(--hr-good)]">
        <Check size={40} strokeWidth={2.2} aria-hidden />
      </span>
      <div className="hr-wrap text-center text-[26px] font-semibold">{done.name}</div>
      <div className="text-[15px] text-[var(--hr-ink-2)]">
        {done.label} <span className="hr-mono hr-num">{done.time}</span>
      </div>
      <Button size="lg" onClick={onClose}>
        {t('time.kiosk.next')}
      </Button>
    </main>
  );
}
