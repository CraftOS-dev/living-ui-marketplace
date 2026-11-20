/**
 * First run: the company, its first legal entity (the country decides the
 * currency, time zone, work week, public holidays and payroll rules), the
 * owner's account with a password and the approval PIN, and the recovery
 * code shown once. One calm card, four short steps, smart defaults.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Download, Globe, KeyRound, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Checkbox, Fact, Field, Input, Notice, PinBoxes, SearchInput, Select, Spinner, Stepper, Tag } from '../../components/ui.tsx';
import { copyText, errMessage, op, saveText } from '../../lib/api.ts';
import { signedIn } from '../../lib/auth.tsx';
import { weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import type { Me } from '../../lib/types.ts';

export interface CountrySummary {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  timezones: string[];
  date_format: string;
  week_start: number;
  weekend: number[];
  name_order: string;
  regions: { code: string; name: string }[];
  packs: string[];
  /** Pack codes a region adds ({ MH: ['in-pt-mh'] }). */
  region_packs?: Record<string, string[]> | undefined;
  /** Each pack's plain name ({ 'in-epf': 'India EPF, EPS, EDLI and PF charges' }). */
  pack_names?: Record<string, string> | undefined;
  has_holidays: boolean;
  holiday_years: string[];
}

/** The one-screen frame of the screens before the app (setup, sign in, invite). */
export function Welcome({ children, wide }: { children: React.ReactNode; wide?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="hr-scroll flex min-h-[100dvh] flex-col overflow-y-auto bg-[var(--hr-page)] text-[var(--hr-ink)]">
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <Users size={19} strokeWidth={1.9} aria-hidden />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">HR OS</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-[4vh] sm:pt-[8vh]">
        <div className={cn('hr-panel hr-in w-full p-5 sm:p-7', wide === true ? 'max-w-[640px]' : 'max-w-[440px]')}>{children}</div>
      </main>
    </div>
  );
}

function guessCountry(list: CountrySummary[]): string {
  const region = (navigator.language ?? '').split('-')[1]?.toUpperCase() ?? '';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return list.find((c) => c.code === region)?.code ?? list.find((c) => c.timezones.includes(zone))?.code ?? list[0]?.code ?? '';
}

function workWeek(c: CountrySummary): string {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (c.week_start + i) % 7).filter((d) => !c.weekend.includes(d));
  if (days.length === 0) return '';
  const name = (d: number): string => weekday(`2026-11-${String(1 + d).padStart(2, '0')}`, 'short');
  return t('setup.week_range', { from: name(days[0] ?? 1), to: name(days[days.length - 1] ?? 5) });
}

type Step = 'company' | 'country' | 'you' | 'saved';

