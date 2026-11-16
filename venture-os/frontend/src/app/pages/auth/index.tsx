/**
 * Before the app: sign in, accept an invite (#/invite?email=&code=) and an
 * owner's recovery with the recovery code (#/recover). One calm card, at
 * most three fields, one black button.
 */
import { useState } from 'react';
import { Check, Copy, Telescope } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Field, Input, Notice } from '../../components/ui.tsx';
import { copyText, errMessage, op } from '../../lib/api.ts';
import { signedIn } from '../../lib/auth.ts';
import { navigate, useRoute } from '../../lib/router.ts';
import type { Me } from '../../lib/types.ts';

/** The one-screen frame of the screens before the app (setup, sign in, invite, recovery). */
export function Welcome({ children, wide }: { children: React.ReactNode; wide?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="vo-scroll flex min-h-[100dvh] flex-col overflow-y-auto bg-[var(--vo-page)] text-[var(--vo-ink)]">
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <Telescope size={18} strokeWidth={1.9} aria-hidden />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Venture OS</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-[4vh] sm:pt-[10vh]">
        <div className={cn('vo-panel vo-in w-full p-6 sm:p-8', wide === true ? 'max-w-[520px]' : 'max-w-[400px]')}>{children}</div>
      </main>
    </div>
  );
}

/** A recovery code shown once, with copy. */
export function OnceCode({ code }: { code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] py-2 pl-3 pr-2">
      <code className="vo-mono vo-wrap min-w-0 flex-1 text-[15px] tracking-[0.04em]">{code}</code>
      <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copyText(code).then((ok) => setCopied(ok))}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function SignInPage({ notice, firm }: { notice: string; firm: string }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me }>('auth.login', { email: email.trim(), password }, { quiet: true });
      signedIn(r.token, r.me);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Welcome>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="vo-wrap text-[15px] font-semibold">{firm !== '' ? firm : 'Sign in'}</h1>
        {notice !== '' && <Notice tone="warn">{notice}</Notice>}
        <Field label="Email">
          <Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        </Field>
        <Field label="Password" error={error}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" aria-invalid={error !== null} />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={email.trim() === '' || password === ''}>
          Sign in
        </Button>
        <div className="flex items-center justify-between text-[12px]">
          <a href="#/invite" className="vo-focus vo-link rounded-[2px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
            Invite code
          </a>
          <a href="#/recover" className="vo-focus vo-link rounded-[2px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
            Recover
          </a>
        </div>
      </form>
    </Welcome>
  );
}

export function InvitePage(): React.JSX.Element {
  const { query } = useRoute();
  const [email, setEmail] = useState(query.get('email') ?? '');
  const [code, setCode] = useState(query.get('code') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me }>('auth.accept-invite', { email: email.trim(), code: code.trim(), password }, { quiet: true });
      navigate('/');
      signedIn(r.token, r.me);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Welcome>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-[15px] font-semibold">Join your firm</h1>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" autoFocus={email === ''} />
        </Field>
        <Field label="Invite code">
          <Input className="vo-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" aria-label="Invite code" />
        </Field>
        <Field label="New password" tip="At least 8 characters." error={error}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" autoFocus={email !== '' && code !== ''} />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={email.trim() === '' || code.trim() === '' || password.length < 8}>
          Join
        </Button>
        <a href="#/" className="vo-focus vo-link self-start rounded-[2px] text-[12px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
          Sign in
        </a>
      </form>
    </Welcome>
  );
}

export function RecoverPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; me: Me; code: string } | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me; recovery_code: string }>('auth.recover', { email: email.trim(), recovery_code: code.trim(), password }, { quiet: true });
      setDone({ token: r.token, me: r.me, code: r.recovery_code });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (done !== null)
    return (
      <Welcome>
        <div className="flex flex-col gap-4">
          <h1 className="text-[15px] font-semibold">New recovery code</h1>
          <OnceCode code={done.code} />
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              navigate('/');
              signedIn(done.token, done.me);
            }}
          >
            Continue
          </Button>
        </div>
      </Welcome>
    );
  return (
    <Welcome>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-[15px] font-semibold">Recover</h1>
        <Field label="Email">
          <Input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        </Field>
        <Field label="Recovery code" tip="The code shown once at setup.">
          <Input className="vo-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Recovery code" />
        </Field>
        <Field label="New password" error={error}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={email.trim() === '' || code.trim() === '' || password.length < 8}>
          Recover
        </Button>
        <a href="#/" className="vo-focus vo-link self-start rounded-[2px] text-[12px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
          Sign in
        </a>
      </form>
    </Welcome>
  );
}
