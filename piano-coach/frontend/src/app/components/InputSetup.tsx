/**
 * Choosing how to play: a digital piano over MIDI, the computer keys, the
 * keys on the screen, or an acoustic piano through the microphone; and what
 * each one needs to work (a connected device, a permission, the key map).
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ExternalLink, Keyboard, Mic, MousePointerClick, RotateCcw, Usb } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { noteName } from '../lib/format.ts';
import type { InputKind } from '../lib/types.ts';
import { input, inFrame, openInTab } from '../music/input.ts';
import { Button, Kbd, Select } from './ui.tsx';

/** Re-render when the inputs change (devices, connection, microphone). */
export function useInputState(): number {
  const [n, setN] = useState(0);
  useEffect(() => input.onState(() => setN((x) => x + 1)), []);
  return n;
}

export const INPUTS: { value: InputKind; label: string; icon: LucideIcon }[] = [
  { value: 'midi', label: 'Digital piano', icon: Usb },
  { value: 'keyboard', label: 'Computer keys', icon: Keyboard },
  { value: 'screen', label: 'Screen keys', icon: MousePointerClick },
  { value: 'mic', label: 'Microphone', icon: Mic },
];

export function InputCards({ value, onChange }: { value: InputKind | ''; onChange: (v: InputKind) => void }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="How you play" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {INPUTS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn('pc-focus flex flex-col items-start gap-3 rounded-[var(--pc-radius)] border px-3 py-3 text-left transition-[border-color,background-color,box-shadow]', on ? 'border-[var(--pc-ink)] bg-[var(--pc-raised)] shadow-[var(--pc-shadow)]' : 'border-[var(--pc-line)] bg-[var(--pc-panel)] hover:border-[var(--pc-line-2)] hover:bg-[var(--pc-raised)]')}
          >
            <o.icon size={18} strokeWidth={1.7} aria-hidden className={on ? 'text-[var(--pc-ink)]' : 'text-[var(--pc-muted)]'} />
            <span className="text-[12.5px] font-medium leading-tight">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const MIDI_TEXT: Record<string, string> = {
  idle: '',
  connecting: 'Connecting…',
  ready: 'Connected',
  none: 'No MIDI device found. Plug in the piano (USB or Bluetooth) and press Connect again.',
  unsupported: 'This browser has no MIDI. Use Chrome or Edge.',
  blocked: 'CraftBot’s window does not let apps use MIDI. Open Piano Coach in its own browser tab to use your piano.',
  denied: 'MIDI permission was refused. Allow it in the browser’s site settings, then press Connect.',
};

const MIC_TEXT: Record<string, string> = {
  off: '',
  starting: 'Starting…',
  on: 'Listening',
  denied: 'Microphone permission was refused. Allow it in the browser’s site settings.',
  blocked: 'This window does not let apps use the microphone. Open Piano Coach in its own browser tab.',
  missing: 'No microphone found.',
  unsupported: 'This browser cannot use the microphone.',
};

/** What the chosen input needs, with its live status. */
export function InputStatus({ kind, device, onDevice }: { kind: InputKind | ''; device: string; onDevice: (name: string) => void }): React.JSX.Element | null {
  useInputState();
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (kind !== 'mic') return;
    const t = window.setInterval(() => setLevel(input.mic.level), 80);
    return () => window.clearInterval(t);
  }, [kind]);

  if (kind === 'midi') {
    const s = input.midiStatus;
    const blocked = s === 'blocked' || (s === 'denied' && inFrame());
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {s === 'ready' ? (
            <Select
              value={input.device}
              onChange={(e) => {
                input.selectDevice(e.target.value);
                onDevice(input.deviceName());
              }}
              className="max-w-[260px]"
            >
              {input.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          ) : (
            <Button variant="primary" icon={Usb} busy={s === 'connecting'} onClick={() => void input.connectMidi(device).then(() => input.deviceName() !== '' && onDevice(input.deviceName()))}>
              Connect
            </Button>
          )}
          {s === 'ready' && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--pc-good)]">
              <span className="size-1.5 rounded-full bg-current" /> {MIDI_TEXT.ready}
            </span>
          )}
          {blocked && (
            <Button icon={ExternalLink} onClick={openInTab}>
              Open in its own tab
            </Button>
          )}
        </div>
        {s !== 'ready' && s !== 'idle' && MIDI_TEXT[s] !== '' && <p className="text-[12px] leading-5 text-[var(--pc-muted)]">{MIDI_TEXT[s]}</p>}
        {s === 'ready' && (
          <label className="flex items-center gap-2 text-[12px] text-[var(--pc-ink-2)]">
            <input type="checkbox" checked={input.midiSound} onChange={(e) => input.setMidiSound(e.target.checked)} className="accent-[var(--pc-ink)]" />
            Play the app’s piano sound for my keys
          </label>
        )}
      </div>
    );
  }
  if (kind === 'mic') {
    const s = input.mic.status;
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          {s === 'on' ? (
            <Button onClick={() => input.stopMic()}>Stop listening</Button>
          ) : (
            <Button variant="primary" icon={Mic} busy={s === 'starting'} onClick={() => void input.startMic()}>
              Listen
            </Button>
          )}
          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--pc-line)]">
            <span className="block h-full rounded-full bg-[var(--pc-ink)] transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </span>
          {s === 'on' && input.lastNote !== null && input.lastNote.src === 'mic' && <span className="pc-mono text-[12px] text-[var(--pc-ink-2)]">{noteName(input.lastNote.note)}</span>}
        </div>
        {MIC_TEXT[s] !== '' && s !== 'on' && <p className="text-[12px] leading-5 text-[var(--pc-muted)]">{MIC_TEXT[s]}</p>}
        <p className="text-[12px] leading-5 text-[var(--pc-muted)]">The microphone hears one note at a time; any note of a chord counts.</p>
        {s === 'blocked' && (
          <div>
            <Button icon={ExternalLink} onClick={openInTab}>
              Open in its own tab
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (kind === 'keyboard') {
    return (
      <div className="flex flex-col gap-2 text-[12px] text-[var(--pc-ink-2)]">
        <div className="flex flex-wrap items-center gap-1">
          {['Z', 'S', 'X', 'D', 'C', 'V', '…', '/'].map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
          <span className="pc-mono ml-1 text-[var(--pc-muted)]">C3–E4</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {['Q', '2', 'W', '3', 'E', 'R', '…', '['].map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
          <span className="pc-mono ml-1 text-[var(--pc-muted)]">C4–F5</span>
        </div>
        <div className="flex items-center gap-1">
          <Kbd>−</Kbd>
          <Kbd>=</Kbd>
          <span className="ml-1 inline-flex items-center gap-1 text-[var(--pc-muted)]">
            <RotateCcw size={11} aria-hidden /> octave {input.octave > 0 ? `+${input.octave}` : input.octave}
          </span>
        </div>
      </div>
    );
  }
  return null;
}
