/**
 * The first open: how you play, where you start, how long a day. One
 * dialog; everything can be changed later in Settings.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../lib/context.tsx';
import type { InputKind } from '../lib/types.ts';
import { input } from '../music/input.ts';
import { InputCards, InputStatus } from './InputSetup.tsx';
import { Mark } from './Sidebar.tsx';
import { Button, Dialog, Segmented } from './ui.tsx';

const START: { value: string; label: string; level: number }[] = [
  { value: '1', label: 'Never played', level: 1 },
  { value: '3', label: 'I play a little', level: 3 },
  { value: '6', label: 'I play well', level: 6 },
];

export function Onboarding(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const [kind, setKind] = useState<InputKind | ''>(s?.input ?? '');
  const [level, setLevel] = useState(String(s?.level ?? 1) === '1' ? '1' : String(s?.level ?? 1));
  const [minutes, setMinutes] = useState(String(s?.daily_minutes ?? 20));
  const [device, setDevice] = useState(s?.midi_device ?? '');

  useEffect(() => {
    if (kind === 'midi' && input.midiStatus === 'idle') void input.connectMidi(device).then(() => input.deviceName() !== '' && setDevice(input.deviceName()));
  }, [kind, device]);

  const done = (): void => {
    app.save({ input: kind === '' ? 'screen' : kind, level: Number(level), daily_minutes: Number(minutes), midi_device: device, onboarded: true });
  };

  return (
    <Dialog
      open
      onClose={done}
      width={560}
      title={
        <span className="flex items-center gap-2">
          <Mark /> Welcome to Piano Coach
        </span>
      }
      footer={
        <Button variant="primary" onClick={done} disabled={kind === ''}>
          Start
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        <section className="flex flex-col gap-2.5">
          <h3 className="pc-label">How you play</h3>
          <InputCards value={kind} onChange={setKind} />
          <InputStatus kind={kind} device={device} onDevice={setDevice} />
        </section>
        <section className="flex flex-col gap-2.5">
          <h3 className="pc-label">Where you start</h3>
          <Segmented value={level} onChange={setLevel} options={START.map((o) => ({ value: o.value, label: o.label }))} label="Where you start" />
        </section>
        <section className="flex flex-col gap-2.5">
          <h3 className="pc-label">Minutes a day</h3>
          <Segmented value={minutes} onChange={setMinutes} options={['10', '20', '30', '45', '60'].map((m) => ({ value: m, label: m }))} label="Minutes a day" />
        </section>
      </div>
    </Dialog>
  );
}
