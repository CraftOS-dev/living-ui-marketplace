/**
 * One job opening: the pipeline board (drag a card to another stage; on a
 * phone, "Move to"), the candidates as a list with bulk move, reject and
 * message, the job post with its place, pay range (a warning where pay
 * transparency law wants it) and team, and the stages. Your AI agent can
 * draft the post; its draft waits in the Inbox.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Briefcase, Check, Eye, FileUp, MessageSquare, MoreHorizontal, PencilLine, Plus, Sparkle, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, IconButton, Input, LoadError, Loading, Menu, MenuItem, MenuLabel, MenuSep, MoneyInput, Notice, PageBody, PageHeader, Panel, Picker, RowCue, Segmented, Select, Tabs, Textarea, confirmAsk, majorParam } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Board } from '../../components/hiring/Board.tsx';
import { CloseDialog, MessageDialog } from '../../components/hiring/dialogs.tsx';
import { AddCandidateDialog, ImportDialog } from '../../components/hiring/forms.tsx';
import { Markdown } from '../../components/hiring/Markdown.tsx';
import { PeoplePicker, StageChain, Status, personItems, statusLabel, usePeople, ToggleRow } from '../../components/hiring/bits.tsx';
import { OpError, errMessage, op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, reshape, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { pickItems, useOrgList } from '../people/data.ts';
import type { CountrySummary } from '../setup/index.tsx';
import type { Application, Board as BoardData, Kit, Opening, Stage, StageKind } from './types.ts';
import { READS } from './types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';

type Tab = 'pipeline' | 'candidates' | 'post' | 'stages';

/* ------------------------------------------------------------ pipeline */

/**
 * Saves of one opening's post run one after another (two at once would
 * each write the record they read and lose the other's fields); Publish
 * waits for the queue, so it publishes what is on screen.
 */
const pendingPost = new Map<string, Promise<unknown>>();

function queueSave<T>(openingId: string, run: () => Promise<T>): Promise<T> {
  const before = pendingPost.get(openingId) ?? Promise.resolve();
  const p = before.catch(() => undefined).then(run);
  pendingPost.set(openingId, p);
  p.finally(() => {
    if (pendingPost.get(openingId) === p) pendingPost.delete(openingId);
  }).catch(() => undefined);
  return p;
}

type Flush = () => Promise<boolean>;

