/**
 * Sign in, accept an invite (the link from an administrator carries the
 * email and code), and the owner's way back in with the recovery code.
 */
import { useState } from 'react';
import { ArrowRight, Check, Copy, KeyRound, LogIn } from 'lucide-react';
import { Button, Checkbox, CompanyLogo, Field, Input, LinkButton, Notice } from '../../components/ui.tsx';
import { copyText, errMessage, op } from '../../lib/api.ts';
import { signedIn } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { navigate, useRoute } from '../../lib/router.ts';
import type { Me } from '../../lib/types.ts';
import { Welcome } from '../setup/index.tsx';

export function SignInPage({ notice, company, logo }: { notice: string; company: string; logo: { light: string; dark: string } }): React.JSX.Element {
  const [mode, setMode] = useState<'password' | 'recover'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ token: string; me: Me; code: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'password') {
        const r = await op<{ token: string; me: Me }>('auth.login', { email: email.trim(), password }, { quiet: true });
        signedIn(r.token, r.me);
      } else {
        const r = await op<{ token: string; me: Me; recovery_code: string }>('auth.recover', { email: email.trim(), recovery_code: code.trim(), password }, { quiet: true });
        setFresh({ token: r.token, me: r.me, code: r.recovery_code });
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (fresh !== null)
    return (
      <Welcome>
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-[15px] font-semibold">{t('signin.new_code_title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('setup.code_sub')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
            <code className="hr-mono hr-wrap min-w-0 flex-1 select-all text-[15px] tracking-[0.06em]">{fresh.code}</code>
            <Button icon={Copy} onClick={() => void copyText(fresh.code).then((ok) => ok && setSaved(true))}>
              {t('ui.copy')}
            </Button>
          </div>
          <Checkbox checked={saved} onChange={setSaved} label={t('setup.code_saved')} />
          <div className="flex justify-end">
            <Button variant="primary" iconRight={ArrowRight} disabled={!saved} onClick={() => signedIn(fresh.token, fresh.me)}>
              {t('setup.open_app')}
            </Button>
          </div>
        </div>
      </Welcome>
    );

  const ready = email.trim() !== '' && password !== '' && (mode === 'password' || (code.trim() !== '' && password.length >= 8));
  return (
    <Welcome>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        <div>
          <CompanyLogo light={logo.light} dark={logo.dark} height={32} alt={company} className="mb-4" />
          <h1 className="text-[15px] font-semibold">{mode === 'password' ? t('signin.title') : t('signin.recover_title')}</h1>
          <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{mode === 'password' ? (company !== '' ? t('signin.sub_company', { company }) : t('signin.sub')) : t('signin.recover_sub')}</p>
        </div>
        {notice !== '' && <Notice tone="warn">{notice}</Notice>}
        <Field label={t('setup.email')}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" autoFocus aria-label={t('setup.email')} />
        </Field>
        {mode === 'recover' && (
          <Field label={t('signin.recovery_code')}>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" className="hr-mono tracking-[0.06em]" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" aria-label={t('signin.recovery_code')} />
          </Field>
        )}
        <Field label={mode === 'password' ? t('setup.password') : t('signin.new_password')} hint={mode === 'recover' ? t('setup.password_hint') : undefined}>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === 'password' ? 'current-password' : 'new-password'} aria-label={t('setup.password')} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-col items-start gap-1.5">
            <LinkButton onClick={() => navigate('/invite')}>{t('signin.have_invite')}</LinkButton>
            <LinkButton
              onClick={() => {
                setMode(mode === 'password' ? 'recover' : 'password');
                setError(null);
              }}
            >
              {mode === 'password' ? t('signin.forgot') : t('signin.back_to_password')}
            </LinkButton>
          </div>
          <Button type="submit" variant="primary" icon={mode === 'password' ? LogIn : KeyRound} busy={busy} disabled={!ready}>
            {mode === 'password' ? t('signin.submit') : t('signin.recover_submit')}
          </Button>
        </div>
        {mode === 'recover' && <p className="text-[12px] leading-4 text-[var(--hr-muted)]">{t('signin.not_owner')}</p>}
      </form>
    </Welcome>
  );
}

/** Accept an invite: '#/invite?email=...&code=...' prefills both. */
export function InvitePage(): React.JSX.Element {
  const { query } = useRoute();
  const [email, setEmail] = useState(query.get('email') ?? '');
  const [code, setCode] = useState((query.get('code') ?? '').toUpperCase());
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = email.trim() !== '' && code.trim() !== '' && password.length >= 8;
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me }>('auth.accept-invite', { email: email.trim(), code: code.trim(), password, name: name.trim() === '' ? undefined : name.trim() }, { quiet: true });
      navigate('/home');
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
          if (ready && !busy) void submit();
        }}
      >
        <div>
          <h1 className="text-[15px] font-semibold">{t('invite.title')}</h1>
          <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('invite.sub')}</p>
        </div>
        <Field label={t('setup.email')}>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" autoFocus={email === ''} aria-label={t('setup.email')} />
        </Field>
        <Field label={t('invite.code')}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="one-time-code" placeholder="XXXXX-XXXXX" className="hr-mono tracking-[0.06em]" aria-label={t('invite.code')} />
        </Field>
        <Field label={t('invite.name')} optional>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label={t('invite.name')} />
        </Field>
        <Field label={t('invite.password')} hint={t('setup.password_hint')} error={password !== '' && password.length < 8 ? t('setup.password_hint') : null}>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" aria-label={t('invite.password')} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <LinkButton onClick={() => navigate('/')}>{t('invite.have_password')}</LinkButton>
          <Button type="submit" variant="primary" icon={Check} busy={busy} disabled={!ready}>
            {t('invite.submit')}
          </Button>
        </div>
      </form>
    </Welcome>
  );
}
