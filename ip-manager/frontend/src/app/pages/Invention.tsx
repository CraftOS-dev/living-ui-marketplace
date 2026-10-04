/**
 * One invention disclosure. The submitter edits and submits their draft
 * (with CraftBot's help if they want it); the IP team edits any time,
 * moves the stage with a decision note, scores it as a committee and turns
 * an approved invention into a filing.
 */
import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, FilePlus2, Lightbulb, Send, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Select, Tabs, TabsContent, TabsList, TabsTrigger, toast, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { getRecord, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { DISCLOSURE_STAGE_LABEL, DISCLOSURE_STAGE_TONE, IP_TYPE_LABEL, STATUS_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { DisclosureRec, DisclosureStage, InvolvementRec, MatterRec } from '../lib/types.ts';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, Loading, Notice, Pill, Ref } from '../components/ui.tsx';
import { MOVE_STAGES, ScoreBar, stampDay, useStageMover } from '../components/inventShared.tsx';
import {
  AskCraftBotPanel,
  DisclosureFormView,
  InventorAttachments,
  InventorsPanel,
  SubmitDialog,
  useDeleteDraft,
  useDisclosureForm,
} from '../components/inventForm.tsx';
import { ConvertDialog, HistoryPanel, ReviewPanel } from '../components/inventReview.tsx';

function newer(a: DisclosureRec | null, b: DisclosureRec | null): DisclosureRec | null {
  if (a === null) return b;
  if (b === null || b.id !== a.id) return a;
  return b.updated > a.updated ? b : a;
}

const CONVERTIBLE: DisclosureStage[] = ['approved', 'review', 'drafting'];

export function InventionPage({ id }: { id: string }): React.JSX.Element {
  const { me, role, can, userName } = useApp();
  const live = useRecord<DisclosureRec>('disclosures', id !== '' ? id : null);
  const [fresh, setFresh] = useState<DisclosureRec | null>(null);
  const d = newer(live.record, fresh);
  const f = useDisclosureForm(d, setFresh);
  const matter = useRecord<MatterRec>('matters', can.read && d !== null && d.matter !== '' ? d.matter : null);
  const inventors = useCollection<InvolvementRec>('involvements', { filter: `disclosure = ${q(id)} && role = "inventor"` });
  const [tab, setTab] = useHashParam('tab', 'details');
  const [target, setTarget] = useState<DisclosureStage | ''>('');
  const [convert, setConvert] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback((): void => {
    if (id === '') return;
    getRecord<DisclosureRec>('disclosures', id)
      .then(setFresh)
      .catch(() => undefined);
  }, [id]);
  const mover = useStageMover(() => {
    setTarget('');
    reload();
  });
  const del = useDeleteDraft(d, () => navigate('inventions'));

  if (live.loading && d === null) return <Loading />;
  if (d === null) {
    return (
      <EmptyHint
        icon={Lightbulb}
        title="Invention not found"
        message="It may have been deleted, or you do not have access to it."
        action={
          <a href={href('inventions')} className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline">
            Back to inventions
          </a>
        }
      />
    );
  }

  const isSubmitter = me !== null && d.submitted_by === me.id;
  const editable = can.edit || (isSubmitter && d.stage === 'draft');
  const canSubmit = d.stage === 'draft' && (isSubmitter || can.edit);
  const canDelete = d.stage === 'draft' && (isSubmitter || can.manage);
  const convertible = can.edit && d.matter === '' && CONVERTIBLE.includes(d.stage);
  const stageOptions = (MOVE_STAGES.includes(d.stage) ? MOVE_STAGES : [d.stage, ...MOVE_STAGES]).map((s) => ({ value: s, label: DISCLOSURE_STAGE_LABEL[s] }));
  const chosen = target === '' ? d.stage : target;
  const decisionTone: Tone = d.stage === 'rejected' ? 'bad' : d.stage === 'on_hold' ? 'warn' : 'info';
  const hasInventors = inventors.records.length > 0 || (f.form?.inventor_names.trim() ?? '') !== '';

  const doSubmit = async (): Promise<void> => {
    if (f.dirty && !(await f.save())) return;
    try {
      await op('disclosures/submit', { id: d.id });
      toast.success('Submitted. The IP team has been notified.');
      setSubmitting(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const details = (
    <DisclosureFormView
      d={d}
      f={f}
      editable={editable}
      showInventorNames={!can.edit && (editable || role === 'inventor')}
      aside={
        <>
          {editable && <AskCraftBotPanel d={d} f={f} onFinished={reload} />}
          {can.read && (can.edit || inventors.records.length > 0) && <InventorsPanel d={d} editable={can.edit} />}
          {role === 'inventor' ? (
            <InventorAttachments d={d} />
          ) : (
            <DocumentsPanel relation="disclosure" relationId={d.id} title="Attachments" defaultType="disclosure" />
          )}
        </>
      }
    />
  );

  return (
    <div>
      <a href={href('inventions')} className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
        <ArrowLeft size={12} aria-hidden /> {role === 'inventor' ? 'My inventions' : 'Inventions'}
      </a>

      <Card className="mb-4">
        <CardContent className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {d.ref !== '' && <Ref>{d.ref}</Ref>}
                <Pill tone={DISCLOSURE_STAGE_TONE[d.stage]}>{DISCLOSURE_STAGE_LABEL[d.stage]}</Pill>
              </div>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{d.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--agent-app-muted)]">
                <span>Submitted by {userName(d.submitted_by) || 'an unknown person'}</span>
                <span>{d10(d.submitted_at) !== '' ? `on ${fmtDate(stampDay(d.submitted_at))}` : 'Not submitted yet'}</span>
                {can.read && (
                  <span className="inline-flex items-center gap-1.5">
                    Score <ScoreBar score={d.score} reviews={d.review_count} />
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canDelete && (
                <Button variant="ghost" size="sm" onClick={del.run}>
                  <Trash2 size={13} aria-hidden /> Delete draft
                </Button>
              )}
              {convertible && (
                <Button variant="outline" onClick={() => setConvert(true)}>
                  <FilePlus2 size={14} aria-hidden /> Convert to a filing
                </Button>
              )}
              {canSubmit && (
                <Button onClick={() => setSubmitting(true)}>
                  <Send size={14} aria-hidden /> Submit for review
                </Button>
              )}
            </div>
          </div>
          {can.edit && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Stage</span>
              <div className="w-52">
                <Select aria-label="Move to stage" value={chosen} options={stageOptions} onChange={(e) => setTarget(e.target.value as DisclosureStage)} />
              </div>
              <Button size="sm" variant="outline" disabled={chosen === d.stage} onClick={() => mover.request(d, chosen)}>
                <ArrowRightLeft size={13} aria-hidden /> Move
              </Button>
              {chosen === d.stage && <span className="text-xs text-[var(--agent-app-muted)]">Choose a stage to move to. Not pursued and On hold ask for a decision note.</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-col gap-3">
        {d.decision !== '' && (
          <Notice tone={decisionTone}>
            <span className="font-medium">Decision{d10(d.decision_at) !== '' ? ` (${fmtDate(stampDay(d.decision_at))})` : ''}: </span>
            {d.decision}
          </Notice>
        )}
        {d.matter !== '' &&
          (can.read && matter.record !== null ? (
            <a
              href={href('matter', matter.record.id)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3 text-[13px] transition-colors hover:border-[var(--agent-app-accent)]/50"
            >
              <FilePlus2 size={15} className="text-[var(--agent-app-muted)]" aria-hidden />
              <span className="font-medium">Filing</span>
              <Ref>{matter.record.ref}</Ref>
              <span className="min-w-0 truncate">{matter.record.title}</span>
              <span className="text-[var(--agent-app-muted)]">
                {IP_TYPE_LABEL[matter.record.ip_type]}, {STATUS_LABEL[matter.record.status]}
              </span>
              <span className="ml-auto font-medium text-[var(--agent-app-accent)]">Open the filing</span>
            </a>
          ) : (
            <Notice tone="good">The IP team opened a filing for this invention.</Notice>
          ))}
        {d.stage === 'draft' && isSubmitter && !can.edit && (
          <Notice tone="info">This is a draft. Only you and the IP team can see it. Fill in the sections, save, then submit it for review.</Notice>
        )}
        {d.stage !== 'draft' && isSubmitter && !can.edit && (
          <Notice tone="info">
            Submitted{d10(d.submitted_at) !== '' ? ` on ${fmtDate(stampDay(d.submitted_at))}` : ''}. The IP team reviews it and you are notified when it moves. You can still add attachments.
          </Notice>
        )}
      </div>

      {can.edit ? (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="details">Disclosure</TabsTrigger>
              <TabsTrigger value="review">Review{d.review_count > 0 ? ` (${d.review_count})` : ''}</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="details">{details}</TabsContent>
          <TabsContent value="review">
            <ReviewPanel d={d} onSaved={reload} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryPanel recordId={d.id} />
          </TabsContent>
        </Tabs>
      ) : (
        details
      )}

      {mover.dialog}
      {del.el}
      {convert && <ConvertDialog d={d} onClose={() => setConvert(false)} />}
      {submitting && f.form !== null && <SubmitDialog form={f.form} hasInventors={hasInventors} onClose={() => setSubmitting(false)} onSubmit={doSubmit} />}
    </div>
  );
}
