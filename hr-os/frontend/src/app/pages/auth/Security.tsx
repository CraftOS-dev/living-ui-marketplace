/**
 * Your sign-in and approval PIN: change the password, set or change the
 * six-digit PIN, and for an owner the recovery code (reset a forgotten PIN,
 * or make a new code, shown once). Used by Settings, Security.
 */
import { useState } from 'react';
import { Check, Copy, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { Button, Dialog, Field, Input, Notice, Panel, PinBoxes, Row, Tag } from '../../components/ui.tsx';
import { copyText, errMessage, op } from '../../lib/api.ts';
import { refreshMe, replaceToken, signOut, useMe } from '../../lib/auth.tsx';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';

interface PinStatus {
  has_pin: boolean;
  set_at: string;
  locked: boolean;
  locked_until: string;
  owner_recovery: boolean;
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = current !== '' && next.length >= 8;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string }>('auth.change-password', { current, password: next }, { quiet: true });
      replaceToken(r.token);
      toast.success(t('security.password_changed'));
      setCurrent('');
      setNext('');
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('security.change_password')}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('security.current_password')}>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus aria-label={t('security.current_password')} />
        </Field>
        <Field label={t('signin.new_password')} hint={t('setup.password_hint')}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label={t('signin.new_password')} />
        </Field>
        <p className="text-[12px] text-[var(--hr-muted)]">{t('security.password_other_devices')}</p>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

type PinMode = 'set' | 'change' | 'recover';

