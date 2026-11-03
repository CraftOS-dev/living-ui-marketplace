/**
 * Step 2, Team: who is full-time (a ring), the team checks, and a card per
 * founder, CEO first as speedrun's form asks: name and title, builds it
 * end-to-end, full-time, years of experience, the rest of the form's
 * founder fields, and their relevant experience as a row.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, ChevronDown, Clock, Code2, Crown, Plus, Trash2, UserPlus } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { vanish } from '../lib/motion.tsx';
import { href, type Route } from '../lib/router.ts';
import type { AnswerList, ChecksList, Founder, Pipeline } from '../lib/types.ts';
import { Ring } from '../components/Charts.tsx';
import { QuestionCard } from '../components/QuestionCard.tsx';
import { ReviewAgain, ReviewNotice } from '../components/ReviewAgain.tsx';
import { Card, CardHeader, CircleButton, PageHeader, PillButton, PillLink, StatusPill, TwoWay, confirmAsk, pillInput, softInput } from '../components/ui.tsx';

interface FormOptions {
  countries: string[];
  founder_fields: { education: string[] };
}

async function update(f: Founder, patch: Record<string, unknown>): Promise<void> {
  await op('founders.update', { founder: f.id, ...patch });
  changed('founders', 'answers');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

type TextKey = 'name' | 'first_name' | 'last_name' | 'role' | 'email' | 'phone' | 'linkedin' | 'github' | 'x' | 'website' | 'country' | 'state' | 'city' | 'citizenship' | 'college';

/** speedrun's required founder fields; the CEO's block also needs these four. */
const REQUIRED: { k: keyof Founder; label: string }[] = [
  { k: 'first_name', label: 'first name' },
  { k: 'last_name', label: 'last name' },
  { k: 'email', label: 'email' },
  { k: 'country', label: 'country' },
  { k: 'city', label: 'city' },
  { k: 'citizenship', label: 'citizenship' },
  { k: 'technical', label: 'builds end-to-end' },
];
const LEAD: { k: keyof Founder; label: string }[] = [
  { k: 'phone', label: 'phone' },
  { k: 'college', label: 'college' },
  { k: 'years', label: 'years of experience' },
  { k: 'linkedin', label: 'LinkedIn' },
];

