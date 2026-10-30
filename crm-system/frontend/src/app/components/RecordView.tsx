/**
 * A person, company or deal: the full page and the side peek.
 *
 * The page has two panes that scroll on their own: the main column (header,
 * highlight strip, the deal's stage bar, tabs with Focus above the history)
 * and a details sidebar where every field is edited in place and the AI
 * agent's values carry its mark. The peek is the same record in a 520px
 * panel next to a list or board.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowUpRight, Building2, CalendarClock, Check, Clock, Kanban, ListPlus, Mail, MessageSquarePlus, MoreHorizontal, Plus, RotateCcw, Sparkles, StickyNote, Trash2, Trophy, UserRound, Users, X, XCircle } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { compact, day, money, relDay, since, stageColor, STRENGTH_LABEL, strengthBand } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import type { LiveCollection } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { AnyRecord, Company, Deal, Obj, Person, RecordDetail, Stage } from '../lib/types.ts';
import { useDialogs } from './dialogs.tsx';
import type { Target } from './dialogs.tsx';
import { DetailRow, specsOf } from './fields.tsx';
import { Avatar, CompanyMark, Dot, Heading, ProvMark, RecordPicker, StrengthBars, Tabs, Tag } from './controls.tsx';
import { ProposalCard } from './Proposal.tsx';
import { Timeline } from './Timeline.tsx';
import { Btn, Chip, IconBtn, Menu, Modal, Spinner, input, useConfirm } from './ui.tsx';

const WATCH: LiveCollection[] = ['people', 'companies', 'deals', 'deal_people', 'employments', 'list_entries', 'notes', 'tasks', 'interactions', 'emails', 'proposals', 'stage_events', 'fields'];

function loadOne(object: Obj, id: string): Promise<RecordDetail<AnyRecord>> {
  return (object === 'people' ? api.person(id) : object === 'companies' ? api.company(id) : api.deal(id)) as Promise<RecordDetail<AnyRecord>>;
}

export function targetOf(object: Obj, r: AnyRecord): Target {
  if (object === 'people') {
    const p = r as Person;
    return { person: { id: p.id, name: p.name }, company: p.company ? { id: p.company, name: p.company_name } : undefined };
  }
  if (object === 'companies') return { company: { id: r.id, name: (r as Company).name } };
  const d = r as Deal;
  const first = d.people[0];
  return { deal: { id: d.id, name: d.name }, person: first ? { id: first.id, name: first.name } : undefined, company: d.company ? { id: d.company, name: d.company_name } : undefined };
}

function nameOf(r: AnyRecord): string {
  return (r as Person | Company | Deal).name;
}

/* ------------------------------------------------------------- highlights */

function Cell({ label, children, tone = 'none', title }: { label: string; children: ReactNode; tone?: 'none' | 'neg' | 'pos' | 'warn' | undefined; title?: string | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-[var(--cr-card)] px-3 py-2" title={title}>
      <span className="truncate text-[11px] font-semibold text-[var(--cr-muted)]">{label}</span>
      <span className={cn('flex min-h-5 min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold', tone === 'neg' && 'text-[var(--cr-neg-text)]', tone === 'pos' && 'text-[var(--cr-pos-text)]', tone === 'warn' && 'text-[var(--cr-warn-text)]')}>{children}</span>
    </div>
  );
}

