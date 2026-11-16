/**
 * Settings, Security: your approval PIN (set, change, recover with the
 * owner's recovery code), a new recovery code (owners), your password, and
 * signing out here or everywhere.
 */
import { useState } from 'react';
import { Button, Dialog, Field, Input, LoadError, Panel, PinBoxes, Row, Skeleton, StatusDot, SubHeader } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { refreshMe, replaceToken, signOut, useMe } from '../../lib/auth.ts';
import { fmtDay } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { OnceCode } from '../auth/index.tsx';

interface PinStatus {
  has_pin: boolean;
  set_at: string;
  locked: boolean;
  owner_recovery: boolean;
}

function PinDialogs({ mode, onClose }: { mode: 'set' | 'change' | 'recover'; onClose: () => void }): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const weak = pin.length === 6 && pin.split('').every((d) => d === pin.charAt(0));
  const ready = pin.length === 6 && !weak && (mode === 'set' ? password !== '' : mode === 'change' ? current.length === 6 : code.trim() !== '');
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'set') await op('pin.set', { password, new_pin: pin }, { quiet: true });
      else if (mode === 'change') await op('pin.change', { current_pin: current, new_pin: pin }, { quiet: true });
      else {
        const r = await op<{ recovery_code: string }>('pin.recover', { recovery_code: code.trim(), new_pin: pin }, { quiet: true });
        setNewCode(r.recovery_code);
      }
      void refreshMe();
      if (mode !== 'recover') onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'set' ? 'Set PIN' : mode === 'change' ? 'Change PIN' : 'Recover PIN';
  if (newCode !== null)
    return (
      <Dialog open onClose={onClose} title="New recovery code" width={440} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <OnceCode code={newCode} />
      </Dialog>
    );
  return (
    <Dialog open onClose={onClose} title={title} width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        {mode === 'set' && (
          <Field label="Password">
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          </Field>
        )}
        {mode === 'change' && (
          <Field label="Current PIN">
            <PinBoxes value={current} onChange={setCurrent} autoFocus label="Current PIN" align="start" />
          </Field>
        )}
        {mode === 'recover' && (
          <Field label="Recovery code">
            <Input className="vo-mono uppercase" autoFocus value={code} onChange={(e) => setCode(e.target.value)} aria-label="Recovery code" />
          </Field>
        )}
        <Field label="New PIN" error={weak ? 'Use different digits.' : error}>
          <PinBoxes value={pin} onChange={setPin} label="New PIN" align="start" invalid={weak} />
        </Field>
      </div>
    </Dialog>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string }>('auth.change-password', { current, password: next }, { quiet: true });
      replaceToken(r.token);
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Change password" width={420} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={current === '' || next.length < 8} onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Current">
          <Input type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current password" />
        </Field>
        <Field label="New" tip="At least 8 characters." error={error}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" />
        </Field>
      </div>
    </Dialog>
  );
}

export function SecuritySettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<PinStatus>('pin.status', {}, ['members'], { name: 'settings.pin' });
  const [dialog, setDialog] = useState<'set' | 'change' | 'recover' | 'password' | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const newRecovery = async (): Promise<void> => {
    const r = await act([], () => op<{ recovery_code: string }>('pin.recovery-new', {}, { pin: { title: 'New recovery code' } }), ['members']);
    if (r !== null) setCode(r.recovery_code);
  };
  const everywhere = async (): Promise<void> => {
    const r = await act([], () => op('members.signout', { member: me.member.id }), ['members']);
    if (r !== null) void signOut();
  };
  const s = live.data;
  return (
    <>
      <SubHeader title="Security" />
      <Panel>
        {s === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : (
          <div className="flex flex-col divide-y divide-[var(--vo-hair)]">
            <Row label="Approval PIN" tip="Six digits, asked for votes, marks, notices, exports and member changes.">
              <StatusDot tone={s.has_pin ? 'good' : 'warn'} label={s.has_pin ? (s.set_at !== '' ? `Set ${fmtDay(s.set_at)}` : 'Set') : 'Not set'} />
              <Button size="sm" onClick={() => setDialog(s.has_pin ? 'change' : 'set')}>
                {s.has_pin ? 'Change' : 'Set PIN'}
              </Button>
              {me.owner && s.has_pin && (
                <Button size="sm" variant="ghost" onClick={() => setDialog('recover')}>
                  Forgot
                </Button>
              )}
            </Row>
            {me.owner && (
              <Row label="Recovery code" tip="Signs an owner in and resets the PIN. Shown once.">
                <Button size="sm" onClick={() => void newRecovery()}>
                  New code
                </Button>
              </Row>
            )}
            <Row label="Password">
              <Button size="sm" onClick={() => setDialog('password')}>
                Change
              </Button>
            </Row>
            <Row label="Sessions">
              <Button size="sm" variant="ghost" onClick={() => void everywhere()}>
                Sign out everywhere
              </Button>
              <Button size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </Row>
          </div>
        )}
      </Panel>
      {(dialog === 'set' || dialog === 'change' || dialog === 'recover') && <PinDialogs mode={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
      {code !== null && (
        <Dialog open onClose={() => setCode(null)} title="New recovery code" width={440} footer={<Button variant="primary" onClick={() => setCode(null)}>Done</Button>}>
          <OnceCode code={code} />
        </Dialog>
      )}
    </>
  );
}
