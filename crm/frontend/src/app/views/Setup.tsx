/**
 * Setup: the workspace, pipelines and their stages, custom fields, lists,
 * currencies, what the AI agent may do, import and export, duplicates and
 * the trash.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, Building2, Copy, Download, FileUp, Globe, Kanban, ListChecks, Plus, RefreshCw, RotateCcw, Shapes, Sparkles, Trash2, Users, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { PIPELINE_KIND_LABEL, day, money, parseMoney, since, stageColor, toDecimal } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Obj, Pipeline, Stage } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { Avatar, CompanyMark, Dot, MoneyInput, Tabs } from '../components/controls.tsx';
import { Btn, Chip, Empty, Field, IconBtn, Menu, Modal, Select, Spinner, Toggle, area, input, useConfirm } from '../components/ui.tsx';

type Tab = 'workspace' | 'pipelines' | 'fields' | 'lists' | 'agent' | 'currencies' | 'data' | 'duplicates' | 'trash';

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'workspace', label: 'Workspace', icon: Globe },
  { value: 'pipelines', label: 'Pipelines', icon: Kanban },
  { value: 'fields', label: 'Fields', icon: Shapes },
  { value: 'lists', label: 'Lists', icon: ListChecks },
  { value: 'agent', label: 'AI agent', icon: Sparkles },
  { value: 'currencies', label: 'Currencies', icon: RefreshCw },
  { value: 'data', label: 'Import and export', icon: FileUp },
  { value: 'duplicates', label: 'Duplicates', icon: Copy },
  { value: 'trash', label: 'Trash', icon: Trash2 },
];

function Section({ title, sub, children, action }: { title: string; sub?: string | undefined; children: React.ReactNode; action?: React.ReactNode | undefined }): React.JSX.Element {
  return (
    <section className="cr-rise border-b border-[var(--cr-line)] px-5 py-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-bold">{title}</h3>
          {sub !== undefined && <p className="mt-0.5 max-w-[640px] text-[12px] leading-[17px] text-[var(--cr-muted)]">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- workspace */

function Workspace(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const [f, setF] = useState({ workspace: s?.workspace ?? '', owner_name: s?.owner_name ?? '', home_currency: s?.home_currency ?? 'USD', keep: String(s?.keep_in_touch_default ?? 0) });
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.updateSettings({ workspace: f.workspace, owner_name: f.owner_name, home_currency: f.home_currency, keep_in_touch_default: Number(f.keep) });
      toast.success('Saved');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Workspace" sub="Your company and you. The home currency is what totals and forecasts are in; deals keep their own currency.">
      <div className="grid max-w-[640px] grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Workspace">
          <input value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value })} className={input} />
        </Field>
        <Field label="Your name">
          <input value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} className={input} />
        </Field>
        <Field label="Home currency">
          <Select label="Home currency" value={f.home_currency} onChange={(v) => setF({ ...f, home_currency: v })} options={app.currencies.map((c) => ({ value: c.code, label: c.code + ' · ' + c.name }))} />
        </Field>
        <Field label="Keep in touch with new people" hint="A default cadence; set it per person too.">
          <Select
            label="Default cadence"
            value={f.keep}
            onChange={(v) => setF({ ...f, keep: v })}
            options={[
              { value: '0', label: 'Not tracked' },
              { value: '30', label: 'Every month' },
              { value: '90', label: 'Every quarter' },
              { value: '180', label: 'Twice a year' },
            ]}
          />
        </Field>
      </div>
      <Btn variant="primary" className="mt-3" loading={busy} onClick={() => void save()}>
        Save
      </Btn>
    </Section>
  );
}

/* --------------------------------------------------------------- pipelines */

