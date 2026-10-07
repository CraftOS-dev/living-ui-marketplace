import { useEffect, useState } from 'react';
import { AlertTriangle, Headphones, Loader2, Mic, MicOff, MonitorSpeaker } from 'lucide-react';
import { Button, Dialog, Select, cn } from '../../kit/index.ts';
import { CATEGORIES, LANGUAGES, recall, remember } from '../format.ts';
import { useMicPreview, type PreviewDevice } from '../recorder/useMicPreview.ts';
import { RecorderError, type RecOptions, type RecSource } from '../recorder/useRecorder.ts';

const SOURCES: ReadonlyArray<{ value: RecSource; title: string; text: string; icon: React.ReactNode }> = [
  { value: 'mic', title: 'Microphone', text: 'Your voice and the room: meetings, interviews, lectures, memos.', icon: <Mic size={18} /> },
  {
    value: 'mic+tab',
    title: 'Microphone + call audio',
    text: 'Online calls in a browser tab (Zoom, Meet, Teams): you and everyone else.',
    icon: <Headphones size={18} />,
  },
  {
    value: 'tab',
    title: 'Tab or screen audio only',
    text: 'Sound playing on this computer. Your microphone is NOT recorded.',
    icon: <MonitorSpeaker size={18} />,
  },
];

function Meter({ level }: { level: number }): React.JSX.Element {
  const bars = 12;
  const lit = Math.round(level * bars);
  return (
    <span className="flex h-3.5 shrink-0 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-sm transition-colors',
            i < lit ? (i >= 10 ? 'bg-red-500' : i >= 7 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-[var(--agent-app-border)]',
          )}
          style={{ height: `${35 + (i / (bars - 1)) * 65}%` }}
        />
      ))}
    </span>
  );
}

function DeviceRow({ d, selected, onSelect }: { d: PreviewDevice; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const dead = d.noSignal === true;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={d.error !== null}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-[var(--agent-app-radius)] border px-3 py-2 text-left transition-colors disabled:opacity-60',
        selected ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-selected)]' : 'border-[var(--agent-app-border)] hover:bg-[var(--agent-app-hover)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-[var(--agent-app-accent)]' : 'border-[var(--agent-app-muted)]/60',
        )}
      >
        {selected && <span className="size-2 rounded-full bg-[var(--agent-app-accent)]" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{d.label}</span>
        <span className={cn('text-xs', dead || d.error !== null ? 'text-red-600 dark:text-red-400' : 'text-[var(--agent-app-muted)]')}>
          {d.error !== null
            ? d.error
            : dead
              ? 'No signal at all: muted, unplugged or a virtual device'
              : d.noSignal === null
                ? 'Checking...'
                : d.isDefault
                  ? 'Default microphone'
                  : 'Working'}
        </span>
      </span>
      {dead ? <MicOff size={15} className="shrink-0 text-red-500" /> : <Meter level={d.level} />}
    </button>
  );
}