function missingOf(f: Founder, lead: boolean): string[] {
  return (lead ? REQUIRED.concat(LEAD) : REQUIRED).filter((x) => f[x.k] === '' || f[x.k] === null).map((x) => x.label);
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

function Text({ f, k, place, locked, className, list }: { f: Founder; k: TextKey; place: string; locked: boolean; className?: string; list?: string }): React.JSX.Element {
  const [v, setV] = useState(f[k]);
  useEffect(() => setV(f[k]), [f, k]);
  return (
    <input
      className={className ?? softInput}
      value={v}
      placeholder={place}
      disabled={locked}
      aria-label={place}
      list={list}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== f[k]) update(f, { [k]: v }).catch(() => setV(f[k]));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Years({ f, locked }: { f: Founder; locked: boolean }): React.JSX.Element {
  const shown = f.years !== null ? String(f.years) : '';
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  return (
    <input
      className={cn(pillInput, 'num h-10 w-[72px] px-3 text-center font-semibold')}
      inputMode="numeric"
      value={v}
      placeholder="?"
      disabled={locked}
      aria-label="Years of professional experience"
      onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
      onBlur={() => {
        if (v !== shown) update(f, { years: v }).catch(() => setV(shown));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Education({ f, locked, options }: { f: Founder; locked: boolean; options: string[] }): React.JSX.Element {
  return (
    <span className="relative block">
      <select className={cn(softInput, 'appearance-none pr-11')} value={f.education} disabled={locked} aria-label="Highest education" onChange={(e) => void update(f, { education: e.target.value })}>
        <option value="">Not given</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--sr-muted)]" />
    </span>
  );
}

/** A form field with its name above it, so a filled value still says what it is. */
function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid gap-1">
      <span className="px-4 text-[12px] font-semibold text-[var(--sr-muted)]">{label}</span>
      {children}
    </div>
  );
}

function FactRow({ icon: Icon, title, children }: { icon: typeof Code2; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[18px] bg-[var(--sr-row)] py-2 pl-4 pr-2">
      <Icon size={16} className="shrink-0 text-[var(--sr-muted)]" aria-hidden />
      <span className="min-w-0 flex-1 whitespace-nowrap text-[14px] font-semibold">{title}</span>
      {children}
    </div>
  );
}

function FounderCard({ f, i, ids, profile, locked, focus, options }: { f: Founder; i: number; ids: string[]; profile: AnswerList | null; locked: boolean; focus: string; options: FormOptions | null }): React.JSX.Element {
  const answers = (profile?.items ?? []).filter((a) => a.founder === f.id);
  const [open, setOpen] = useState<string>(focus.startsWith('fp.' + f.id + '.') ? focus : '');
  const lead = i === 0;
  const missing = missingOf(f, lead);
  const [details, setDetails] = useState(false);
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk('Remove ' + f.name + '?', 'Their relevant experience goes too.', 'Remove'))) return;
    const undo = await vanish(document.getElementById('f-' + f.id));
    try {
      await op('founders.remove', { founder: f.id });
      changed('founders', 'answers');
    } catch {
      undo();
    }
  };
  const makeCeo = async (): Promise<void> => {
    await op('founders.reorder', { order: [f.id, ...ids.filter((x) => x !== f.id)] });
    changed('founders', 'answers');
  };
  return (
    <Card id={'f-' + f.id} className="grid content-start gap-4">
      <div className="flex items-center gap-3">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold', i % 2 === 1 ? 'bg-[var(--sr-row)] text-[var(--sr-ink)]' : 'bg-[var(--sr-ink)] text-[var(--sr-shell)]')}>{initials(f.name)}</span>
        <div className="min-w-0 flex-1">
          <Text f={f} k="name" place="Full name" locked={locked} className="w-full rounded-full bg-transparent px-2 text-[15px] font-bold outline-none ring-[var(--sr-ink)] hover:bg-[var(--sr-hover)] focus-visible:ring-2" />
          <Text f={f} k="role" place="Title, e.g. CEO" locked={locked} className="w-full rounded-full bg-transparent px-2 text-[13px] text-[var(--sr-muted)] outline-none ring-[var(--sr-ink)] hover:bg-[var(--sr-hover)] focus-visible:ring-2" />
        </div>
        {lead ? (
          <StatusPill tone="info">Applies as CEO</StatusPill>
        ) : (
          !locked && (
            <PillButton variant="row" icon={Crown} className="hidden h-10 sm:inline-flex" onClick={() => void makeCeo()}>
              Make CEO
            </PillButton>
          )
        )}
        {!locked && !f.confirmed ? (
          <PillButton variant="dark" dot icon={Check} className="h-10" onClick={() => void op('founders.confirm', { founder: f.id }).then(() => changed('founders', 'answers'))}>
            Looks right
          </PillButton>
        ) : f.confirmed ? (
          <StatusPill tone="good">Confirmed</StatusPill>
        ) : null}
      </div>

      {f.need !== '' && <div className="rounded-[18px] bg-[var(--sr-ink)] px-4 py-3 text-[13px] text-[var(--sr-shell)] [overflow-wrap:anywhere]">{f.need}</div>}

      <div className="grid gap-2 md:grid-cols-3">
        <FactRow icon={Code2} title="Builds it end-to-end">
          <YesNo value={f.technical} label="Technical enough to build the product end-to-end" locked={locked} onChange={(v) => update(f, { technical: v })} />
        </FactRow>
        <FactRow icon={Clock} title="Full-time">
          <YesNo value={f.full_time} label="Full-time" locked={locked} onChange={(v) => update(f, { full_time: v })} />
        </FactRow>
        <FactRow icon={BriefcaseBusiness} title="Years of experience">
          <Years f={f} locked={locked} />
        </FactRow>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)} className="flex items-center gap-2 text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
          {details ? 'Hide form details' : 'Form details'}
          {missing.length > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-[var(--sr-muted)] no-underline">
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--sr-accent)]" />
              {missing.length} missing
            </span>
          )}
        </button>
        {!locked && <CircleButton icon={Trash2} label={'Remove ' + f.name} variant="row" size={36} onClick={() => void remove()} />}
      </div>
      {details && (
        <div className="sr-unfold grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Text f={f} k="first_name" place="First name" locked={locked} />
          </Field>
          <Field label="Last name">
            <Text f={f} k="last_name" place="Last name" locked={locked} />
          </Field>
          <Field label="Email">
            <Text f={f} k="email" place="name@company.com" locked={locked} />
          </Field>
          <Field label={'Phone' + (lead ? '' : ' (optional)')}>
            <Text f={f} k="phone" place="+1 415 555 2671" locked={locked} />
          </Field>
          <Field label="Lives in (country)">
            <Text f={f} k="country" place="Country" locked={locked} list="sr-countries" />
          </Field>
          <Field label="City">
            <Text f={f} k="city" place="City" locked={locked} />
          </Field>
          {f.country === 'United States of America' && (
            <Field label="State">
              <Text f={f} k="state" place="State" locked={locked} />
            </Field>
          )}
          <Field label="Citizenship">
            <Text f={f} k="citizenship" place="Country" locked={locked} list="sr-countries" />
          </Field>
          <Field label={'College or university' + (lead ? '' : ' (optional)')}>
            <Text f={f} k="college" place="School" locked={locked} />
          </Field>
          <Field label="Highest education (optional)">
            <Education f={f} locked={locked} options={options?.founder_fields.education ?? []} />
          </Field>
          <Field label={'LinkedIn' + (lead ? '' : ' (optional)')}>
            <Text f={f} k="linkedin" place="https://www.linkedin.com/in/" locked={locked} />
          </Field>
          <Field label="GitHub (optional)">
            <Text f={f} k="github" place="https://github.com/" locked={locked} />
          </Field>
          <Field label="X (optional)">
            <Text f={f} k="x" place="https://x.com/" locked={locked} />
          </Field>
          <Field label="Portfolio or side project (optional)">
            <Text f={f} k="website" place="https://" locked={locked} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {answers.map((a) => (
          <QuestionCard key={a.key} a={a} open={open === a.key} onToggle={() => setOpen((o) => (o === a.key ? '' : a.key))} locked={locked} />
        ))}
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
        <UserPlus size={18} /> Add a co-founder
      </span>
      <AddFounderForm />
    </Card>
  );
}

