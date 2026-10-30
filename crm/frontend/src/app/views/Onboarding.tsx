/**
 * First run: the workspace, your name, the home currency and which
 * pipelines to start with; then three ways to bring people in (a CSV, the
 * AI agent from email and calendar, by hand). Never an empty screen with
 * nothing to do.
 */
import { useState } from 'react';
import { ArrowRight, Briefcase, Check, FileUp, Handshake, PiggyBank, Sparkles, UserPlus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { useDialogs } from '../components/dialogs.tsx';
import { Mark } from '../components/Shell.tsx';
import { Btn, Field, Select, input } from '../components/ui.tsx';

export const onboarding = { step2: false };

const KINDS: { kind: string; label: string; icon: LucideIcon; sub: string }[] = [
  { kind: 'sales', label: 'Sales', icon: Briefcase, sub: 'Leads to won customers' },
  { kind: 'fundraising', label: 'Fundraising', icon: PiggyBank, sub: 'Investors, from target to committed' },
  { kind: 'hiring', label: 'Hiring', icon: Users, sub: 'Candidates, from sourced to hired' },
  { kind: 'partnerships', label: 'Partnerships', icon: Handshake, sub: 'Partners, from prospect to live' },
];

export function Onboarding(): React.JSX.Element {
  const app = useApp();
  const dlg = useDialogs();
  const [step, setStep] = useState(onboarding.step2 ? 2 : 1);
  const [workspace, setWorkspace] = useState('');
  const [owner, setOwner] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [kinds, setKinds] = useState<string[]>(['sales']);
  const [busy, setBusy] = useState(false);
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      onboarding.step2 = true;
      await api.applySetup({ workspace, owner_name: owner, home_currency: currency, pipelines: kinds, keep_in_touch_default: 0 });
      setStep(2);
    } catch (err) {
      onboarding.step2 = false;
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const finish = (): void => {
    onboarding.step2 = false;
    window.location.hash = '#/home';
    app.reloadAll();
  };
  return (
    <div className="flex h-dvh items-center justify-center overflow-y-auto bg-[var(--cr-page)] px-4 py-8 text-[var(--cr-ink)]">
      <div className="cr-pop cr-block w-full max-w-[580px] px-6 py-6 sm:px-8 sm:py-7">
        <div className="mb-6 flex items-center gap-3 border-b border-[var(--cr-line)] pb-5">
          <Mark size={40} />
          <div>
            <h1 className="text-[22px] font-semibold leading-7 tracking-tight">CRM</h1>
            <p className="text-[13px] text-[var(--cr-muted)]">Your people, companies and deals, kept with your AI agent.</p>
          </div>
        </div>
        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Workspace">
                <input autoFocus value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={input} placeholder="Northwind Studio" />
              </Field>
              <Field label="Your name">
                <input value={owner} onChange={(e) => setOwner(e.target.value)} className={input} placeholder="Sam Rivera" />
              </Field>
              <Field label="Home currency" hint="Totals and forecasts are in it; each deal keeps its own currency.">
                <Select label="Home currency" value={currency} onChange={setCurrency} options={app.currencies.map((c) => ({ value: c.code, label: c.code + ' · ' + c.name }))} />
              </Field>
            </div>
            <Field label="What do you want to track?" group hint="Each is a pipeline with its own stages; add more later.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {KINDS.map((k) => {
                  const on = kinds.includes(k.kind);
                  const Icon = k.icon;
                  return (
                    <button key={k.kind} type="button" aria-pressed={on} onClick={() => setKinds(on ? kinds.filter((x) => x !== k.kind) : [...kinds, k.kind])} className={cn('flex items-start gap-2.5 border px-3 py-2.5 text-left transition-colors', on ? 'border-[var(--cr-ink)] bg-[var(--cr-row)]' : 'border-[var(--cr-line)] hover:bg-[var(--cr-row)]')}>
                      <Icon size={16} className="mt-0.5 shrink-0 text-[var(--cr-ink-2)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-bold">{k.label}</span>
                        <span className="block text-[11.5px] text-[var(--cr-muted)]">{k.sub}</span>
                      </span>
                      <span className={cn('flex size-4 shrink-0 items-center justify-center border', on ? 'border-[var(--cr-ink)] bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'border-[var(--cr-line)]')}>{on && <Check size={11} strokeWidth={3} />}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Btn variant="primary" size="md" loading={busy} disabled={kinds.length === 0} onClick={() => void start()} className="self-start">
              Set up my CRM <ArrowRight size={14} />
            </Btn>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-[15px] font-bold">Bring your people in</h2>
            <p className="text-[12.5px] text-[var(--cr-muted)]">Pick one now; you can do the others any time.</p>
            {[
              {
                icon: Sparkles,
                title: 'Ask your AI agent to fill it from your email and calendar',
                sub: 'It adds the people you actually talk to, their companies and your recent meetings and emails. Newsletters and receipts are skipped.',
                accent: true,
                go: () =>
                  void api
                    .ask('Fill the CRM from my email and calendar of the last 90 days: the people I actually correspond or meet with, their companies, and the interactions.', 'job')
                    .then(() => {
                      toast.success('Asked your AI agent; people appear as it works');
                      finish();
                    })
                    .catch((err: unknown) => toast.error(errMessage(err))),
              },
              { icon: FileUp, title: 'Import a CSV', sub: 'Exports from Google Contacts, LinkedIn, HubSpot, Pipedrive or a spreadsheet. Columns are matched for you.', go: () => (finish(), dlg.openImport('people')) },
              { icon: UserPlus, title: 'Add someone by hand', sub: 'Start with the people who matter this week.', go: () => (finish(), dlg.openNew('person')) },
            ].map((o) => (
              <button key={o.title} type="button" onClick={o.go} className={cn('group flex items-start gap-3 border px-3.5 py-3 text-left transition-colors', o.accent ? 'border-[var(--cr-accent)] bg-[var(--cr-accent-soft)]' : 'border-[var(--cr-line)] hover:bg-[var(--cr-row)]')}>
                <o.icon size={18} className={cn('mt-0.5 shrink-0', o.accent ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-ink-2)]')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold">{o.title}</span>
                  <span className="block text-[12px] leading-[17px] text-[var(--cr-ink-2)]">{o.sub}</span>
                </span>
                <ArrowRight size={15} className="mt-1 shrink-0 text-[var(--cr-muted)] transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
            <Btn variant="ghost" onClick={finish} className="self-start">
              Skip for now
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
