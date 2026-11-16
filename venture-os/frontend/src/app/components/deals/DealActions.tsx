/**
 * The deal page's actions: the stage's one primary action (Advance, Schedule
 * IC, Mark invested, Reopen; at Partner meeting and IC the caller's next
 * committee step from committee.next-step: Vote, Reveal, Record decision,
 * Open meeting, Schedule IC) and the overflow menu (Assign, Team, Restrict,
 * Pass, Lost, Hold, Merge, Reopen), each a small dialog of chips and pickers
 * whose result shows on the page at once.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarCheck, CircleCheck, Combine, DoorOpen, Eye, Gavel, Lock, PauseCircle, RotateCcw, UserRound, Users, Vote, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, Button, Checkbox, ChipPicker, Dialog, Field, Menu, MenuItem, MenuSep, Picker, Row, Toggle } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import type { OpName } from '../../lib/api.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { go, setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { MOVE_READS, moveDeal, setStatus } from './actions.ts';
import { PASS_REASONS } from './types.ts';
import type { Deal, DealCard } from './types.ts';

interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  role: string;
  me: boolean;
}

type Close = 'passed' | 'lost' | 'hold';
type Dlg = '' | 'assign' | 'team' | 'restrict' | 'merge' | Close;

const LOST = ['Went with another lead', 'Founders declined', 'Round closed', 'Other'];
const HOLD = ['Too early', 'Waiting on traction', 'Waiting on the round', 'Other'];
const WORD: Record<Close, string> = { passed: 'Passed', lost: 'Lost', hold: 'On hold' };

/** The caller's next committee step on a deal (committee.next-step). */
interface CommitteeStep {
  key: 'vote' | 'reveal' | 'record' | 'open' | 'schedule';
  label: string;
  op: string;
  params: Record<string, unknown>;
  href: string;
  pin: boolean;
  ready: boolean;
}

const STEP_READS = ['ic_meetings', 'agenda_items', 'votes', 'decisions', 'memos', 'deals', 'stage_events'];
const STEP_ICON: Record<CommitteeStep['key'], LucideIcon> = { vote: Vote, reveal: Eye, record: Gavel, open: DoorOpen, schedule: CalendarCheck };

/**
 * At Partner meeting and IC the black button is the caller's next committee
 * step. A ready step runs in place (Reveal with the PIN, then the room shows
 * the tally; Schedule IC moves the deal with Undo); the others open the room
 * on the item, where the choice is made (Vote opens its scale at once).
 */
function CommitteeStepButton({ deal }: { deal: Deal }): React.JSX.Element | null {
  const live = useOp<{ step: CommitteeStep | null }>('committee.next-step', { deal: deal.id }, STEP_READS, { name: 'committee.next-step' });
  const [busy, setBusy] = useState(false);
  const step = live.data?.step ?? null;
  if (step === null) return null;
  const run = async (): Promise<void> => {
    if (step.ready && step.op === 'deals.move') {
      const stages = deal.pipeline.stages;
      const i = stages.findIndex((s) => s.key === String(step.params['stage'] ?? ''));
      const st = stages[i];
      if (st !== undefined) await moveDeal(deal, { key: st.key, label: st.label, index: i });
      return;
    }
    if (step.ready && step.op !== '') {
      setBusy(true);
      const out = await act([], () => op(step.op as OpName, step.params, step.pin ? { pin: { title: step.label } } : {}), STEP_READS);
      setBusy(false);
      if (out === null) return;
    }
    if (step.href !== '') go(step.href);
  };
  return (
    <Button variant="primary" icon={STEP_ICON[step.key]} busy={busy} onClick={() => void run()}>
      {step.label}
    </Button>
  );
}