function Pipeline({ opening }: { opening: Opening }): React.JSX.Element {
  const [sort, setSort] = useState<'waiting' | 'applied' | 'name'>('waiting');
  const [closed, setClosed] = useState(false);
  const live = useOp<BoardData>('openings.board', { opening: opening.id, sort, status: closed ? 'closed' : 'active' }, READS, { name: 'hiring.board' });
  const b = live.data;
  const move = async (ids: string[], stage: string): Promise<void> => {
    const r = await act<{ moved: unknown[]; skipped: { name: string; reason: string }[] }>(
      [
        reshape('hiring.board', (d) => {
          const data = d as BoardData;
          const moving = data.columns.flatMap((c) => c.cards).filter((c) => ids.includes(c.application));
          return { ...data, columns: data.columns.map((c) => ({ ...c, cards: c.key === stage ? [...c.cards.filter((x) => !ids.includes(x.application)), ...moving.map((m) => ({ ...m, stage, days_in_stage: 0 }))] : c.cards.filter((x) => !ids.includes(x.application)) })) };
        }),
      ],
      () => op('applications.move', { applications: ids, stage }),
      ['applications', 'hiring_events'],
    );
    if (r !== null && r.skipped.length > 0) toast.info(r.skipped.map((s) => `${s.name}: ${s.reason}`).join('; '));
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={closed ? 'closed' : 'active'} onChange={(v) => setClosed(v === 'closed')} label={t('hiring.show')} size="sm" options={[{ value: 'active', label: tn('hiring.in_process_n', opening.active) }, { value: 'closed', label: tn('hiring.closed_n', opening.hired + opening.rejected + opening.withdrawn) }]} />
        <span className="flex-1" />
        {!closed && <Segmented value={sort} onChange={setSort} label={t('hiring.sort')} size="sm" options={(['waiting', 'applied', 'name'] as const).map((s) => ({ value: s, label: t(`hiring.sort.${s}`) }))} />}
      </div>
      {b === null ? (
        live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
      ) : closed ? (
        <div className="hr-panel min-w-0">
          {b.closed.length === 0 ? (
            <Empty icon={UserMinus} title={t('hiring.none_closed')} />
          ) : (
            <ul className="divide-y divide-[var(--hr-line)]">
              {b.closed.map((c) => (
                <li key={c.application}>
                  <a href={`#/hiring/candidates/${c.candidate}`} className="hr-focus group grid min-h-10 cursor-pointer grid-cols-[minmax(0,1fr)_112px_14px] items-center gap-3 px-4 py-2 hover:bg-[var(--hr-hover)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px_14px]">
                    <span className="hr-wrap min-w-0 text-[13px]">{c.name}</span>
                    <span className="hr-wrap hidden text-[12px] text-[var(--hr-muted)] sm:block">{c.reason}</span>
                    <Status kind="application" status={c.status} />
                    <RowCue />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : b.totals.active === 0 ? (
        <div className="hr-panel">
          <Empty icon={UserPlus} title={t('hiring.board_empty')}>
            {opening.status === 'draft' ? t('hiring.board_empty_draft') : t('hiring.board_empty_text')}
          </Empty>
        </div>
      ) : (
        <Board board={b} canMove={opening.can.edit} onMove={(ids, stage) => void move(ids, stage)} onOpen={(c) => navigate('/hiring/candidates/' + c.candidate, { application: c.application })} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- candidates */

function CandidatesTab({ opening }: { opening: Opening }): React.JSX.Element {
  const [status, setStatus] = useState<'active' | 'hired' | 'rejected' | 'withdrawn' | 'all'>('active');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<string[] | null>(null);
  const [messaging, setMessaging] = useState<string[] | null>(null);
  const live = useOp<{ applications: Application[]; total: number }>('applications.list', { opening: opening.id, status, limit: 500 }, READS, { name: 'hiring.opening.apps' });
  useEffect(() => setSel(new Set()), [status]);
  const columns: Column<Application>[] = useMemo(
    () => [
      { key: 'name', label: t('hiring.col.candidate'), width: 'minmax(200px,2fr)', sort: (r) => r.candidate_name, phone: 'title', render: (r) => <span className="hr-wrap font-medium">{r.candidate_name}</span> },
      { key: 'stage', label: t('hiring.col.stage'), width: 'minmax(160px,1.4fr)', sort: (r) => r.stages.findIndex((s) => s.key === r.stage), phone: 'sub', render: (r) => <StageChain stages={r.stages} current={r.stage} status={r.status} /> },
      { key: 'since', label: t('hiring.col.since'), width: '110px', mono: true, sort: (r) => r.stage_since, hideBelow: 'lg', phone: 'hide', render: (r) => fmtDay(r.stage_since) },
      { key: 'source', label: t('hiring.col.source'), width: '120px', sort: (r) => r.source, hideBelow: 'xl', phone: 'hide', render: (r) => (r.source !== '' ? t(`hiring.source.${r.source}`) : '') },
      { key: 'status', label: t('hiring.col.status'), width: '120px', sort: (r) => r.status, phone: 'end', render: (r) => <span title={r.rejected_reason_name}>{statusLabel('application', r.status)}</span> },
    ],
    [],
  );
  const d = live.data;
  const stages = opening.stages.filter((s) => s.kind !== 'hired');
  const bulkMove = async (ids: string[], stage: string, clear: () => void): Promise<void> => {
    try {
      const r = await op<{ moved: unknown[]; skipped: { name: string; reason: string }[] }>('applications.move', { applications: ids, stage });
      changed('applications', 'hiring_events');
      toast.success(tn('hiring.moved_n', r.moved.length) + (r.skipped.length > 0 ? ' ' + t('hiring.skipped_list', { list: r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ') }) : ''));
      clear();
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="hr-panel min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
        <Segmented value={status} onChange={setStatus} label={t('hiring.col.status')} size="sm" options={(['active', 'hired', 'rejected', 'withdrawn', 'all'] as const).map((s) => ({ value: s, label: t(`hiring.app_view.${s}`) }))} />
      </div>
      {d === null ? (
        live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
      ) : (
        <DataTable
          label={t('hiring.candidates')}
          columns={columns}
          rows={d.applications}
          rowKey={(r) => r.id}
          rowHref={(r) => `#/hiring/candidates/${r.candidate}?application=${r.id}`}
          selectable={opening.can.edit && status === 'active'}
          selected={sel}
          onSelect={setSel}
          selectionBar={(ids, clear) => (
            <>
              <Menu icon={MoreHorizontal} label={t('hiring.move_to')} width={200} align="start">
                {(close) => (
                  <>
                    <MenuLabel>{tn('hiring.move_n_to', ids.length)}</MenuLabel>
                    {stages.map((s) => (
                      <MenuItem
                        key={s.key}
                        onClick={() => {
                          close();
                          void bulkMove(ids, s.key, clear);
                        }}
                      >
                        {s.name}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
              <Button size="sm" icon={MessageSquare} onClick={() => setMessaging(ids)}>
                {t('hiring.message')}
              </Button>
              <Button size="sm" variant="danger" icon={X} onClick={() => setClosing(ids)}>
                {t('hiring.reject')}
              </Button>
            </>
          )}
          empty={<Empty icon={UserPlus} title={status === 'active' ? t('hiring.board_empty') : t('hiring.none_match')} />}
        />
      )}
      <CloseDialog open={closing !== null} onClose={() => setClosing(null)} ids={closing ?? []} label={tn('hiring.n_candidates', closing?.length ?? 0)} mode="rejected" onDone={() => setSel(new Set())} />
      <MessageDialog open={messaging !== null} onClose={() => setMessaging(null)} ids={messaging ?? []} label={tn('hiring.n_candidates', messaging?.length ?? 0)} />
    </div>
  );
}

/* --------------------------------------------------------------- post */

function PostTab({ opening, flushRef }: { opening: Opening; flushRef: React.MutableRefObject<Flush | null> }): React.JSX.Element {
  const listed = usePeople();
  // Until the lists load, the pickers show what the opening already names.
  const people = useMemo(() => listed ?? [...(opening.hiring_manager !== '' ? [{ id: opening.hiring_manager, name: opening.hiring_manager_name }] : []), ...opening.team].map((m) => ({ id: m.id, name: m.name, email: '', title: '', role: '', employee_number: '' })), [listed, opening.hiring_manager, opening.hiring_manager_name, opening.team]);
  const loadedCountries = useOp<{ countries: CountrySummary[] }>('countries.list', {}, [], { name: 'countries' }).data?.countries ?? null;
  const countries: { code: string; name: string; regions: { code: string; name: string }[] }[] = loadedCountries ?? (opening.country !== '' ? [{ code: opening.country, name: opening.country, regions: opening.region !== '' ? [{ code: opening.region, name: opening.region }] : [] }] : []);
  const departments = useOrgList('departments', opening.entity).items;
  const locations = useOrgList('locations', opening.entity).items;
  const types = useOrgList('employment-types').items;
  const titles = useOrgList('titles').items;
  const [f, setF] = useState(() => init(opening));
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [notes, setNotes] = useState('');
  const base = JSON.stringify(init(opening));
  const prev = useRef(base);
  useEffect(() => {
    // Adopt fresh data from the server unless the person is in the middle of a change.
    if (JSON.stringify(f) === prev.current) setF(init(opening));
    prev.current = base;
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patchF: Partial<ReturnType<typeof init>>): void => setF((x) => ({ ...x, ...patchF }));
  const dirty = JSON.stringify(f) !== base;
  const cur = opening.currency;
  const payIssue = opening.issues.find((i) => i.field === 'salary');
  const can = opening.can.edit;
  // The post saves itself a moment after typing stops; Publish and leaving the tab save everything on screen.
  const [postState, setPostState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const savedPost = useRef(opening.description ?? '');
  const latest = useRef(f);
  latest.current = f;
  const savePost = useCallback(
    async (text: string): Promise<boolean> => {
      if (text === savedPost.current) return true;
      setPostState('saving');
      try {
        await queueSave(opening.id, () => (text === savedPost.current ? Promise.resolve(null) : op('openings.update', { opening: opening.id, description: text }, { quiet: true })));
        savedPost.current = text;
        setPostState('saved');
        changed('openings');
        return true;
      } catch {
        setPostState('failed');
        return false;
      }
    },
    [opening.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!can || f.description === savedPost.current) return;
    const h = setTimeout(() => void savePost(f.description), 1200);
    return () => clearTimeout(h);
  }, [f.description, can, savePost]);
  const fields = (x: ReturnType<typeof init>): Record<string, unknown> => ({
    opening: opening.id,
    title: x.title,
    description: x.description,
    department: x.department,
    job_title: x.job_title,
    location: x.location,
    location_text: x.location_text,
    country: x.country,
    region: x.region,
    remote: x.remote,
    employment_type: x.employment_type,
    salary_min: majorParam(x.lo, cur) ?? '',
    salary_max: majorParam(x.hi, cur) ?? '',
    pay_per: x.pay_per,
    show_pay: x.show_pay,
    positions: Number(x.positions),
    hiring_manager: x.hiring_manager,
    team: x.team,
  });
  const flush = async (): Promise<boolean> => {
    const x = latest.current;
    if (JSON.stringify(x) === base) return true;
    if (x.title.trim() === '') {
      toast.error(t('hiring.title_needed'));
      return false;
    }
    try {
      await queueSave(opening.id, () => op('openings.update', fields(x)));
      savedPost.current = x.description;
      changed('openings');
      return true;
    } catch {
      return false;
    }
  };
  const flushNow = useRef<Flush>(flush);
  flushNow.current = flush;
  useEffect(() => {
    flushRef.current = () => flushNow.current();
  });
  useEffect(() => {
    // A post saved elsewhere (an accepted proposal, another tab) is the new saved text.
    savedPost.current = opening.description ?? '';
  }, [opening.description]);
  useEffect(
    () => () => {
      flushRef.current = null;
      // Leaving the tab keeps what was typed.
      if (can && JSON.stringify(latest.current) !== prev.current && latest.current.title.trim() !== '') void flushNow.current();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await queueSave(opening.id, () => op('openings.update', fields(f)));
      savedPost.current = f.description;
      changed('openings');
      toast.success(t('hiring.post_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const ask = async (): Promise<void> => {
    try {
      const r = await op<{ asked: boolean }>('openings.draft-post', { opening: opening.id, notes });
      changed('openings');
      if (r.asked) toast.info(t('hiring.agent_drafting'), { label: t('hiring.open_inbox'), run: () => navigate('/inbox') });
      else toast.info(t('agent.already_asked'));
      setAsking(false);
      setNotes('');
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel index="01" label={t('hiring.job_post')} className="lg:col-span-7">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={mode} onChange={setMode} label={t('hiring.post_view')} size="sm" options={[{ value: 'write', label: t('hiring.write_md'), icon: PencilLine }, { value: 'preview', label: t('hiring.preview'), icon: Eye }]} />
            <span className="flex-1" />
            {can && postState !== 'idle' && (
              <span role="status" className="inline-flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                {postState === 'saving' && t('hiring.post_saving')}
                {postState === 'saved' && (
                  <>
                    <Check size={12} aria-hidden />
                    {t('hiring.post_autosaved')}
                  </>
                )}
                {postState === 'failed' && (
                  <Button size="sm" variant="ghost" onClick={() => void savePost(f.description)}>
                    {t('hiring.post_not_saved')}
                  </Button>
                )}
              </span>
            )}
            {opening.agent?.open !== true && can && (
              <Button size="sm" icon={Sparkle} onClick={() => setAsking(true)}>
                {f.description.trim() === '' ? t('hiring.draft_with_agent') : t('hiring.improve_with_agent')}
              </Button>
            )}
          </div>
          {opening.agent !== null && opening.agent.ended_at === '' && (
            <Notice tone="agent" action={<Button size="sm" onClick={() => navigate('/inbox')}>{t('hiring.open_inbox')}</Button>}>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {t('hiring.agent_on_post')}
                <AgentAskStatus ask={opening.agent} reads={['openings']} canRetry={can} />
              </span>
            </Notice>
          )}
          {mode === 'write' ? (
            <Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} minRows={14} maxRows={40} aria-label={t('hiring.job_post')} disabled={!can} placeholder={t('hiring.post_placeholder')} className="hr-mono text-[13px]" />
          ) : f.description.trim() === '' ? (
            <p className="py-6 text-center text-[13px] text-[var(--hr-muted)]">{t('hiring.post_empty')}</p>
          ) : (
            <Markdown text={f.description} />
          )}
        </div>
      </Panel>
      <Panel index="02" label={t('hiring.details')} className="lg:col-span-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('hiring.job_title')} className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set({ title: e.target.value })} disabled={!can} aria-label={t('hiring.job_title')} />
          </Field>
          <Field label={t('hiring.title_list')} optional>
            <Picker value={f.job_title} onChange={(v) => set({ job_title: v })} items={pickItems(titles)} label={t('hiring.title_list')} clearable disabled={!can} />
          </Field>
          <Field label={t('hiring.department')} optional>
            <Picker value={f.department} onChange={(v) => set({ department: v })} items={pickItems(departments)} label={t('hiring.department')} clearable disabled={!can} />
          </Field>
          <Field label={t('hiring.location')} optional>
            <Picker value={f.location} onChange={(v, item) => set({ location: v, location_text: f.location_text === '' && item !== null ? item.label : f.location_text })} items={pickItems(locations)} label={t('hiring.location')} clearable disabled={!can} />
          </Field>
          <Field label={t('hiring.location_text')} optional>
            <Input value={f.location_text} onChange={(e) => set({ location_text: e.target.value })} disabled={!can} aria-label={t('hiring.location_text')} />
          </Field>
          <Field label={t('hiring.work_country')} hint={t('hiring.work_country_hint')} className="sm:col-span-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Picker value={f.country} onChange={(v) => set({ country: v, region: v === f.country ? f.region : '' })} items={countries.map((c) => ({ value: c.code, label: c.name, sub: c.code }))} label={t('hiring.country')} placeholder={t('hiring.country')} disabled={!can} />
              {(countries.find((c) => c.code === f.country)?.regions ?? []).length > 0 && (
                <Picker value={f.region} onChange={(v) => set({ region: v })} items={(countries.find((c) => c.code === f.country)?.regions ?? []).map((r) => ({ value: r.code, label: r.name, sub: r.code }))} label={t('hiring.region')} placeholder={t('hiring.region')} clearable disabled={!can} />
              )}
            </div>
          </Field>
          <Field label={t('hiring.work_mode')}>
            <Segmented value={f.remote} onChange={(v) => set({ remote: v })} label={t('hiring.work_mode')} size="sm" options={(['onsite', 'hybrid', 'remote'] as const).map((r) => ({ value: r, label: t(`hiring.remote.${r}`) }))} />
          </Field>
          <Field label={t('hiring.employment_type')} optional>
            <Picker value={f.employment_type} onChange={(v) => set({ employment_type: v })} items={pickItems(types)} label={t('hiring.employment_type')} clearable disabled={!can} />
          </Field>
          <Field label={t('hiring.positions')}>
            <Input value={f.positions} onChange={(e) => set({ positions: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" disabled={!can} aria-label={t('hiring.positions')} />
          </Field>
          <Field label={t('hiring.pay_range', { currency: cur })} className="sm:col-span-2" optional={payIssue === undefined && opening.pay_rule === null}>
            <div className="flex flex-col gap-2">
              {opening.pay_rule !== null && (f.lo === null || f.hi === null) && <Notice tone="warn">{t('hiring.pay_rule_warn', { basis: opening.pay_rule.basis })}</Notice>}
              <div className="flex flex-wrap items-center gap-2">
                <MoneyInput value={f.lo} onChange={(v) => set({ lo: v })} currency={cur} label={t('hiring.pay_low')} className="w-[140px]" invalid={opening.pay_rule !== null && f.lo === null} />
                <span className="text-[var(--hr-muted)]">{t('hiring.to')}</span>
                <MoneyInput value={f.hi} onChange={(v) => set({ hi: v })} currency={cur} label={t('hiring.pay_high')} className="w-[140px]" invalid={opening.pay_rule !== null && f.hi === null} />
                <Segmented value={f.pay_per as 'year' | 'month' | 'hour'} onChange={(v) => set({ pay_per: v })} label={t('hiring.per')} size="sm" options={(['year', 'month', 'hour'] as const).map((p) => ({ value: p, label: t(`hiring.per.${p}`) }))} />
              </div>
              <ToggleRow checked={f.show_pay} onChange={(v) => set({ show_pay: v })} label={t('hiring.show_pay')} disabled={!can} />
            </div>
          </Field>
          <Field label={t('hiring.hiring_manager')} optional className="sm:col-span-2">
            <Picker value={f.hiring_manager} onChange={(v) => set({ hiring_manager: v })} items={personItems(people)} label={t('hiring.hiring_manager')} clearable disabled={!can} />
          </Field>
          <Field label={t('hiring.team')} optional className="sm:col-span-2" help={t('hiring.team_help')}>
            <PeoplePicker value={f.team} onChange={(v) => set({ team: v })} people={people} label={t('hiring.team')} />
          </Field>
        </div>
        {can && (
          <div className="mt-4 flex justify-end gap-2 border-t border-[var(--hr-line)] pt-3">
            <Button disabled={!dirty} onClick={() => setF(init(opening))}>
              {t('hiring.undo_changes')}
            </Button>
            <Button variant="primary" busy={busy} disabled={!dirty || f.title.trim() === ''} onClick={() => void save()}>
              {t('ui.save')}
            </Button>
          </div>
        )}
      </Panel>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={f.description.trim() === '' ? t('hiring.draft_with_agent') : t('hiring.improve_with_agent')}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>{t('ui.cancel')}</Button>
            <Button variant="agent" icon={Sparkle} onClick={() => void ask()}>
              {t('hiring.ask_agent')}
            </Button>
          </>
        }
      >
        <Field label={t('hiring.agent_notes')} optional hint={t('hiring.agent_notes_hint')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t('hiring.agent_notes')} minRows={3} />
        </Field>
      </Dialog>
    </div>
  );
}

function init(o: Opening): { title: string; description: string; department: string; job_title: string; location: string; location_text: string; country: string; region: string; remote: 'onsite' | 'hybrid' | 'remote'; employment_type: string; lo: number | null; hi: number | null; pay_per: string; show_pay: boolean; positions: string; hiring_manager: string; team: string[] } {
  return {
    title: o.title,
    description: o.description ?? '',
    department: o.department,
    job_title: o.job_title,
    location: o.location,
    location_text: o.location_text,
    country: o.country,
    region: o.region,
    remote: o.remote,
    employment_type: o.employment_type,
    lo: o.salary_min_minor > 0 ? o.salary_min_minor : null,
    hi: o.salary_max_minor > 0 ? o.salary_max_minor : null,
    pay_per: o.pay_per !== '' ? o.pay_per : 'year',
    show_pay: o.show_pay,
    positions: String(o.positions),
    hiring_manager: o.hiring_manager,
    team: o.team.map((m) => m.id),
  };
}

/* ------------------------------------------------------------- stages */

const KINDS: StageKind[] = ['applied', 'screen', 'interview', 'offer', 'other', 'hired'];

function StagesTab({ opening, kits }: { opening: Opening; kits: Kit[] }): React.JSX.Element {
  const [rows, setRows] = useState<Stage[]>(opening.stages);
  const [busy, setBusy] = useState(false);
  const [moves, setMoves] = useState<{ key: string; name: string; count: number }[] | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  useEffect(() => setRows(opening.stages), [JSON.stringify(opening.stages)]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = opening.can.edit;
  const dirty = JSON.stringify(rows.map((r) => [r.key, r.name, r.kind, r.kit ?? ''])) !== JSON.stringify(opening.stages.map((r) => [r.key, r.name, r.kind, r.kit ?? '']));
  const setRow = (i: number, p: Partial<Stage>): void => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const swap = (i: number, j: number): void => {
    const next = [...rows];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setRows(next);
  };
  const save = async (withMoves?: Record<string, string>): Promise<void> => {
    setBusy(true);
    try {
      await op('openings.stages', { opening: opening.id, stages: rows.map((r) => ({ key: r.key, name: r.name, kind: r.kind, kit: r.kit ?? '' })), moves: withMoves }, { quiet: true });
      changed('openings', 'applications');
      toast.success(t('hiring.stages_saved'));
      setMoves(null);
    } catch (e) {
      if (e instanceof OpError && e.code === 'stage_in_use') {
        const keys = rows.map((r) => r.key);
        const gone = opening.stages.filter((s) => !keys.includes(s.key) && (s.count ?? 0) > 0).map((s) => ({ key: s.key, name: s.name, count: s.count ?? 0 }));
        setTarget(Object.fromEntries(gone.map((g) => [g.key, rows.find((r) => r.kind !== 'hired' && r.kind !== 'applied')?.key ?? rows[0]?.key ?? ''])));
        setMoves(gone);
      } else toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel index="01" label={t('hiring.stages')} aside={can ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows([...rows.slice(0, -1), { key: '', name: t('hiring.new_stage'), kind: 'interview' }, ...rows.slice(-1)])}>{t('hiring.add_stage')}</Button> : undefined}>
      <ul className="flex flex-col divide-y divide-[var(--hr-line)]">
        {rows.map((r, i) => {
          const fixed = i === 0 || i === rows.length - 1;
          return (
            <li key={r.key !== '' ? r.key : `new${i}`} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2 py-2 sm:grid-cols-[28px_minmax(0,1.4fr)_150px_minmax(0,1fr)_auto]">
              <span className="hr-mono hr-num text-center text-[12px] text-[var(--hr-muted)]">{String(i + 1).padStart(2, '0')}</span>
              <Input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} disabled={!can} aria-label={t('hiring.stage_name')} />
              <Select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as StageKind })} disabled={!can || fixed} aria-label={t('hiring.stage_kind')} className="col-start-2 sm:col-start-auto">
                {KINDS.filter((k) => (fixed ? k === r.kind : k !== 'applied' && k !== 'hired')).map((k) => (
                  <option key={k} value={k}>
                    {t(`hiring.stage_kind.${k}`)}
                  </option>
                ))}
              </Select>
              <Picker value={r.kit ?? ''} onChange={(v) => setRow(i, { kit: v })} items={kits.map((k) => ({ value: k.id, label: k.name }))} label={t('hiring.kit')} placeholder={t('hiring.no_kit')} clearable disabled={!can || r.kind === 'applied' || r.kind === 'hired'} className="col-start-2 sm:col-start-auto" />
              <span className="col-start-2 flex items-center gap-0.5 sm:col-start-auto">
                {can && !fixed && (
                  <>
                    <IconButton icon={ArrowUp} label={t('hiring.move_up')} disabled={i <= 1} onClick={() => swap(i, i - 1)} />
                    <IconButton icon={ArrowDown} label={t('hiring.move_down')} disabled={i >= rows.length - 2} onClick={() => swap(i, i + 1)} />
                    <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                  </>
                )}
                <span className="hr-mono hr-num w-8 text-right text-[12px] text-[var(--hr-muted)]">{r.kind === 'hired' ? opening.hired : (opening.stages.find((s) => s.key === r.key)?.count ?? 0)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {can && (
        <div className="mt-3 flex justify-end gap-2 border-t border-[var(--hr-line)] pt-3">
          <Button disabled={!dirty} onClick={() => setRows(opening.stages)}>
            {t('hiring.undo_changes')}
          </Button>
          <Button variant="primary" busy={busy} disabled={!dirty || rows.some((r) => r.name.trim() === '')} onClick={() => void save()}>
            {t('hiring.save_stages')}
          </Button>
        </div>
      )}
      <Dialog
        open={moves !== null}
        onClose={() => setMoves(null)}
        title={t('hiring.where_go')}
        footer={
          <>
            <Button onClick={() => setMoves(null)}>{t('ui.cancel')}</Button>
            <Button variant="primary" busy={busy} onClick={() => void save(target)}>
              {t('hiring.move_and_save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {(moves ?? []).map((m) => (
            <Field key={m.key} label={tn('hiring.in_removed_stage', m.count, { stage: m.name })}>
              <Select value={target[m.key] ?? ''} onChange={(e) => setTarget({ ...target, [m.key]: e.target.value })} aria-label={m.name}>
                {rows
                  .filter((r) => r.kind !== 'hired' && r.key !== '')
                  .map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
        </div>
      </Dialog>
    </Panel>
  );
}

/* --------------------------------------------------------------- page */

export function OpeningPage({ params, query }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const tab = (query.get('tab') as Tab | null) ?? 'pipeline';
  const live = useOp<{ opening: Opening & { kits: Kit[] } }>('openings.get', { opening: id }, READS, { name: 'hiring.opening' });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const flushRef = useRef<Flush | null>(null);
  const o = live.data?.opening ?? null;
  if (o === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const setStatus = async (status: 'open' | 'on_hold' | 'closed' | 'draft'): Promise<void> => {
    if (status === 'closed' && !(await confirmAsk(o.active > 0 ? tn('hiring.close_confirm_active', o.active) : t('hiring.close_confirm'), t('hiring.close_opening'), t('hiring.close_opening'), 'primary'))) return;
    if (status === 'open') {
      // Publish exactly what is on screen: save what is still unsaved, after every save in the queue.
      if (flushRef.current !== null && !(await flushRef.current())) return;
      const tail = pendingPost.get(o.id);
      if (tail !== undefined) await tail.catch(() => undefined);
    }
    try {
      const r = await op<{ opening: Opening; active_left: number; issues: { message: string }[] }>('openings.set-status', { opening: o.id, status });
      changed('openings');
      if (status === 'closed' && r.active_left > 0) toast.info(tn('hiring.still_active', r.active_left), { label: t('hiring.review'), run: () => setQuery({ tab: 'candidates' }) });
      else if (status === 'open' && r.issues.length > 0) toast.info(r.issues.map((i) => i.message).join(' '));
      else toast.success(t(`hiring.status_done.${status}`));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('hiring.delete_opening_text'), t('hiring.delete_opening')))) return;
    try {
      await op('openings.delete', { opening: o.id });
      changed('openings');
      toast.success(t('hiring.opening_deleted'));
      navigate('/hiring/openings');
    } catch {
      /* toast shown */
    }
  };
  const meta = [o.number, o.entity_name, o.location_name || o.location_text, statusLabel('opening', o.status)].filter((x) => x !== '').join(' · ');
  return (
    <>
      <PageHeader title={o.title} meta={meta} back="#/hiring/openings">
        {o.can.add && (
          <Button variant={tab === 'post' || tab === 'stages' ? 'default' : 'primary'} icon={UserPlus} onClick={() => setAdding(true)} aria-label={t('hiring.add_candidate')}>
            <span className="hidden sm:inline">{t('hiring.add_candidate')}</span>
          </Button>
        )}
        {(o.can.edit || o.can.publish) && (
          <Menu icon={MoreHorizontal} label={t('ui.more')} width={230}>
            {(close) => (
              <>
                {o.can.publish && o.status !== 'open' && (
                  <MenuItem icon={Briefcase} onClick={() => (close(), void setStatus('open'))}>
                    {t('hiring.status_to.open')}
                  </MenuItem>
                )}
                {o.can.publish && o.status === 'open' && (
                  <MenuItem onClick={() => (close(), void setStatus('on_hold'))}>{t('hiring.status_to.on_hold')}</MenuItem>
                )}
                {o.can.publish && o.status !== 'closed' && (
                  <MenuItem onClick={() => (close(), void setStatus('closed'))}>{t('hiring.status_to.closed')}</MenuItem>
                )}
                {o.can.add && (
                  <MenuItem icon={FileUp} onClick={() => (close(), setImporting(true))}>
                    {t('hiring.import_candidates')}
                  </MenuItem>
                )}
                {o.can.publish && o.active + o.hired + o.rejected + o.withdrawn === 0 && (
                  <>
                    <MenuSep />
                    <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                      {t('hiring.delete_opening')}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody wide>
        {o.status === 'draft' && (
          <Notice className="mb-3" action={o.can.publish ? <Button size="sm" onClick={() => void setStatus('open')}>{t('hiring.status_to.open')}</Button> : undefined}>
            {t('hiring.draft_note')}
          </Notice>
        )}
        {o.issues.length > 0 && tab !== 'post' && (
          <Notice tone="warn" className="mb-3" action={o.can.edit ? <Button size="sm" onClick={() => setQuery({ tab: 'post' })}>{t('hiring.fix')}</Button> : undefined}>
            {o.issues.map((i) => i.message).join(' ')}
          </Notice>
        )}
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'pipeline' ? undefined : v })}
          label={t('hiring.opening_tabs')}
          className="mb-3"
          tabs={[
            { value: 'pipeline', label: t('hiring.tab.pipeline'), count: o.active },
            { value: 'candidates', label: t('hiring.tab.candidates') },
            { value: 'post', label: t('hiring.tab.post') },
            { value: 'stages', label: t('hiring.tab.stages') },
          ]}
        />
        {tab === 'pipeline' && <Pipeline opening={o} />}
        {tab === 'candidates' && <CandidatesTab opening={o} />}
        {tab === 'post' && <PostTab opening={o} flushRef={flushRef} />}
        {tab === 'stages' && <StagesTab opening={o} kits={o.kits ?? []} />}
      </PageBody>
      <AddCandidateDialog open={adding} onClose={() => setAdding(false)} opening={o.id} onAdded={(to) => to === o.id && setQuery({ tab: undefined })} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} opening={o.id} onAdded={(to) => to === o.id && setQuery({ tab: undefined })} />
    </>
  );
}
