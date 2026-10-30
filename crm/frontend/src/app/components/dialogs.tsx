/**
 * Creation and capture dialogs, opened from anywhere (the New button, the
 * palette, keys, record pages): a person, a company, a deal, logging an
 * interaction, a task, an email, a CSV import. Modals are only for these;
 * everything else is edited in place.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, FileUp, Mail, MessageSquare, Phone, Send, Sparkles, Upload, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errCandidates, errMessage } from '../lib/api.ts';
import { PIPELINE_KIND_LABEL, addDays, today } from '../lib/format.ts';
import { openRecord } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import type { Email, ImportPreview, Obj } from '../lib/types.ts';
import { DateInput, MoneyInput, Picker, RecordPicker, TagsInput } from './controls.tsx';
import { Btn, Field, Modal, Seg, Select, Toggle, area, input } from './ui.tsx';

export interface Target {
  person?: { id: string; name: string } | undefined;
  company?: { id: string; name: string } | undefined;
  deal?: { id: string; name: string } | undefined;
}

interface Dialogs {
  openNew: (kind: 'person' | 'company' | 'deal', defaults?: Record<string, string> | undefined) => void;
  openLog: (target?: Target | undefined, kind?: 'meeting' | 'call' | 'email' | 'message' | undefined) => void;
  openTask: (target?: Target | undefined) => void;
  openEmail: (target?: Target | undefined, draft?: Email | undefined) => void;
  openImport: (object?: Obj | undefined) => void;
}

const Ctx = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useDialogs outside DialogsProvider');
  return v;
}

type Open =
  | { k: 'person'; d: Record<string, string> }
  | { k: 'company'; d: Record<string, string> }
  | { k: 'deal'; d: Record<string, string> }
  | { k: 'log'; t: Target; kind: 'meeting' | 'call' | 'email' | 'message' }
  | { k: 'task'; t: Target }
  | { k: 'email'; t: Target; draft: Email | undefined }
  | { k: 'import'; object: Obj }
  | null;

export function DialogsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  const value = useMemo<Dialogs>(
    () => ({
      openNew: (kind, d) => setOpen({ k: kind, d: d ?? {} }),
      openLog: (t, kind) => setOpen({ k: 'log', t: t ?? {}, kind: kind ?? 'meeting' }),
      openTask: (t) => setOpen({ k: 'task', t: t ?? {} }),
      openEmail: (t, draft) => setOpen({ k: 'email', t: t ?? {}, draft }),
      openImport: (object) => setOpen({ k: 'import', object: object ?? 'people' }),
    }),
    [],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {open?.k === 'person' && <NewPerson defaults={open.d} onClose={close} />}
      {open?.k === 'company' && <NewCompany defaults={open.d} onClose={close} />}
      {open?.k === 'deal' && <NewDeal defaults={open.d} onClose={close} />}
      {open?.k === 'log' && <LogInteraction target={open.t} kind={open.kind} onClose={close} />}
      {open?.k === 'task' && <NewTask target={open.t} onClose={close} />}
      {open?.k === 'email' && <Compose target={open.t} draft={open.draft} onClose={close} />}
      {open?.k === 'import' && <ImportCsv object={open.object} onClose={close} />}
    </Ctx.Provider>
  );
}

/* --------------------------------------------------------------- helpers */

function Dupe({ object, cands, onClose }: { object: Obj; cands: { id: string; name: string; deleted: boolean }[]; onClose: () => void }): React.JSX.Element | null {
  if (cands.length === 0) return null;
  return (
    <div className="mt-3 flex items-start gap-2 border border-[var(--cr-line)] bg-[var(--cr-warn-soft)] px-3 py-2 text-[12.5px]">
      <AlertTriangle size={14} className="mt-px shrink-0 text-[var(--cr-warn-text)]" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--cr-warn-text)]">Already in your CRM</p>
        {cands.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onClose();
              if (c.deleted) toast.error(c.name + ' is in the trash: restore it from Setup > Trash');
              else openRecord(object, c.id);
            }}
            className="mt-0.5 flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
          >
            Open {c.name} {c.deleted ? '(in the trash)' : ''} <ArrowRight size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}

const CADENCE = [
  { value: '0', label: 'Not tracked' },
  { value: '14', label: 'Every 2 weeks' },
  { value: '30', label: 'Every month' },
  { value: '90', label: 'Every quarter' },
  { value: '180', label: 'Twice a year' },
  { value: '365', label: 'Every year' },
];