/** The stage's primary action (one black button), or null when the stage has none. */
export function PrimaryFor({ deal, canEdit, hasTab }: { deal: Deal; canEdit: boolean; hasTab: (key: string) => boolean }): React.JSX.Element | null {
  // A vote or a reveal is committee work, not a deal edit: the committee step shows for everyone it names.
  if (deal.status === 'open' && deal.pipeline.kind === 'deal_flow' && (deal.stage === 'partner_meeting' || deal.stage === 'ic')) return <CommitteeStepButton deal={deal} />;
  if (!canEdit) return null;
  if (deal.status === 'hold')
    return (
      <Button variant="primary" icon={RotateCcw} onClick={() => void setStatus(deal.id, 'open', '', 'Reopened')}>
        Reopen
      </Button>
    );
  if (deal.status !== 'open') return null;
  const stages = deal.pipeline.stages;
  const i = stages.findIndex((s) => s.key === deal.stage);
  const next = stages[i + 1];
  const ic = stages.findIndex((s) => s.key === 'ic');
  if (deal.pipeline.kind === 'deal_flow') {
    if (deal.stage === 'diligence') {
      const st = stages[ic];
      if (st === undefined) return null;
      return (
        <Button variant="primary" icon={CalendarCheck} onClick={() => void moveDeal(deal, { key: st.key, label: st.label, index: ic })}>
          Schedule IC
        </Button>
      );
    }
    if (deal.stage === 'closed') return null;
    if (deal.stage === 'term_sheet') {
      if (!hasTab('investment')) return null;
      return (
        <Button variant="primary" icon={CircleCheck} onClick={() => setQuery({ tab: 'investment' })}>
          Mark invested
        </Button>
      );
    }
  }
  if (next === undefined) return null;
  return (
    <Button variant="primary" iconRight={ArrowRight} onClick={() => void moveDeal(deal, { key: next.key, label: next.label, index: i + 1 })} title={`Move to ${next.label}`}>
      Advance
    </Button>
  );
}

function useMembers(open: boolean): Member[] {
  const live = useOp<{ members: Member[] }>('deals.members', {}, ['members'], { name: 'deals.members', skip: !open });
  return live.data?.members ?? [];
}

function AssignDialog({ deal, onClose }: { deal: Deal; onClose: () => void }): React.JSX.Element {
  const members = useMembers(true);
  const [pick, setPick] = useState(deal.point?.id ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    const m = members.find((x) => x.id === pick);
    if (m === undefined) return;
    setBusy(true);
    const out = await act([patch(deal.id, { point: { id: m.id, name: m.name } })], () => op('deals.assign', { deal: deal.id, point: m.id }), MOVE_READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Point partner"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={pick === '' || pick === deal.point?.id} onClick={() => void save()}>
            Assign
          </Button>
        </>
      }
    >
      <Picker label="Point partner" value={pick} onChange={(v) => setPick(v)} items={members.map((m) => ({ value: m.id, label: m.name, sub: m.role, avatar: 'person' as const }))} />
    </Dialog>
  );
}

