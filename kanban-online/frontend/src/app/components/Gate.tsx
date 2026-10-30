/**
 * What a signed-in account sees before the boards: an account waiting for
 * an admin sees that (and can say who it is), a suspended one sees that,
 * and a new account names itself first; the first admin also names the
 * workspace and chooses how new people join. Everyone else goes straight
 * through. When an admin lets a waiting account in, the page opens the
 * boards by itself.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Clock, LogOut, ShieldOff } from 'lucide-react';
import { toast, useAuth } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import type { Me, Settings } from '../lib/types.ts';
import { Button, Field, Input, PersonAvatar, Segmented, Spinner, errMessage } from './ui.tsx';

export function Gate({ children }: { children: ReactNode }): React.JSX.Element {
  const me = useLive(() => api.me(), ['users'], [], 150, 800);
  const status = me.data?.status;
  // Let in while this page was open: start over, so the live view sees the boards.
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (status === undefined) return;
    if (was.current !== null && was.current !== 'active' && status === 'active') window.location.reload();
    was.current = status;
  }, [status]);
  // Waiting: look again now and then too, in case a live update is missed.
  const { reload } = me;
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [status, reload]);

  if (me.data === null) {
    if (me.error !== null) return <Unreachable message={me.error} onRetry={me.reload} />;
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[var(--kb-side)] text-[var(--kb-muted)]">
        <Spinner size={18} />
      </div>
    );
  }
  const m = me.data;
  if (m.status === 'pending') return <Waiting me={m} onSaved={me.reload} />;
  if (m.status === 'suspended') return <Suspended me={m} />;
  if (!m.named) return <Welcome me={m} onDone={me.reload} />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ frame */

function Mark(): React.JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 38 38" aria-hidden>
      <rect width="38" height="38" rx="10" fill="var(--kb-accent)" />
      <rect x="9" y="10" width="5.5" height="18" rx="2" fill="white" />
      <rect x="16.25" y="10" width="5.5" height="12" rx="2" fill="white" fillOpacity=".85" />
      <rect x="23.5" y="10" width="5.5" height="8" rx="2" fill="white" fillOpacity=".7" />
    </svg>
  );
}

function Screen({ children, foot }: { children: ReactNode; foot?: ReactNode }): React.JSX.Element {
  return (
    <div className="kb-gate flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-4 pb-10 pt-6 text-[13px] text-[var(--kb-ink)]" style={{ fontFamily: 'var(--kb-font)' }}>
      <div className="flex items-center gap-2.5">
        <Mark />
        <span className="text-[20px] font-bold tracking-[-0.015em]">Kanban Online</span>
      </div>
      <div className="kb-in w-full max-w-[400px] rounded-[var(--kb-radius-lg)] border border-[var(--kb-line)] bg-[var(--kb-main)] px-6 pb-6 pt-5 shadow-[var(--kb-shadow-lg)]">{children}</div>
      {foot}
    </div>
  );
}

function SignOut(): React.JSX.Element {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => logout()} className="kb-focus inline-flex items-center gap-1.5 rounded-[var(--kb-radius-sm)] px-2 py-1 text-[12.5px] text-[var(--kb-ink-2)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
      <LogOut size={13} aria-hidden /> Sign out
    </button>
  );
}

/* ---------------------------------------------------------------- screens */

function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <Screen foot={<SignOut />}>
      <h1 className="text-[17px] font-semibold">The board did not answer</h1>
      <p className="mt-1 text-[13px] leading-5 text-[var(--kb-ink-2)]">{message}</p>
      <div className="mt-4">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Screen>
  );
}

