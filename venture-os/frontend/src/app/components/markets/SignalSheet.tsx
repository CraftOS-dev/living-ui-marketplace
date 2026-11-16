/**
 * One candidate in full, one click deeper than its row: the source link,
 * the structured facts the source gave (graded public), the thesis checks,
 * your AI agent's line and context, and the two decisions.
 */
import { SourceLink } from './SourceLink.tsx';
import { Inbox, X } from 'lucide-react';
import { AgentTag, Avatar, Button, CheckChip, Fact, GradeDot, Section, Sheet, SheetHeader, Tag } from '../ui.tsx';
import { ago, compact, money } from '../../lib/format.ts';
import { addToInbox, dismiss } from './actions.ts';
import type { Signal } from './types.ts';
import { word } from './types.ts';

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** What the source itself says, as facts (no prose). */
function sourceFacts(sig: Signal): { label: string; value: string; mono?: boolean }[] {
  const p = sig.payload;
  const out: { label: string; value: string; mono?: boolean }[] = [];
  if (sig.source === 'edgar_form_d') {
    if (s(p['industry']) !== '') out.push({ label: 'Industry', value: s(p['industry']) });
    if (s(p['state_name']) !== '') out.push({ label: 'State', value: word(s(p['state_name']).toLowerCase()) });
    const offer = n(p['offering_minor']);
    if (offer !== null) out.push({ label: 'Offering', value: money(offer, 'USD', { compact: true }), mono: true });
    const sold = n(p['sold_minor']);
    if (sold !== null) out.push({ label: 'Sold', value: money(sold, 'USD', { compact: true }), mono: true });
    const year = n(p['year_of_inc']);
    if (year !== null) out.push({ label: 'Incorporated', value: String(year), mono: true });
    const inv = n(p['investors']);
    if (inv !== null) out.push({ label: 'Investors', value: String(inv), mono: true });
    if (s(p['filed_at']) !== '') out.push({ label: 'Filed', value: ago(s(p['filed_at'])), mono: true });
  } else if (sig.source === 'hacker_news') {
    const score = n(p['score']);
    if (score !== null) out.push({ label: 'Points', value: String(score), mono: true });
    const c = n(p['comments']);
    if (c !== null) out.push({ label: 'Comments', value: String(c), mono: true });
    if (s(p['posted_at']) !== '') out.push({ label: 'Posted', value: ago(s(p['posted_at'])), mono: true });
  } else if (sig.source === 'github') {
    const st = n(p['stars']);
    if (st !== null) out.push({ label: 'Stars', value: compact(st), mono: true });
    if (s(p['language']) !== '') out.push({ label: 'Language', value: s(p['language']) });
    if (s(p['created_at']) !== '') out.push({ label: 'Created', value: ago(s(p['created_at'])), mono: true });
  }
  return out;
}

const CONTEXT: [string, string][] = [
  ['founders', 'Founders'],
  ['hiring', 'Hiring'],
  ['traction', 'Traction'],
  ['connections', 'Connections'],
  ['prior', 'Prior'],
];

export function SignalSheet({ signal, onClose }: { signal: Signal | null; onClose: () => void }): React.JSX.Element | null {
  if (signal === null) return null;
  const sig = signal;
  const facts = sourceFacts(sig);
  const people = Array.isArray(sig.payload['people']) ? (sig.payload['people'] as { name: string; roles: string[] }[]).slice(0, 6) : [];
  const ctx = CONTEXT.filter(([k]) => typeof sig.context[k] === 'string' && sig.context[k] !== '');
  const links = Array.isArray(sig.context['links']) ? (sig.context['links'] as string[]) : [];
  const open = sig.status === 'new' || sig.status === 'candidate';
  const byAgent = sig.screened_at !== '' && sig.status !== 'new';
  return (
    <Sheet open onClose={onClose} label={sig.display} width={520}>
      <SheetHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={sig.display} size={24} square />
            <span className="vo-wrap min-w-0">{sig.display}</span>
          </span>
        }
        onClose={onClose}
      />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {sig.source_url !== '' && (
            <SourceLink href={sig.source_url}>{sig.source_label}</SourceLink>
          )}
          <Tag tone="faint">{word(sig.kind)}</Tag>
          {sig.licence === 'internal_only' && (
            <Tag tone="warn" title="Licensed data: never in LP outputs">
              Internal
            </Tag>
          )}
          {sig.website !== '' && (
            <SourceLink href={sig.website} tone="faint" title="Open the website">
              {sig.domain !== '' ? sig.domain : 'Website'}
            </SourceLink>
          )}
        </div>
        {sig.summary !== '' && (
          <p className="vo-wrap flex items-start gap-2 text-[13px] leading-5 text-[var(--vo-ink)]">
            {byAgent && <AgentTag className="mt-0.5" />}
            <span className="min-w-0">{sig.summary}</span>
          </p>
        )}
        {sig.title !== '' && sig.title !== sig.display && <p className="vo-wrap text-[13px] leading-5 text-[var(--vo-ink-2)]">{sig.title}</p>}
        {facts.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {facts.map((f) => (
              <Fact key={f.label} label={f.label} mono={f.mono}>
                <span className="inline-flex items-center gap-1.5">
                  <GradeDot grade="public" />
                  {f.value}
                </span>
              </Fact>
            ))}
          </div>
        )}
        {sig.fit !== null && (sig.fit.checks ?? []).length > 0 && (
          <Section title="Thesis">
            <div className="flex flex-wrap gap-1.5">
              {(sig.fit.checks ?? []).map((c) => (
                <CheckChip key={c.key} state={c.status} label={c.label} />
              ))}
            </div>
          </Section>
        )}
        {people.length > 0 && (
          <Section title="Officers">
            <ul className="flex flex-col gap-1.5">
              {people.map((p) => (
                <li key={p.name} className="flex min-w-0 items-center gap-2 text-[13px]">
                  <Avatar name={p.name} size={22} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="truncate text-[12px] text-[var(--vo-muted)]">{p.roles.join(', ')}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {ctx.length > 0 && (
          <Section title="Context" aside={<AgentTag />}>
            <div className="flex flex-col gap-3">
              {ctx.map(([k, label]) => (
                <Fact key={k} label={label}>
                  {String(sig.context[k])}
                </Fact>
              ))}
            </div>
          </Section>
        )}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <SourceLink key={l} href={l} tone="faint">
                {l.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
              </SourceLink>
            ))}
          </div>
        )}
      </div>
      {open && (
        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--vo-line)] px-5 py-3">
          <Button icon={X} onClick={() => void dismiss([sig.id]).then((ok) => ok && onClose())}>
            Dismiss
          </Button>
          <Button variant="primary" icon={Inbox} onClick={() => void addToInbox([sig.id]).then((ok) => ok && onClose())}>
            Add to Inbox
          </Button>
        </footer>
      )}
    </Sheet>
  );
}
