/**
 * New card: a dialog with a clear heading, a title field, a description,
 * and the card's properties (board, column, who does it: you, a teammate,
 * one agent or any agent, priority). When an agent does it, the acceptance
 * criteria field shows: it is what done means for the agent, and some
 * columns need it before an agent starts. A column agents work decides who
 * gets the card. Enter in the title creates the card; Ctrl+Enter works from
 * anywhere; Esc closes.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CornerDownLeft, SquareKanban, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLive } from '../lib/live.ts';
import type { AssigneeKey } from '../lib/types.ts';
import { CategoryIcon, PRIORITY_LABEL, PriorityIcon } from './marks.tsx';
import { AssigneeMenu, PartyChip, forAgents, usePartyOf } from './people.tsx';
import { Button, IconButton, MenuItem, PartyAvatar, Popover, Textarea, errMessage } from './ui.tsx';
import { createPortal } from 'react-dom';

function Pick({ children, onClick, ref, label }: { children: React.ReactNode; onClick: () => void; ref?: React.Ref<HTMLButtonElement>; label: string }): React.JSX.Element {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} onClick={onClick} className="kb-focus inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-[var(--kb-radius-sm)] border border-[var(--kb-line)] bg-[var(--kb-main)] px-2.5 text-[13px] text-[var(--kb-ink)] transition-colors hover:bg-[var(--kb-main-hover)]">
      {children}
      <span className="flex-1" />
      <ChevronDown size={13} aria-hidden className="shrink-0 text-[var(--kb-muted)]" />
    </button>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">{label}</span>
      {children}
    </div>
  );
}

export function Composer(): React.JSX.Element | null {
  const app = useApp();
  const o = app.compose;
  const [board, setBoard] = useState('');
  const [column, setColumn] = useState('');
  const [who, setWho] = useState<AssigneeKey>('me');
  const [priority, setPriority] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'' | 'board' | 'column' | 'priority' | 'who'>('');
  const refs = { board: useRef<HTMLButtonElement | null>(null), column: useRef<HTMLButtonElement | null>(null), priority: useRef<HTMLButtonElement | null>(null), who: useRef<HTMLButtonElement | null>(null) };
  const partyOf = usePartyOf();
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (o === null) return;
    const b = o.board && app.boards.some((x) => x.id === o.board) ? o.board : app.lastBoard && app.boards.some((x) => x.id === app.lastBoard) ? app.lastBoard : (app.boards[0]?.id ?? '');
    setBoard(b);
    setColumn(o.column ?? '');
    setWho(o.assignee ?? 'me');
    setPriority(0);
    setTitle('');
    setDescription('');
    setCriteria('');
    setTimeout(() => titleRef.current?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o]);

  const detail = useLive(() => (board !== '' ? api.board(board) : Promise.resolve(null)), ['columns'], [board]);
  const cols = detail.data?.columns ?? [];
  const col = cols.find((c) => c.id === column) ?? cols.find((c) => c.category === 'todo') ?? cols[0];
  // A column agents work decides: its own agent, or any agent unless you pick one.
  const mode = col?.agent_mode ?? 'off';
  const assignee: AssigneeKey = mode === 'one' && col?.agent ? 'agent:' + col.agent.id : mode === 'any' && !forAgents(who) ? 'pool' : who;
  const forAgent = forAgents(assignee);
  const party = partyOf(assignee);
  const agentName = party?.kind === 'agent' ? party.name : 'the agent';
  const boardName = app.boards.find((b) => b.id === board)?.name ?? 'Board';
  const needsCriteria = forAgent && col?.need_criteria === true && criteria.trim() === '';

  if (o === null) return null;
  const close = (): void => app.setCompose(null);
  const submit = async (): Promise<void> => {
    const t = title.trim();
    if (t === '' || board === '' || busy) return;
    setBusy(true);
    try {
      const r = await api.addCard({ board, column: col?.id, title: t, description: description.trim() || undefined, acceptance: forAgent && criteria.trim() !== '' ? criteria.trim() : undefined, assignee, priority });
      const c = r.card;
      if (c.agent_state === 'queued') toast.success(`${c.key} created and queued for ${c.assignee?.kind === 'pool' ? 'any agent' : (c.assignee?.name ?? 'an agent')}`);
      else if (c.agent_state === 'needs_input') toast.info(`${c.key} created: add acceptance criteria so an agent can start`);
      else toast.success(`${c.key} created`);
      close();
      app.setOpenCard(c.id);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const shut = (): void => setOpen('');
  // What happens once the card exists, when an agent does it.
  const startsNow = col !== undefined && (mode !== 'off' || col.category === 'todo' || col.category === 'doing');
  const doer = assignee === 'pool' ? 'The first free agent' : agentName;
  const note = !forAgent || col === undefined ? '' : needsCriteria ? `Without them the card waits for you before ${assignee === 'pool' ? 'an agent' : agentName} starts; you can also add them later on the card.` : startsNow ? `${doer} picks this card up as soon as you create it.` : `${doer} starts once the card reaches a to-do or in-progress column (${col.name} is not one).`;
  const ctrlEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return createPortal(
    <div className="kb-scrim fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[10vh]" onPointerDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && document.querySelector('[data-kb-popover]') === null && close()}>
      <div role="dialog" aria-modal="true" aria-label="New card" className="kb-in flex w-full max-w-[680px] flex-col rounded-[var(--kb-radius-lg)] border border-[var(--kb-line)] bg-[var(--kb-main)] shadow-[var(--kb-shadow-lg)]">
        <header className="flex items-center gap-3 border-b border-[var(--kb-hair)] px-5 py-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--kb-radius-sm)] bg-[var(--kb-accent-soft)] text-[var(--kb-accent-text)]">
            <SquareKanban size={16} strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-5">New card</h2>
            <p className="truncate text-[12px] leading-4 text-[var(--kb-muted)]">
              A new task on {boardName}
              {col !== undefined ? `, in ${col.name}` : ''}
            </p>
          </div>
          <IconButton icon={X} label="Close" onClick={close} />
        </header>

        <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--kb-ink-2)]">Title</span>
            <input
              ref={titleRef}
              aria-label="Title"
              value={title}
              maxLength={300}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              onPaste={(e) => {
                // Pasting several lines: the first is the title, the rest the description.
                const text = e.clipboardData.getData('text');
                if (!text.includes('\n') || title.trim() !== '') return;
                e.preventDefault();
                const [first, ...rest] = text.split(/\r?\n/);
                setTitle((first ?? '').trim());
                if (description.trim() === '') setDescription(rest.join('\n').trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="kb-field h-10 px-3 text-[15px] font-medium"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline gap-1.5 text-[12px] font-medium text-[var(--kb-ink-2)]">
              Description <span className="font-normal text-[var(--kb-faint)]">optional · markdown</span>
            </span>
            <Textarea aria-label="Description" value={description} minRows={4} placeholder="Context, links, notes…" onChange={(e) => setDescription(e.target.value)} onKeyDown={ctrlEnter} className="max-h-[260px] overflow-y-auto" />
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.1fr)]">
            <Prop label="Board">
              <Pick ref={refs.board} label={`Board: ${boardName}`} onClick={() => setOpen(open === 'board' ? '' : 'board')}>
                <SquareKanban size={14} aria-hidden className="shrink-0 text-[var(--kb-muted)]" />
                <span className="truncate">{boardName}</span>
              </Pick>
            </Prop>
            <Prop label="Column">
              <Pick ref={refs.column} label={`Column: ${col?.name ?? ''}`} onClick={() => setOpen(open === 'column' ? '' : 'column')}>
                {col !== undefined && <CategoryIcon category={col.category} size={14} />}
                <span className="truncate">{col?.name ?? 'Column'}</span>
              </Pick>
            </Prop>
            <Prop label="Assignee">
              <Pick ref={refs.who} label={`Assignee: ${party?.name ?? 'Nobody'}`} onClick={() => (mode === 'one' ? toast.info(`${col?.name ?? 'This column'} is worked by ${agentName}: cards here are its.`) : setOpen(open === 'who' ? '' : 'who'))}>
                <PartyChip party={party} size={16} />
              </Pick>
            </Prop>
            <Prop label="Priority">
              <Pick ref={refs.priority} label={`Priority: ${PRIORITY_LABEL[priority] ?? ''}`} onClick={() => setOpen(open === 'priority' ? '' : 'priority')}>
                <PriorityIcon priority={priority} size={14} />
                <span className="truncate">{PRIORITY_LABEL[priority]}</span>
              </Pick>
            </Prop>
          </div>

          {forAgent && (
            <div className="kb-in flex flex-col gap-3 rounded-[var(--kb-radius)] border border-[var(--kb-hair)] bg-[var(--kb-card)] p-3">
              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-1.5 text-[12px] font-medium text-[var(--kb-ink-2)]">
                  Acceptance criteria
                  <span className={cn('font-normal', needsCriteria ? 'text-[var(--kb-amber)]' : 'text-[var(--kb-faint)]')}>{col?.need_criteria === true ? `required in ${col.name}` : 'recommended'}</span>
                </span>
                <Textarea aria-label="Acceptance criteria" value={criteria} minRows={2} placeholder={'What done looks like, one line each. The agent checks its work against these, and the reviewer sees each one met or not.'} onChange={(e) => setCriteria(e.target.value)} onKeyDown={ctrlEnter} className="bg-[var(--kb-main)]" />
              </label>
              {note !== '' && (
                <p className="flex items-start gap-2 text-[12.5px] leading-[18px] text-[var(--kb-ink-2)]">
                  <PartyAvatar party={party} size={18} />
                  <span>{note}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--kb-hair)] px-5 py-3">
          <span className="hidden min-w-0 flex-1 truncate text-[12px] text-[var(--kb-muted)] sm:block">Enter in the title or Ctrl+Enter to create · Esc to close</span>
          <span className="flex-1 sm:hidden" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={title.trim() === ''} onClick={() => void submit()} title="Create the card (Enter)">
            Create card
            <CornerDownLeft size={13} aria-hidden className="opacity-70" />
          </Button>
        </footer>
      </div>

      <Popover anchor={refs.board} open={open === 'board'} onClose={shut} width={240}>
        {app.boards.map((b) => (
          <MenuItem key={b.id} selected={b.id === board} onClick={() => (setBoard(b.id), setColumn(''), shut())}>
            {b.name}
          </MenuItem>
        ))}
      </Popover>
      <Popover anchor={refs.column} open={open === 'column'} onClose={shut} width={260}>
        {cols.map((c) => (
          <MenuItem key={c.id} selected={c.id === col?.id} hint={c.agent_mode === 'any' ? 'any agent' : c.agent_mode === 'one' ? (c.agent?.name ?? 'an agent') : undefined} onClick={() => (setColumn(c.id), shut())}>
            <span className="inline-flex items-center gap-2">
              <CategoryIcon category={c.category} /> {c.name}
            </span>
          </MenuItem>
        ))}
      </Popover>
      <Popover anchor={refs.who} open={open === 'who'} onClose={shut} width={250}>
        <AssigneeMenu value={assignee} only={mode === 'any' ? 'agents' : undefined} onPick={(k) => (setWho(k), shut())} />
      </Popover>
      <Popover anchor={refs.priority} open={open === 'priority'} onClose={shut} width={180}>
        {[1, 2, 3, 4, 0].map((p) => (
          <MenuItem key={p} selected={p === priority} onClick={() => (setPriority(p), shut())}>
            <span className="inline-flex items-center gap-2">
              <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}
            </span>
          </MenuItem>
        ))}
      </Popover>
    </div>,
    document.body,
  );
}
