/**
 * Team: directory + seats (accountability chart) + hiring pipeline.
 * Each collection is fetched exactly ONCE here and passed down: two
 * identical concurrent queries trip PocketBase's SDK auto-cancellation
 * (the "Failed to load data" the old page showed).
 */
import { useState } from 'react';
import { Building2, LayoutGrid, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  EntityForm,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import { useAuth } from '../lib/useAuth.ts';
import type { AccessRole, Candidate, Company, Seat, TeamMember, UserAccount } from '../lib/types.ts';
import { STAGES } from '../lib/types.ts';
import { callOp } from '../lib/ops.ts';
import {
  DeleteButton,
  Dot,
  EditButton,
  GhostCards,
  GhostRows,
  GhostState,
  GroupHeader,
  IdentityChip,
  ListRow,
  PageHeader,
  Pill,
  type Tone,
} from '../components/ui.tsx';

const MEMBER_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'email', type: 'text' },
  { name: 'active', label: 'Currently active', type: 'boolean' },
  { name: 'note', type: 'textarea' },
];

const SEAT_FIELDS: EntityField[] = [
  { name: 'name', label: 'Seat (area of the business)', type: 'text', required: true },
  { name: 'responsibilities', label: 'Responsibilities (up to 5)', type: 'tags' },
  { name: 'accountable', label: 'Accountable person', type: 'ref', ref: { collection: 'team_members', labelField: 'name' } },
];

const CANDIDATE_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'seat', label: 'For which seat / role', type: 'text' },
  {
    name: 'stage',
    type: 'select',
    required: true,
    options: [
      { value: 'applied', label: 'Applied' },
      { value: 'screening', label: 'Screening' },
      { value: 'interview', label: 'Interview' },
      { value: 'offer', label: 'Offer' },
      { value: 'hired', label: 'Hired' },
      { value: 'passed', label: 'Passed' },
    ],
  },
  { name: 'note', type: 'textarea' },
];

const CANDIDATE_TONE: Record<Candidate['stage'], Tone> = {
  applied: 'info',
  screening: 'warn',
  interview: 'warn',
  offer: 'good',
  hired: 'good',
  passed: 'neutral',
};

const CANDIDATE_LABEL: Record<Candidate['stage'], string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  passed: 'Passed',
};

type Tab = 'members' | 'seats' | 'hiring' | 'access';

