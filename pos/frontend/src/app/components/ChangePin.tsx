/** Change my own PIN: the current one confirms it is me, the new one twice. */
import { useState } from 'react';
import { toast } from '../../kit/index.ts';
import { OpError, api } from '../lib/api.ts';
import { Button, Field, Modal, pillInput } from './ui.tsx';

function PinInput({ label, value, onChange, autoFocus = false }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }): React.JSX.Element {
  return (
    <Field label={label}>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${pillInput} num tracking-[0.3em]`}
      />
    </Field>
  );
}

export function ChangePin({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = current.length >= 4 && next.length >= 4 && next === again;
  const save = async (): Promise<void> => {
    if (next !== again) {
      setError('The new PINs are different');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.changePin(current, next);
      toast.success('Your PIN is changed');
      onClose();
    } catch (err) {
      setError(err instanceof OpError ? err.message : 'Could not change the PIN');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Change my PIN"
      description="4 to 6 digits, different from everyone else's."
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={() => void save()}>
            Change PIN
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <PinInput label="Current PIN" value={current} onChange={setCurrent} autoFocus />
        <PinInput label="New PIN" value={next} onChange={setNext} />
        <PinInput label="New PIN again" value={again} onChange={setAgain} />
        {error !== '' && (
          <p className="px-1 text-[12px] font-semibold text-[var(--ps-red-text)]" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
