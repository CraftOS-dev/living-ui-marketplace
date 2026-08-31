/**
 * LoginGate (spec B4 multi-user): renders children only when authenticated;
 * otherwise an email/password login/register form with INLINE, human error
 * messages (no silent "Failed to authenticate"). Whether an authenticated user
 * may actually see the app is decided downstream by the approval gate.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../pb/auth.ts';
import { Button } from './Button.tsx';
import { Card, CardBody, CardHeader } from './Card.tsx';
import { Input } from './Input.tsx';

interface FieldErr {
  message?: string;
}

/** Turn a normalized PB error into a sentence a person can act on. */
function authErrorMessage(err: unknown, mode: 'login' | 'register'): string {
  const e = err as { status?: number; message?: string; raw?: { response?: { data?: Record<string, FieldErr> } } };
  const status = e?.status ?? 0;
  const data = e?.raw?.response?.data;

  if (data && typeof data === 'object') {
    const email = data['email']?.message;
    if (email !== undefined && email !== '') {
      if (/unique|already|exist/i.test(email)) return 'That email is already registered — try signing in instead.';
      return email;
    }
    const password = data['password']?.message;
    if (password !== undefined && password !== '') return password;
    const first = Object.values(data)[0]?.message;
    if (first !== undefined && first !== '') return first;
  }

  if (mode === 'login' && (status === 400 || status === 401 || status === 403)) {
    return 'Wrong email or password.';
  }
  if (status === 0) return 'Could not reach the server. Check your connection and try again.';
  return e?.message !== undefined && e.message !== '' ? e.message : 'Something went wrong. Please try again.';
}

export function LoginGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (userId !== null) return <>{children}</>;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err, mode));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (): void => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader title={mode === 'login' ? 'Sign in' : 'Create account'} />
        <CardBody>
          <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error !== null) setError(null);
              }}
            />
            <Input
              label="Password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error !== null) setError(null);
              }}
            />
            {mode === 'register' && (
              <p className="text-xs text-[var(--lui-muted)]">
                At least 8 characters. New accounts need an admin’s approval before they can open the workspace.
              </p>
            )}

            {error !== null && (
              <p
                role="alert"
                className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-700 dark:text-red-400"
              >
                {error}
              </p>
            )}

            <Button type="submit" loading={busy} className="mt-1">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={switchMode}>
              {mode === 'login' ? 'No account? Create one' : 'Have an account? Sign in'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