export function TeamPage({ company }: { company: Company }): React.JSX.Element {
  const { userId, role } = useAuth();
  const isAdmin = role === 'owner' || role === 'admin';
  const { records: members } = useCollection<TeamMember>('team_members', { sort: 'name' });
  const { records: seats } = useCollection<Seat>('seats', { sort: 'name' });
  const { records: candidates } = useCollection<Candidate>('candidates', { sort: '-created' });
  const [tab, setTab] = useState<Tab>('members');
  const [memberOpen, setMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [seatOpen, setSeatOpen] = useState(false);
  const [editingSeat, setEditingSeat] = useState<Seat | null>(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const showHiring = STAGES.indexOf(company.stage) >= STAGES.indexOf('grow') || candidates.length > 0;
  const tabs: Array<{ key: Tab; label: string; icon: typeof Users }> = [
    { key: 'members', label: 'People', icon: Users },
    { key: 'seats', label: 'Seats', icon: LayoutGrid },
    ...(showHiring ? [{ key: 'hiring' as Tab, label: 'Hiring', icon: UserPlus }] : []),
    ...(isAdmin ? [{ key: 'access' as Tab, label: 'Access', icon: ShieldCheck }] : []),
  ];

  const removeMember = async (m: TeamMember): Promise<void> => {
    if (!(await confirm(`Remove ${m.name}?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('team_members').delete(m.id))
      .catch(() => undefined);
  };

  const removeSeat = async (s: Seat): Promise<void> => {
    if (!(await confirm(`Delete seat "${s.name}"?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('seats').delete(s.id))
      .catch(() => undefined);
  };

  const removeCandidate = async (c: Candidate): Promise<void> => {
    if (!(await confirm(`Delete candidate "${c.name}"?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('candidates').delete(c.id))
      .catch(() => undefined);
  };

  const headerAction =
    tab === 'members' ? (
      <Button
        size="sm"
        onClick={() => {
          setEditingMember(null);
          setMemberOpen(true);
        }}
      >
        <Plus size={14} aria-hidden />
        Add person
      </Button>
    ) : tab === 'seats' ? (
      <Button
        size="sm"
        onClick={() => {
          setEditingSeat(null);
          setSeatOpen(true);
        }}
      >
        <Plus size={14} aria-hidden />
        Add seat
      </Button>
    ) : tab === 'hiring' ? (
      <Button
        size="sm"
        onClick={() => {
          setEditingCandidate(null);
          setCandidateOpen(true);
        }}
      >
        <Plus size={14} aria-hidden />
        Add candidate
      </Button>
    ) : undefined;

  return (
    <div>
      <PageHeader icon={Building2} title="Team" meta={String(members.length)} actions={headerAction} />

      <div className="mb-4 flex gap-1 border-b border-[var(--lui-border)]">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors',
                tab === t.key ? 'font-medium text-[var(--lui-text)]' : 'text-[var(--lui-muted)] hover:text-[var(--lui-text)]',
              )}
            >
              <Icon size={14} aria-hidden />
              {t.label}
              {tab === t.key && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--lui-accent)]" />}
            </button>
          );
        })}
      </div>

      {tab === 'members' &&
        (members.length === 0 ? (
          <GhostState
            icon={Building2}
            title="Nobody here yet"
            message="Add yourself first. Seats and accountability build on the people list."
            action={
              <Button size="sm" onClick={() => setMemberOpen(true)}>
                Add yourself
              </Button>
            }
          >
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              <GhostRows rows={4} />
            </div>
          </GhostState>
        ) : (
          <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
            {members.map((m) => {
              const memberSeats = seats.filter((s) => s.accountable === m.id).map((s) => s.name);
              return (
                <ListRow
                  key={m.id}
                  leading={<IdentityChip name={m.name} />}
                  primary={m.name}
                  secondary={memberSeats.length > 0 ? memberSeats.join(' · ') : m.email}
                  trailing={
                    <Pill tone={m.active ? 'good' : 'neutral'}>{m.active ? 'Active' : 'Inactive'}</Pill>
                  }
                  hoverActions={
                    <>
                      <EditButton
                        onClick={() => {
                          setEditingMember(m);
                          setMemberOpen(true);
                        }}
                      />
                      <DeleteButton label="Remove" onClick={() => void removeMember(m)} />
                    </>
                  }
                  onClick={() => {
                    setEditingMember(m);
                    setMemberOpen(true);
                  }}
                />
              );
            })}
          </div>
        ))}

      {tab === 'seats' &&
        (seats.length === 0 ? (
          <GhostState
            icon={Building2}
            title="No seats defined yet"
            message="A seat is an area of the business (Sales, Delivery, Money) with up to five responsibilities and exactly one accountable person. One person can hold several seats."
            action={
              <Button size="sm" onClick={() => setSeatOpen(true)}>
                Define your first seat
              </Button>
            }
          >
            <GhostCards count={3} />
          </GhostState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {seats.map((seat) => {
              const owner = members.find((m) => m.id === seat.accountable);
              return (
                <Card key={seat.id}>
                  <CardContent className="flex h-full flex-col gap-2.5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{seat.name}</p>
                      {owner !== undefined ? (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--lui-muted)]">
                          <IdentityChip name={owner.name} size="sm" />
                          {owner.name.split(' ')[0]}
                        </span>
                      ) : (
                        <Pill tone="bad">No owner</Pill>
                      )}
                    </div>
                    <ul className="flex flex-1 flex-col gap-1">
                      {(seat.responsibilities ?? []).slice(0, 5).map((r) => (
                        <li key={r} className="flex items-center gap-2 text-xs text-[var(--lui-muted)]">
                          <Dot tone="neutral" />
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-1">
                      <EditButton
                        onClick={() => {
                          setEditingSeat(seat);
                          setSeatOpen(true);
                        }}
                      />
                      <DeleteButton onClick={() => void removeSeat(seat)} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}

      {tab === 'hiring' &&
        (candidates.length === 0 ? (
          <GhostState
            icon={Building2}
            title="No candidates yet"
            message="Add them as they apply and move them stage by stage. Hiring stops being a scramble when it has a pipeline."
            action={
              <Button size="sm" onClick={() => setCandidateOpen(true)}>
                Add a candidate
              </Button>
            }
          >
            <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              <GhostRows rows={4} />
            </div>
          </GhostState>
        ) : (
          <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
            {candidates.map((c) => (
              <ListRow
                key={c.id}
                leading={<IdentityChip name={c.name} />}
                primary={c.name}
                secondary={c.seat !== '' ? `For: ${c.seat}` : undefined}
                trailing={<Pill tone={CANDIDATE_TONE[c.stage]}>{CANDIDATE_LABEL[c.stage]}</Pill>}
                hoverActions={
                  <>
                    <EditButton
                      onClick={() => {
                        setEditingCandidate(c);
                        setCandidateOpen(true);
                      }}
                    />
                    <DeleteButton onClick={() => void removeCandidate(c)} />
                  </>
                }
                onClick={() => {
                  setEditingCandidate(c);
                  setCandidateOpen(true);
                }}
              />
            ))}
          </div>
        ))}

      {tab === 'access' && isAdmin && <AccessManager meId={userId ?? ''} myRole={role ?? ''} />}

      {confirmEl}

      <Dialog open={memberOpen} onOpenChange={setMemberOpen} title={editingMember !== null ? 'Edit person' : 'Add person'}>
        <EntityForm
          collection="team_members"
          fields={MEMBER_FIELDS}
          {...(editingMember !== null ? { initial: editingMember } : { defaults: { active: true } })}
          onSaved={() => setMemberOpen(false)}
          onCancel={() => setMemberOpen(false)}
        />
      </Dialog>
      <Dialog open={seatOpen} onOpenChange={setSeatOpen} title={editingSeat !== null ? 'Edit seat' : 'Add seat'}>
        <EntityForm
          collection="seats"
          fields={SEAT_FIELDS}
          {...(editingSeat !== null ? { initial: editingSeat } : {})}
          onSaved={() => setSeatOpen(false)}
          onCancel={() => setSeatOpen(false)}
        />
      </Dialog>
      <Dialog
        open={candidateOpen}
        onOpenChange={setCandidateOpen}
        title={editingCandidate !== null ? 'Edit candidate' : 'Add candidate'}
      >
        <EntityForm
          collection="candidates"
          fields={CANDIDATE_FIELDS}
          {...(editingCandidate !== null ? { initial: editingCandidate } : { defaults: { stage: 'applied' } })}
          onSaved={() => setCandidateOpen(false)}
          onCancel={() => setCandidateOpen(false)}
        />
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Access: approve / manage login accounts (owner & admin only)        */
/* ------------------------------------------------------------------ */

const ROLE_LABEL: Record<AccessRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  '': 'Member',
};
const ROLE_TONE: Record<AccessRole, Tone> = {
  owner: 'accent',
  admin: 'info',
  member: 'neutral',
  '': 'neutral',
};

function AccessManager({ meId, myRole }: { meId: string; myRole: string }): React.JSX.Element {
  const { records: users } = useCollection<UserAccount>('users', { sort: 'created' });
  const [confirmEl, confirm] = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (u: UserAccount, action: string, confirmMsg?: string): Promise<void> => {
    if (confirmMsg !== undefined && !(await confirm(confirmMsg))) return;
    setBusyId(u.id);
    try {
      await callOp('/api/ops/member-access', { userId: u.id, action });
      const msg =
        action === 'approve'
          ? 'Access granted'
          : action === 'revoke'
            ? 'Access revoked'
            : action === 'make_admin'
              ? 'Now an admin'
              : action === 'make_member'
                ? 'Now a member'
                : action === 'remove'
                  ? 'Account removed'
                  : 'Updated';
      toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update access');
    } finally {
      setBusyId(null);
    }
  };

  const label = (u: UserAccount): string => {
    const name = (u.name ?? '').trim();
    if (name !== '') return name;
    const mail = (u.email ?? '').trim();
    return mail !== '' ? mail : 'Pending account';
  };
  const hasName = (u: UserAccount): boolean => (u.name ?? '').trim() !== '' && (u.email ?? '') !== '';
  const pending = users.filter((u) => !u.approved && u.role !== 'owner');
  const active = users.filter((u) => u.approved || u.role === 'owner');

  const rowFor = (u: UserAccount): React.JSX.Element => {
    const isMe = u.id === meId;
    const targetOwner = u.role === 'owner';
    const role = (u.role ?? '') as AccessRole;
    const busy = busyId === u.id;
    const canRemove = !targetOwner && !isMe && (myRole === 'owner' || (myRole === 'admin' && u.role !== 'admin'));

    return (
      <ListRow
        key={u.id}
        leading={<IdentityChip name={label(u)} />}
        primary={
          <span className="flex items-center gap-2">
            {label(u)}
            {isMe && <span className="text-[11px] text-[var(--lui-muted)]">you</span>}
          </span>
        }
        secondary={hasName(u) ? u.email : undefined}
        trailing={
          <>
            <Pill tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Pill>
            <Pill tone={u.approved ? 'good' : 'warn'}>{u.approved ? 'Active' : 'Pending'}</Pill>
          </>
        }
        hoverActions={
          isMe || targetOwner ? undefined : (
            <>
              {!u.approved ? (
                <Button size="sm" loading={busy} onClick={() => void act(u, 'approve')}>
                  Approve
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(u, 'revoke', `Revoke ${label(u)}’s access?`)}>
                  Revoke
                </Button>
              )}
              {myRole === 'owner' &&
                u.approved &&
                (u.role === 'admin' ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(u, 'make_member')}>
                    Make member
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(u, 'make_admin')}>
                    Make admin
                  </Button>
                ))}
              {canRemove && (
                <DeleteButton
                  label="Remove account"
                  onClick={() => void act(u, 'remove', `Remove ${label(u)}’s account for good? They will lose all access.`)}
                />
              )}
            </>
          )
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-[var(--lui-muted)]">
        Anyone can create an account, but they stay <strong>Pending</strong> — with no access to anything — until you
        approve them here. Owners can also make someone an admin (admins can approve others, but only the owner manages
        admins).
      </p>

      <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
        <GroupHeader label="Pending approval" count={pending.length} />
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--lui-muted)]">
            No one is waiting. New sign-ups will appear here.
          </p>
        ) : (
          pending.map(rowFor)
        )}
      </div>

      <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
        <GroupHeader label="With access" count={active.length} />
        {active.map(rowFor)}
      </div>

      {confirmEl}
    </div>
  );
}