function TeamDialog({ deal, onClose }: { deal: Deal; onClose: () => void }): React.JSX.Element {
  const members = useMembers(true);
  const start = useMemo(() => new Set(deal.team.map((t) => t.id)), [deal.team]);
  const [on, setOn] = useState<Set<string>>(start);
  const [busy, setBusy] = useState(false);
  const add = [...on].filter((x) => !start.has(x));
  const remove = [...start].filter((x) => !on.has(x));
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('deals.team', { deal: deal.id, add: add.length > 0 ? add : undefined, remove: remove.length > 0 ? remove : undefined }), MOVE_READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Deal team"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={add.length === 0 && remove.length === 0} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <ul className="vo-scroll -mx-1 flex max-h-[320px] flex-col overflow-y-auto">
        {members.map((m) => {
          const point = deal.point?.id === m.id;
          return (
            <li key={m.id} className="flex h-10 items-center gap-3 rounded-[var(--vo-radius-sm)] px-1">
              <Avatar name={m.name} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
              <Checkbox
                label={m.name}
                hideLabel
                checked={on.has(m.id)}
                disabled={point}
                onChange={(v) =>
                  setOn((s) => {
                    const n = new Set(s);
                    if (v) n.add(m.id);
                    else n.delete(m.id);
                    return n;
                  })
                }
              />
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function RestrictDialog({ deal, onClose }: { deal: Deal; onClose: () => void }): React.JSX.Element {
  const [restricted, setRestricted] = useState(deal.restricted);
  const [agent, setAgent] = useState(deal.agent_allowed);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([patch(deal.id, { restricted, agent_allowed: agent })], () => op('deals.restrict', { deal: deal.id, restricted, agent_allowed: agent }), MOVE_READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Restrict"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={restricted === deal.restricted && agent === deal.agent_allowed} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <Row label="Deal team only" tip="Only the deal team and the owner see it">
          <Toggle label="Deal team only" checked={restricted} onChange={setRestricted} />
        </Row>
        <Row label="Your AI agent" tip="Your AI agent may work on this restricted deal">
          <Toggle label="Your AI agent may work on it" checked={agent} onChange={setAgent} disabled={!restricted} />
        </Row>
      </div>
    </Dialog>
  );
}

function CloseDialog({ deal, status, onClose }: { deal: Deal; status: Close; onClose: () => void }): React.JSX.Element {
  const options = status === 'passed' ? PASS_REASONS : status === 'lost' ? LOST : HOLD;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = status === 'passed' ? 'Pass' : status === 'lost' ? 'Lost' : 'Hold';
  const save = async (): Promise<void> => {
    setBusy(true);
    const ok = await setStatus(deal.id, status, reason, WORD[status]);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={label}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={status === 'hold' ? 'primary' : 'danger'} busy={busy} disabled={reason === ''} onClick={() => void save()}>
            {label}
          </Button>
        </>
      }
    >
      <Field label="Reason">
        <ChipPicker label="Reason" options={options.map((o) => ({ value: o, label: o }))} value={reason} onChange={setReason} keys />
      </Field>
    </Dialog>
  );
}

function MergeDialog({ deal, onClose }: { deal: Deal; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useOp<{ deals: DealCard[] }>('deals.list', { pipeline: deal.pipeline.key, status: 'all', q: q.trim() || undefined, limit: 30 }, ['deals'], { name: 'deals.merge-pick', keep: true });
  const items = (live.data?.deals ?? []).filter((d) => d.id !== deal.id).map((d) => ({ value: d.id, label: d.title, sub: d.number + ' ' + d.stage_label, avatar: 'company' as const }));
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op<{ dropped: string; _activity?: string | undefined }>('deals.merge', { keep: deal.id, drop: pick }), MOVE_READS.concat(['tasks', 'files']));
    setBusy(false);
    if (out !== null) {
      const entry = out._activity ?? '';
      if (entry !== '') toast.undo(`Merged ${out.dropped}`, () => void act([], () => op('activity.undo', { entry }), MOVE_READS.concat(['tasks', 'files'])));
      onClose();
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Merge a duplicate"
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={pick === ''} onClick={() => void save()}>
            Merge
          </Button>
        </>
      }
    >
      <Field label="Duplicate" tip={`Its notes, tasks, files and team move into ${deal.title}; the duplicate goes. Undo restores both.`}>
        <Picker label="Duplicate" value={pick} onChange={(v) => setPick(v)} items={items} onSearch={setQ} />
      </Field>
    </Dialog>
  );
}

/** The overflow menu and its dialogs. */
export function DealMenu({ deal, canEdit }: { deal: Deal; canEdit: boolean }): React.JSX.Element | null {
  const [dlg, setDlg] = useState<Dlg>('');
  if (!canEdit) return null;
  const open = deal.status === 'open';
  const close = (): void => setDlg('');
  return (
    <>
      <Menu label="More actions" width={220}>
        {(c) => {
          const go = (d: Dlg) => (): void => {
            c();
            setDlg(d);
          };
          return (
            <>
              <MenuItem icon={UserRound} onClick={go('assign')}>
                Assign
              </MenuItem>
              <MenuItem icon={Users} onClick={go('team')}>
                Team
              </MenuItem>
              <MenuItem icon={Lock} onClick={go('restrict')}>
                Restrict
              </MenuItem>
              <MenuSep />
              {open ? (
                <>
                  <MenuItem icon={XCircle} onClick={go('passed')}>
                    Pass
                  </MenuItem>
                  <MenuItem icon={XCircle} onClick={go('lost')}>
                    Lost
                  </MenuItem>
                  <MenuItem icon={PauseCircle} onClick={go('hold')}>
                    Hold
                  </MenuItem>
                </>
              ) : (
                <MenuItem
                  icon={RotateCcw}
                  onClick={() => {
                    c();
                    void setStatus(deal.id, 'open', '', 'Reopened');
                  }}
                >
                  Reopen
                </MenuItem>
              )}
              <MenuSep />
              <MenuItem icon={Combine} onClick={go('merge')}>
                Merge
              </MenuItem>
            </>
          );
        }}
      </Menu>
      {dlg === 'assign' && <AssignDialog deal={deal} onClose={close} />}
      {dlg === 'team' && <TeamDialog deal={deal} onClose={close} />}
      {dlg === 'restrict' && <RestrictDialog deal={deal} onClose={close} />}
      {dlg === 'merge' && <MergeDialog deal={deal} onClose={close} />}
      {(dlg === 'passed' || dlg === 'lost' || dlg === 'hold') && <CloseDialog deal={deal} status={dlg} onClose={close} />}
    </>
  );
}