export function SetupPage(): React.JSX.Element {
  const [countries, setCountries] = useState<CountrySummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('company');
  const [company, setCompany] = useState('');
  const [legal, setLegal] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [zone, setZone] = useState('');
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [given, setGiven] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; me: Me; code: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    op<{ countries: CountrySummary[] }>('setup.countries', {}, { quiet: true })
      .then((r) => {
        setCountries(r.countries);
        const g = guessCountry(r.countries);
        setCountry(g);
      })
      .catch((e: unknown) => setLoadErr(errMessage(e)));
  }, []);

  const c = useMemo(() => countries?.find((x) => x.code === country) ?? null, [countries, country]);
  useEffect(() => {
    if (c !== null) {
      const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setZone(c.timezones.includes(here) ? here : c.timezone);
      setRegion('');
    }
  }, [c]);

  const listRef = useRef<HTMLDivElement | null>(null);
  // The guessed country is in view when the step opens.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    // Whole rows above the guessed one (never a half row clipped at the top).
    if (step === 'country' && list !== null && list !== undefined && el !== null && el !== undefined) {
      const row = Math.max(1, el.offsetHeight);
      const first = list.firstElementChild instanceof HTMLElement ? list.firstElementChild.offsetTop : 0;
      list.scrollTop = Math.max(0, el.offsetTop - first - Math.floor(list.clientHeight / row / 2) * row);
    }
  }, [step, countries]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (countries ?? []).filter((x) => n === '' || x.name.toLowerCase().includes(n) || x.code.toLowerCase() === n || x.currency.toLowerCase() === n);
  }, [countries, q]);

  const okCompany = company.trim() !== '';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pinWeak = pin.length === 6 && pin.split('').every((d) => d === pin.charAt(0));
  const familyFirst = c?.name_order === 'family_first';
  const name = (familyFirst ? [family, given] : [given, family]).map((x) => x.trim()).filter((x) => x !== '').join(' ');
  const okYou = name !== '' && emailOk && password.length >= 8 && pin.length === 6 && !pinWeak && pin2 === pin;

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ token: string; me: Me; recovery_code: string }>(
        'setup.complete',
        { company_name: company.trim(), legal_name: legal.trim() === '' ? undefined : legal.trim(), country, region: region === '' ? undefined : region, timezone: zone, owner_name: name, email: email.trim(), password, pin },
        { quiet: true },
      );
      setDone({ token: r.token, me: r.me, code: r.recovery_code });
      setStep('saved');
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { key: 'company', label: t('setup.step_company') },
    { key: 'country', label: t('setup.step_country') },
    { key: 'you', label: t('setup.step_you') },
    { key: 'saved', label: t('setup.step_code') },
  ];

  return (
    <Welcome wide>
      <Stepper steps={steps} current={step} onStep={done === null ? (k) => setStep(k as Step) : undefined} className="-mx-2 mb-6" />
      {countries === null && loadErr === null ? (
        <div className="flex h-40 items-center justify-center text-[var(--hr-muted)]">
          <Spinner size={18} />
        </div>
      ) : loadErr !== null ? (
        <Notice tone="bad">{loadErr}</Notice>
      ) : step === 'company' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (okCompany) setStep('country');
          }}
        >
          <div>
            <h1 className="text-[15px] font-semibold">{t('setup.company_title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('setup.company_sub')}</p>
          </div>
          <Field label={t('setup.company_name')}>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} autoFocus placeholder={t('setup.company_ph')} aria-label={t('setup.company_name')} />
          </Field>
          <Field label={t('setup.legal_name')} optional help={t('setup.legal_help')}>
            <Input value={legal} onChange={(e) => setLegal(e.target.value)} placeholder={company.trim() !== '' ? company.trim() : t('setup.legal_ph')} aria-label={t('setup.legal_name')} />
          </Field>
          <div className="flex justify-end pt-1">
            <Button type="submit" variant="primary" iconRight={ArrowRight} disabled={!okCompany}>
              {t('ui.continue')}
            </Button>
          </div>
        </form>
      ) : step === 'country' ? (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-[15px] font-semibold">{t('setup.country_title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('setup.country_sub')}</p>
          </div>
          {(countries ?? []).length === 0 ? (
            <Notice tone="warn">{t('setup.no_countries')}</Notice>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="flex min-w-0 flex-col gap-2">
                <SearchInput value={q} onChange={setQ} placeholder={t('setup.find_country')} />
                <div ref={listRef} role="listbox" aria-label={t('setup.step_country')} className="hr-scroll relative h-[266px] snap-y overflow-y-auto rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-1 [&>button]:snap-start">
                  {shown.map((x) => (
                    <button
                      key={x.code}
                      type="button"
                      role="option"
                      aria-selected={x.code === country}
                      onClick={() => setCountry(x.code)}
                      className={cn('hr-focus flex h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] px-2 text-left text-[13px] transition-colors', x.code === country ? 'bg-[var(--hr-active)] font-medium' : 'hover:bg-[var(--hr-hover)]')}
                    >
                      <span className="hr-mono w-6 shrink-0 text-[12px] text-[var(--hr-muted)]">{x.code}</span>
                      <span className="min-w-0 flex-1 truncate">{x.name}</span>
                      <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{x.currency}</span>
                      {x.code === country && <Check size={13} aria-hidden />}
                    </button>
                  ))}
                  {shown.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-[var(--hr-muted)]">{t('ui.nothing_found')}</p>}
                </div>
              </div>
              {c !== null && (
                <div className="flex min-w-0 flex-col gap-3 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3.5">
                  <div className="flex items-center gap-2">
                    <Globe size={14} aria-hidden className="text-[var(--hr-muted)]" />
                    <span className="hr-label">{t('setup.brings', { name: c.name })}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Fact label={t('setup.currency')} mono>
                      {c.currency}
                    </Fact>
                    <Fact label={t('setup.work_week')}>{workWeek(c)}</Fact>
                    <Fact label={t('setup.holidays')}>{c.has_holidays ? c.holiday_years.join(', ') : t('setup.holidays_none')}</Fact>
                    <Fact label={t('setup.date_format')} mono>
                      {c.date_format}
                    </Fact>
                  </div>
                  <div>
                    <div className="hr-label mb-1.5">{t('setup.payroll_rules')}</div>
                    {c.packs.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-[13px] text-[var(--hr-ink-2)]">
                        {[...c.packs, ...(region !== '' ? (c.region_packs?.[region] ?? []) : [])].map((p) => (
                          <li key={p} className="hr-wrap flex items-start gap-2">
                            <Check size={13} aria-hidden className="mt-[3px] shrink-0 text-[var(--hr-good)]" />
                            {c.pack_names?.[p] ?? t('setup.packs_built_in', { country: c.name })}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[13px] text-[var(--hr-muted)]">{t('setup.packs_none')}</div>
                    )}
                  </div>
                  <Field label={t('setup.timezone')}>
                    <Select value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t('setup.timezone')}>
                      {c.timezones.map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {c.regions.length > 0 && (
                    <Field label={t('setup.region')} optional help={t('setup.region_help')}>
                      <Select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t('setup.region')}>
                        <option value="">{t('setup.region_none')}</option>
                        {c.regions.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep('company')}>
              {t('ui.back')}
            </Button>
            <Button variant="primary" iconRight={ArrowRight} disabled={c === null} onClick={() => setStep('you')}>
              {t('ui.continue')}
            </Button>
          </div>
        </div>
      ) : step === 'you' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (okYou && !busy) void finish();
          }}
        >
          <div>
            <h1 className="text-[15px] font-semibold">{t('setup.you_title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('setup.you_sub', { company: company.trim() })}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(familyFirst ? ['family', 'given'] : ['given', 'family']).map((part, i) => (
              <Field key={part} label={part === 'family' ? t('setup.family_name') : t('setup.given_name')}>
                <Input value={part === 'family' ? family : given} onChange={(e) => (part === 'family' ? setFamily(e.target.value) : setGiven(e.target.value))} autoFocus={i === 0} autoComplete={part === 'family' ? 'family-name' : 'given-name'} aria-label={part === 'family' ? t('setup.family_name') : t('setup.given_name')} />
              </Field>
            ))}
            <Field label={t('setup.email')} error={email !== '' && !emailOk ? t('setup.email_bad') : null} className="sm:col-span-2">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" aria-label={t('setup.email')} />
            </Field>
          </div>
          <Field label={t('setup.password')} hint={t('setup.password_hint')} error={password !== '' && password.length < 8 ? t('setup.password_hint') : null}>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" aria-label={t('setup.password')} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--hr-ink-2)]">
                <KeyRound size={12} aria-hidden /> {t('setup.pin')}
              </span>
              <PinBoxes value={pin} onChange={setPin} label={t('setup.pin')} invalid={pinWeak} align="start" />
              <span className={cn('text-[12px] leading-4', pinWeak ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-muted)]')}>{pinWeak ? t('setup.pin_weak') : t('setup.pin_hint')}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[var(--hr-ink-2)]">{t('setup.pin_again')}</span>
              <PinBoxes value={pin2} onChange={setPin2} label={t('setup.pin_again')} invalid={pin2.length === 6 && pin2 !== pin} align="start" />
              {pin2.length === 6 && pin2 !== pin && <span className="text-[12px] text-[var(--hr-bad)]">{t('setup.pin_mismatch')}</span>}
            </div>
          </div>
          {error !== null && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep('country')}>
              {t('ui.back')}
            </Button>
            <Button type="submit" variant="primary" icon={Check} busy={busy} disabled={!okYou}>
              {t('setup.create')}
            </Button>
          </div>
        </form>
      ) : done !== null ? (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-[15px] font-semibold">{t('setup.code_title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--hr-muted)]">{t('setup.code_sub')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-sunk)] p-3">
            <code className="hr-mono hr-wrap min-w-0 flex-1 select-all text-[15px] tracking-[0.06em]" aria-label={t('setup.code_title')}>
              {done.code}
            </code>
            <Button
              icon={copied ? Check : Copy}
              onClick={() =>
                void copyText(done.code).then((ok) => {
                  setCopied(ok);
                  if (ok) setSaved(true);
                })
              }
            >
              {copied ? t('ui.copied') : t('ui.copy')}
            </Button>
            <Button
              icon={Download}
              onClick={() => {
                saveText(`${t('setup.code_file_title', { company: company.trim() })}\n\n${done.code}\n\n${t('setup.code_file_text')}\n`, 'hr-os-recovery-code.txt', 'text/plain');
                setSaved(true);
              }}
            >
              {t('setup.download')}
            </Button>
          </div>
          <Checkbox checked={saved} onChange={setSaved} label={t('setup.code_saved')} />
          <div className="flex justify-end pt-1">
            <Button variant="primary" iconRight={ArrowRight} disabled={!saved} onClick={() => signedIn(done.token, done.me)}>
              {t('setup.open_app')}
            </Button>
          </div>
        </div>
      ) : null}
    </Welcome>
  );
}

