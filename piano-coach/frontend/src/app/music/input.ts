/**
 * Every way to play into the app, as one stream of note events stamped on
 * the performance.now() clock:
 *
 *   midi      a digital piano or MIDI keyboard (Web MIDI; Chrome and Edge).
 *             Inside CraftBot the app's frame must be allowed to use MIDI;
 *             when it is not, the app can open in its own browser tab.
 *   keyboard  the computer keyboard: Z S X D C V G B H N J M , L . ; / for
 *             C3 to E4 and Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ for C4 to
 *             F5; - and = shift both rows by an octave
 *   screen    the keys on the screen (mouse or touch)
 *   mic       an acoustic piano through the microphone (one note at a time)
 *
 * Nothing asks the browser for MIDI or the microphone until the person
 * clicks to connect: a request on load could fail the install check.
 */
import { audio } from './audio.ts';
import { Mic } from './mic.ts';
import type { MicStatus } from './mic.ts';

export type Source = 'midi' | 'keyboard' | 'screen' | 'mic';

export interface NoteEvent {
  on: boolean;
  note: number;
  vel: number;
  /** performance.now() time of the key press. */
  t: number;
  src: Source;
}

export type MidiStatus = 'idle' | 'connecting' | 'ready' | 'none' | 'unsupported' | 'blocked' | 'denied';

export interface MidiDevice {
  id: string;
  name: string;
}

