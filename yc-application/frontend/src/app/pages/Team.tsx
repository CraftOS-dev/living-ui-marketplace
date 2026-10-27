/**
 * Step 2, Team: the equity ring, the team checks, and a card per founder
 * (name, title, writes code, full-time, equity, contact details) with their
 * profile questions as rows.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock, Code2, Percent, Plus, Trash2, UserPlus } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { vanish } from '../lib/motion.tsx';
import { href, type Route } from '../lib/router.ts';
import type { AnswerList, ChecksList, Founder, Pipeline } from '../lib/types.ts';
import { Ring, sliceColor } from '../components/Charts.tsx';
import { QuestionCard } from '../components/QuestionCard.tsx';
import { Card, CardHeader, CircleButton, PageHeader, PillButton, PillLink, Segments, StatusPill, TwoWay, confirmAsk, pillInput, softInput } from '../components/ui.tsx';

async function update(f: Founder, patch: Record<string, unknown>): Promise<void> {
  await op('founders.update', { founder: f.id, ...patch });
  changed('founders', 'answers');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function YesNo({ value, onChange, locked, label }: { value: boolean | null; onChange: (v: boolean) => Promise<void>; locked: boolean; label: string }): React.JSX.Element {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <TwoWay
      label={label}
      labels={['Yes', 'No']}
      value={v === true ? 0 : v === false ? 1 : null}
      disabled={locked}
      onPick={(i) => {
        const before = v;
        const b = i === 0;
        setV(b);
        onChange(b).catch(() => setV(before));
      }}
    />
  );
}

type TextKey = 'name' | 'role' | 'email' | 'linkedin' | 'github' | 'location';

function Text({ f, k, place, locked, className }: { f: Founder; k: TextKey; place: string; locked: boolean; className?: string }): React.JSX.Element {
  const [v, setV] = useState(f[k]);
  useEffect(() => setV(f[k]), [f, k]);
  return (
    <input
      className={className ?? softInput}
      value={v}
      placeholder={place}
      disabled={locked}
      aria-label={place}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== f[k]) void update(f, { [k]: v });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Equity({ f, locked }: { f: Founder; locked: boolean }): React.JSX.Element {
  const shown = f.equity !== null ? String(f.equity) : '';
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  return (
    <span className="relative inline-flex">
      <input
        className={cn(pillInput, 'num h-10 w-[96px] pr-8 text-right font-semibold')}
        inputMode="decimal"
        value={v}
        placeholder="?"
        disabled={locked}
        aria-label="Equity percent"
        onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => {
          const n = Number(v);
          if (v !== '' && Number.isFinite(n) && n !== f.equity) update(f, { equity: n }).catch(() => setV(shown));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-[var(--yc-muted)]">%</span>
    </span>
  );
}

function IconOf({ icon: Icon }: { icon: typeof Code2 }): React.JSX.Element {
  return <Icon size={16} className="shrink-0 text-[var(--yc-muted)]" aria-hidden />;
}

function FactRow({ icon, title, children }: { icon: typeof Code2; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[18px] bg-[var(--yc-row)] py-2 pl-4 pr-2">
      <IconOf icon={icon} />
      <span className="min-w-0 flex-1 whitespace-nowrap text-[14px] font-semibold">{title}</span>
      {children}
    </div>
  );
}

function FounderCard({ f, i, profile, locked, focus }: { f: Founder; i: number; profile: AnswerList | null; locked: boolean; focus: string }): React.JSX.Element {
  const answers = (profile?.items ?? []).filter((a) => a.founder === f.id);
  const [open, setOpen] = useState<string>(focus.startsWith('fp.' + f.id + '.') ? focus : '');
  const [details, setDetails] = useState(false);
  const done = answers.filter((a) => a.value !== '').length;
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk('Remove ' + f.name + '?', 'Their profile answers go too.', 'Remove'))) return;
    const undo = await vanish(document.getElementById('f-' + f.id));
    try {
      await op('founders.remove', { founder: f.id });
      changed('founders', 'answers');
    } catch {
      undo();
    }
  };
  return (
    <Card id={'f-' + f.id} className="grid content-start gap-4">
      <div className="flex items-center gap-3">
        <span
          className={cn('flex size-12 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold', i % 2 === 1 ? 'bg-[var(--yc-row)] text-[var(--yc-ink)]' : 'bg-[var(--yc-ink)] text-[var(--yc-shell)]')}
        >
          {initials(f.name)}
        </span>
        <div className="min-w-0 flex-1">
          <Text f={f} k="name" place="Full name" locked={locked} className="w-full rounded-full bg-transparent px-2 text-[15px] font-bold outline-none ring-[var(--yc-ink)] hover:bg-[var(--yc-hover)] focus-visible:ring-2" />
          <Text f={f} k="role" place="Title, e.g. CEO" locked={locked} className="w-full rounded-full bg-transparent px-2 text-[13px] text-[var(--yc-muted)] outline-none ring-[var(--yc-ink)] hover:bg-[var(--yc-hover)] focus-visible:ring-2" />
        </div>
        {!locked && !f.confirmed ? (
          <PillButton variant="dark" dot icon={Check} className="h-10" onClick={() => void op('founders.confirm', { founder: f.id }).then(() => changed('founders', 'answers'))}>
            Looks right
          </PillButton>
        ) : f.confirmed ? (
          <StatusPill tone="good">Confirmed</StatusPill>
        ) : null}
      </div>

      {f.need !== '' && <div className="rounded-[18px] bg-[var(--yc-ink)] px-4 py-3 text-[13px] text-[var(--yc-shell)]">{f.need}</div>}

      <div className="grid gap-2 md:grid-cols-3">
        <FactRow icon={Code2} title="Writes code">
          <YesNo value={f.technical} label="Writes code" locked={locked} onChange={(v) => update(f, { technical: v })} />
        </FactRow>
        <FactRow icon={Clock} title="Full-time">
          <YesNo value={f.full_time} label="Full-time" locked={locked} onChange={(v) => update(f, { full_time: v })} />
        </FactRow>
        <FactRow icon={Percent} title="Equity">
          <Equity f={f} locked={locked} />
        </FactRow>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setDetails((d) => !d)} className="text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
          {details ? 'Hide contact details' : 'Contact details'}
        </button>
        {!locked && <CircleButton icon={Trash2} label={'Remove ' + f.name} variant="row" size={36} onClick={() => void remove()} />}
      </div>
      {details && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Text f={f} k="email" place="Email" locked={locked} />
          <Text f={f} k="location" place="Lives in" locked={locked} />
          <Text f={f} k="linkedin" place="LinkedIn link" locked={locked} />
          <Text f={f} k="github" place="GitHub link" locked={locked} />
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[15px] font-bold">Profile</span>
          <span className="flex items-center gap-2 text-[12px] text-[var(--yc-muted)]">
            <Segments value={done} max={Math.max(1, answers.length)} count={answers.length || 4} /> {done}/{answers.length}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {answers.map((a) => (
            <QuestionCard key={a.key} a={a} months={[]} confirms={{}} open={open === a.key} onToggle={() => setOpen((o) => (o === a.key ? '' : a.key))} locked={locked} />
          ))}
        </div>
      </div>
    </Card>
  );
}

/** A name and an Add button. */
function AddFounderForm(): React.JSX.Element {
  const [name, setName] = useState('');
  const add = async (): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    setName('');
    try {
      await op('founders.add', { name: n });
      changed('founders', 'answers');
    } catch {
      setName(n);
    }
  };
  return (
    <div className="flex gap-2">
      <input className={softInput} value={name} placeholder="Full name" aria-label="Add a founder" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      <PillButton variant="dark" icon={Plus} disabled={name.trim() === ''} onClick={() => void add()}>
        Add
      </PillButton>
    </div>
  );
}