/** Before any founder: ask for them first, nothing else. */
function StartTeam({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Start with your founders" subtitle="Add the CEO first, then each co-founder. Your AI agent fills their details from their links, and the checks show what speedrun looks for in a team." />
      {locked ? (
        <p className="text-[13px] text-[var(--sr-muted)]">The application is sent, so the team can no longer change.</p>
      ) : (
        <div className="grid gap-3">
          <AddFounderForm />
          <p className="text-[13px] text-[var(--sr-muted)]">
            Or{' '}
            <a href={href('links')} className="font-semibold text-[var(--sr-ink)] underline underline-offset-4">
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
  const options = useLive<FormOptions>('form-options', (signal) => op<FormOptions>('questions.list', {}, { signal, quiet: true }), []);
  const fs = team.data?.founders ?? [];
  const locked = p.settings.status !== 'preparing';
  const live = (checks.data?.checks ?? []).filter((c) => c.status === 'pass' || c.status === 'fail');
  const fails = live.filter((c) => c.status === 'fail');
  const full = fs.filter((f) => f.full_time === true).length;
  const part = fs.filter((f) => f.full_time === false).length;
  const header = (
    <PageHeader
      title="Your team"
      subtitle="speedrun reads the team and bios most"
      actions={
        fs.length > 0 ? (
          <>
            <ReviewAgain progress={p.review.progress} locked={locked} />
            <PillLink variant="dark" dot icon={ArrowRight} href={href('answers')}>Next: answers</PillLink>
          </>
        ) : undefined
      }
    />
  );
  if (team.data === null) return <p className="py-16 text-center text-[13px] text-[var(--sr-muted)]">{team.error ?? 'Loading'}</p>;
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
      <ReviewNotice progress={p.review.progress} />
      <datalist id="sr-countries">
        {(options.data?.countries ?? []).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Full-time founders" subtitle="speedrun asks how many founders build it full-time" />
            <div className="flex items-center gap-5">
              <Ring
                parts={[
                  { label: 'Full-time', value: (full / fs.length) * 100, color: 'var(--sr-ink)' },
                  { label: 'Part-time', value: (part / fs.length) * 100, color: 'var(--sr-slice-2)' },
                ].filter((x) => x.value > 0)}
                center={String(full)}
                caption={'of ' + fs.length}
              />
              <div className="grid min-w-0 flex-1 gap-2">
                {fs.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-[13px]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: f.full_time === true ? 'var(--sr-ink)' : f.full_time === false ? 'var(--sr-slice-2)' : 'var(--sr-slice-3)' }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                    <span className="text-[var(--sr-muted)]">{f.full_time === true ? 'Full-time' : f.full_time === false ? 'Part-time' : '?'}</span>
                    <span className="num w-14 text-right">{f.years !== null ? f.years + ' yrs' : ''}</span>
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
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: c.severity === 'blocker' ? 'var(--sr-red)' : 'var(--sr-accent)' }} />
                    <span>
                      <b>{c.title}</b>
                      {c.detail !== '' && <span className="ml-1.5 text-[var(--sr-muted)]">{c.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          {fs.map((f, i) => (
            <FounderCard key={f.id} f={f} i={i} ids={fs.map((x) => x.id)} profile={profile.data} locked={locked} focus={route.focus} options={options.data} />
          ))}
          {!locked && <AddFounder />}
        </div>
      </div>
    </>
  );
}
