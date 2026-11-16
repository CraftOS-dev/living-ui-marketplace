/**
 * Deal actions shared by the board, the table, the deal page, the peek and
 * the phone rows: move (instant, with Undo), a place on the board (a drag:
 * deals.reorder), status changes, and a narrow screen hook. Every write is
 * an operation; the screen changes at once.
 */
import { useEffect, useState } from 'react';
import { confirmAsk } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { act, patch, reshape } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import type { BoardAnswer, DealCard } from './types.ts';

export const MOVE_READS = ['deals', 'stage_events', 'notes'];

/** Below 768px (phones): the board becomes rows with a Move to menu. */
export function useNarrow(): boolean {
  const q = '(max-width: 767.98px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = (): void => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** The board answer with one card moved to another column (the instant view of a drag). */
function moveOnBoard(id: string, to: string, label: string, index: number): (data: unknown) => unknown {
  return (data: unknown) => {
    const b = data as BoardAnswer | null;
    if (b === null || !Array.isArray(b.stages)) return data;
    let card: DealCard | null = null;
    const stages = b.stages.map((s) => {
      const hit = s.deals.find((d) => d.id === id);
      if (hit === undefined) return s;
      card = hit;
      return { ...s, count: Math.max(0, s.count - 1), deals: s.deals.filter((d) => d.id !== id) };
    });
    if (card === null) return data;
    const moved: DealCard = { ...(card as DealCard), stage: to, stage_label: label, stage_index: index, days_in_stage: 0, stalled: false };
    return { ...b, stages: stages.map((s) => (s.key === to ? { ...s, count: s.count + 1, deals: [moved, ...s.deals] } : s)) };
  };
}

/** The board answer with one card at `at` in column `to` (the instant view of a drop). */
function placeOnBoard(id: string, to: string, label: string, index: number, at: number): (data: unknown) => unknown {
  return (data: unknown) => {
    const b = data as BoardAnswer | null;
    if (b === null || !Array.isArray(b.stages)) return data;
    let card: DealCard | null = null;
    let from = '';
    const stages = b.stages.map((s) => {
      const hit = s.deals.find((d) => d.id === id);
      if (hit === undefined) return s;
      card = hit;
      from = s.key;
      return { ...s, count: Math.max(0, s.count - 1), deals: s.deals.filter((d) => d.id !== id) };
    });
    if (card === null) return data;
    const c = card as DealCard;
    const placed: DealCard = from === to ? c : { ...c, stage: to, stage_label: label, stage_index: index, days_in_stage: 0, stalled: false };
    return {
      ...b,
      stages: stages.map((s) => {
        if (s.key !== to) return s;
        const list = [...s.deals];
        list.splice(Math.max(0, Math.min(at, list.length)), 0, placed);
        return { ...s, count: s.count + 1, deals: list };
      }),
    };
  };
}

/**
 * Put a deal at a place on the board (a drag): `at` is its index in the
 * column `to` after the move, `before` the deal it lands in front of ('' =
 * the end). A drop in another column moves the deal there too, with Undo.
 * The board shows it at once; deals.reorder keeps the order for everyone.
 */
export async function placeDeal(d: DealCard, to: { key: string; label: string; index: number }, at: number, before: string): Promise<boolean> {
  const cross = to.key !== d.stage;
  const edits = [reshape('deals.board', placeOnBoard(d.id, to.key, to.label, to.index, at))];
  if (cross) edits.push(patch(d.id, { stage: to.key, stage_label: to.label, stage_index: to.index, days_in_stage: 0, stalled: false }));
  const out = await act(edits, () => op<{ _activity?: string }>('deals.reorder', { deal: d.id, stage: to.key, before: before !== '' ? before : undefined }), MOVE_READS);
  if (out === null) return false;
  const entry = out._activity;
  if (cross && entry !== undefined && entry !== '') toast.undo(`Moved to ${to.label}`, () => void act([], () => op('activity.undo', { entry }), MOVE_READS));
  return true;
}

/**
 * Move a deal to a stage: the board and every view show it at once, the
 * operation runs behind, and the toast offers Undo. `ask` adds the one-line
 * confirm (the stage track on the deal page).
 */
export async function moveDeal(d: { id: string; stage: string; stage_label?: string | undefined }, to: { key: string; label: string; index: number }, ask = false): Promise<boolean> {
  if (to.key === d.stage) return false;
  if (ask && !(await confirmAsk(`Move to ${to.label}?`, 'Move', 'primary'))) return false;
  const from = d.stage;
  const out = await act([reshape('deals.board', moveOnBoard(d.id, to.key, to.label, to.index)), patch(d.id, { stage: to.key, stage_label: to.label, stage_index: to.index, days_in_stage: 0, stalled: false })], () => op('deals.move', { deal: d.id, stage: to.key }), MOVE_READS);
  if (out === null) return false;
  toast.undo(`Moved to ${to.label}`, () => {
    void act([], () => op('deals.move', { deal: d.id, stage: from }), MOVE_READS);
  });
  return true;
}

/** Pass, lose, hold or reopen a deal (with a reason), with Undo back to open. */
export async function setStatus(id: string, status: 'open' | 'passed' | 'lost' | 'hold', reason: string, word: string): Promise<boolean> {
  // A pass keeps its reason chip and asks your AI agent for the pass email (one pass flow for every deal).
  const out = await act([patch(id, { status })], () => (status === 'passed' ? op('passes.create', { deal: id, reason }) : op('deals.status', { deal: id, status, reason })), MOVE_READS);
  if (out === null) return false;
  if (status !== 'open')
    toast.undo(word, () => {
      void act([patch(id, { status: 'open' })], () => op('deals.status', { deal: id, status: 'open' }), MOVE_READS);
    });
  return true;
}