/* ---------------------------------------------------------------- person */

function NewPerson({ defaults, onClose }: { defaults: Record<string, string>; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [f, setF] = useState({ name: defaults['name'] ?? '', email: defaults['email'] ?? '', title: '', phone: '', linkedin: '', lead_source: '', how_met: '', keep: String(app.settings?.keep_in_touch_default ?? 0) });
  const [company, setCompany] = useState<{ id: string; name: string }>({ id: defaults['company'] ?? '', name: defaults['company_name'] ?? '' });
  const [tags, setTags] = useState<string[]>([]);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<{ id: string; name: string; deleted: boolean }[]>([]);
  const set = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const save = async (): Promise<void> => {
    if (f.name.trim() === '' && f.email.trim() === '') return void toast.error('Give a name or an email');
    setBusy(true);
    setCands([]);
    try {
      const r = await api.create<{ id: string; name: string }>('people', {
        name: f.name,
        email: f.email || undefined,
        title: f.title || undefined,
        phone: f.phone || undefined,
        linkedin: f.linkedin || undefined,
        lead_source: f.lead_source || undefined,
        how_met: f.how_met || undefined,
        company: company.id || company.name || undefined,
        tags: tags.length ? tags : undefined,
        keep_in_touch: Number(f.keep),
        list: defaults['list'] || undefined,
      });
      const p = r['person'] as { id: string; name: string };
      if (research) await api.research('people', [p.id], '');
      toast.success('Added ' + p.name);
      onClose();
      if (defaults['open'] !== 'no') openRecord('people', p.id);
    } catch (err) {
      setCands(errCandidates(err));
      if (errCandidates(err).length === 0) toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New person"
      width="lg"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-[12px] text-[var(--cr-ink-2)]">
            <Toggle checked={research} onChange={setResearch} label="Research with AI" />
            <Sparkles size={12} className="text-[var(--cr-accent-text)]" /> Research with AI after adding
          </span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Add person
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={input} placeholder="Ada Lovelace" />
        </Field>
        <Field label="Email" hint="A work email finds or adds their company.">
          <input value={f.email} onChange={(e) => set('email', e.target.value)} className={input} placeholder="ada@analytical.io" />
        </Field>
        <Field label="Title">
          <input value={f.title} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Head of Engineering" />
        </Field>
        <Field label="Company" group>
          <RecordPicker object="companies" value={company.id} valueLabel={company.name} onChange={(id, name, created) => setCompany(created ? { id: '', name } : { id, name })} label="Company" placeholder={company.name || 'From the email, or pick one'} create="Add company" />
        </Field>
        <Field label="Phone">
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={input} />
        </Field>
        <Field label="LinkedIn">
          <input value={f.linkedin} onChange={(e) => set('linkedin', e.target.value)} className={input} placeholder="linkedin.com/in/..." />
        </Field>
        <Field label="Source">
          <input value={f.lead_source} onChange={(e) => set('lead_source', e.target.value)} className={input} placeholder="Referral, Event, Inbound ..." />
        </Field>
        <Field label="Keep in touch">
          <Select label="Keep in touch" value={f.keep} onChange={(v) => set('keep', v)} options={CADENCE} />
        </Field>
        <Field label="How you know them" className="sm:col-span-2">
          <input value={f.how_met} onChange={(e) => set('how_met', e.target.value)} className={input} placeholder="Met at the founders dinner in March" />
        </Field>
        <Field label="Tags" group className="sm:col-span-2">
          <TagsInput value={tags} onChange={setTags} />
        </Field>
      </div>
      <Dupe object="people" cands={cands} onClose={onClose} />
    </Modal>
  );
}

/* --------------------------------------------------------------- company */

const SIZES = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'];

function NewCompany({ defaults, onClose }: { defaults: Record<string, string>; onClose: () => void }): React.JSX.Element {
  const [f, setF] = useState({ name: defaults['name'] ?? '', domain: '', industry: '', size: '', location: '', lead_source: '' });
  const [tags, setTags] = useState<string[]>([]);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<{ id: string; name: string; deleted: boolean }[]>([]);
  const set = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const save = async (): Promise<void> => {
    if (f.name.trim() === '' && f.domain.trim() === '') return void toast.error('Give a name or a website');
    setBusy(true);
    setCands([]);
    try {
      const r = await api.create<{ id: string; name: string }>('companies', { name: f.name || undefined, domain: f.domain || undefined, industry: f.industry || undefined, size: f.size || undefined, location: f.location || undefined, lead_source: f.lead_source || undefined, tags: tags.length ? tags : undefined, list: defaults['list'] || undefined });
      const c = r['company'] as { id: string; name: string };
      if (research) await api.research('companies', [c.id], '');
      toast.success('Added ' + c.name);
      onClose();
      openRecord('companies', c.id);
    } catch (err) {
      setCands(errCandidates(err));
      if (errCandidates(err).length === 0) toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New company"
      width="lg"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-[12px] text-[var(--cr-ink-2)]">
            <Toggle checked={research} onChange={setResearch} label="Research with AI" />
            <Sparkles size={12} className="text-[var(--cr-accent-text)]" /> Research with AI after adding
          </span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Add company
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder="Analytical Engines" />
        </Field>
        <Field label="Website" hint="Its domain keeps the company unique.">
          <input value={f.domain} onChange={(e) => set('domain', e.target.value)} className={input} placeholder="analytical.io" />
        </Field>
        <Field label="Industry">
          <input value={f.industry} onChange={(e) => set('industry', e.target.value)} className={input} />
        </Field>
        <Field label="Size">
          <Select label="Size" value={f.size} onChange={(v) => set('size', v)} options={[{ value: '', label: 'Unknown' }, ...SIZES.map((s) => ({ value: s, label: s + ' people' }))]} />
        </Field>
        <Field label="Location">
          <input value={f.location} onChange={(e) => set('location', e.target.value)} className={input} />
        </Field>
        <Field label="Source">
          <input value={f.lead_source} onChange={(e) => set('lead_source', e.target.value)} className={input} />
        </Field>
        <Field label="Tags" group className="sm:col-span-2">
          <TagsInput value={tags} onChange={setTags} />
        </Field>
      </div>
      <Dupe object="companies" cands={cands} onClose={onClose} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ deal */

function NewDeal({ defaults, onClose }: { defaults: Record<string, string>; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const firstPipe = app.pipelines.find((p) => p.id === defaults['pipeline']) ?? app.pipelines[0];
  const [pipeline, setPipeline] = useState(firstPipe?.id ?? '');
  const pipe = app.pipeline(pipeline);
  const openStages = (pipe?.stages ?? []).filter((s) => s.kind === 'open');
  const [stage, setStage] = useState(defaults['stage'] ?? openStages[0]?.id ?? '');
  const [name, setName] = useState(defaults['name'] ?? '');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(pipe?.currency ?? app.home);
  const [close, setClose] = useState('');
  const [company, setCompany] = useState<{ id: string; name: string }>({ id: defaults['company'] ?? '', name: defaults['company_name'] ?? '' });
  const [person, setPerson] = useState<{ id: string; name: string }>({ id: defaults['person'] ?? '', name: defaults['person_name'] ?? '' });
  const [role, setRole] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const roles = pipe?.kind === 'fundraising' ? ['Lead investor', 'Investor', 'Partner', 'Analyst'] : pipe?.kind === 'hiring' ? ['Candidate', 'Referrer', 'Interviewer'] : ['Champion', 'Decision maker', 'Influencer', 'Contact'];
  const save = async (): Promise<void> => {
    if (name.trim() === '') return void toast.error('Give the deal a name');
    setBusy(true);
    try {
      const r = await api.create<{ id: string; name: string }>('deals', {
        name,
        pipeline,
        stage: stage || undefined,
        value: value || undefined,
        currency,
        expected_close: close || undefined,
        company: company.id || company.name || undefined,
        people: person.id ? [{ person: person.id, role }] : undefined,
        next_step: nextStep || undefined,
        lead_source: source || undefined,
      });
      const d = r['deal'] as { id: string; name: string };
      toast.success('Added ' + d.name);
      onClose();
      openRecord('deals', d.id);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New deal"
      width="lg"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Add deal
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder={pipe?.kind === 'fundraising' ? 'Seed round: Acme Ventures' : pipe?.kind === 'hiring' ? 'Senior engineer: Jane Doe' : 'Acme: annual plan'} />
        </Field>
        <Field label="Pipeline">
          <Select
            label="Pipeline"
            value={pipeline}
            onChange={(v) => {
              setPipeline(v);
              const p = app.pipeline(v);
              setStage(p?.stages.find((s) => s.kind === 'open')?.id ?? '');
              setCurrency(p?.currency ?? app.home);
            }}
            options={app.pipelines.map((p) => ({ value: p.id, label: p.name, group: PIPELINE_KIND_LABEL[p.kind] }))}
          />
        </Field>
        <Field label="Stage">
          <Select label="Stage" value={stage} onChange={setStage} options={openStages.map((s) => ({ value: s.id, label: s.name + ' · ' + s.probability + '%' }))} />
        </Field>
        <Field label={pipe?.kind === 'fundraising' ? 'Amount' : 'Value'} group>
          <div className="flex gap-1.5">
            <MoneyInput value={value} onChange={setValue} label="Value" className="flex-1" />
            <Select label="Currency" value={currency} onChange={setCurrency} className="w-24" options={app.currencies.map((c) => ({ value: c.code, label: c.code }))} />
          </div>
        </Field>
        <Field label="Expected close">
          <DateInput value={close} onChange={setClose} label="Expected close" />
        </Field>
        <Field label="Company" group>
          <RecordPicker object="companies" value={company.id} valueLabel={company.name} onChange={(id, n, created) => setCompany(created ? { id: '', name: n } : { id, name: n })} label="Company" create="Add company" />
        </Field>
        <Field label="Person" group>
          <div className="flex gap-1.5">
            <RecordPicker object="people" value={person.id} valueLabel={person.name} onChange={(id, n) => setPerson({ id, name: n })} label="Person" className="min-w-0 flex-1" />
            <Picker value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} label="Role" placeholder="Role" create="Use" className="w-32" />
          </div>
        </Field>
        <Field label="Next step">
          <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} className={input} placeholder="Send the proposal" />
        </Field>
        <Field label="Source">
          <input value={source} onChange={(e) => setSource(e.target.value)} className={input} placeholder="Referral, Inbound ..." />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- interactions */

const KINDS = [
  { value: 'meeting' as const, label: 'Meeting', icon: Users },
  { value: 'call' as const, label: 'Call', icon: Phone },
  { value: 'email' as const, label: 'Email', icon: Mail },
  { value: 'message' as const, label: 'Message', icon: MessageSquare },
];

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function LogInteraction({ target, kind: k0, onClose }: { target: Target; kind: 'meeting' | 'call' | 'email' | 'message'; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [kind, setKind] = useState(k0);
  const [people, setPeople] = useState<{ id: string; name: string }[]>(target.person ? [target.person] : []);
  const [deal, setDeal] = useState<{ id: string; name: string }>(target.deal ?? { id: '', name: '' });
  const [when, setWhen] = useState(localNow());
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [subject, setSubject] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const review = app.settings?.policy.meeting_review === true && (kind === 'meeting' || kind === 'call') && summary.trim().length >= 40;
  const save = async (): Promise<void> => {
    if (people.length === 0 && !target.company && !deal.id) return void toast.error('Say who it was with');
    setBusy(true);
    try {
      const r = await api.logInteraction({
        kind,
        people: people.map((p) => p.id),
        company: people.length === 0 ? target.company?.id : undefined,
        deal: deal.id || undefined,
        at: new Date(when).toISOString(),
        direction: kind === 'email' || kind === 'message' ? direction : undefined,
        subject: subject || undefined,
        summary: summary || undefined,
      });
      toast.success(r.review ? 'Logged. Your AI agent will review it and propose the follow-ups.' : 'Logged');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Log an interaction"
      width="lg"
      footer={
        <>
          {review && (
            <span className="mr-auto flex items-center gap-1.5 text-[12px] text-[var(--cr-accent-text)]">
              <Sparkles size={12} /> Your AI agent will propose deal updates, tasks and a follow-up
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Log it
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((x) => {
            const Icon = x.icon;
            return (
              <button key={x.value} type="button" onClick={() => setKind(x.value)} aria-pressed={kind === x.value} className={cn('inline-flex h-8 items-center gap-1.5 border px-3 text-[12.5px] font-semibold transition-colors', kind === x.value ? 'border-[var(--cr-ink)] bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'border-[var(--cr-line)] hover:bg-[var(--cr-row)]')}>
                <Icon size={14} /> {x.label}
              </button>
            );
          })}
          {(kind === 'email' || kind === 'message') && <Seg value={direction} onChange={setDirection} options={[{ value: 'out', label: 'Sent' }, { value: 'in', label: 'Received' }]} />}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="With" group className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {people.map((p) => (
                <span key={p.id} className="inline-flex h-7 items-center gap-1 bg-[var(--cr-row-hover)] pl-2 pr-1 text-[12.5px] font-semibold">
                  {p.name}
                  <button type="button" aria-label={'Remove ' + p.name} onClick={() => setPeople(people.filter((x) => x.id !== p.id))} className="px-1 text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
                    ×
                  </button>
                </span>
              ))}
              <RecordPicker object="people" value="" onChange={(id, name) => id && !people.some((x) => x.id === id) && setPeople([...people, { id, name }])} label="Add a person" placeholder="Add a person" className="w-56" clearable={false} />
              {target.company && people.length === 0 && <span className="text-[12px] text-[var(--cr-muted)]">or logged on {target.company.name}</span>}
            </div>
          </Field>
          <Field label="Deal" group>
            <RecordPicker object="deals" value={deal.id} valueLabel={deal.name} onChange={(id, name) => setDeal({ id, name })} label="Deal" placeholder="No deal" />
          </Field>
          <Field label="When">
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={cn(input, 'num')} />
          </Field>
          <Field label="Subject" className="sm:col-span-2">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} placeholder={kind === 'meeting' ? 'Pilot scope' : kind === 'call' ? 'Intro call' : 'Re: proposal'} />
          </Field>
          <Field label="What happened" className="sm:col-span-2" hint={app.settings?.policy.meeting_review && (kind === 'meeting' || kind === 'call') ? 'Notes from a meeting or call go to your AI agent, which proposes the deal updates and follow-ups they imply.' : undefined}>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={6} className={area} placeholder="Decisions, numbers, dates, next steps ..." />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ task */

function NewTask({ target, onClose }: { target: Target; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(today());
  const [kind, setKind] = useState('todo');
  const [notes, setNotes] = useState('');
  const [person, setPerson] = useState(target.person ?? { id: '', name: '' });
  const [deal, setDeal] = useState(target.deal ?? { id: '', name: '' });
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (title.trim() === '') return void toast.error('What is the task?');
    setBusy(true);
    try {
      await api.addTask({ title, due: due || undefined, kind, notes: notes || undefined, person: person.id || undefined, company: target.company?.id, deal: deal.id || undefined });
      toast.success('Task added');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const quick = [
    { label: 'Today', v: today() },
    { label: 'Tomorrow', v: addDays(today(), 1) },
    { label: 'Next week', v: addDays(today(), 7) },
    { label: 'No date', v: '' },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      width="md"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} onClick={() => void save()}>
            Add task
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Task">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={input} placeholder="Send the proposal" />
        </Field>
        <Field label="Due" group>
          <div className="flex flex-wrap items-center gap-1.5">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => setDue(q.v)} aria-pressed={due === q.v} className={cn('h-7 border px-2 text-[12px] font-semibold', due === q.v ? 'border-[var(--cr-ink)] bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'border-[var(--cr-line)] hover:bg-[var(--cr-row)]')}>
                {q.label}
              </button>
            ))}
            <DateInput value={due} onChange={setDue} label="Due" className="w-36" />
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <Select label="Kind" value={kind} onChange={setKind} options={[{ value: 'todo', label: 'To do' }, { value: 'follow_up', label: 'Follow up' }, { value: 'call', label: 'Call' }, { value: 'email', label: 'Email' }, { value: 'meeting', label: 'Meeting' }]} />
          </Field>
          <Field label="Person" group>
            <RecordPicker object="people" value={person.id} valueLabel={person.name} onChange={(id, name) => setPerson({ id, name })} label="Person" placeholder="Nobody" />
          </Field>
          <Field label="Deal" group className="sm:col-span-2">
            <RecordPicker object="deals" value={deal.id} valueLabel={deal.name} onChange={(id, name) => setDeal({ id, name })} label="Deal" placeholder="No deal" />
          </Field>
        </div>
        <Field label="Details">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={area} />
        </Field>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- email */

function Compose({ target, draft, onClose }: { target: Target; draft: Email | undefined; onClose: () => void }): React.JSX.Element {
  const [to, setTo] = useState(draft?.to ?? '');
  const [cc, setCc] = useState(draft?.cc ?? '');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [busy, setBusy] = useState<'' | 'save' | 'send'>('');
  const id = useRef(draft?.id ?? '');
  const ensure = async (): Promise<string> => {
    if (id.current !== '') {
      await api.updateEmail(id.current, { to, cc, subject, body });
      return id.current;
    }
    const r = await api.draftEmail({ to: to || undefined, cc: cc || undefined, subject, body, person: target.person?.id ?? draft?.person?.id, deal: target.deal?.id ?? draft?.deal?.id });
    id.current = r.email.id;
    if (to === '') setTo(r.email.to);
    return r.email.id;
  };
  const save = async (): Promise<void> => {
    setBusy('save');
    try {
      await ensure();
      toast.success('Draft saved');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const send = async (): Promise<void> => {
    setBusy('send');
    try {
      const eid = await ensure();
      const r = await api.sendEmail(eid);
      toast.success(r.asked ? 'Sent to your AI agent to deliver from your email' : 'Queued; your AI agent sends it when it is next available');
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const mailto = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + (cc ? '&cc=' + encodeURIComponent(cc) : '') + '&body=' + encodeURIComponent(body);
  return (
    <Modal
      open
      onClose={onClose}
      title={draft ? 'Draft email' : 'New email'}
      description={target.person ? 'To ' + target.person.name + (target.deal ? ' about ' + target.deal.name : '') : undefined}
      width="lg"
      footer={
        <>
          <a href={mailto} className="mr-auto text-[12px] font-semibold text-[var(--cr-ink-2)] underline-offset-2 hover:underline">
            Open in my mail app instead
          </a>
          <Btn onClick={() => void save()} loading={busy === 'save'}>
            Save draft
          </Btn>
          <Btn variant="primary" icon={Send} loading={busy === 'send'} onClick={() => void send()}>
            Send
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="To" hint={target.person && to === '' ? 'Their primary email when left empty' : undefined}>
          <input value={to} onChange={(e) => setTo(e.target.value)} className={input} placeholder={target.person ? 'Their primary email' : 'name@company.com'} />
        </Field>
        <Field label="Cc">
          <input value={cc} onChange={(e) => setCc(e.target.value)} className={input} />
        </Field>
        <Field label="Subject">
          <input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
        </Field>
        <Field label="Message">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={area} />
        </Field>
        <p className="text-[11.5px] text-[var(--cr-muted)]">Your AI agent sends it from your connected email account and logs it on the person.</p>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- import */

const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  first_name: 'First name',
  last_name: 'Last name',
  emails: 'Email',
  phones: 'Phone',
  title: 'Title',
  company: 'Company',
  linkedin: 'LinkedIn',
  location: 'Location',
  birthday: 'Birthday',
  how_met: 'How you know them',
  source: 'Source',
  tags: 'Tags',
  note: 'Note',
  domains: 'Website',
  industry: 'Industry',
  size: 'Size',
  description: 'Description',
  pipeline: 'Pipeline',
  stage: 'Stage',
  value: 'Value',
  currency: 'Currency',
  expected_close: 'Expected close',
  person: 'Contact',
  next_step: 'Next step',
};

function ImportCsv({ object: o0, onClose }: { object: Obj; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const [object, setObject] = useState<Obj>(o0);
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const preview = async (text: string, obj: Obj, map?: string[]): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.importPreview(obj, text, map);
      setPv(r);
      setMapping(r.mapping);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const load = async (f: File): Promise<void> => {
    const text = await f.text();
    setCsv(text);
    setFile(f.name);
    await preview(text, object);
  };
  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.importApply({ object, csv, mapping, overwrite, list: list || undefined, file_name: file });
      toast.success(`Imported: ${r.created} new, ${r.updated} updated` + (r.skipped ? `, ${r.skipped} skipped` : ''));
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const lists = app.lists.filter((l) => l.object === object);
  const ACTION: Record<string, { label: string; tone: string }> = { create: { label: 'New', tone: 'text-[var(--cr-pos-text)]' }, update: { label: 'Update', tone: 'text-[var(--cr-ink-2)]' }, skip: { label: 'Skip', tone: 'text-[var(--cr-muted)]' }, conflict: { label: 'Check', tone: 'text-[var(--cr-warn-text)]' } };
  return (
    <Modal
      open
      onClose={onClose}
      title="Import from CSV"
      description="People are matched on email, companies on website or name: matches are updated, the rest added. The import is one change you can undo."
      width="xl"
      footer={
        pv !== null ? (
          <>
            <span className="mr-auto text-[12px] text-[var(--cr-ink-2)]">
              {pv.counts.create} new · {pv.counts.update} to update · {pv.counts.skip + pv.counts.conflict} skipped
            </span>
            <Btn onClick={() => (setPv(null), setCsv(''))}>Choose another file</Btn>
            <Btn variant="primary" icon={Upload} loading={busy} onClick={() => void apply()}>
              Import {pv.counts.create + pv.counts.update} {object}
            </Btn>
          </>
        ) : undefined
      }
    >
      {pv === null ? (
        <div className="flex flex-col gap-3">
          <Seg
            value={object}
            onChange={(v) => setObject(v)}
            options={[
              { value: 'people', label: 'People' },
              { value: 'companies', label: 'Companies' },
              { value: 'deals', label: 'Deals' },
            ]}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void load(f);
            }}
            className="flex h-40 flex-col items-center justify-center gap-2 border border-dashed border-[var(--cr-line)] text-[12.5px] text-[var(--cr-ink-2)] transition-colors hover:bg-[var(--cr-row)]"
          >
            <FileUp size={22} className="text-[var(--cr-muted)]" />
            <span className="font-semibold">Drop a CSV here or choose a file</span>
            <span className="text-[11.5px] text-[var(--cr-muted)]">Exports from Google Contacts, LinkedIn, HubSpot, Pipedrive, a spreadsheet ...</span>
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv,.tsv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto border border-[var(--cr-line)]">
            <table className="cr-table">
              <thead>
                <tr>
                  <th>Column in the file</th>
                  <th>Goes to</th>
                  <th>First value</th>
                </tr>
              </thead>
              <tbody>
                {pv.headers.map((h, i) => (
                  <tr key={h + i}>
                    <td className="font-semibold">{h}</td>
                    <td className="w-[220px]">
                      <Select
                        small
                        label={'Field for ' + h}
                        value={mapping[i] ?? ''}
                        onChange={(v) => {
                          const m = mapping.slice();
                          m[i] = v;
                          setMapping(m);
                          void preview(csv, object, m);
                        }}
                        options={[{ value: '', label: 'Skip this column' }, ...pv.fields.map((f) => ({ value: f, label: FIELD_LABEL[f] ?? (f.startsWith('custom.') ? (app.fields.find((x) => x.key === f.slice(7))?.label ?? f) : f) }))]}
                      />
                    </td>
                    <td className="max-w-0 truncate text-[var(--cr-muted)]">{pv.sample.find((s) => s.values[mapping[i] ?? ''] !== undefined)?.values[mapping[i] ?? ''] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[12.5px]">
            {object !== 'deals' && (
              <label className="flex items-center gap-2">
                <Toggle checked={overwrite} onChange={setOverwrite} label="Replace existing values" /> Replace values already in the CRM (otherwise only empty fields are filled)
              </label>
            )}
            {object !== 'deals' && lists.length > 0 && (
              <Select small label="Add to list" value={list} onChange={setList} className="w-48" options={[{ value: '', label: 'Do not add to a list' }, ...lists.map((l) => ({ value: l.id, label: 'Add to ' + l.name }))]} />
            )}
          </div>
          <div className="max-h-[240px] overflow-y-auto border border-[var(--cr-line)]">
            <table className="cr-table">
              <thead>
                <tr>
                  <th className="w-[70px]">Row</th>
                  <th className="w-[80px]">Action</th>
                  <th>Values</th>
                </tr>
              </thead>
              <tbody>
                {pv.sample.map((s) => (
                  <tr key={s.row}>
                    <td className="num text-[var(--cr-muted)]">{s.row}</td>
                    <td className={cn('font-semibold', ACTION[s.action]?.tone)}>{ACTION[s.action]?.label}</td>
                    <td className="max-w-0 truncate">
                      {Object.values(s.values).join(' · ')}
                      {s.note && <span className="ml-2 text-[var(--cr-muted)]">{s.action === 'update' ? '→ ' + s.note : s.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