function StageRow({ s, p, first, last }: { s: Stage; p: Pipeline; first: boolean; last: boolean }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const upd = (patch: Record<string, unknown>): void => {
    api.updateStage(s.id, patch).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const reorder = (dir: -1 | 1): void => {
    const ids = p.stages.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    api.reorderStages(p.id, ids).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <tr>
      <td className="w-[28px]">
        <Menu
          align="left"
          trigger={(_, t) => (
            <button type="button" onClick={t} aria-label="Color" className="flex size-5 items-center justify-center hover:bg-[var(--cr-row)]">
              <Dot color={stageColor(s.color, s.kind)} size={10} />
            </button>
          )}
          items={['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => ({ label: c.toUpperCase(), swatch: stageColor(c), onClick: () => upd({ color: c }) }))}
        />
      </td>
      <td>
        <input defaultValue={s.name} onBlur={(e) => e.target.value.trim() !== s.name && upd({ name: e.target.value })} className={cn(input, 'h-6 font-semibold')} aria-label="Stage name" />
      </td>
      <td className="w-[110px]">
        <Select small label="Kind" value={s.kind} onChange={(v) => upd({ kind: v })} options={[{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
      </td>
      <td className="w-[90px]">
        <span className="flex items-center gap-1">
          <input defaultValue={String(s.probability)} onBlur={(e) => Number(e.target.value) !== s.probability && upd({ probability: e.target.value })} className={cn(input, 'num h-6 w-14 text-right')} aria-label="Probability" />%
        </span>
      </td>
      <td className="w-[100px]">
        <span className="flex items-center gap-1">
          <input defaultValue={String(s.rot_days)} disabled={s.kind !== 'open'} onBlur={(e) => Number(e.target.value) !== s.rot_days && upd({ rot_days: e.target.value })} className={cn(input, 'num h-6 w-14 text-right')} aria-label="Rotting days" />d
        </span>
      </td>
      <td className="w-[100px]">
        <span className="flex items-center gap-1">
          <input defaultValue={String(s.target_days)} disabled={s.kind !== 'open'} onBlur={(e) => Number(e.target.value) !== s.target_days && upd({ target_days: e.target.value })} className={cn(input, 'num h-6 w-14 text-right')} aria-label="Target days" />d
        </span>
      </td>
      <td className="w-[96px] r">
        {confirmEl}
        <span className="inline-flex">
          <IconBtn icon={ArrowUp} label="Move up" size={22} disabled={first} onClick={() => reorder(-1)} />
          <IconBtn icon={ArrowDown} label="Move down" size={22} disabled={last} onClick={() => reorder(1)} />
          <IconBtn
            icon={Trash2}
            label="Delete stage"
            size={22}
            onClick={() =>
              void confirm('Deals in this stage move to another stage first.', 'Delete ' + s.name + '?', 'Continue').then((ok) => {
                if (ok) setMoveTo(p.stages.find((x) => x.id !== s.id)?.id ?? '');
              })
            }
          />
        </span>
        {moveTo !== null && (
          <Modal
            open
            width="sm"
            onClose={() => setMoveTo(null)}
            title={'Delete ' + s.name}
            footer={
              <>
                <Btn onClick={() => setMoveTo(null)}>Cancel</Btn>
                <Btn
                  variant="primary"
                  onClick={() => {
                    const to = moveTo;
                    setMoveTo(null);
                    api
                      .deleteStage(s.id, to || undefined)
                      .then(() => toast.success('Deleted'))
                      .catch((err: unknown) => toast.error(errMessage(err)));
                  }}
                >
                  Delete
                </Btn>
              </>
            }
          >
            <Field label="Move its deals to">
              <Select label="Move to" value={moveTo} onChange={setMoveTo} options={p.stages.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
          </Modal>
        )}
      </td>
    </tr>
  );
}

/** A fundraising pipeline's target (the round size): committed against it shows on the board. */
function TargetInput({ p }: { p: Pipeline }): React.JSX.Element {
  const [v, setV] = useState(p.target ? toDecimal(p.target, p.currency) : '');
  const save = (): void => {
    const minor = v.trim() === '' ? 0 : parseMoney(v, p.currency);
    if (minor === null) return void toast.error('The target is a number');
    if (minor === p.target) return;
    api
      .updatePipeline(p.id, { target: v.trim() === '' ? '0' : toDecimal(minor, p.currency) })
      .then(() => toast.success('Target saved'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-[var(--cr-ink-2)]" onBlur={save}>
      Round target
      <MoneyInput value={v} onChange={setV} onEnter={save} className="h-7 w-32" label="Round target" />
    </span>
  );
}

function Pipelines(): React.JSX.Element {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('sales');
  const [name, setName] = useState('');
  const [confirmEl, confirm] = useConfirm();
  const all = useLive(() => api.pipelines(true), ['pipelines', 'stages', 'deals'], [], 300);
  const list = all.data?.pipelines ?? app.pipelines;
  return (
    <>
      {confirmEl}
      <Section
        title="Pipelines"
        sub="Each process with its stages: probability (for the weighted forecast), when a quiet deal starts rotting, and a target time in the stage. Every pipeline has a won and a lost stage."
        action={
          <Btn size="sm" icon={Plus} onClick={() => setAdding(true)}>
            New pipeline
          </Btn>
        }
      >
        <div className="flex flex-col gap-4">
          {list.map((p) => (
            <div key={p.id} className={cn('overflow-hidden border border-[var(--cr-line)]', p.archived && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cr-line)] bg-[var(--cr-row)] px-3 py-2">
                <Kanban size={14} className="text-[var(--cr-ink-2)]" />
                <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() !== p.name && void api.updatePipeline(p.id, { name: e.target.value }).catch((err: unknown) => toast.error(errMessage(err)))} className={cn(input, 'h-7 w-48 font-bold')} aria-label="Pipeline name" />
                <Chip>{PIPELINE_KIND_LABEL[p.kind]}</Chip>
                <span className="text-[12px] text-[var(--cr-muted)]">{p.open_deals} open</span>
                <span className="flex-1" />
                <Select small label="Currency" value={p.currency} onChange={(v) => void api.updatePipeline(p.id, { currency: v }).catch((err: unknown) => toast.error(errMessage(err)))} className="w-24" options={app.currencies.map((c) => ({ value: c.code, label: c.code }))} />
                {p.kind === 'fundraising' && <TargetInput p={p} />}
                <Btn size="xs" variant="ghost" onClick={() => void api.updatePipeline(p.id, { archived: !p.archived }).catch((err: unknown) => toast.error(errMessage(err)))}>
                  {p.archived ? 'Unarchive' : 'Archive'}
                </Btn>
                {p.open_deals === 0 && (
                  <IconBtn
                    icon={Trash2}
                    label="Delete pipeline"
                    onClick={() =>
                      void confirm('An empty pipeline goes for good (undo in Activity).', 'Delete ' + p.name + '?').then((ok) => {
                        if (ok) api.deletePipeline(p.id).catch((err: unknown) => toast.error(errMessage(err)));
                      })
                    }
                  />
                )}
              </div>
              <table className="cr-table">
                <thead>
                  <tr>
                    <th />
                    <th>Stage</th>
                    <th>Kind</th>
                    <th>Probability</th>
                    <th title="Days without any activity before a deal turns stale">Rots after</th>
                    <th title="How long a deal should stay in this stage">Target</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.stages.map((s, i) => (
                    <StageRow key={s.id} s={s} p={p} first={i === 0} last={i === p.stages.length - 1} />
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2">
                <Btn size="xs" variant="ghost" icon={Plus} onClick={() => void api.createStage({ pipeline: p.id, name: 'New stage' }).catch((err: unknown) => toast.error(errMessage(err)))}>
                  Add a stage
                </Btn>
              </div>
            </div>
          ))}
        </div>
      </Section>
      {adding && (
        <Modal
          open
          width="sm"
          onClose={() => setAdding(false)}
          title="New pipeline"
          footer={
            <>
              <Btn onClick={() => setAdding(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  void api
                    .createPipeline({ kind, name: name || undefined })
                    .then(() => {
                      setAdding(false);
                      setName('');
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Create
              </Btn>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Template">
              <Select label="Template" value={kind} onChange={setKind} options={[...app.templates.map((t) => ({ value: t.kind, label: t.name + ': ' + t.stages.join(', ') })), { value: 'other', label: 'Simple: New, In progress, Done, Dropped' }]} />
            </Field>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder={app.templates.find((t) => t.kind === kind)?.name ?? 'Pipeline'} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ fields */

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Money' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'One of a list' },
  { value: 'multi_select', label: 'Several of a list' },
  { value: 'checkbox', label: 'Yes or no' },
  { value: 'url', label: 'Link' },
  { value: 'rating', label: 'Rating (1-5)' },
];

function Fields(): React.JSX.Element {
  const app = useApp();
  const [confirmEl, confirm] = useConfirm();
  const [adding, setAdding] = useState<Obj | null>(null);
  const [f, setF] = useState({ label: '', type: 'text', options: '', ai_prompt: '' });
  return (
    <>
      {confirmEl}
      {(['people', 'companies', 'deals'] as Obj[]).map((o) => (
        <Section
          key={o}
          title={o === 'people' ? 'People' : o === 'companies' ? 'Companies' : 'Deals'}
          sub={o === 'people' ? 'Your own fields next to the built-in ones. An instruction for the AI agent lets it fill a field when it researches someone.' : undefined}
          action={
            <Btn size="sm" icon={Plus} onClick={() => setAdding(o)}>
              New field
            </Btn>
          }
        >
          {app.fieldsOf(o).length === 0 ? (
            <p className="text-[12.5px] text-[var(--cr-muted)]">No custom fields.</p>
          ) : (
            <ul className="divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
              {app.fieldsOf(o).map((x) => (
                <li key={x.id} className="flex items-start gap-3 px-3 py-2 text-[12.5px]">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="font-semibold">{x.label}</span>
                      <Chip>{FIELD_TYPES.find((t) => t.value === x.type)?.label ?? x.type}</Chip>
                      <code className="text-[11px] text-[var(--cr-muted)]">custom.{x.key}</code>
                    </p>
                    {x.options.length > 0 && <p className="mt-0.5 text-[12px] text-[var(--cr-ink-2)]">{x.options.join(' · ')}</p>}
                    {x.ai_prompt && (
                      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--cr-accent-text)]">
                        <Sparkles size={11} /> {x.ai_prompt}
                      </p>
                    )}
                  </div>
                  <IconBtn
                    icon={Trash2}
                    label="Delete field"
                    size={24}
                    onClick={() =>
                      void confirm('Its values are kept and come back if you add the field again with the same key.', 'Delete ' + x.label + '?').then((ok) => {
                        if (ok) api.deleteField(x.id).catch((err: unknown) => toast.error(errMessage(err)));
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}
      {adding !== null && (
        <Modal
          open
          width="md"
          onClose={() => setAdding(null)}
          title={'New field on ' + adding}
          footer={
            <>
              <Btn onClick={() => setAdding(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() =>
                  void api
                    .createField({ object: adding, label: f.label, type: f.type, options: f.options.split(',').map((x) => x.trim()).filter(Boolean), ai_prompt: f.ai_prompt })
                    .then(() => {
                      setAdding(null);
                      setF({ label: '', type: 'text', options: '', ai_prompt: '' });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Add field
              </Btn>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Label">
              <input autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className={input} placeholder={adding === 'people' ? 'Tier, Investor type, Timezone ...' : adding === 'companies' ? 'Funding stage, ARR ...' : 'Contract length ...'} />
            </Field>
            <Field label="Type">
              <Select label="Type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={FIELD_TYPES} />
            </Field>
            {(f.type === 'select' || f.type === 'multi_select') && (
              <Field label="Options" hint="Separated by commas">
                <input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} className={input} placeholder="Gold, Silver, Bronze" />
              </Field>
            )}
            <Field label="Instruction for the AI agent" hint="How to fill it when researching. Leave empty to fill it yourself.">
              <textarea value={f.ai_prompt} onChange={(e) => setF({ ...f, ai_prompt: e.target.value })} rows={2} className={area} placeholder="The company's latest funding round, from their website or press" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- lists */

function Lists(): React.JSX.Element {
  const app = useApp();
  const [confirmEl, confirm] = useConfirm();
  return (
    <Section title="Lists" sub="Lighter processes over people or companies: Investors, Community, Advisors, Targets. A person can be in many.">
      {confirmEl}
      {app.lists.length === 0 ? (
        <Empty icon={ListChecks} title="No lists yet" className="h-auto py-6">
          Create one from the sidebar of People or Companies.
        </Empty>
      ) : (
        <ul className="divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
          {app.lists.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
              <Menu
                align="left"
                trigger={(_, t) => (
                  <button type="button" onClick={t} aria-label="Color" className="flex size-5 items-center justify-center hover:bg-[var(--cr-row)]">
                    <Dot color={stageColor(l.color)} size={10} />
                  </button>
                )}
                items={['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => ({ label: c.toUpperCase(), swatch: stageColor(c), onClick: () => void api.updateList(l.id, { color: c }) }))}
              />
              <input defaultValue={l.name} onBlur={(e) => e.target.value.trim() !== l.name && void api.updateList(l.id, { name: e.target.value }).catch((err: unknown) => toast.error(errMessage(err)))} className={cn(input, 'h-7 w-56 font-semibold')} aria-label="List name" />
              <span className="text-[12px] text-[var(--cr-muted)]">
                {l.count} {l.object}
              </span>
              <span className="flex-1" />
              <Btn size="xs" variant="ghost" onClick={() => go(l.object, { list: l.id })}>
                Open
              </Btn>
              <IconBtn icon={Trash2} label="Delete list" size={24} onClick={() => void confirm('The list goes; its ' + l.object + ' stay.', 'Delete ' + l.name + '?').then((ok) => ok && void api.deleteList(l.id).catch((err: unknown) => toast.error(errMessage(err))))} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- AI agent */

function Agent(): React.JSX.Element {
  const app = useApp();
  const pol = app.settings?.policy;
  const kinds = app.settings?.policy_kinds ?? {};
  const [rules, setRules] = useState(pol?.house_rules ?? '');
  if (!pol) return <Spinner />;
  const upd = (patch: Record<string, unknown>): void => {
    api.updatePolicy(patch).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <>
      <Section title="What your AI agent may do directly" sub="It always writes notes, logged interactions, tasks, new records and empty fields itself (marked as its own and revertible). These changes it proposes first unless you make them automatic. Review > History shows how often you accept each kind.">
        <ul className="max-w-[720px] divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
          {Object.keys(kinds).map((k) => (
            <li key={k} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
              <span className="min-w-0 flex-1 font-semibold">{kinds[k]}</span>
              <Select
                small
                label={kinds[k] ?? k}
                value={pol.autonomy[k] ?? 'propose'}
                onChange={(v) => upd({ [k]: v })}
                className="w-56"
                options={[
                  { value: 'propose', label: 'Ask me first (proposal)' },
                  { value: 'auto', label: 'Do it, I can undo it' },
                ]}
              />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Work it does for you">
        <div className="flex max-w-[720px] flex-col gap-3 text-[12.5px]">
          <label className="flex items-start gap-3">
            <Toggle checked={pol.meeting_review} onChange={(v) => upd({ meeting_review: v })} label="Review meetings" />
            <span>
              <b>Review meetings and calls you log.</b> <span className="text-[var(--cr-ink-2)]">It proposes the deal updates your notes imply, adds the follow-up tasks and drafts the follow-up email.</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Toggle checked={pol.auto_research} onChange={(v) => upd({ auto_research: v })} label="Research new records" />
            <span>
              <b>Research the people and companies you add.</b> <span className="text-[var(--cr-ink-2)]">It fills in what is missing (title, company, location, LinkedIn, industry, size) with its sources.</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Toggle checked={pol.daily_brief} onChange={(v) => upd({ daily_brief: v })} label="Daily brief" />
            <span>
              <b>Prepare a brief every morning</b> <span className="text-[var(--cr-ink-2)]">at</span>{' '}
              <select value={pol.brief_hour} onChange={(e) => upd({ brief_hour: Number(e.target.value) })} className={cn(input, 'inline-block h-6 w-20')} aria-label="Hour">
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>{' '}
              <span className="text-[var(--cr-ink-2)]">: who to follow up with, which deals are slipping, drafts where a follow-up is due. It shows under Ask AI.</span>
            </span>
          </label>
        </div>
      </Section>
      <Section title="House rules" sub="Standing instructions it follows in this CRM: how you like emails written, what never to do, who matters most.">
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={6} className={cn(area, 'max-w-[720px]')} placeholder={'Write emails short, warm and in British English.\nNever email investors on weekends.\nTag anyone from a YC company with "yc".'} />
        <Btn className="mt-2" variant="primary" onClick={() => void api.updatePolicy({ house_rules: rules }).then(() => toast.success('Saved')).catch((err: unknown) => toast.error(errMessage(err)))}>
          Save house rules
        </Btn>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------- currencies */

function Currencies(): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.fx(), ['fx_rates', 'deals'], [], 300);
  const [cur, setCur] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const d = live.data;
  return (
    <Section
      title="Currencies"
      sub={'Deals in another currency are valued in ' + app.home + ' at the latest rate while open and frozen when they close. A deal without a rate is left out of totals (never added up raw).'}
      action={
        <Btn
          size="sm"
          icon={RefreshCw}
          loading={busy}
          onClick={() => {
            setBusy(true);
            api
              .fetchRates()
              .then((r) => toast.success(r.stored > 0 ? 'Fetched ' + r.stored + ' rates from the European Central Bank' : 'No deals in other currencies yet'))
              .catch((err: unknown) => toast.error(errMessage(err)))
              .finally(() => setBusy(false));
          }}
        >
          Fetch today's rates
        </Btn>
      }
    >
      {d === null ? (
        <Spinner />
      ) : (
        <div className="flex max-w-[720px] flex-col gap-4">
          {d.in_use.length > 0 && (
            <ul className="divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
              {d.in_use.map((c) => (
                <li key={c.currency} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                  <span className="w-12 font-bold">{c.currency}</span>
                  <span className="flex-1 text-[var(--cr-ink-2)]">{c.deals} deal{c.deals === 1 ? '' : 's'}</span>
                  {c.latest ? (
                    <span className="num">
                      1 {c.currency} = {c.latest} {d.home}
                    </span>
                  ) : (
                    <Chip tone="warn">No rate</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Currency">
              <Select label="Currency" value={cur} onChange={setCur} className="w-28" options={[{ value: '', label: 'Choose' }, ...app.currencies.filter((c) => c.code !== app.home).map((c) => ({ value: c.code, label: c.code }))]} />
            </Field>
            <Field label={'Rate (' + app.home + ' per 1)'}>
              <input value={rate} onChange={(e) => setRate(e.target.value)} className={cn(input, 'num w-32')} placeholder="1.0842" />
            </Field>
            <Btn
              disabled={!cur || !rate}
              onClick={() =>
                void api
                  .setRate(cur, rate)
                  .then(() => {
                    setRate('');
                    toast.success('Saved');
                  })
                  .catch((err: unknown) => toast.error(errMessage(err)))
              }
            >
              Set rate
            </Btn>
          </div>
          {d.rates.length > 0 && (
            <table className="cr-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Currency</th>
                  <th className="r">Rate</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.rates.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td className="num">{day(r.date)}</td>
                    <td className="font-semibold">{r.currency}</td>
                    <td className="r num">{r.rate}</td>
                    <td className="text-[var(--cr-ink-2)]">{r.source === 'ecb' ? 'European Central Bank' : 'Typed in'}</td>
                    <td className="r">
                      <IconBtn icon={X} label="Remove" size={22} onClick={() => void api.deleteRate(r.id).catch((err: unknown) => toast.error(errMessage(err)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------- import / export */

function Data(): React.JSX.Element {
  const dlg = useDialogs();
  const dl = (o: Obj): void => {
    api
      .exportCsv(o, {})
      .then((r) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
        a.download = r.filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <>
      <Section title="Import" sub="From a CSV: exports of Google Contacts, LinkedIn, HubSpot, Pipedrive or a spreadsheet. Columns are matched to fields for you; people are matched on email and companies on website, so nothing is duplicated. One import is one change you can undo.">
        <div className="flex flex-wrap gap-2">
          {(['people', 'companies', 'deals'] as Obj[]).map((o) => (
            <Btn key={o} icon={FileUp} onClick={() => dlg.openImport(o)}>
              Import {o}
            </Btn>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--cr-ink-2)]">
          <Sparkles size={12} className="text-[var(--cr-accent-text)]" /> Or ask your AI agent: "Fill the CRM from my email and calendar of the last 90 days".
        </p>
      </Section>
      <Section title="Export" sub="Everything as CSV, to keep or move elsewhere.">
        <div className="flex flex-wrap gap-2">
          {(['people', 'companies', 'deals'] as Obj[]).map((o) => (
            <Btn key={o} icon={Download} onClick={() => dl(o)}>
              Export {o}
            </Btn>
          ))}
        </div>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- duplicates */

function Duplicates({ object }: { object: 'people' | 'companies' }): React.JSX.Element {
  const live = useLive(() => api.dupes(object), [object, 'interactions'], [object], 400);
  const [confirmEl, confirm] = useConfirm();
  const pairs = live.data?.pairs ?? [];
  return (
    <Section
      title="Likely duplicates"
      sub="Same email or domain, or the same name at the same company or email domain. Merging keeps the left one's values, fills its blanks from the right one and moves everything over; you can undo it."
      action={
        <Select
          small
          label="Which"
          value={object}
          onChange={(v) => setQuery({ object: v })}
          className="w-32"
          options={[
            { value: 'people', label: 'People' },
            { value: 'companies', label: 'Companies' },
          ]}
        />
      }
    >
      {confirmEl}
      {live.data === null ? (
        <Spinner />
      ) : pairs.length === 0 ? (
        <Empty icon={Copy} title="No duplicates found" className="h-auto py-6" />
      ) : (
        <ul className="flex max-w-[860px] flex-col gap-2">
          {pairs.map((p) => (
            <li key={p.a.id + p.b.id} className="flex flex-wrap items-center gap-3 border border-[var(--cr-line)] px-3 py-2 text-[12.5px]">
              {[p.a, p.b].map((r, i) => (
                <button key={r.id} type="button" onClick={() => go(object, { id: r.id })} className="flex min-w-[200px] flex-1 items-center gap-2 text-left">
                  {object === 'people' ? <Avatar name={r.name} size={24} /> : <CompanyMark name={r.name} size={24} />}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {r.name} {i === 0 && <Chip>Keeps</Chip>}
                    </span>
                    <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">{object === 'people' ? r.emails.join(', ') || r.company_name : r.domains.join(', ')}</span>
                  </span>
                </button>
              ))}
              <Chip>{p.reason}</Chip>
              <Btn
                size="xs"
                variant="primary"
                onClick={() =>
                  void confirm('Merge ' + p.b.name + ' into ' + p.a.name + '?', 'Merge', 'Merge').then((ok) => {
                    if (ok)
                      api
                        .merge(object, p.a.id, p.b.id)
                        .then(() => toast.success('Merged (Ctrl+Z to undo)'))
                        .catch((err: unknown) => toast.error(errMessage(err)));
                  })
                }
              >
                Merge
              </Btn>
              <Btn size="xs" variant="ghost" onClick={() => void api.dismissDupe(object, p.a.id, p.b.id).catch((err: unknown) => toast.error(errMessage(err)))}>
                Not the same
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------- trash */

function Trash(): React.JSX.Element {
  const live = useLive(() => api.trash(), ['people', 'companies', 'deals'], [], 300);
  const d = live.data;
  const rows: { o: Obj; id: string; name: string; sub: string; deleted: string; icon: LucideIcon }[] = d
    ? [
        ...d.people.map((p) => ({ o: 'people' as Obj, id: p.id, name: p.name, sub: p.email || p.company_name, deleted: p.deleted, icon: Users })),
        ...d.companies.map((c) => ({ o: 'companies' as Obj, id: c.id, name: c.name, sub: c.domain, deleted: c.deleted, icon: Building2 })),
        ...d.deals.map((x) => ({ o: 'deals' as Obj, id: x.id, name: x.name, sub: x.pipeline_name + ' · ' + money(x.value, x.currency), deleted: x.deleted, icon: Kanban })),
      ].sort((a, b) => (a.deleted < b.deleted ? 1 : -1))
    : [];
  return (
    <Section title="Trash" sub="Deleted people, companies and deals stay here for 90 days with their notes, interactions and tasks, then go for good.">
      {d === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon={Trash2} title="The trash is empty" className="h-auto py-6" />
      ) : (
        <ul className="max-w-[860px] divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
          {rows.map((r) => (
            <li key={r.o + r.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
              <r.icon size={14} className="text-[var(--cr-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">{r.sub}</span>
              </span>
              <span className="text-[11.5px] text-[var(--cr-muted)]">deleted {since(r.deleted)}</span>
              <Btn size="xs" icon={RotateCcw} onClick={() => void api.restore(r.o, r.id).then(() => toast.success('Restored')).catch((err: unknown) => toast.error(errMessage(err)))}>
                Restore
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SetupView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const tab = (TABS.some((t) => t.value === q['tab']) ? q['tab'] : 'workspace') as Tab;
  useReportScreen('setup', null, { tab });
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-[var(--cr-line)] py-1.5 md:block">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setQuery({ tab: t.value }, false)} className={cn('relative flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors', tab === t.value ? 'bg-[var(--cr-row-hover)] font-semibold' : 'hover:bg-[var(--cr-row)]')}>
            {tab === t.value && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 bg-[var(--cr-accent)]" />}
            <t.icon size={14} className={tab === t.value ? '' : 'text-[var(--cr-muted)]'} />
            {t.label}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="border-b border-[var(--cr-line)] px-3 md:hidden">
          <Tabs value={tab} onChange={(v) => setQuery({ tab: v }, false)} tabs={TABS.map((t) => ({ value: t.value, label: t.label }))} className="h-10" />
        </div>
        {tab === 'workspace' && <Workspace />}
        {tab === 'pipelines' && <Pipelines />}
        {tab === 'fields' && <Fields />}
        {tab === 'lists' && <Lists />}
        {tab === 'agent' && <Agent />}
        {tab === 'currencies' && <Currencies />}
        {tab === 'data' && <Data />}
        {tab === 'duplicates' && <Duplicates object={q['object'] === 'companies' ? 'companies' : 'people'} />}
        {tab === 'trash' && <Trash />}
      </div>
    </div>
  );
}

