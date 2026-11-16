/**
 * Settings, Capture: Gmail's connection state ("Connect Gmail in CraftBot"
 * when the bridge answers 503), my own consent (opt-in) and the domains
 * left out for me, every member's consent, the labels used, and for
 * admins the firm's capture mailbox, its own domains and the domains never
 * captured. Headers only; capture never needs typing once it is on.
 */
import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button, Input, LoadError, More, Panel, Row, Skeleton, StatusDot, SubHeader, Tag, Toggle } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { CaptureStatus } from './types.ts';

const READS = ['capture_state', 'interactions', 'cal_events', 'members'];

const GMAIL: Record<CaptureStatus['gmail'], { tone: Tone; label: string }> = {
  connected: { tone: 'good', label: 'Connected' },
  waiting: { tone: 'faint', label: 'Not read yet' },
  offline: { tone: 'warn', label: 'Connect Gmail in CraftBot' },
  error: { tone: 'bad', label: 'Error' },
};

/** Domains as chips with an add field (Enter or comma adds). */
function DomainChips({ value, onChange, label }: { value: string[]; onChange: (next: string[]) => void; label: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const add = (): void => {
    const d = text.trim().toLowerCase().replace(/^@/, '');
    if (d === '' || value.includes(d)) {
      setText('');
      return;
    }
    onChange([...value, d]);
    setText('');
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {value.map((d) => (
        <Tag key={d} className="pr-0.5">
          <span className="vo-mono">{d}</span>
          <button type="button" aria-label={'Remove ' + d} onClick={() => onChange(value.filter((x) => x !== d))} className="vo-focus hit flex size-4 items-center justify-center rounded-[3px] text-[var(--vo-muted)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
            <X size={11} aria-hidden />
          </button>
        </Tag>
      ))}
      <Input
        value={text}
        aria-label={label}
        placeholder="domain.com"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="h-7 w-[130px] text-[12px]"
      />
    </div>
  );
}

export function CaptureSettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<CaptureStatus>('capture.status', {}, READS, { name: 'capture.status' });
  const [syncing, setSyncing] = useState(false);
  const s = live.data;
  const admin = allowed(me, 'settings:edit');
  const consent = async (on: boolean): Promise<void> => {
    await act([], () => op('capture.consent', { consent: on }), READS);
  };
  const exclude = async (list: string[]): Promise<void> => {
    await act([], () => op('capture.consent', { exclude_domains: list }), READS);
  };
  const configure = async (patch: Record<string, unknown>): Promise<void> => {
    await act([], () => op('capture.configure', patch), READS);
  };
  const sync = async (): Promise<void> => {
    setSyncing(true);
    await act([], () => op('capture.sync', {}), READS.concat(['strengths', 'briefs', 'people', 'companies']));
    setSyncing(false);
  };
  if (live.error !== null && s === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (s === null) return <Skeleton className="h-60 w-full" />;
  const g = GMAIL[s.gmail];
  const lastRead = [s.sources.mail_owner.last_ok_at, s.sources.calendar.last_ok_at].filter((x) => x !== '').sort().pop() ?? '';
  const mine = s.me;
  return (
    <>
      <SubHeader title="Capture">
        <Button icon={RefreshCw} busy={syncing} disabled={!s.bridge} onClick={() => void sync()}>
          Sync now
        </Button>
      </SubHeader>
      <Panel>
        <div className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
          <Row label="Gmail" tip="Mail headers every 15 minutes, the calendar every 10, for members who turned capture on.">
            <StatusDot tone={g.tone} label={g.label} />
            {lastRead !== '' && <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{ago(lastRead)}</span>}
          </Row>
          {mine !== null && (
            <Row label="My capture" tip="Only who you emailed or met and when: headers, never the text.">
              <Toggle checked={mine.consent} onChange={(v) => void consent(v)} label="Capture my email and meetings" />
            </Row>
          )}
          {mine !== null && (
            <Row label="Left out">
              <DomainChips value={mine.exclude_domains} onChange={(v) => void exclude(v)} label="Domains left out for me" />
            </Row>
          )}
          <Row label="Labels">
            {s.labels.map((l) => (
              <Tag key={l}>{l}</Tag>
            ))}
          </Row>
        </div>
      </Panel>
      <Panel label="Members" flush>
        <ul className="flex min-w-0 flex-col px-5 pb-3">
          {s.members.map((m) => (
            <li key={m.id} className="flex h-9 min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--vo-ink)]">{m.name}</span>
              <StatusDot tone={m.consent ? 'good' : 'faint'} label={m.consent ? 'On' : 'Off'} />
            </li>
          ))}
        </ul>
      </Panel>
      {admin && (
        <Panel label="Firm">
          <div className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
            <Row label="Capture mailbox" tip="An address members BCC or copy; set its Gmail account under More to read it.">
              <Input defaultValue={s.firm.capture_address} placeholder="capture@firm.com" aria-label="Capture mailbox" onBlur={(e) => e.target.value.trim() !== s.firm.capture_address && void configure({ capture_address: e.target.value.trim() })} className="w-[220px]" />
            </Row>
            <Row label="Firm domains" tip="Addresses on these domains are the firm, never contacts. Members' own domains count already.">
              <DomainChips value={s.firm.firm_domains} onChange={(v) => void configure({ firm_domains: v })} label="Firm domains" />
            </Row>
            <Row label="Never capture">
              <DomainChips value={s.firm.exclude_domains} onChange={(v) => void configure({ exclude_domains: v })} label="Domains never captured" />
            </Row>
          </div>
          <More className="pt-3">
            <Row label="Mailbox account" tip="The connected Gmail account that receives the capture mailbox.">
              <Input defaultValue={s.firm.capture_account} aria-label="Mailbox account" onBlur={(e) => e.target.value.trim() !== s.firm.capture_account && void configure({ capture_account: e.target.value.trim() })} className="w-[220px]" />
            </Row>
          </More>
        </Panel>
      )}
    </>
  );
}
