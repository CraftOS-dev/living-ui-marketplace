/**
 * Barcode scanners that act as a keyboard (USB or Bluetooth "keyboard
 * wedge" scanners): they type the code very fast and usually press Enter.
 * No browser permission is involved, so they work inside the host's tab.
 *
 * Telling a scan from typing: the characters of a scan arrive a few
 * milliseconds apart; people type a key every 80 ms or more. A burst of at
 * least 4 characters averaging under 40 ms per key, ended by Enter or Tab
 * (or a short pause, for scanners set up without a suffix), is a scan.
 *
 * Keys typed into a text field are left to that field (search boxes treat
 * Enter on an exact code as a scan themselves). Elsewhere, a scan goes to
 * the most recently mounted listener: a full-screen form over a page wins
 * over the page, and a page wins over the app-wide lookup.
 */
import { useEffect, useRef } from 'react';

/** code: what was scanned; startedAt: performance.now() of its first key (keys
 *  of the scan may already have reached a key handler, e.g. a keypad, which
 *  can undo what it typed since then). */
type Handler = (code: string, startedAt: number) => void;

const stack: { id: number; handler: { current: Handler } }[] = [];
let nextId = 1;
let started = false;

const MIN_LENGTH = 4;
const MAX_AVG_MS = 40;
const MAX_GAP_MS = 120;
const IDLE_END_MS = 160;

let buffer = '';
let times: number[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type);
}

function reset(): void {
  buffer = '';
  times = [];
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
}

function looksScanned(): boolean {
  if (buffer.length < MIN_LENGTH || times.length < 2) return false;
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  return (last - first) / (times.length - 1) <= MAX_AVG_MS;
}

function deliver(): boolean {
  const code = buffer.trim();
  const ok = looksScanned() && code !== '';
  const startedAt = times[0] ?? performance.now();
  reset();
  if (!ok) return false;
  const top = stack[stack.length - 1];
  if (top !== undefined) top.handler.current(code, startedAt);
  return true;
}

/** Whether a scan-like burst is being typed right now (key handlers can hold off). */
export function scanning(): boolean {
  return buffer.length >= 2 && looksScanned();
}

function onKey(e: KeyboardEvent): void {
  if (stack.length === 0) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTextTarget(e.target)) {
    reset();
    return;
  }
  const now = performance.now();
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (deliver()) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  if (e.key.length !== 1) return;
  const last = times[times.length - 1];
  if (last !== undefined && now - last > MAX_GAP_MS) reset();
  buffer += e.key;
  times.push(now);
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (buffer.length >= 6) deliver();
    else reset();
  }, IDLE_END_MS);
}

function start(): void {
  if (started) return;
  started = true;
  window.addEventListener('keydown', onKey, true);
}

/** Receive scans while `enabled`. The latest mounted listener gets them. */
export function useScanner(onScan: Handler, enabled = true): void {
  const ref = useRef<Handler>(onScan);
  ref.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    start();
    const id = nextId++;
    stack.push({ id, handler: ref });
    return () => {
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}