function Highlights({ object, d, cols = 6 }: { object: Obj; d: RecordDetail<AnyRecord>; cols?: number | undefined }): React.JSX.Element {
  const app = useApp();
  const r = d.record;
  let cells: ReactNode[] = [];
  if (object === 'people') {
    const p = r as Person;
    const due = p.next_touch !== '' && p.next_touch <= new Date().toISOString().slice(0, 10);
    cells = [
      <Cell key="s" label="Relationship" title={p.touches + ' interactions in the last year'}>
        <StrengthBars value={p.strength} /> {STRENGTH_LABEL[strengthBand(p.strength)]}
      </Cell>,
      <Cell key="l" label="Last contact">
        {p.last_interaction ? since(p.last_interaction) : <span className="text-[var(--cr-muted)]">Never</span>}
      </Cell>,
      <Cell key="n" label="Keep in touch" tone={due ? 'warn' : 'none'}>
        {p.keep_in_touch > 0 ? (due ? 'Due ' + relDay(p.next_touch) : 'Next ' + relDay(p.next_touch)) : <span className="text-[var(--cr-muted)]">Not tracked</span>}
      </Cell>,
      <Cell key="d" label="Open deals">
        {p.open_deals}
      </Cell>,
      <Cell key="e" label="Email">
        {p.email ? (
          <a href={'mailto:' + p.email} className="truncate hover:underline">
            {p.email}
          </a>
        ) : (
          <span className="text-[var(--cr-muted)]">None</span>
        )}
      </Cell>,
      <Cell key="t" label="Phone">
        {p.phones[0] ? <span className="num truncate">{p.phones[0]}</span> : <span className="text-[var(--cr-muted)]">None</span>}
      </Cell>,
    ];
  } else if (object === 'companies') {
    const c = r as Company;
    cells = [
      <Cell key="s" label="Relationship">
        <StrengthBars value={c.strength} /> {STRENGTH_LABEL[strengthBand(c.strength)]}
      </Cell>,
      <Cell key="l" label="Last contact">
        {c.last_interaction ? since(c.last_interaction) : <span className="text-[var(--cr-muted)]">Never</span>}
      </Cell>,
      <Cell key="p" label="People">
        {c.people}
      </Cell>,
      <Cell key="d" label="Open pipeline">
        <span className="num">{c.open_deals > 0 ? compact(c.pipeline_value, app.home) + ' · ' + c.open_deals : '0'}</span>
      </Cell>,
      <Cell key="i" label="Industry">
        {c.industry || <span className="text-[var(--cr-muted)]">Unknown</span>}
      </Cell>,
      <Cell key="z" label="Size">
        {c.size ? c.size + ' people' : <span className="text-[var(--cr-muted)]">Unknown</span>}
      </Cell>,
    ];
  } else {
    const x = r as Deal;
    cells = [
      <Cell key="v" label="Value" title={x.currency !== app.home && x.home_value !== null ? money(x.home_value, app.home) + ' in ' + app.home : undefined}>
        <span className="num">{money(x.value, x.currency)}</span>
      </Cell>,
      <Cell key="w" label="Weighted" title={x.probability + '% x value'}>
        <span className="num">{x.weighted === null ? 'No rate' : compact(x.weighted, app.home)}</span>
        <span className="text-[11.5px] font-normal text-[var(--cr-muted)]">{x.probability}%</span>
      </Cell>,
      <Cell key="c" label={x.status === 'open' ? 'Expected close' : x.status === 'won' ? 'Won' : 'Lost'} tone={x.status === 'open' && x.expected_close !== '' && x.expected_close < new Date().toISOString().slice(0, 10) ? 'neg' : x.status === 'won' ? 'pos' : 'none'}>
        {x.status === 'open' ? (x.expected_close ? relDay(x.expected_close) : <span className="text-[var(--cr-muted)]">Not set</span>) : day(x.closed_at)}
      </Cell>,
      <Cell key="t" label="In stage" tone={x.over_target ? 'neg' : 'none'} title={x.target_days ? 'Target ' + x.target_days + ' days' : undefined}>
        <span className="num">{x.days_in_stage} d</span>
        {x.target_days > 0 && <span className="text-[11.5px] font-normal text-[var(--cr-muted)]">of {x.target_days}</span>}
      </Cell>,
      <Cell key="a" label="Last activity" tone={x.rotting ? 'neg' : 'none'} title={x.rotting ? 'Rotting: no activity for more than ' + x.rot_days + ' days' : undefined}>
        {x.rotting && <Clock size={12} />}
        {x.idle_days === 0 ? 'today' : x.idle_days + ' d ago'}
      </Cell>,
      <Cell key="n" label="Next step" tone={x.next_state === 'overdue' ? 'neg' : x.next_state === 'none' && x.status === 'open' ? 'warn' : 'none'}>
        {x.next_task ? <span className="truncate">{x.next_task.title}</span> : x.next_step ? <span className="truncate">{x.next_step}</span> : <span className="font-normal text-[var(--cr-muted)]">None</span>}
      </Cell>,
    ];
  }
  return <div className={cn('grid gap-px border-y border-[var(--cr-line)] bg-[var(--cr-line)]', cols === 6 ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3')}>{cells}</div>;
}

/* -------------------------------------------------------------- stage bar */

function StageBar({ deal, stages }: { deal: Deal; stages: Stage[] }): React.JSX.Element {
  const [lost, setLost] = useState(false);
  const [reason, setReason] = useState('');
  const open = stages.filter((s) => s.kind === 'open');
  const idx = open.findIndex((s) => s.id === deal.stage);
  const move = (stage: string): void => {
    api
      .move(deal.id, stage)
      .then(() => toast.success('Moved'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 gap-[3px]" role="list" aria-label="Stages">
        {open.map((s, i) => {
          const passed = deal.status === 'won' || (deal.status === 'open' && i < idx);
          const current = deal.status === 'open' && s.id === deal.stage;
          return (
            <button
              key={s.id}
              type="button"
              role="listitem"
              title={s.name + ' · ' + s.probability + '%' + (s.days ? ' · ' + Math.floor(s.days) + ' days' : '')}
              onClick={() => s.id !== deal.stage && move(s.id)}
              className={cn('group relative flex h-8 min-w-0 flex-1 flex-col justify-center px-2 text-left transition-colors first:rounded-l-[6px] last:rounded-r-[6px]', current ? 'text-[var(--cr-card)]' : passed ? 'text-[var(--cr-ink)]' : 'bg-[var(--cr-row)] text-[var(--cr-muted)] hover:bg-[var(--cr-row-hover)]')}
              style={current ? { background: stageColor(s.color) } : passed ? { background: `color-mix(in oklab, ${stageColor(s.color)} 22%, var(--cr-card))` } : undefined}
            >
              <span className="truncate text-[11.5px] font-bold leading-4">{s.name}</span>
              {(s.days ?? 0) > 0 && <span className="num truncate text-[10.5px] leading-3 opacity-80">{(s.days ?? 0) < 1 ? '<1' : Math.floor(s.days ?? 0)} d</span>}
            </button>
          );
        })}
      </div>
      {deal.status === 'open' ? (
        <div className="flex items-center gap-1.5">
          <Btn size="sm" icon={Trophy} onClick={() => void api.close(deal.id, 'won').then(() => toast.success('Won: ' + deal.name)).catch((err: unknown) => toast.error(errMessage(err)))} className="text-[var(--cr-pos-text)]">
            Won
          </Btn>
          <Btn size="sm" icon={XCircle} onClick={() => setLost(true)}>
            Lost
          </Btn>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Chip tone={deal.status === 'won' ? 'pos' : 'neg'}>
            {deal.status} {day(deal.closed_at, true)}
          </Chip>
          <Btn size="sm" icon={RotateCcw} onClick={() => void api.reopen(deal.id).then(() => toast.success('Reopened')).catch((err: unknown) => toast.error(errMessage(err)))}>
            Reopen
          </Btn>
        </div>
      )}
      {lost && (
        <Modal
          open
          width="sm"
          onClose={() => setLost(false)}
          title={'Mark ' + deal.name + ' lost'}
          footer={
            <>
              <Btn onClick={() => setLost(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setLost(false);
                  void api
                    .close(deal.id, 'lost', reason)
                    .then(() => toast.success('Marked lost'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Mark lost
              </Btn>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-[11.5px] font-semibold text-[var(--cr-ink-2)]">Why was it lost?</span>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder="Went with a competitor, no budget, timing ..." />
          </label>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- composer */

function NoteComposer({ object, id }: { object: Obj; id: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const field = object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal';
  const save = async (): Promise<void> => {
    if (text.trim() === '') return;
    setBusy(true);
    try {
      await api.addNote({ [field]: id, body: text });
      setText('');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[7px] border border-[var(--cr-line)] focus-within:border-[var(--cr-ink-2)]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        rows={text === '' ? 1 : 3}
        placeholder="Write a note... (Ctrl+Enter to save)"
        className="block w-full resize-none rounded-[7px] bg-transparent px-2.5 py-2 text-[12.5px] leading-[18px] outline-none"
        data-note-composer=""
      />
      {text !== '' && (
        <div className="flex justify-end gap-1.5 border-t border-[var(--cr-hair)] px-2 py-1.5">
          <Btn size="xs" variant="ghost" onClick={() => setText('')}>
            Cancel
          </Btn>
          <Btn size="xs" variant="primary" loading={busy} onClick={() => void save()}>
            Add note
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- actions */

function ActionBar({ object, r, compactBar = false }: { object: Obj; r: AnyRecord; compactBar?: boolean | undefined }): React.JSX.Element {
  const d = useDialogs();
  const t = targetOf(object, r);
  const [merge, setMerge] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const research = (): void => {
    if (object === 'deals') return;
    void api
      .research(object, [r.id], '')
      .then((x) => toast.success(x.queued > 0 ? 'Sent to your AI agent to research' : 'Already being researched'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const del = (): void => {
    void confirm(nameOf(r) + ' goes to the trash; you can restore it for 90 days.', 'Move to the trash?', 'Move to trash').then((ok) => {
      if (!ok) return;
      api
        .remove(object, r.id)
        .then(() => {
          toast.success('Moved to the trash (Ctrl+Z to undo)');
          go(object);
        })
        .catch((err: unknown) => toast.error(errMessage(err)));
    });
  };
  const B = ({ icon, label, onClick, hint }: { icon: LucideIcon; label: string; onClick: () => void; hint?: string | undefined }): React.JSX.Element =>
    compactBar ? (
      <IconBtn icon={icon} label={label + (hint ? ' (' + hint + ')' : '')} onClick={onClick} />
    ) : (
      <Btn size="sm" icon={icon} onClick={onClick} title={hint ? label + ' (' + hint + ')' : label}>
        <span className="hidden lg:inline">{label}</span>
      </Btn>
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {confirmEl}
      <B icon={MessageSquarePlus} label="Log" hint="L" onClick={() => d.openLog(t)} />
      {object !== 'companies' && <B icon={Mail} label="Email" hint="E" onClick={() => d.openEmail(t)} />}
      <B icon={CalendarClock} label="Task" hint="T" onClick={() => d.openTask(t)} />
      {object !== 'deals' && (
        <Btn size="sm" icon={Sparkles} onClick={research} className="text-[var(--cr-accent-text)]" title="Your AI agent fills in what is missing, with its sources">
          {!compactBar && <span className="hidden lg:inline">Research</span>}
        </Btn>
      )}
      <Menu
        align="right"
        trigger={(_, toggle) => <IconBtn icon={MoreHorizontal} label="More" onClick={toggle} />}
        items={[
          ...(object === 'people' ? [{ label: 'New deal with ' + nameOf(r), icon: Kanban, onClick: () => d.openNew('deal', { person: r.id, person_name: nameOf(r), company: (r as Person).company, company_name: (r as Person).company_name }) }] : []),
          ...(object === 'companies' ? [{ label: 'New deal with ' + nameOf(r), icon: Kanban, onClick: () => d.openNew('deal', { company: r.id, company_name: nameOf(r) }) }, { label: 'Add a person here', icon: UserRound, onClick: () => d.openNew('person', { company: r.id, company_name: nameOf(r) }) }] : []),
          { label: 'Merge a duplicate into this', icon: Users, onClick: () => setMerge(true) },
          'divider',
          { label: 'Move to the trash', icon: Trash2, danger: true, onClick: del },
        ]}
      />
      {merge && <MergeDialog object={object} r={r} onClose={() => setMerge(false)} />}
    </div>
  );
}

function MergeDialog({ object, r, onClose }: { object: Obj; r: AnyRecord; onClose: () => void }): React.JSX.Element {
  const [other, setOther] = useState({ id: '', name: '' });
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    if (!other.id) return;
    setBusy(true);
    try {
      const x = await api.merge(object, r.id, other.id);
      toast.success('Merged' + (x.filled.length ? ': filled ' + x.filled.join(', ').toLowerCase() : '') + ' (Ctrl+Z to undo)');
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
      width="md"
      onClose={onClose}
      title={'Merge into ' + nameOf(r)}
      description={'Its values stay; empty fields are filled from the duplicate; emails, phones, domains and tags are combined; every note, interaction, task, deal and list moves here. The duplicate goes to the trash and its old links keep working.'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={busy} disabled={!other.id || other.id === r.id} onClick={() => void run()}>
            Merge
          </Btn>
        </>
      }
    >
      <RecordPicker object={object} value={other.id} valueLabel={other.name} onChange={(id, name) => setOther({ id, name })} label="The duplicate" placeholder="Find the duplicate" />
    </Modal>
  );
}

/* ---------------------------------------------------------------- details */

function Details({ object, d }: { object: Obj; d: RecordDetail<AnyRecord> }): React.JSX.Element {
  const app = useApp();
  const r = d.record;
  const specs = specsOf(app, object).filter((s) => !(object === 'deals' && s.key === 'lost_reason' && (r as Deal).status !== 'lost'));
  const builtin = specs.filter((s) => !s.key.startsWith('custom.'));
  const custom = specs.filter((s) => s.key.startsWith('custom.'));
  const listsOf = app.lists.filter((l) => l.object === object);
  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <section>
        <Heading>Details</Heading>
        {builtin.map((s) => (
          <DetailRow key={s.key} object={object} rec={r} spec={s} app={app} />
        ))}
      </section>
      {custom.length > 0 && (
        <section>
          <Heading action={<button type="button" onClick={() => go('setup', { tab: 'fields' })} className="text-[11.5px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">Edit fields</button>}>Custom fields</Heading>
          {custom.map((s) => (
            <DetailRow key={s.key} object={object} rec={r} spec={s} app={app} />
          ))}
        </section>
      )}
      {object !== 'deals' && (
        <section>
          <Heading
            action={
              listsOf.length > 0 ? (
                <Menu
                  align="right"
                  trigger={(_, t) => <IconBtn icon={ListPlus} label="Add to a list" size={22} onClick={t} />}
                  items={listsOf.map((l) => ({ label: l.name, swatch: stageColor(l.color), checked: (d.lists ?? []).some((x) => x.id === l.id), onClick: () => void ((d.lists ?? []).some((x) => x.id === l.id) ? api.removeFromList(l.id, [r.id]) : api.addToList(l.id, [r.id])).catch((err: unknown) => toast.error(errMessage(err))) }))}
                />
              ) : undefined
            }
          >
            Lists
          </Heading>
          <div className="flex flex-wrap gap-1.5">
            {(d.lists ?? []).length === 0 && <span className="text-[12px] text-[var(--cr-muted)]">In no list</span>}
            {(d.lists ?? []).map((l) => (
              <button key={l.id} type="button" onClick={() => go(object, { list: l.id })} className="inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-[var(--cr-line)] px-2 text-[12px] font-semibold hover:bg-[var(--cr-row)]">
                <Dot color={stageColor(l.color)} /> {l.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {object === 'people' && (d.employments ?? []).length > 0 && (
        <section>
          <Heading>Work history</Heading>
          <ol className="flex flex-col gap-1.5">
            {(d.employments ?? []).map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[12.5px]">
                <CompanyMark name={e.company?.name ?? ''} size={20} />
                <div className="min-w-0 flex-1">
                  <button type="button" disabled={!e.company || e.company.deleted} onClick={() => e.company && go('companies', { id: e.company.id })} className="truncate font-semibold hover:underline disabled:hover:no-underline">
                    {e.company?.name ?? 'A deleted company'}
                  </button>
                  <p className="text-[11.5px] text-[var(--cr-muted)]">
                    {e.title || 'No title'} · {e.current ? 'since ' + day(e.start, true) : day(e.start, true) + ' – ' + day(e.end, true)}
                  </p>
                </div>
                {e.current && <Chip>Now</Chip>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="text-[11.5px] text-[var(--cr-muted)]">
        <p>
          Added {day(r.created.slice(0, 10))} {r.prov['first_name']?.by === 'agent' || r.prov['name']?.by === 'agent' ? 'by your AI agent' : r.prov['first_name']?.by === 'import' || r.prov['name']?.by === 'import' ? 'by an import' : ''}
        </p>
        <p>Changed {since(r.updated)}</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

type Tab = 'overview' | 'activity' | 'notes' | 'tasks' | 'emails' | 'people' | 'deals';

function Related({ object, d }: { object: Obj; d: RecordDetail<AnyRecord> }): React.JSX.Element {
  const dl = useDialogs();
  const [add, setAdd] = useState<{ id: string; name: string }>({ id: '', name: '' });
  const [role, setRole] = useState('');
  if (object === 'deals') {
    const deal = d.record as Deal;
    return (
      <div className="flex flex-col gap-3">
        <ul className="divide-y divide-[var(--cr-hair)] rounded-[7px] border border-[var(--cr-line)]">
          {(d.people ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar name={p.name} size={26} />
              <button type="button" onClick={() => go('people', { id: p.id })} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] font-semibold">{p.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">{[p.title, p.company_name].filter(Boolean).join(' · ') || p.email}</span>
              </button>
              {p.role && <Chip>{p.role}</Chip>}
              <StrengthBars value={p.strength} />
              <IconBtn icon={X} label={'Take ' + p.name + ' off this deal'} size={22} onClick={() => void api.removePerson(deal.id, p.id).catch((err: unknown) => toast.error(errMessage(err)))} />
            </li>
          ))}
          {(d.people ?? []).length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-[var(--cr-muted)]">Nobody on this deal yet</li>}
        </ul>
        <div className="flex flex-wrap items-center gap-1.5">
          <RecordPicker object="people" value={add.id} valueLabel={add.name} onChange={(id, name) => setAdd({ id, name })} label="Person" placeholder="Add a person" className="w-56" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (Champion, Decision maker ...)" className={cn(input, 'w-56')} />
          <Btn
            size="sm"
            icon={Plus}
            disabled={!add.id}
            onClick={() =>
              void api
                .addPerson(deal.id, add.id, role)
                .then(() => {
                  setAdd({ id: '', name: '' });
                  setRole('');
                })
                .catch((err: unknown) => toast.error(errMessage(err)))
            }
          >
            Add
          </Btn>
        </div>
      </div>
    );
  }
  if (object === 'companies') {
    const c = d.record as Company;
    return (
      <div className="flex flex-col gap-3">
        <ul className="divide-y divide-[var(--cr-hair)] rounded-[7px] border border-[var(--cr-line)]">
          {(d.people ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar name={p.name} size={26} />
              <button type="button" onClick={() => go('people', { id: p.id })} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[12.5px] font-semibold">{p.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">{p.title || p.email}</span>
              </button>
              <span className="text-[11.5px] text-[var(--cr-muted)]">{p.last_interaction ? since(p.last_interaction) : 'never'}</span>
              <StrengthBars value={p.strength} />
            </li>
          ))}
          {(d.people ?? []).length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-[var(--cr-muted)]">No people here yet</li>}
        </ul>
        <Btn size="sm" icon={Plus} onClick={() => dl.openNew('person', { company: c.id, company_name: c.name })} className="self-start">
          Add a person
        </Btn>
        {(d.alumni ?? []).length > 0 && (
          <div>
            <Heading>Used to work here</Heading>
            <ul className="flex flex-col gap-1">
              {(d.alumni ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                  <Avatar name={a.name} size={20} />
                  <button type="button" onClick={() => go('people', { id: a.id })} className="font-semibold hover:underline">
                    {a.name}
                  </button>
                  <span className="text-[var(--cr-muted)]">
                    {a.title} · left {day(a.end, true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  return <></>;
}

function DealsList({ object, d }: { object: Obj; d: RecordDetail<AnyRecord> }): React.JSX.Element {
  const dl = useDialogs();
  const r = d.record;
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-[var(--cr-hair)] rounded-[7px] border border-[var(--cr-line)]">
        {(d.deals ?? []).map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => go('deals', { id: x.id })} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--cr-row)]">
              <Dot color={stageColor(x.stage_color, x.stage_kind)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">{x.name}</span>
                <span className="block truncate text-[11.5px] text-[var(--cr-muted)]">
                  {x.pipeline_name} · {x.stage_name}
                  {x.role ? ' · ' + x.role : ''}
                </span>
              </span>
              {x.rotting && <Chip tone="neg">Rotting</Chip>}
              <span className="num text-[12.5px] font-semibold">{money(x.value, x.currency)}</span>
            </button>
          </li>
        ))}
        {(d.deals ?? []).length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-[var(--cr-muted)]">No deals</li>}
      </ul>
      <Btn size="sm" icon={Plus} className="self-start" onClick={() => dl.openNew('deal', object === 'people' ? { person: r.id, person_name: (r as Person).name, company: (r as Person).company, company_name: (r as Person).company_name } : { company: r.id, company_name: (r as Company).name })}>
        New deal
      </Btn>
    </div>
  );
}

function Focus({ object, d }: { object: Obj; d: RecordDetail<AnyRecord> }): React.JSX.Element | null {
  const dl = useDialogs();
  const r = d.record;
  const deal = object === 'deals' ? (r as Deal) : null;
  const items: ReactNode[] = [];
  for (const p of d.proposals) items.push(<ProposalCard key={p.id} p={p} showTarget={false} />);
  if (deal && deal.status === 'open' && deal.next_state === 'none')
    items.push(
      <div key="ns" className="flex items-center gap-2 rounded-[7px] border border-dashed border-[var(--cr-line)] px-3 py-2 text-[12.5px] text-[var(--cr-warn-text)]">
        <CalendarClock size={14} /> No next step on this deal.
        <button type="button" onClick={() => dl.openTask(targetOf(object, r))} className="font-semibold underline-offset-2 hover:underline">
          Add a task
        </button>
      </div>,
    );
  for (const t of d.tasks)
    items.push(
      <div key={t.id} className="flex items-center gap-2.5 rounded-[7px] border border-[var(--cr-line)] px-3 py-2 text-[12.5px]">
        <button type="button" aria-label="Done" onClick={() => void api.completeTask(t.id).catch((err: unknown) => toast.error(errMessage(err)))} className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--cr-line)] hover:border-[var(--cr-ink-2)]">
          <Check size={10} className="opacity-0 hover:opacity-60" />
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold">{t.title}</span>
        {t.by === 'agent' && <Sparkles size={12} className="text-[var(--cr-accent-text)]" />}
        <span className={cn('text-[11.5px]', t.state === 'overdue' ? 'font-semibold text-[var(--cr-neg-text)]' : 'text-[var(--cr-muted)]')}>{t.due ? relDay(t.due) : 'no date'}</span>
      </div>,
    );
  for (const n of d.pinned)
    items.push(
      <div key={n.id} className="rounded-[7px] border border-[var(--cr-line)] bg-[var(--cr-row)] px-3 py-2 text-[12.5px]">
        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">
          <StickyNote size={11} /> Pinned
        </p>
        <p className="cr-prose leading-[18px]">{n.body}</p>
      </div>,
    );
  if (items.length === 0) return null;
  return (
    <section>
      <Heading>Focus</Heading>
      <div className="flex flex-col gap-2">{items}</div>
    </section>
  );
}

function Body({ object, d, tab }: { object: Obj; d: RecordDetail<AnyRecord>; tab: Tab }): React.JSX.Element {
  const r = d.record;
  const dl = useDialogs();
  const tl = useLive(() => api.timeline(object, r.id), WATCH, [object, r.id], 300);
  const items = tl.data?.items ?? [];
  if (tl.data === null) return <Spinner className="mx-auto my-8" />;
  if (tab === 'overview')
    return (
      <div className="flex flex-col gap-4">
        <Focus object={object} d={d} />
        <NoteComposer object={object} id={r.id} />
        <section>
          <Heading>History</Heading>
          <Timeline items={items.slice(0, 20)} showTarget={object !== 'deals'} />
        </section>
      </div>
    );
  if (tab === 'activity') return <Timeline items={items} showTarget={object !== 'deals'} />;
  if (tab === 'notes')
    return (
      <div className="flex flex-col gap-3">
        <NoteComposer object={object} id={r.id} />
        <Timeline items={items.filter((i) => i.type === 'note')} empty="No notes yet." />
      </div>
    );
  if (tab === 'tasks')
    return (
      <div className="flex flex-col gap-3">
        <Btn size="sm" icon={Plus} className="self-start" onClick={() => dl.openTask(targetOf(object, r))}>
          New task
        </Btn>
        <Timeline items={items.filter((i) => i.type === 'task')} empty="No tasks yet." />
      </div>
    );
  if (tab === 'emails')
    return (
      <div className="flex flex-col gap-3">
        <Btn size="sm" icon={Mail} className="self-start" onClick={() => dl.openEmail(targetOf(object, r))}>
          New email
        </Btn>
        <Timeline items={items.filter((i) => i.type === 'email' || (i.type === 'interaction' && i.interaction.kind === 'email'))} empty="No emails yet." />
      </div>
    );
  if (tab === 'deals') return <DealsList object={object} d={d} />;
  return <Related object={object} d={d} />;
}

function Header({ object, d, peek = false, onClose }: { object: Obj; d: RecordDetail<AnyRecord>; peek?: boolean | undefined; onClose?: (() => void) | undefined }): React.JSX.Element {
  const r = d.record;
  let sub: ReactNode = null;
  let mark: ReactNode = null;
  if (object === 'people') {
    const p = r as Person;
    mark = <Avatar name={p.name} size={peek ? 36 : 44} />;
    sub = (
      <>
        {p.title && <span>{p.title}</span>}
        {p.title && p.company && <span className="text-[var(--cr-muted)]">at</span>}
        {p.company && (
          <button type="button" onClick={() => go('companies', { id: p.company })} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <Building2 size={12} /> {p.company_name}
          </button>
        )}
        {p.location && <span className="text-[var(--cr-muted)]">· {p.location}</span>}
      </>
    );
  } else if (object === 'companies') {
    const c = r as Company;
    mark = <CompanyMark name={c.name} size={peek ? 36 : 44} />;
    sub = (
      <>
        {c.domain && (
          <a href={'https://' + c.domain} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {c.domain} <ArrowUpRight size={11} />
          </a>
        )}
        {c.industry && <span className="text-[var(--cr-muted)]">· {c.industry}</span>}
        {c.location && <span className="text-[var(--cr-muted)]">· {c.location}</span>}
      </>
    );
  } else {
    const x = r as Deal;
    mark = (
      <span style={{ width: peek ? 36 : 44, height: peek ? 36 : 44, background: `color-mix(in oklab, ${stageColor(x.stage_color, x.stage_kind)} 18%, var(--cr-card))`, color: stageColor(x.stage_color, x.stage_kind) }} className="flex shrink-0 items-center justify-center rounded-[8px]">
        <Kanban size={peek ? 18 : 20} />
      </span>
    );
    sub = (
      <>
        <span>{x.pipeline_name}</span>
        <span className="text-[var(--cr-muted)]">·</span>
        <span className="inline-flex items-center gap-1 font-semibold">
          <Dot color={stageColor(x.stage_color, x.stage_kind)} /> {x.stage_name}
        </span>
        {x.company && (
          <button type="button" onClick={() => go('companies', { id: x.company })} className="inline-flex items-center gap-1 hover:underline">
            · <Building2 size={12} /> {x.company_name}
          </button>
        )}
      </>
    );
  }
  const researching = (r as Person).agent_state === 'waiting' || (r as Person).agent_state === 'working';
  return (
    <div className={cn('flex items-start gap-3', peek ? 'px-4 pb-3 pt-3' : 'px-4 pb-3 pt-3.5')}>
      {!peek && <IconBtn icon={ArrowLeft} label="Back to the list" onClick={() => go(object)} className="mt-1" />}
      {mark}
      <div className="min-w-0 flex-1">
        <h2 className={cn('flex flex-wrap items-center gap-2 font-bold leading-6', peek ? 'text-[16px]' : 'text-[19px]')}>
          <span className="truncate">{nameOf(r)}</span>
          <ProvMark prov={r.prov['name'] ?? r.prov['first_name']} />
          {r.deleted && <Chip tone="neg">In the trash</Chip>}
          {researching && (
            <Chip tone="accent">
              <Sparkles size={10} className="cr-pulse" /> AI researching
            </Chip>
          )}
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-[var(--cr-ink-2)]">{sub}</p>
        {r.tags.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {r.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {r.deleted ? (
          <Btn size="sm" icon={RotateCcw} onClick={() => void api.restore(object, r.id).then(() => toast.success('Restored')).catch((err: unknown) => toast.error(errMessage(err)))}>
            Restore
          </Btn>
        ) : (
          <ActionBar object={object} r={r} compactBar={peek} />
        )}
        {peek && (
          <>
            <IconBtn icon={ArrowUpRight} label="Open the full page" onClick={() => go(object, { id: r.id })} />
            <IconBtn icon={X} label="Close (Esc)" onClick={onClose ?? (() => setQuery({ peek: undefined }))} />
          </>
        )}
      </div>
    </div>
  );
}

function tabsFor(object: Obj, d: RecordDetail<AnyRecord>): { value: Tab; label: string; count?: number | undefined }[] {
  const t: { value: Tab; label: string; count?: number | undefined }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity' },
    { value: 'notes', label: 'Notes', count: d.counts.notes },
    { value: 'tasks', label: 'Tasks', count: d.tasks.length },
  ];
  if (object !== 'companies') t.push({ value: 'emails', label: 'Emails', count: d.counts.emails });
  if (object === 'companies') t.push({ value: 'people', label: 'People', count: (d.people ?? []).length });
  if (object === 'deals') t.push({ value: 'people', label: 'People', count: (d.people ?? []).length });
  if (object !== 'deals') t.push({ value: 'deals', label: 'Deals', count: (d.deals ?? []).length });
  return t;
}

/** The full page of a record. */
export function RecordPage({ object, id }: { object: Obj; id: string }): React.JSX.Element {
  const live = useLive(() => loadOne(object, id), WATCH, [object, id], 250);
  const [tab, setTab] = useState<Tab>('overview');
  const d = live.data;
  useReportScreen(object, d ? { type: object, id: d.record.id } : null);
  useEffect(() => setTab('overview'), [id]);
  useRecordKeys(object, d?.record ?? null);
  // An old id (a merged record) resolves to the survivor: show its id.
  const resolved = d?.record.id ?? '';
  useEffect(() => {
    if (resolved !== '' && resolved !== id) setQuery({ id: resolved });
  }, [resolved, id]);
  if (live.error !== null && d === null)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-[var(--cr-muted)]">
        <p>{live.error}</p>
        <Btn onClick={() => go(object)}>Back to the list</Btn>
      </div>
    );
  if (d === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Header object={object} d={d} />
        <Highlights object={object} d={d} />
        {object === 'deals' && d.stages && <StageBar deal={d.record as Deal} stages={d.stages} />}
        <div className="sticky top-0 z-10 flex h-10 shrink-0 items-stretch border-b border-[var(--cr-line)] bg-[var(--cr-card)] px-4">
          <Tabs value={tab} onChange={setTab} tabs={tabsFor(object, d)} />
        </div>
        <div className="cr-rise mx-auto w-full max-w-[860px] px-4 py-4" key={tab}>
          <Body object={object} d={d} tab={tab} />
        </div>
      </div>
      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-[var(--cr-line)] lg:block">
        <Details object={object} d={d} />
      </aside>
    </div>
  );
}

/** The record in a side panel next to a list or board. */
export function Peek({ object, id, onClose }: { object: Obj; id: string; onClose: () => void }): React.JSX.Element {
  const live = useLive(() => loadOne(object, id), WATCH, [object, id], 250);
  const d = live.data;
  useReportScreen(object, d ? { type: object, id: d.record.id } : null);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[data-cr-popover]') === null && document.querySelector('[role="dialog"]') === null) onClose();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <aside className="cr-pop fixed inset-0 z-30 flex w-full flex-col bg-[var(--cr-card)] md:static md:z-auto md:w-[520px] md:shrink-0 md:border-l md:border-[var(--cr-line)]" aria-label="Record">
      {d === null ? (
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Header object={object} d={d} peek onClose={onClose} />
          <Highlights object={object} d={d} cols={3} />
          {object === 'deals' && d.stages && <StageBar deal={d.record as Deal} stages={d.stages} />}
          <div className="flex flex-col gap-4 px-4 py-3">
            <Focus object={object} d={d} />
            <PeekTimeline object={object} id={d.record.id} />
          </div>
          <div className="border-t border-[var(--cr-line)]">
            <Details object={object} d={d} />
          </div>
        </div>
      )}
    </aside>
  );
}

function PeekTimeline({ object, id }: { object: Obj; id: string }): React.JSX.Element {
  const tl = useLive(() => api.timeline(object, id), WATCH, [object, id], 300);
  const items = useMemo(() => (tl.data?.items ?? []).slice(0, 8), [tl.data]);
  return (
    <section>
      <Heading action={<button type="button" onClick={() => go(object, { id })} className="text-[11.5px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">All history</button>}>Latest</Heading>
      {tl.data === null ? <Spinner className="mx-auto my-4" /> : <Timeline items={items} showTarget={object !== 'deals'} />}
    </section>
  );
}

/** L log, N note, T task, E email on a record page. */
function useRecordKeys(object: Obj, r: AnyRecord | null): void {
  const d = useDialogs();
  useEffect(() => {
    if (r === null) return;
    const on = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') !== null) return;
      const t = targetOf(object, r);
      if (e.key === 'l') {
        e.preventDefault();
        d.openLog(t);
      } else if (e.key === 't') {
        e.preventDefault();
        d.openTask(t);
      } else if (e.key === 'e' && object !== 'companies') {
        e.preventDefault();
        d.openEmail(t);
      } else if (e.key === 'n') {
        const box = document.querySelector<HTMLTextAreaElement>('[data-note-composer]');
        if (box) {
          e.preventDefault();
          box.focus();
        }
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [object, r, d]);
}

