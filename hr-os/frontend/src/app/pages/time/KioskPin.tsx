/**
 * The personal kiosk PIN: a person sets their own (shown on the clock page;
 * the Me page may embed KioskPinRow), and HR sets one for anyone, including
 * people without a sign-in, from the kiosk settings.
 */
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Dialog, Field, RowCue, toast } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { act, useOp } from '../../lib/live.ts';
import { READS } from './util.ts';

export function KioskPinDialog({ open, onClose, employee, name }: { open: boolean; onClose: () => void; employee?: string | undefined; name?: string | undefined }): React.JSX.Element | null {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = /^\d{4,6}$/.test(pin) && pin === again;
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = await act([], () => op('kiosk.pin-set', { employee, pin }), READS.clock);
    setBusy(false);
    if (r !== null) {
      toast.success(name !== undefined ? t('time.pin.set_for', { name }) : t('time.pin.set_mine'));
      setPin('');
      setAgain('');
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={name !== undefined ? t('time.pin.title_for', { name }) : t('time.pin.title')}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} busy={busy} onClick={() => void save()}>
            {t('time.pin.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('time.pin.new')} hint={t('time.pin.hint')}>
          <PinInput value={pin} onChange={setPin} label={t('time.pin.new')} />
        </Field>
        <Field label={t('time.pin.again')} error={again.length >= 4 && again !== pin ? t('time.pin.mismatch') : null}>
          <PinInput value={again} onChange={setAgain} label={t('time.pin.again')} />
        </Field>
      </div>
    </Dialog>
  );
}

function PinInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }): React.JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="off"
      type="password"
      aria-label={label}
      className="hr-mono h-10 w-40 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-3 text-[15px] tracking-[0.4em] outline-none focus:border-[var(--hr-ink-2)]"
    />
  );
}

/** "Kiosk PIN: set / not set" with the dialog, for the person themself. */
export function KioskPinRow(): React.JSX.Element | null {
  const me = useMe();
  const live = useOp<{ set: boolean; locked: boolean }>('kiosk.pin-status', {}, READS.clock, { skip: me.employee === null, name: 'time.pin.mine' });
  const [open, setOpen] = useState(false);
  if (me.employee === null) return null;
  const set = live.data?.set === true;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group hr-focus flex h-10 w-full items-center gap-2.5 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] transition-colors hover:bg-[var(--hr-hover)]">
        <KeyRound size={15} aria-hidden className="text-[var(--hr-muted)]" />
        <span className="flex-1">{set ? t('time.pin.change') : t('time.pin.set')}</span>
        <span className="hr-label">{live.data === null ? '' : set ? (live.data.locked ? t('time.pin.locked') : t('time.pin.is_set')) : t('time.pin.not_set')}</span>
        <RowCue />
      </button>
      <KioskPinDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

