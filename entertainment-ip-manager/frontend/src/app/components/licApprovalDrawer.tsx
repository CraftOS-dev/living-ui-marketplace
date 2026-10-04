/**
 * One approval (監修) in a drawer: the submitted images, the reviewer chain
 * with every answer, the rounds so far, and the decision form for whoever
 * may decide. CraftBot can check the submission against the style guide
 * and write draft comments; a person always decides. Licensing staff can
 * resubmit for a licensee after "changes" or withdraw the item.
 */
import { useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Bot, ExternalLink, Undo2 } from 'lucide-react';
import { Button, Dialog, Drawer, Select, Textarea, cn, toast, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { errText, fileUrl, getRecord, op, opForm, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, fmtDate } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, ApprovalRec, ApprovalRoundRec, PartyRec, ProductRec } from '../lib/records.ts';
import type { ApprovalReviewer } from '../lib/shapes.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { Checkbox, EnumPill, Fact, FactGrid, Field, Notice, Pill, Prose, Ref, Segmented, TONE_TEXT } from './ui.tsx';
import {
  DECISION_TONE,
  ImagePicker,
  RecordImage,
  ReplyDue,
  ReviewerChip,
  SubHead,
  awaitingReviewers,
  decisionLabel,
  isOpenApproval,
  newest,
  reviewerKindLabel,
  reviewerName,
} from './licShared.tsx';

/** A note pinned on a submitted image, at x and y percent of its size. */
interface Pin {
  image: string;
  x: number;
  y: number;
  note: string;
}

function parsePins(v: unknown): Pin[] {
  if (!Array.isArray(v)) return [];
  const out: Pin[] = [];
  for (const p of v) {
    if (typeof p !== 'object' || p === null) continue;
    const o = p as Record<string, unknown>;
    const x = Number(o['x']);
    const y = Number(o['y']);
    out.push({
      image: typeof o['image'] === 'string' ? o['image'] : '',
      x: Number.isFinite(x) ? x : -1,
      y: Number.isFinite(y) ? y : -1,
      note: typeof o['note'] === 'string' ? o['note'] : '',
    });
  }
  return out;
}

const COPYRIGHT_TONE: Record<string, Tone> = { ok: 'good', wrong: 'bad', unchecked: 'neutral' };

