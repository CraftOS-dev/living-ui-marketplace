/**
 * v2 helpers for the apps-first screens: outcome states per app, intent words,
 * and the catalogue (loaded once). Mirrors the server's words (lib/v2/intent.js).
 */
import { runOp } from './ops.ts';
import type { CatalogueApp, CheckState, EvaluationRecord, Outcome, Reach } from './types.ts';
import type { Tone } from '../components/visual.tsx';

export const OUTCOMES: Array<{ key: Outcome; label: string; hint: string }> = [
  { key: 'reach', label: 'Who can reach it', hint: 'Compared with who you chose' },
  { key: 'security', label: 'Safety settings', hint: 'Sign-in, setup and settings that let people in' },
  { key: 'updates', label: 'Updates', hint: 'Security fixes from its makers' },
  { key: 'backups', label: 'Backups', hint: 'Whether its data is copied somewhere safe' },
  { key: 'uptime', label: 'Up and running', hint: 'Whether it answers' },
];

/** v4: one server — its network is "local" (or the VPC, on a cloud machine). */
export type Place = 'local' | 'vpc';

export function reachChoices(place: Place = 'local'): Array<{ key: Reach; label: string; hint: string }> {
  if (place === 'vpc') {
    return [
      { key: 'this_machine', label: 'Only this server', hint: 'Nothing else in the VPC can open it' },
      { key: 'local_network', label: 'Only your other cloud servers', hint: 'Servers and services in the same private cloud network (VPC)' },
      { key: 'local_plus_private_remote', label: 'The VPC, and your team remotely (VPN)', hint: 'Plus people connected through your VPN or Tailscale' },
      { key: 'internet', label: 'Anyone on the internet', hint: 'A public website or service' },
    ];
  }
  return [
    { key: 'this_machine', label: 'Only this server', hint: 'Nothing else on the network can open it' },
    { key: 'local_network', label: 'Only my local network', hint: 'Everyone on the network this server is on' },
    { key: 'local_plus_private_remote', label: 'My network, and me when I’m away', hint: 'Plus your own devices, privately (e.g. Tailscale or a VPN)' },
    { key: 'internet', label: 'Anyone on the internet', hint: 'A public website or service' },
  ];
}

export const REACH_CHOICES = reachChoices('local');

export function reachLabel(r: string, place: Place = 'local'): string {
  return reachChoices(place).find((c) => c.key === r)?.label ?? (r === 'specific_networks' ? 'Chosen networks only' : r);
}

const STATE_RANK: Record<CheckState, number> = { fail: 4, unknown: 3, accepted: 2, pass: 1, not_applicable: 0 };

/** The state of one outcome of one app = its worst check (can't-tell never shows as fine). */
export function outcomeState(evals: EvaluationRecord[], outcome: Outcome): { state: CheckState | 'none'; worst: EvaluationRecord | null } {
  const mine = evals.filter((e) => e.outcome === outcome && e.state !== 'not_applicable');
  if (!mine.length) return { state: 'none', worst: null };
  const worst = mine.reduce((w, e) => (STATE_RANK[e.state] > STATE_RANK[w.state] ? e : w));
  return { state: worst.state, worst };
}

export function stateTone(s: CheckState | 'none'): Tone {
  return s === 'fail' ? 'bad' : s === 'pass' ? 'good' : s === 'unknown' ? 'warn' : 'neutral';
}

export function stateWord(s: CheckState | 'none'): string {
  return { fail: 'Needs you', pass: 'Fine', unknown: 'Can’t tell yet', accepted: 'Accepted', not_applicable: 'Doesn’t apply', none: 'Not checked' }[s];
}

let catalogue: Promise<CatalogueApp[]> | null = null;
export function loadCatalogue(): Promise<CatalogueApp[]> {
  if (!catalogue) catalogue = runOp<{ apps: CatalogueApp[] }>('catalogue.list', {}, { silent: true }).then((r) => r.apps, () => []);
  return catalogue;
}

export function appName(a: { label: string; display_name: string }): string {
  return a.label || a.display_name;
}

/** Where an app opens in the browser: its port on this server (the address the browser already uses). */
export function openUrl(ep: { port: number; bind?: string } | null | undefined): string {
  if (!ep || !ep.port) return '';
  const bind = ep.bind || '';
  const host = !bind || bind === '0.0.0.0' || bind === '::' || bind === '127.0.0.1' || bind === '::1' ? window.location.hostname : bind;
  return `http://${host.includes(':') ? `[${host}]` : host}:${ep.port}`;
}
