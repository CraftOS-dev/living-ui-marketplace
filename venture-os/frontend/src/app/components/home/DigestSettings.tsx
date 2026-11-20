/**
 * Settings, Digest: the member's own morning email (off by default). On,
 * it arrives at the digest time in the member's zone with the day's
 * meetings, items past due, votes and decisions due, and alerts, one line
 * each. The switch is the member's preference (auth.update-profile prefs);
 * the link base is the address this browser opened the app at, so each line
 * links back. Send now shows the result in place.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { op } from '../../lib/api.ts';
import { refreshMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import { Button, LoadError, Row, Skeleton, StatusDot, SubHeader, Toggle } from '../ui.tsx';
import type { DigestOut } from './types.ts';

const KIND: Record<string, string> = { meeting: 'Meeting', stall: 'Past due', vote: 'Vote', decision: 'Decision', alert: 'Alert' };

function appLink(): string {
  return window.location.origin + window.location.pathname;
}

export function DigestSettings(): React.JSX.Element {
  const live = useOp<DigestOut>('home.digest', {}, ['members', 'outbound', 'settings'], { name: 'home.digest' });
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-28 w-full" />;
  const d = live.data;
  const toggle = async (on: boolean): Promise<void> => {
    setBusy('toggle');
    await act([], () => op('auth.update-profile', { prefs: on ? { digest: true, digest_link: appLink() } : { digest: false } }), ['members']);
    await refreshMe();
    setBusy('');
  };
  const sendNow = async (): Promise<void> => {
    setBusy('send');
    setSent(null);
    const out = await act([], () => op<{ message: { status: string; error: string } | null }>('home.digest-send', {}), ['outbound']);
    setBusy('');
    if (out !== null) setSent(out.message !== null && out.message.status === 'sent' ? { ok: true, text: 'Sent' } : { ok: false, text: out.message !== null && out.message.error !== '' ? out.message.error : 'Not sent' });
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SubHeader title="Digest" />
      <div className="vo-panel divide-y divide-[var(--vo-hair)] px-5">
        <Row label="Morning digest" tip={`An email at ${d.time} your time (${d.zone}) with the day's meetings, items past due, votes due and alerts.`}>
          <Toggle checked={d.on} onChange={(v) => void toggle(v)} label="Morning digest" disabled={busy !== '' || !d.can_send} />
        </Row>
        <Row label="Today">
          {sent !== null && <StatusDot tone={sent.ok ? 'good' : 'bad'} label={sent.text} />}
          <Button size="sm" icon={Send} busy={busy === 'send'} disabled={busy !== '' || !d.can_send || !d.bridge} onClick={() => void sendNow()}>
            Send now
          </Button>
        </Row>
        {d.lines.length > 0 && (
          <ul className="flex flex-col py-2" aria-label="Today's digest">
            {d.lines.map((l, i) => (
              <li key={i} className="vo-wrap flex min-h-7 items-baseline gap-3 py-0.5 text-[13px] text-[var(--vo-ink-2)]">
                <span className="vo-mono w-24 shrink-0 text-[12px] text-[var(--vo-muted)]">{KIND[l.kind] ?? l.kind}</span>
                <span className="min-w-0 flex-1">{l.kind === 'meeting' ? l.text : l.text.slice(l.text.indexOf(': ') + 2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