function AddFounder(): React.JSX.Element {
  return (
    <Card className="grid content-center gap-3">
      <span className="flex items-center gap-2 text-[15px] font-bold">
        <UserPlus size={18} /> Add a founder
      </span>
      <AddFounderForm />
    </Card>
  );
}

/** Before any founder: ask for them first, nothing else. */
function StartTeam({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Start with your founders" subtitle="Add each founder by name. Your AI agent fills their profiles from their links, and the checks show what YC looks for in a team." />
      {locked ? (
        <p className="text-[13px] text-[var(--yc-muted)]">The application is sent, so the team can no longer change.</p>
      ) : (
        <div className="grid gap-3">
          <AddFounderForm />
          <p className="text-[13px] text-[var(--yc-muted)]">
            Or{' '}
            <a href={href('links')} className="font-semibold text-[var(--yc-ink)] underline underline-offset-4">
              add each founder&apos;s LinkedIn
            </a>{' '}
            and your AI agent adds them for you.
          </p>
        </div>
      )}
    </Card>
  );
}

export function TeamPage({ p, route }: { p: Pipeline; route: Route }): React.JSX.Element {
  const team = useLive<{ founders: Founder[] }>('founders', (signal) => op<{ founders: Founder[] }>('founders.list', {}, { signal, quiet: true }), ['founders']);
  const profile = useLive<AnswerList>('profile', (signal) => op<AnswerList>('answers.list', { section: 'profile' }, { signal, quiet: true }), ['answers', 'founders']);
  const checks = useLive<ChecksList>('checks-team', (signal) => op<ChecksList>('review.checks', { group: 'team', brief: true }, { signal, quiet: true }), ['answers', 'founders', 'settings']);
  const fs = team.data?.founders ?? [];
  const locked = p.settings.status !== 'preparing';
  const live = (checks.data?.checks ?? []).filter((c) => c.status === 'pass' || c.status === 'fail');
  const fails = live.filter((c) => c.status === 'fail');
  const total = fs.reduce((n, f) => n + (f.equity ?? 0), 0);
  const header = (
    <PageHeader
      title="Your team"
      subtitle="YC reads the team first"
      actions={
        fs.length > 0 ? (
          <PillLink variant="dark" dot icon={ArrowRight} href={href('answers')}>
            Next: answers
          </PillLink>
        ) : undefined
      }
    />
  );
  if (team.data === null) return <p className="py-16 text-center text-[13px] text-[var(--yc-muted)]">{team.error ?? 'Loading'}</p>;
  if (fs.length === 0) {
    return (
      <>
        {header}
        <StartTeam locked={locked} />
      </>
    );
  }
  return (
    <>
      {header}
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Equity" subtitle="YC checks that the founders split it fairly" />
            <div className="flex items-center gap-5">
              <Ring parts={fs.map((f, i) => ({ label: f.name, value: f.equity ?? 0, color: sliceColor(i) })).filter((x) => x.value > 0)} center={Math.round(total) + '%'} caption="founders" />
              <div className="grid min-w-0 flex-1 gap-2">
                {fs.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2 text-[13px]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: sliceColor(i) }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                    <span className="num">{f.equity !== null ? f.equity + '%' : '?'}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Team checks" subtitle={live.length - fails.length + ' of ' + live.length + ' done'} />
            {fails.length === 0 && live.length > 0 ? (
              <StatusPill tone="good">All good</StatusPill>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {fails.slice(0, 4).map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5 text-[13px] leading-5">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: c.severity === 'blocker' ? 'var(--yc-red)' : 'var(--yc-accent)' }} />
                    <span>
                      <b>{c.title}</b>
                      {c.detail !== '' && <span className="ml-1.5 text-[var(--yc-muted)]">{c.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          {fs.map((f, i) => (
            <FounderCard key={f.id} f={f} i={i} profile={profile.data} locked={locked} focus={route.focus} />
          ))}
          {!locked && <AddFounder />}
        </div>
      </div>
    </>
  );
}
