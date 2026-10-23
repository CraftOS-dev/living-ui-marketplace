/**
 * Changing your own PIN: the current one, then the new one twice, each on
 * the PIN pad. PINs are 4 to 8 digits and unique in the store.
 */
import { useState } from 'react';
import { toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { PinPad } from './pads.tsx';
import { Modal } from './ui.tsx';

type Step = 'current' | 'new' | 'again';

const PROMPTS: Record<Step, string> = {
  current: 'Enter your current PIN',
  new: 'Choose a new PIN (4 to 8 digits)',
  again: 'Enter the new PIN again',
};

export function ChangePin({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { staff } = useSession();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const close = (): void => {
    setStep('current');
    setCurrent('');
    setNext('');
    setMsg(null);
    onClose();
  };

  const submit = async (pin: string): Promise<string | null> => {
    setMsg(null);
    if (step === 'current') {
      setCurrent(pin);
      setStep('new');
      return null;
    }
    if (step === 'new') {
      if (pin === current) return 'That is your current PIN; choose another';
      setNext(pin);
      setStep('again');
      return null;
    }
    if (pin !== next) {
      setNext('');
      setStep('new');
      setMsg('The two PINs did not match; choose the new PIN again');
      return null;
    }
    if (staff === null) return 'Sign in first';
    try {
      await api.saveStaff({ id: staff.id, pin: next, current_pin: current }, { quiet: true });
      toast.success('Your PIN was changed');
      close();
    } catch (err) {
      setCurrent('');
      setNext('');
      setStep('current');
      setMsg(errMessage(err));
    }
    return null;
  };

  return (
    <Modal touch open={open} onClose={close} title="Change my PIN" description={PROMPTS[step]}>
      <div className="flex justify-center pb-1">
        <PinPad key={step} onSubmit={submit} error={msg} submitLabel={step === 'again' ? 'Save' : 'Next'} />
      </div>
    </Modal>
  );
}