export function RecordDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (opts: RecOptions) => Promise<void>;
}): React.JSX.Element {
  // Always starts on Microphone: a remembered "tab audio only" silently left
  // the user's voice out of the next recording.
  const [source, setSource] = useState<RecSource>('mic');
  const [deviceId, setDeviceId] = useState(recall('device', ''));
  const [language, setLanguage] = useState(recall('language', 'auto'));
  const [category, setCategory] = useState(recall('category', 'Meeting'));
  const [error, setError] = useState<RecorderError | null>(null);
  const [starting, setStarting] = useState(false);
  const usesMic = source !== 'tab';
  const preview = useMicPreview(open && usesMic && !starting);

  // Keep the selection on a real device: the remembered one when it is still
  // here, otherwise the browser's default input.
  useEffect(() => {
    if (preview.devices.length === 0) return;
    if (preview.devices.some((d) => d.deviceId === deviceId)) return;
    const fallback = preview.devices.find((d) => d.isDefault) ?? preview.devices[0];
    if (fallback !== undefined) setDeviceId(fallback.deviceId);
  }, [preview.devices, deviceId]);

  const selected = preview.devices.find((d) => d.deviceId === deviceId);
  const selectedDead = usesMic && selected?.noSignal === true;
  const working = preview.devices.filter((d) => d.noSignal === false);
  const loudest = [...working].sort((a, b) => b.peak - a.peak)[0];

  const start = (): void => {
    setError(null);
    setStarting(true);
    remember('device', deviceId);
    remember('language', language);
    remember('category', category);
    onStart({ source, deviceId: usesMic ? deviceId : '', language, category })
      .then(() => onOpenChange(false))
      .catch((err: unknown) => {
        setError(err instanceof RecorderError ? err : new RecorderError('failed', String(err)));
      })
      .finally(() => setStarting(false));
  };

  const micBlocked = usesMic && preview.phase === 'error';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New recording"
      description="Recorded here, transcribed on this PC, then CraftBot writes the notes."
      className="max-h-[92vh] w-[min(94vw,34rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={starting} disabled={selectedDead || micBlocked || (usesMic && selected === undefined)} onClick={start}>
            <span aria-hidden className="size-2 rounded-full bg-current" />
            Start recording
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="What to record" className="flex flex-col gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={source === s.value}
              onClick={() => setSource(s.value)}
              className={cn(
                'flex items-start gap-3 rounded-[var(--agent-app-radius)] border px-3 py-2.5 text-left transition-colors',
                source === s.value
                  ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-selected)]'
                  : 'border-[var(--agent-app-border)] hover:bg-[var(--agent-app-hover)]',
              )}
            >
              <span className={cn('mt-0.5', source === s.value ? 'text-[var(--agent-app-accent)]' : 'text-[var(--agent-app-muted)]')}>{s.icon}</span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{s.title}</span>
                <span className="text-[13px] text-[var(--agent-app-muted)]">{s.text}</span>
              </span>
            </button>
          ))}
        </div>

        {usesMic && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Microphone</span>
              <span className="text-[13px] text-[var(--agent-app-muted)]">Say something: the bar of the mic that hears you moves.</span>
            </div>
            {preview.phase === 'asking' && (
              <p className="flex items-center gap-2 text-sm text-[var(--agent-app-muted)]">
                <Loader2 size={14} className="animate-spin" />
                Allow microphone access in the browser prompt to see your microphones.
              </p>
            )}
            {micBlocked && preview.error !== null && (
              <p role="alert" className="flex gap-2 rounded-[var(--agent-app-radius)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {preview.error.message}
              </p>
            )}
            {preview.phase === 'ready' && preview.devices.length === 0 && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">No microphone is connected to this computer.</p>
            )}
            <div role="radiogroup" aria-label="Microphone" className="flex flex-col gap-1.5">
              {preview.devices.map((d) => (
                <DeviceRow key={d.deviceId} d={d} selected={d.deviceId === deviceId} onSelect={() => setDeviceId(d.deviceId)} />
              ))}
            </div>
            {selectedDead && (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={15} className="shrink-0" />
                This microphone sends no sound, so a recording would be silent.
                {loudest !== undefined && (
                  <Button size="sm" variant="secondary" className="text-[var(--agent-app-text)]" onClick={() => setDeviceId(loudest.deviceId)}>
                    Use {loudest.label}
                  </Button>
                )}
              </p>
            )}
          </div>
        )}
        {source !== 'mic' && (
          <p className="rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] px-3 py-2 text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
            After you press Start, the browser asks what to share: pick the meeting tab (or the entire screen) and switch on{' '}
            <span className="font-medium text-[var(--agent-app-text)]">Share tab audio</span>.
            {source === 'tab' && <span className="font-medium text-[var(--agent-app-text)]"> Your own voice will not be recorded in this mode.</span>}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select label="Spoken language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </div>

        {error !== null && (
          <div
            role="alert"
            className={cn(
              'flex gap-2 rounded-[var(--agent-app-radius)] border px-3 py-2 text-sm',
              error.kind === 'cancelled'
                ? 'border-[var(--agent-app-border)] text-[var(--agent-app-muted)]'
                : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error.message}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
