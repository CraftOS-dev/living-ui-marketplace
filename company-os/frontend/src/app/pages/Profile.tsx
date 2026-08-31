/**
 * Company Profile: the whole strategy on one page (the 2-page V/TO idea,
 * compressed). Each section is a titled card with an icon and a hint that
 * previews the filled state; values render as chips. One AI assist: draft
 * the EMPTY fields; degrades honestly without the bridge.
 */
import { useState } from 'react';
import {
  BookOpen,
  CalendarRange,
  Coins,
  Compass,
  Heart,
  Package,
  Sparkles,
  Telescope,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, TagInput, Textarea, getPbClient, toast } from '../../kit/index.ts';
import { callOp, OpError } from '../lib/ops.ts';
import type { Company } from '../lib/types.ts';
import { PageHeader } from '../components/ui.tsx';

type TextField =
  | 'mission'
  | 'who_we_serve'
  | 'offer'
  | 'how_money'
  | 'three_year_picture'
  | 'year_goals';

const SECTIONS: ReadonlyArray<{ field: TextField; title: string; hint: string; icon: LucideIcon }> = [
  { field: 'mission', title: 'Why we exist', hint: 'The problem you solve, in one honest sentence.', icon: Compass },
  { field: 'who_we_serve', title: 'Who we serve', hint: 'The people or businesses you are for.', icon: Users },
  { field: 'offer', title: 'What we offer', hint: 'Your product or service, and roughly what it costs.', icon: Package },
  { field: 'how_money', title: 'How we make money', hint: 'Where the money actually comes from.', icon: Coins },
  { field: 'three_year_picture', title: 'Three years from now', hint: 'What does the company look like if this works?', icon: Telescope },
  { field: 'year_goals', title: 'This year', hint: 'The few things that must be true by December.', icon: CalendarRange },
];

export function ProfilePage({ company }: { company: Company }): React.JSX.Element {
  const [drafts, setDrafts] = useState<Partial<Record<TextField, string>>>({});
  const [values, setValues] = useState<string[]>(company.values_list ?? []);
  const [aiBusy, setAiBusy] = useState(false);

  const filledCount = SECTIONS.filter((s) => String(company[s.field]).trim() !== '').length;

  const save = async (field: TextField): Promise<void> => {
    const draft = drafts[field];
    if (draft === undefined || draft === company[field]) return;
    try {
      await getPbClient().call((pb) => pb.collection('company').update(company.id, { [field]: draft }));
      toast.success('Saved');
      // Profile fields feed Journey rules (plan_started, offer_filled): let the
      // engine mark those steps done from the saved record. Best-effort.
      await callOp('/api/ops/journey-autocheck').catch(() => undefined);
    } catch {
      /* surfaced by shell */
    }
  };

  const saveValues = async (next: string[]): Promise<void> => {
    setValues(next.slice(0, 5));
    await getPbClient()
      .call((pb) => pb.collection('company').update(company.id, { values_list: next.slice(0, 5) }))
      .catch(() => undefined);
  };

  const draftWithAi = async (): Promise<void> => {
    setAiBusy(true);
    try {
      const res = await callOp<{ filled: string[] }>('/api/ops/ai-draft-plan');
      if (res.filled.length === 0) {
        toast.info('Nothing to draft, the empty fields are already filled');
      } else {
        toast.success(`Drafted ${res.filled.length} field(s). Edit them until they sound like you.`);
      }
    } catch (err) {
      if (err instanceof OpError && err.status === 503) {
        toast.info('AI assist unavailable right now, the page works fine without it');
      } else {
        toast.error(err instanceof Error ? err.message : 'Draft failed');
      }
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={BookOpen}
        title="Company Profile"
        meta={`${filledCount}/${SECTIONS.length} sections filled`}
        subtitle="Your whole plan on one page. Short beats complete, and you can change it any time."
        actions={
          <Button size="sm" variant="secondary" loading={aiBusy} onClick={() => void draftWithAi()}>
            <Sparkles size={14} aria-hidden />
            Draft empty fields with AI
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.field} className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
              <div className="flex items-center gap-2 border-b border-[var(--lui-border)] px-4 py-2.5">
                <Icon size={14} aria-hidden className="text-[var(--lui-muted)]" />
                <h2 className="text-[13px] font-semibold">{s.title}</h2>
              </div>
              <div className="p-3">
                <Textarea
                  aria-label={s.title}
                  placeholder={s.hint}
                  rows={3}
                  className="border-transparent bg-transparent px-1 py-0.5 text-[13px] leading-relaxed transition-colors hover:border-[var(--lui-border)] focus:border-[var(--lui-border)]"
                  value={drafts[s.field] ?? company[s.field]}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [s.field]: e.target.value }))}
                  onBlur={() => void save(s.field)}
                />
              </div>
            </div>
          );
        })}

        <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)] lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-[var(--lui-border)] px-4 py-2.5">
            <Heart size={14} aria-hidden className="text-[var(--lui-muted)]" />
            <h2 className="text-[13px] font-semibold">Values</h2>
            <span className="text-xs text-[var(--lui-muted)]">up to 5, the behaviors you hire, praise, and part ways over</span>
          </div>
          <div className="p-4">
            <TagInput value={values} onChange={(tags) => void saveValues(tags)} />
          </div>
        </div>
      </div>
    </div>
  );
}