function Waiting({ me, onSaved }: { me: Me; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState(me.named ? me.name : '');
  const [busy, setBusy] = useState(false);
  const save = (): void => {
    if (name.trim() === '' || name.trim() === me.name) return;
    setBusy(true);
    api
      .saveMe({ name: name.trim() })
      .then(() => {
        toast.success('Saved: the admins see your name');
        onSaved();
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Screen foot={<SignOut />}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--kb-amber-soft)] text-[var(--kb-amber)]">
          <Clock size={17} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-6">You are on the list</h1>
          <p className="mt-1 text-[13px] leading-5 text-[var(--kb-ink-2)]">
            <span className="font-semibold text-[var(--kb-ink)]">{me.workspace ?? 'This workspace'}</span> asks an admin to let new people in, and they have just been told you are here. This page opens the boards as soon as they do; you can leave it open.
          </p>
          {(me.admins ?? []).length > 0 && (
            <p className="mt-2 text-[12.5px] leading-[18px] text-[var(--kb-muted)]">
              Waiting on {listOf(me.admins ?? [])}. If it takes a while, send them a message.
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-[var(--kb-hair)] pt-4">
        <Field label="Your name" hint={`So the admins know who ${me.email} is.`}>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="e.g. Sam Lee" maxLength={60} aria-label="Your name" />
            <Button busy={busy} disabled={name.trim() === '' || name.trim() === me.name} onClick={save}>
              Save
            </Button>
          </div>
        </Field>
      </div>
    </Screen>
  );
}

/** "Ada", "Ada or Chloe", "Ada, Ben or Chloe". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function Suspended({ me }: { me: Me }): React.JSX.Element {
  return (
    <Screen foot={<SignOut />}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--kb-red-soft)] text-[var(--kb-red)]">
          <ShieldOff size={17} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-6">This account is suspended</h1>
          <p className="mt-1 text-[13px] leading-5 text-[var(--kb-ink-2)]">
            {me.email} cannot open the boards of <span className="font-semibold text-[var(--kb-ink)]">{me.workspace ?? 'this workspace'}</span> right now. Ask one of its admins to restore it.
          </p>
        </div>
      </div>
    </Screen>
  );
}

function Welcome({ me, onDone }: { me: Me; onDone: () => void }): React.JSX.Element {
  const admin = me.role === 'admin';
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workspace, setWorkspace] = useState('');
  const [joining, setJoining] = useState<'approval' | 'open'>('open');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!admin) return;
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setWorkspace(s.name);
        setJoining(s.joining);
      })
      .catch(() => undefined);
  }, [admin]);
  const go = async (): Promise<void> => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    try {
      if (admin && settings !== null && (workspace.trim() !== settings.name || joining !== settings.joining)) {
        await api.saveSettings({ ...(workspace.trim() !== '' && workspace.trim() !== settings.name ? { name: workspace.trim() } : {}), joining });
      }
      await api.saveMe({ name: name.trim() });
      onDone();
    } catch (err) {
      toast.error(errMessage(err));
      setBusy(false);
    }
  };
  return (
    <Screen foot={<SignOut />}>
      <div className="flex items-center gap-3">
        <PersonAvatar person={{ name: name.trim() || me.email, tone: me.tone }} size={36} />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-6">Welcome{admin && settings !== null ? '' : ' to the team'}</h1>
          <p className="truncate text-[12.5px] text-[var(--kb-muted)]">{me.email}</p>
        </div>
      </div>
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Field label="Your name" hint="What your team and its agents see on your cards, comments and decisions.">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Lee" maxLength={60} aria-label="Your name" className="h-9 text-[14px]" />
        </Field>
        {admin && settings !== null && (
          <div className="flex flex-col gap-4 rounded-[var(--kb-radius)] border border-[var(--kb-hair)] bg-[var(--kb-card)] p-3.5">
            <p className="text-[12.5px] leading-[18px] text-[var(--kb-ink-2)]">You run this workspace. Name it and choose how new people get in; you can change both in Settings.</p>
            <Field label="Workspace name">
              <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} maxLength={80} aria-label="Workspace name" className="bg-[var(--kb-main)]" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">New people</span>
              <Segmented size="sm" label="New people" value={joining} onChange={setJoining} options={[{ value: 'open', label: 'Join at once' }, { value: 'approval', label: 'An admin lets them in' }]} />
              <span className="text-[12px] leading-4 text-[var(--kb-muted)]">{joining === 'open' ? 'Anyone with the app or a link you share can create an account and start.' : 'People who sign up through a shared link wait for an admin. Accounts made on this computer are always in.'}</span>
            </div>
          </div>
        )}
        <Button type="submit" variant="primary" busy={busy} disabled={name.trim() === ''} className="h-9 text-[14px]">
          Open the boards
        </Button>
      </form>
    </Screen>
  );
}