const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft'];
const LABEL: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[' };

function codeLabel(code: string): string {
  if (LABEL[code] !== undefined) return LABEL[code] ?? '';
  return code.replace(/^Key|^Digit/, '');
}

function frameAllows(feature: string): boolean {
  const d = document as Document & { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };
  const pol = d.permissionsPolicy ?? d.featurePolicy;
  if (pol === undefined) return true;
  try {
    return pol.allowsFeature(feature);
  } catch {
    return true;
  }
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** True when the app runs inside another page's frame (CraftBot). */
export function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

class InputHub {
  private listeners = new Set<(e: NoteEvent) => void>();
  private stateListeners = new Set<() => void>();
  midiStatus: MidiStatus = 'idle';
  devices: MidiDevice[] = [];
  device = '';
  /** Play a sound for notes from MIDI (a keyboard without its own speakers). */
  midiSound = false;
  sustain = false;
  held = new Set<number>();
  octave = 0;
  keyboardOn = true;
  lastNote: NoteEvent | null = null;
  readonly mic = new Mic();
  private access: MIDIAccess | null = null;
  private bound = new Set<MIDIInput>();
  private keysDown = new Map<string, number>();

  constructor() {
    try {
      this.midiSound = localStorage.getItem('pc.midiSound') === '1';
    } catch {
      /* a convenience */
    }
    this.mic.onNote = (n) => this.emit({ ...n, src: 'mic' });
    this.mic.onStatus = () => this.changed();
  }

  on(fn: (e: NoteEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Status changes (devices, connection, microphone) for the UI. */
  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  }

  private changed(): void {
    for (const fn of this.stateListeners) fn();
  }

  emit(e: NoteEvent): void {
    if (e.on) this.held.add(e.note);
    else this.held.delete(e.note);
    if (e.on) this.lastNote = e;
    const sound = e.src === 'keyboard' || e.src === 'screen' || (e.src === 'midi' && this.midiSound);
    if (sound) {
      if (e.on) audio.noteOn(e.note, e.vel);
      else audio.noteOff(e.note);
    }
    for (const fn of this.listeners) fn(e);
  }

  setMidiSound(v: boolean): void {
    this.midiSound = v;
    try {
      localStorage.setItem('pc.midiSound', v ? '1' : '0');
    } catch {
      /* a convenience */
    }
    this.changed();
  }

  /* ----------------------------------------------------------------- MIDI */

  midiSupported(): boolean {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  /** Ask for MIDI (from a click). */
  async connectMidi(preferred = ''): Promise<MidiStatus> {
    if (!this.midiSupported()) return this.setMidi('unsupported');
    if (!frameAllows('midi')) return this.setMidi('blocked');
    if (this.access !== null) {
      this.refresh(preferred);
      return this.midiStatus;
    }
    this.setMidi('connecting');
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      return this.setMidi(name === 'SecurityError' || (name === 'NotAllowedError' && inFrame()) ? 'blocked' : 'denied');
    }
    this.access.onstatechange = () => this.refresh(this.device);
    this.refresh(preferred);
    return this.midiStatus;
  }

  private setMidi(s: MidiStatus): MidiStatus {
    this.midiStatus = s;
    this.changed();
    return s;
  }

  private refresh(preferred: string): void {
    const acc = this.access;
    if (acc === null) return;
    const list: MidiDevice[] = [];
    acc.inputs.forEach((inp) => {
      if (inp.state !== 'disconnected') list.push({ id: inp.id, name: inp.name ?? 'MIDI input' });
    });
    this.devices = list;
    const pick = list.find((d) => d.name === preferred || d.id === preferred) ?? list.find((d) => d.id === this.device) ?? list[0];
    this.device = pick?.id ?? '';
    // Listen to the chosen input only (other inputs stay quiet).
    acc.inputs.forEach((inp) => {
      if (inp.id === this.device) {
        if (!this.bound.has(inp)) {
          inp.onmidimessage = (m) => this.onMidi(m);
          this.bound.add(inp);
        }
      } else if (this.bound.has(inp)) {
        inp.onmidimessage = null;
        this.bound.delete(inp);
      }
    });
    this.setMidi(list.length === 0 ? 'none' : 'ready');
  }

  selectDevice(id: string): void {
    this.device = id;
    this.refresh(id);
  }

  deviceName(): string {
    return this.devices.find((d) => d.id === this.device)?.name ?? '';
  }

  private onMidi(m: MIDIMessageEvent): void {
    const d = m.data;
    if (d === null || d.length < 2) return;
    const cmd = (d[0] ?? 0) & 0xf0;
    const a = d[1] ?? 0;
    const b = d[2] ?? 0;
    const t = m.timeStamp || performance.now();
    if (cmd === 0x90 && b > 0) this.emit({ on: true, note: a, vel: b, t, src: 'midi' });
    else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) this.emit({ on: false, note: a, vel: 0, t, src: 'midi' });
    else if (cmd === 0xb0 && a === 64) {
      const s = b >= 64;
      if (s !== this.sustain) {
        this.sustain = s;
        this.changed();
      }
    }
  }

  /* ------------------------------------------------------ computer keys */

  /** The note a computer key plays now (or null). */
  noteForCode(code: string): number | null {
    const lo = LOWER.indexOf(code);
    if (lo >= 0) return 48 + lo + this.octave * 12;
    const up = UPPER.indexOf(code);
    if (up >= 0) return 60 + up + this.octave * 12;
    return null;
  }

  /** The computer key that plays a note (for the hints on the screen keys). */
  keyFor(midi: number): string {
    const up = midi - 60 - this.octave * 12;
    if (up >= 0 && up < UPPER.length) return codeLabel(UPPER[up] ?? '');
    const lo = midi - 48 - this.octave * 12;
    if (lo >= 0 && lo < 12) return codeLabel(LOWER[lo] ?? '');
    return '';
  }

  /** Listen to the computer keyboard. Returns the detach function. */
  attachKeyboard(): () => void {
    const down = (e: KeyboardEvent): void => {
      if (!this.keyboardOn || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      if (e.code === 'Minus' || e.code === 'Equal') {
        if (e.repeat) return;
        this.octave = Math.max(-3, Math.min(3, this.octave + (e.code === 'Minus' ? -1 : 1)));
        this.changed();
        e.preventDefault();
        return;
      }
      const n = this.noteForCode(e.code);
      if (n === null) return;
      e.preventDefault();
      if (e.repeat || this.keysDown.has(e.code)) return;
      this.keysDown.set(e.code, n);
      this.emit({ on: true, note: n, vel: 92, t: e.timeStamp || performance.now(), src: 'keyboard' });
    };
    const up = (e: KeyboardEvent): void => {
      const n = this.keysDown.get(e.code);
      if (n === undefined) return;
      this.keysDown.delete(e.code);
      this.emit({ on: false, note: n, vel: 0, t: e.timeStamp || performance.now(), src: 'keyboard' });
    };
    const blur = (): void => {
      for (const [code, n] of this.keysDown) {
        this.keysDown.delete(code);
        this.emit({ on: false, note: n, vel: 0, t: performance.now(), src: 'keyboard' });
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }

  /* ---------------------------------------------------------- screen keys */

  screen(note: number, on: boolean, vel = 90): void {
    this.emit({ on, note, vel: on ? vel : 0, t: performance.now(), src: 'screen' });
  }

  /* ----------------------------------------------------------- microphone */

  async startMic(): Promise<MicStatus> {
    return this.mic.start();
  }

  stopMic(): void {
    this.mic.stop();
  }
}

export const input = new InputHub();

/** Open the app in its own browser tab (where MIDI is allowed). */
export function openInTab(): void {
  window.open(window.location.href, '_blank', 'noopener');
}