/** An image with numbered pins; clicking adds a pin when `onAdd` is given. */
function PinnedImage({
  src,
  pins,
  numberOf,
  onAdd,
  alt,
}: {
  src: string;
  pins: Pin[];
  numberOf: (p: Pin) => number;
  onAdd?: ((x: number, y: number) => void) | undefined;
  alt: string;
}): React.JSX.Element {
  const place = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (onAdd === undefined) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = Math.round(((e.clientX - box.left) / box.width) * 1000) / 10;
    const y = Math.round(((e.clientY - box.top) / box.height) * 1000) / 10;
    onAdd(Math.min(100, Math.max(0, x)), Math.min(100, Math.max(0, y)));
  };
  return (
    <div className={cn('relative border border-[var(--agent-app-border)]', onAdd !== undefined && 'cursor-crosshair')} onClick={place}>
      <img src={src} alt={alt} loading="lazy" className="block w-full" draggable={false} />
      {pins
        .filter((p) => p.x >= 0 && p.y >= 0)
        .map((p) => (
          <span
            key={`${p.x}-${p.y}-${numberOf(p)}`}
            className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--agent-app-accent)] text-[10px] font-bold text-[var(--agent-app-accent-contrast)] shadow"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            title={p.note}
          >
            {numberOf(p)}
          </span>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Decision form                                                       */
/* ------------------------------------------------------------------ */

type Answer = 'approved' | 'changes' | 'rejected';

function DecisionForm({
  a,
  agreement,
  slots,
  comment,
  setComment,
  onDone,
}: {
  a: ApprovalRec;
  agreement: AgreementRec | null;
  slots: ApprovalReviewer[];
  comment: string;
  setComment: (v: string) => void;
  onDone: () => void;
}): React.JSX.Element {
  const { me, can } = useApp();
  const preferred = useMemo(() => {
    const mine = slots.find((r) => me !== null && r.user === me.id);
    if (mine !== undefined) return mine.key;
    const internal = slots.find((r) => r.kind === 'internal');
    if (internal !== undefined && can.licensing) return internal.key;
    return slots[0]?.key ?? '';
  }, [slots, me, can.licensing]);
  const [slotPick, setSlotPick] = useState('');
  const slot = slotPick !== '' && slots.some((s) => s.key === slotPick) ? slotPick : preferred;
  const [answer, setAnswer] = useState<Answer>('approved');
  const [copyright, setCopyright] = useState<'ok' | 'wrong' | 'unchecked'>(a.copyright_check === 'ok' || a.copyright_check === 'wrong' ? a.copyright_check : 'unchecked');
  const [advance, setAdvance] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsComment = answer === 'changes' || answer === 'rejected';
  const slotRec = slots.find((s) => s.key === slot);

  const submit = async (): Promise<void> => {
    if (slot === '') return;
    if (needsComment && comment.trim() === '') {
      setError(t('Say what needs to change. Changes and rejections need a comment.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await opForm<{ id: string; status: string; reviewers: ApprovalReviewer[] }>(
        'approvals/decide',
        {
          approval_id: a.id,
          reviewer_key: slot,
          decision: answer,
          comment: comment.trim(),
          copyright_check: copyright,
          annotations: pins.map((p) => ({ image: p.image, x: p.x, y: p.y, note: p.note.trim() })),
          advance: answer === 'approved' && advance,
        },
        files.length > 0 ? { images: files } : undefined,
      );
      const msg =
        r.status === 'approved'
          ? t('Stage approved.')
          : r.status === 'changes_requested'
            ? t('Sent back to the licensee for changes.')
            : r.status === 'rejected'
              ? t('Stage rejected.')
              : t('Decision recorded. Waiting on the other reviewers.');
      toast.success(msg);
      setComment('');
      setFiles([]);
      setPins([]);
      setAnswer('approved');
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const numberOf = (p: Pin): number => pins.indexOf(p) + 1;

  return (
    <section className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
      <SubHead>{t('Record a decision for round {n}', { n: a.round || 1 })}</SubHead>
      {slots.length > 1 ? (
        <Select
          label={t('Answering for')}
          value={slot}
          options={slots.map((r) => ({ value: r.key, label: `${reviewerName(r)} (${reviewerKindLabel(r.kind)})` }))}
          onChange={(e) => setSlotPick(e.target.value)}
        />
      ) : slotRec !== undefined ? (
        <p className="text-[13px]">{t('Answering for {name}', { name: `${reviewerName(slotRec)} (${reviewerKindLabel(slotRec.kind)})` })}</p>
      ) : null}
      <Field label={t('Decision')}>
        <Segmented<Answer>
          value={answer}
          onChange={setAnswer}
          ariaLabel={t('Decision')}
          options={[
            { value: 'approved', label: t('Approve'), tone: 'good' },
            { value: 'changes', label: t('Request changes'), tone: 'warn' },
            { value: 'rejected', label: t('Reject|approval'), tone: 'bad' },
          ]}
        />
      </Field>
      <Textarea
        label={needsComment ? t('Comment to the licensee (required)') : t('Comment to the licensee')}
        rows={4}
        value={comment}
        error={error !== '' ? error : undefined}
        placeholder={t('What to change and where, one point per line.')}
        onChange={(e) => setComment(e.target.value)}
      />
      <Field
        label={t('Copyright line and logo use')}
        help={agreement !== null && agreement.copyright_notice !== '' ? t('The licence says: {line}', { line: agreement.copyright_notice }) : t('The licence has no copyright line on file.')}
      >
        <Segmented<'ok' | 'wrong' | 'unchecked'>
          value={copyright}
          onChange={setCopyright}
          ariaLabel={t('Copyright line and logo use')}
          options={[
            { value: 'ok', label: enumLabel('approvals.copyright_check', 'ok'), tone: 'good' },
            { value: 'wrong', label: enumLabel('approvals.copyright_check', 'wrong'), tone: 'bad' },
            { value: 'unchecked', label: enumLabel('approvals.copyright_check', 'unchecked') },
          ]}
        />
      </Field>
      {answer === 'approved' && <Checkbox checked={advance} onChange={setAdvance} label={t('Move the product to the next stage when the stage is approved')} />}

      {a.images.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Mark up the images (optional)')}</span>
          <p className="text-xs text-[var(--agent-app-muted)]">{t('Click an image to pin a numbered note where something needs to change.')}</p>
          <div className="grid grid-cols-2 gap-2">
            {a.images.map((img) => (
              <PinnedImage
                key={img}
                src={fileUrl(a, img, '400x0')}
                alt={t('Submitted image')}
                pins={pins.filter((p) => p.image === img)}
                numberOf={numberOf}
                onAdd={(x, y) => setPins((list) => [...list, { image: img, x, y, note: '' }])}
              />
            ))}
          </div>
          {pins.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {pins.map((p, i) => (
                <li key={`${p.image}-${p.x}-${p.y}-${i}`} className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--agent-app-accent)] text-[10px] font-bold text-[var(--agent-app-accent-contrast)]">{i + 1}</span>
                  <input
                    className="h-8 min-w-0 flex-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm"
                    aria-label={t('Note {n}', { n: i + 1 })}
                    placeholder={t('What to change here')}
                    value={p.note}
                    onChange={(e) => setPins((list) => list.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                  />
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setPins((list) => list.filter((_, j) => j !== i))}>
                    {t('Remove')}
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <ImagePicker label={t('Reference images (optional)')} files={files} onChange={setFiles} help={t('For example a corrected colour sample or a marked-up scan.')} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} loading={busy} disabled={slot === ''}>
          {answer === 'approved' ? t('Approve') : answer === 'changes' ? t('Request changes') : t('Reject|approval')}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Resubmit and withdraw                                               */
/* ------------------------------------------------------------------ */

function ResubmitForm({ a, onDone }: { a: ApprovalRec; onDone: () => void }): React.JSX.Element {
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await opForm<{ id: string; round: number; due_date: string }>('approvals/resubmit', { approval_id: a.id, notes: notes.trim() }, files.length > 0 ? { images: files } : undefined);
      toast.success(t('Round {n} submitted. Reply due {date}.', { n: r.round, date: fmtDate(r.due_date) }));
      setNotes('');
      setFiles([]);
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
      <SubHead>{t('Resubmit for the licensee')}</SubHead>
      <p className="text-xs text-[var(--agent-app-muted)]">
        {t('Starts round {n}. Reviewers who asked for changes answer again; the reply date is counted afresh.', { n: (a.round || 1) + 1 })}
      </p>
      <Textarea label={t('What changed')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('For example: logo moved, colours corrected to the style guide')} />
      <ImagePicker label={t('New images')} files={files} onChange={setFiles} help={t('New images replace the ones on file. Leave empty to keep them.')} />
      <div>
        <Button onClick={() => void submit()} loading={busy}>
          {t('Resubmit')}
        </Button>
      </div>
    </section>
  );
}

function WithdrawDialog({ a, onClose, onDone }: { a: ApprovalRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await op<{ id: string; status: string }>('approvals/withdraw', { approval_id: a.id, reason: reason.trim() });
      toast.success(t('Approval withdrawn'));
      onDone();
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Withdraw this approval?')}
      description={t('The item closes and stays in the history. Submit the stage again to restart it.')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={reason.trim() === ''}>
            {t('Withdraw')}
          </Button>
        </>
      }
    >
      <Textarea label={t('Reason')} rows={3} value={reason} autoFocus placeholder={t('For example: the licensee dropped this item')} onChange={(e) => setReason(e.target.value)} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

function timeoutHelp(outcome: string): string {
  if (outcome === 'deemed_approved') return t('If the reply is late, the licence treats the stage as approved.');
  if (outcome === 'deemed_refused') return t('If the reply is late, the licence treats the stage as refused.');
  return t('A late reply changes nothing under the licence; chase the reviewers.');
}

export function ApprovalDrawer({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { can, me, userName, on } = useApp();
  const live = useRecord<ApprovalRec>('approvals', id);
  const [saved, setSaved] = useState<ApprovalRec | null>(null);
  const a = newest(live.record, saved !== null && saved.id === id ? saved : null);
  const product = useRecord<ProductRec>('products', a !== null && a.product !== '' ? a.product : null);
  const agreement = useRecord<AgreementRec>('agreements', a !== null && a.agreement !== '' ? a.agreement : null);
  const licenseeId = product.record?.licensee ?? '';
  const licensee = useRecord<PartyRec>('parties', licenseeId !== '' ? licenseeId : null);
  const rounds = useCollection<ApprovalRoundRec>('approval_rounds', { filter: `approval = ${q(id)}`, sort: '-created' });
  const [comment, setComment] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [withdraw, setWithdraw] = useState(false);

  const reload = async (): Promise<void> => {
    try {
      setSaved(await getRecord<ApprovalRec>('approvals', id));
    } catch {
      /* deleted meanwhile */
    }
    rounds.refresh();
  };

  const reviewers = a?.reviewers ?? [];
  const slots = a !== null && awaitingReviewers(a.status) ? reviewers.filter((r) => r.decision === 'pending' && (can.edit || (me !== null && me.role === 'reviewer' && r.user === me.id))) : [];

  const askCraftBot = async (): Promise<void> => {
    if (a === null) return;
    setAsking(true);
    const rid = await handToCraftBot('approval_review_requested', { approval_id: a.id });
    setAsking(false);
    if (rid !== null) setRequestId(rid);
  };

  const keyName = (key: string): string => {
    // Submission rows (one per round) carry the submitted notes and images.
    if (key === 'submission') return t('Submitted for review');
    const r = reviewers.find((x) => x.key === key);
    return r !== undefined ? reviewerName(r) : key;
  };

  const title = product.record !== null ? product.record.name : t('Approval');

  return (
    <Drawer open onClose={onClose} title={title} width={680}>
      {a === null ? (
        <p className="text-sm text-[var(--agent-app-muted)]">{live.loading ? t('Loading') : t('This approval no longer exists or is not visible to you.')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <EnumPill field="approvals.status" value={a.status} />
            <span className="text-[13px] font-medium">{enumLabel('approvals.stage', a.stage)}</span>
            <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Round {n}', { n: a.round || 1 })}</span>
            <ReplyDue a={a} />
          </div>

          <FactGrid cols={2}>
            <Fact
              label={t('Product')}
              value={
                product.record !== null ? (
                  on('products') ? (
                    <a className="hover:underline" href={href('product', product.record.id)}>
                      <Ref className="mr-1.5">{product.record.ref}</Ref>
                      {product.record.name}
                    </a>
                  ) : (
                    <span>
                      <Ref className="mr-1.5">{product.record.ref}</Ref>
                      {product.record.name}
                    </span>
                  )
                ) : (
                  ''
                )
              }
            />
            <Fact label={t('Licensee')} value={licensee.record?.name ?? ''} />
            <Fact
              label={t('Licence')}
              value={
                agreement.record !== null ? (
                  <a className="hover:underline" href={href('agreement', agreement.record.id)}>
                    <Ref>{agreement.record.ref}</Ref> {agreement.record.title}
                  </a>
                ) : (
                  ''
                )
              }
            />
            <Fact label={t('Submitted')} value={fmtDate(a.submitted_at)} />
            <Fact label={t('Reply due')} value={d10(a.due_date) !== '' ? <ReplyDue a={a} className="text-[13px]" /> : ''} />
            <Fact label={t('If the reply is late')} value={<span title={timeoutHelp(a.timeout_outcome)}>{enumLabel('approvals.timeout_outcome', a.timeout_outcome || 'none')}</span>} />
            <Fact
              label={t('Copyright line check')}
              value={
                <Pill tone={COPYRIGHT_TONE[a.copyright_check] ?? 'neutral'}>{enumLabel('approvals.copyright_check', a.copyright_check || 'unchecked')}</Pill>
              }
            />
            {a.decided_by !== '' && <Fact label={t('Closed by')} value={`${userName(a.decided_by)}${d10(a.decided_at) !== '' ? `, ${fmtDate(a.decided_at)}` : ''}`} />}
          </FactGrid>
          <p className="-mt-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
            {t('The reply date is counted in business days on the organization calendar from the day of submission.')} {timeoutHelp(a.timeout_outcome)}
          </p>
          {a.notes !== '' && <Prose className="border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{a.notes}</Prose>}

          <section>
            <SubHead>{t('Submitted images')}</SubHead>
            {a.images.length === 0 ? (
              <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No images with this round.')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {a.images.map((img) => (
                  <RecordImage key={img} src={fileUrl(a, img, '400x0')} full={fileUrl(a, img)} alt={t('Submitted image')} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SubHead>{t('Reviewers')}</SubHead>
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {reviewers.map((r) => (
                <li key={r.key} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ReviewerChip r={r} />
                    <span className="text-xs text-[var(--agent-app-muted)]">{reviewerKindLabel(r.kind)}</span>
                    <span className={cn('ml-auto text-xs', TONE_TEXT[DECISION_TONE[r.decision] ?? 'neutral'])}>
                      {decisionLabel(r.decision)}
                      {r.decided_at !== undefined && r.decided_at !== '' ? ` · ${fmtDate(r.decided_at)}` : ''}
                      {r.decided_by !== undefined && r.decided_by !== '' ? ` · ${userName(r.decided_by)}` : ''}
                    </span>
                  </div>
                  {r.comment !== undefined && r.comment !== '' && <Prose className="mt-1 text-[var(--agent-app-text)]/85">{r.comment}</Prose>}
                  {r.previous_comment !== undefined && r.previous_comment !== '' && (
                    <p className="mt-1 text-xs text-[var(--agent-app-muted)]">
                      {t('Earlier round:')} <span className="whitespace-pre-wrap">{r.previous_comment}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {(a.draft_comments !== '' || (can.edit && awaitingReviewers(a.status))) && (
            <section className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-3">
              <SubHead
                right={
                  can.edit && awaitingReviewers(a.status) ? (
                    <Button size="sm" variant="outline" onClick={() => void askCraftBot()} loading={asking}>
                      <Bot size={13} aria-hidden /> {t('Ask CraftBot to check against the style guide')}
                    </Button>
                  ) : undefined
                }
              >
                {t('CraftBot review')}
              </SubHead>
              <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
                {t('CraftBot compares the images with the style guide, the copyright line and the licence, and writes draft comments. It never decides; you do.')}
              </p>
              <AgentStatus requestId={requestId} workingText={t('CraftBot is checking the submission...')} doneText={t('CraftBot wrote draft comments.')} onDone={() => void reload()} compact />
              {a.draft_comments !== '' && (
                <div className="flex flex-col gap-2 border-l-2 border-[var(--agent-app-accent)] pl-3">
                  <Prose>{a.draft_comments}</Prose>
                  {slots.length > 0 && (
                    <div>
                      <Button size="sm" variant="outline" onClick={() => setComment(a.draft_comments)}>
                        {t('Use these comments')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {slots.length > 0 && <DecisionForm a={a} agreement={agreement.record} slots={slots} comment={comment} setComment={setComment} onDone={() => void reload()} />}
          {awaitingReviewers(a.status) && slots.length === 0 && !can.edit && <Notice>{t('Decisions are recorded by the licensing team and the assigned reviewers. You can follow every round here.')}</Notice>}

          {a.status === 'changes_requested' && can.licensing && <ResubmitForm a={a} onDone={() => void reload()} />}

          <section>
            <SubHead>{t('Rounds')}</SubHead>
            {rounds.records.length === 0 ? (
              <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No answers yet. Every decision is kept here with its comments and images.')}</p>
            ) : (
              <ol className="flex flex-col border border-[var(--agent-app-border)]">
                {rounds.records.map((r) => {
                  const pins = parsePins(r.annotations);
                  const pinNo = (p: Pin): number => pins.indexOf(p) + 1;
                  const pinnedImages = [...new Set(pins.map((p) => p.image))].filter((img) => img !== '' && a.images.includes(img));
                  return (
                    <li key={r.id} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums">{t('Round {n}', { n: r.round || 1 })}</span>
                        <span className="min-w-0 truncate text-xs">{keyName(r.reviewer_key)}</span>
                        <EnumPill field="approval_rounds.status" value={r.status} />
                        <span className="ml-auto text-xs text-[var(--agent-app-muted)]" title={r.created}>
                          {r.decided_by_name !== '' ? r.decided_by_name : userName(r.decided_by)}
                          {r.decided_by_name !== '' || r.decided_by !== '' ? ', ' : ''}
                          {ago(r.created)}
                        </span>
                        <DeleteButton
                          collection="approval_rounds"
                          id={r.id}
                          iconOnly
                          label={t('Delete this round')}
                          note={t('The approval keeps its current status. The licensee no longer sees this round in the portal either.')}
                        />
                      </div>
                      {r.comment !== '' && <Prose className="mt-1 text-[var(--agent-app-text)]/85">{r.comment}</Prose>}
                      {pins.length > 0 && (
                        <div className="mt-2 flex flex-col gap-2">
                          {pinnedImages.length > 0 && (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {pinnedImages.map((img) => (
                                <PinnedImage key={img} src={fileUrl(a, img, '400x0')} alt={t('Submitted image')} pins={pins.filter((p) => p.image === img)} numberOf={pinNo} />
                              ))}
                            </div>
                          )}
                          <ol className="flex flex-col gap-0.5 text-xs">
                            {pins.map((p, i) => (
                              <li key={`${p.image}-${i}`} className="flex gap-1.5">
                                <span className="font-semibold tabular-nums">{i + 1}.</span>
                                <span className="min-w-0 break-words">{p.note !== '' ? p.note : t('(no note)')}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {r.images.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.images.map((img) => (
                            <RecordImage key={img} src={fileUrl(r, img, '100x100')} full={fileUrl(r, img)} alt={t('Reference image')} className="w-12" />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)] pt-3">
            {product.record !== null && on('products') && (
              <a href={href('product', product.record.id, { tab: 'approvals' })} className="inline-flex items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline">
                <ExternalLink size={12} aria-hidden /> {t('Open the product')}
              </a>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {isOpenApproval(a.status) && can.licensing && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setWithdraw(true)}>
                  <Undo2 size={13} aria-hidden /> {t('Withdraw')}
                </Button>
              )}
              <DeleteButton collection="approvals" id={a.id} onDeleted={onClose} />
            </div>
          </div>
          {withdraw && <WithdrawDialog a={a} onClose={() => setWithdraw(false)} onDone={() => void reload()} />}
        </div>
      )}
    </Drawer>
  );
}