function PinDialogForm({ mode, onClose }: { mode: PinMode | null; onClose: () => void }): React.JSX.Element | null {
  const [secret, setSecret] = useState('');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  if (mode === null) return null;
  const weak = pin.length === 6 && pin.split('').every((d) => d === pin.charAt(0));
  const ok = pin.length === 6 && !weak && pin === pin2 && (mode === 'set' ? secret !== '' : mode === 'change' ? current.length === 6 : secret.trim() !== '');
  const close = (): void => {
    setSecret('');
    setCurrent('');
    setPin('');
    setPin2('');
    setError(null);
    setNewCode(null);
    onClose();
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'set') await op('pin.set', { password: secret, new_pin: pin }, { quiet: true });
      else if (mode === 'change') await op('pin.change', { current_pin: current, new_pin: pin }, { quiet: true });
      else {
        const r = await op<{ recovery_code: string }>('pin.recover', { recovery_code: secret.trim(), new_pin: pin }, { quiet: true });
        setNewCode(r.recovery_code);
      }
      await refreshMe();
      toast.success(t('security.pin_saved'));
      if (mode !== 'recover') close();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (newCode !== null)
    return (
      <Dialog open onClose={close} title={t('signin.new_code_title')} width={440} footer={<Button variant="primary" onClick={close}>{t('ui.done')}</Button>}>
        <p className="mb-3 text-[13px] text-[var(--hr-ink-2)]">{t('setup.code_sub')}</p>
        <div className="flex items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
          <code className="hr-mono hr-wrap min-w-0 flex-1 select-all text-[14px] tracking-[0.06em]">{newCode}</code>
          <Button icon={Copy} onClick={() => void copyText(newCode).then((x) => x && toast.success(t('ui.copied')))}>
            {t('ui.copy')}
          </Button>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      open
      onClose={close}
      title={mode === 'set' ? t('security.set_pin') : mode === 'change' ? t('security.change_pin') : t('security.recover_pin')}
      width={420}
      footer={
        <>
          <Button onClick={close}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === 'set' && (
          <Field label={t('setup.password')}>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" autoFocus aria-label={t('setup.password')} />
          </Field>
        )}
        {mode === 'recover' && (
          <Field label={t('signin.recovery_code')}>
            <Input value={secret} onChange={(e) => setSecret(e.target.value.toUpperCase())} className="hr-mono tracking-[0.06em]" autoFocus aria-label={t('signin.recovery_code')} />
          </Field>
        )}
        {mode === 'change' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--hr-ink-2)]">{t('security.current_pin')}</span>
            <PinBoxes value={current} onChange={setCurrent} label={t('security.current_pin')} autoFocus />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--hr-ink-2)]">{t('security.new_pin')}</span>
          <PinBoxes value={pin} onChange={setPin} label={t('security.new_pin')} invalid={weak} />
          {weak && <span className="text-[12px] text-[var(--hr-bad)]">{t('setup.pin_weak')}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--hr-ink-2)]">{t('setup.pin_again')}</span>
          <PinBoxes value={pin2} onChange={setPin2} label={t('setup.pin_again')} invalid={pin2.length === 6 && pin2 !== pin} />
        </div>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function SecurityPanels(): React.JSX.Element {
  const me = useMe();
  const status = useOp<PinStatus>('pin.status', {}, ['members'], { name: 'security.pin' });
  const [pw, setPw] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const s = status.data;
  const newRecovery = async (): Promise<void> => {
    try {
      const r = await op<{ recovery_code: string }>('pin.recovery-new', {}, { pin: { title: t('security.new_code') } });
      setCode(r.recovery_code);
    } catch {
      /* the toast says why */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('security.signin')} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        <Row label={t('setup.email')}>
          <span className="hr-mono text-[13px] text-[var(--hr-ink-2)]">{me.member.email}</span>
        </Row>
        <Row label={t('setup.password')}>
          <Button size="sm" onClick={() => setPw(true)}>
            {t('security.change_password')}
          </Button>
        </Row>
        <Row label={t('security.sign_out')} hint={t('security.sign_out_hint')}>
          <Button size="sm" icon={LogOut} onClick={() => void signOut()}>
            {t('security.sign_out')}
          </Button>
        </Row>
      </Panel>
      <Panel index="02" label={t('security.pin_title')} aside={s?.has_pin === true ? <Tag tone="good">{t('security.pin_on')}</Tag> : s !== null ? <Tag tone="warn">{t('security.pin_off')}</Tag> : undefined} bodyClass="flex flex-col divide-y divide-[var(--hr-hair)]">
        <Row label={t('security.pin_title')} hint={s === null ? '' : s.has_pin ? t('security.pin_set_ago', { when: ago(s.set_at) }) : t('security.pin_why')}>
          {s?.has_pin === true ? (
            <Button size="sm" icon={KeyRound} onClick={() => setPinMode('change')}>
              {t('security.change_pin')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={KeyRound} onClick={() => setPinMode('set')}>
              {t('security.set_pin')}
            </Button>
          )}
        </Row>
        {s?.locked === true && <Notice tone="warn">{t('security.pin_locked', { when: ago(s.locked_until) })}</Notice>}
        {me.owner && (
          <>
            <Row label={t('security.forgot_pin')} hint={t('security.forgot_pin_hint')}>
              <Button size="sm" onClick={() => setPinMode('recover')}>
                {t('security.use_code')}
              </Button>
            </Row>
            <Row label={t('security.recovery')} hint={t('security.recovery_hint')}>
              <Button size="sm" icon={ShieldCheck} onClick={() => void newRecovery()}>
                {t('security.new_code')}
              </Button>
            </Row>
          </>
        )}
      </Panel>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
      <PinDialogForm mode={pinMode} onClose={() => setPinMode(null)} />
      {code !== null && (
        <Dialog open onClose={() => setCode(null)} title={t('signin.new_code_title')} width={440} footer={<Button variant="primary" icon={Check} onClick={() => setCode(null)}>{t('ui.done')}</Button>}>
          <p className="mb-3 text-[13px] text-[var(--hr-ink-2)]">{t('setup.code_sub')}</p>
          <div className="flex items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
            <code className="hr-mono hr-wrap min-w-0 flex-1 select-all text-[14px] tracking-[0.06em]">{code}</code>
            <Button icon={Copy} onClick={() => void copyText(code).then((x) => x && toast.success(t('ui.copied')))}>
              {t('ui.copy')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
