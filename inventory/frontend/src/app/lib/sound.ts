/**
 * Short beeps for scans (a high one when a code is recognised, a low double
 * one when it is not), made with the Web Audio API: no files and no
 * permission. The person can turn them off; the choice is remembered in this
 * browser only.
 */

let ctx: AudioContext | null = null;
const KEY = 'inventory.scan.sound';

export function soundOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSound(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* a per-browser convenience only */
  }
}

function tone(freq: number, start: number, length: number): void {
  if (ctx === null) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}

export function beep(kind: 'ok' | 'miss'): void {
  if (!soundOn()) return;
  try {
    if (ctx === null) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (kind === 'ok') tone(1320, 0, 0.09);
    else {
      tone(300, 0, 0.12);
      tone(300, 0.16, 0.12);
    }
  } catch {
    /* audio unavailable: the screen still shows the result */
  }
}
