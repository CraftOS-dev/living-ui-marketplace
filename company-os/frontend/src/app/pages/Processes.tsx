/**
 * Processes: the SOP library as scannable cards (owner chip, category,
 * numbered steps). The empty state offers company-type starter templates
 * (structural, from the company_type enum, mirroring the backend packs).
 */
import { useState } from 'react';
import { Plus, Wrench } from 'lucide-react';
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
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type { Company, CompanyType, Process, TeamMember } from '../lib/types.ts';
import { DeleteButton, EditButton, IdentityChip, PageHeader } from '../components/ui.tsx';

const PROCESS_FIELDS: EntityField[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'category', type: 'text', placeholder: 'e.g. Delivery, Money, People' },
  { name: 'owner_member', label: 'Owner', type: 'ref', ref: { collection: 'team_members', labelField: 'name' } },
  { name: 'steps', label: 'Steps (in order)', type: 'tags' },
];

/** Mirrors the backend's PROCESS_PACKS (static UI starter content). */
const TEMPLATES: Record<CompanyType, ReadonlyArray<{ name: string; steps: string[] }>> = {
  services: [
    { name: 'Onboard a new client', steps: ['Confirm scope and price', 'Sign agreement', 'Kickoff conversation', 'Set follow-up dates'] },
    { name: 'Deliver the work', steps: ['Plan the job', 'Do the work', 'Quality check', 'Hand over and confirm satisfaction'] },
    { name: 'Invoice and get paid', steps: ['Send invoice', 'Record it in Money', 'Chase politely after due date', 'Mark paid'] },
  ],
  retail_ecommerce: [
    { name: 'Fulfill an order', steps: ['Confirm payment', 'Pick and pack', 'Ship and share tracking', 'Follow up for a review'] },
    { name: 'Restock', steps: ['Check stock levels', 'Order from supplier', 'Receive and count', 'Update prices if needed'] },
    { name: 'Handle a return', steps: ['Confirm the issue', 'Approve return', 'Refund or replace', 'Record the cost'] },
  ],
  food_hospitality: [
    { name: 'Open the day', steps: ['Check prep list', 'Confirm staffing', 'Check stock', 'Open service'] },
    { name: 'Close the day', steps: ['Count the till', 'Record the numbers', 'Clean and prep', 'Lock up'] },
    { name: 'Handle a complaint', steps: ['Listen fully', 'Fix it on the spot if possible', 'Log what happened', 'Follow up'] },
  ],
  software_digital: [
    { name: 'Onboard a new customer', steps: ['Welcome message', 'Setup call or guide', 'First-value check-in', 'Ask for feedback'] },
    { name: 'Ship a change', steps: ['Write down the change', 'Build it', 'Test it', 'Tell customers'] },
    { name: 'Handle a support request', steps: ['Acknowledge fast', 'Reproduce and fix or answer', 'Confirm resolution', 'Log the cause'] },
  ],
  other: [
    { name: 'Deliver for a customer', steps: ['Confirm what they need', 'Do the work', 'Check quality', 'Confirm they are happy'] },
    { name: 'Get paid', steps: ['Agree the price', 'Invoice or collect', 'Record it in Money', 'Follow up if late'] },
  ],
};

export function ProcessesPage({ company }: { company: Company }): React.JSX.Element {
  const { records: processes } = useCollection<Process>('processes', { sort: 'name' });
  const { records: members } = useCollection<TeamMember>('team_members');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Process | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const templates = TEMPLATES[company.company_type];

  const remove = async (p: Process): Promise<void> => {
    if (!(await confirm(`Delete process "${p.name}"?`))) return;
    await getPbClient()
      .call((pb) => pb.collection('processes').delete(p.id))
      .catch(() => undefined);
  };

  const addFromTemplate = async (tpl: { name: string; steps: string[] }): Promise<void> => {
    setBusyTemplate(tpl.name);
    try {
      await getPbClient().call((pb) =>
        pb.collection('processes').create({ name: tpl.name, category: '', steps: tpl.steps }),
      );
      toast.success(`Added "${tpl.name}". Edit it until it matches how YOU do it.`);
    } catch {
      /* surfaced by shell */
    } finally {
      setBusyTemplate(null);
    }
  };

  const addButton = (
    <Button
      size="sm"
      onClick={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <Plus size={14} aria-hidden />
      Write a process
    </Button>
  );

  return (
    <div>
      <PageHeader
        icon={Wrench}
        title="Processes"
        meta={processes.length > 0 ? String(processes.length) : undefined}
        subtitle="The few processes your business runs on, at the 20% of detail that covers 80% of cases."
        actions={addButton}
      />

      {processes.length === 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">Start from a template</h3>
            <span className="text-[11px] text-[var(--lui-muted)]">
              pick one for your kind of business, then edit it until it matches reality — or write your own
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <Card key={tpl.name}>
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <p className="text-sm font-semibold">{tpl.name}</p>
                  <ol className="flex flex-1 flex-col gap-1">
                    {tpl.steps.map((s, i) => (
                      <li key={s} className="flex items-baseline gap-2 text-xs text-[var(--lui-muted)]">
                        <span className="text-[10px] font-semibold tabular-nums text-[var(--lui-muted)]/70">{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    loading={busyTemplate === tpl.name}
                    onClick={() => void addFromTemplate(tpl)}
                  >
                    Use template
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {processes.map((p) => {
            const owner = members.find((m) => m.id === p.owner_member);
            return (
              <Card key={p.id}>
                <CardContent className="flex h-full flex-col gap-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      {p.category !== '' && (
                        <p className="text-[11px] uppercase tracking-wider text-[var(--lui-muted)]">{p.category}</p>
                      )}
                    </div>
                    {owner !== undefined && <IdentityChip name={owner.name} size="sm" />}
                  </div>
                  <ol className="flex flex-1 flex-col gap-1">
                    {(p.steps ?? []).map((s, i) => (
                      <li key={s} className="flex items-baseline gap-2 text-xs text-[var(--lui-muted)]">
                        <span className="text-[10px] font-semibold tabular-nums text-[var(--lui-muted)]/70">{i + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <div className="flex items-center gap-1">
                    <EditButton
                      onClick={() => {
                        setEditing(p);
                        setFormOpen(true);
                      }}
                    />
                    <DeleteButton onClick={() => void remove(p)} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen} title={editing !== null ? 'Edit process' : 'Write a process'}>
        <EntityForm
          collection="processes"
          fields={PROCESS_FIELDS}
          {...(editing !== null ? { initial: editing } : {})}
          onSaved={() => setFormOpen(false)}
          onCancel={() => setFormOpen(false)}
        />
      </Dialog>

      {confirmEl}
    </div>
  );
}
