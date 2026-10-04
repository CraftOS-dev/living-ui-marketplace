/**
 * Submit one approval (監修) stage of a product: the stages come from the
 * licence, the reviewer chain is built on the server from the licence
 * (licensing team, committee, original author, talent) plus any outside
 * reviewers picked here, and the server sets the reply date in business
 * days.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Select, Textarea, toast, useRecord } from '../../kit/index.ts';
import { errText, opForm } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, joinList, t } from '../lib/i18n.ts';
import type { AgreementRec, ApprovalRec, ProductRec } from '../lib/records.ts';
import type { ApprovalReviewer } from '../lib/shapes.ts';
import { Checkbox, Field, Notice } from './ui.tsx';
import { ImagePicker, isOpenApproval, reviewerKindLabel, slaDays, stageName, stageTemplates } from './licShared.tsx';

export function SubmitStageDialog({
  product,
  approvals,
  defaultStage,
  onClose,
  onSubmitted,
}: {
  product: ProductRec;
  approvals: ApprovalRec[];
  defaultStage?: string | undefined;
  onClose: () => void;
  onSubmitted?: ((approvalId: string) => void) | undefined;
}): React.JSX.Element {
  const { settings, users } = useApp();
  const agreement = useRecord<AgreementRec>('agreements', product.agreement !== '' ? product.agreement : null);
  const templates = useMemo(() => stageTemplates(agreement.record, settings), [agreement.record, settings]);
  const openStages = new Set(approvals.filter((a) => isOpenApproval(a.status)).map((a) => a.stage as string));
  const approvedStages = new Set(approvals.filter((a) => a.status === 'approved').map((a) => a.stage as string));
  const available = templates.filter((s) => !openStages.has(s.key));
  const suggested =
    defaultStage !== undefined && available.some((s) => s.key === defaultStage)
      ? defaultStage
      : (available.find((s) => !approvedStages.has(s.key))?.key ?? available[0]?.key ?? '');
  const [stagePick, setStagePick] = useState('');
  const stage = stagePick !== '' && available.some((s) => s.key === stagePick) ? stagePick : suggested;
  const tpl = templates.find((s) => s.key === stage);
  const outside = users.filter((u) => u.role === 'reviewer');
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const kinds = (tpl?.reviewers ?? ['internal']).filter((k) => k !== 'reviewer');
  const days = slaDays(agreement.record, tpl, settings);
  const blocked = templates.filter((s) => openStages.has(s.key));

  const submit = async (): Promise<void> => {
    if (stage === '') return;
    setBusy(true);
    try {
      const r = await opForm<{ id: string; stage: string; due_date: string; reviewers: ApprovalReviewer[] }>(
        'products/submit-approval',
        { product_id: product.id, stage, reviewers: picked, notes: notes.trim() },
        files.length > 0 ? { images: files } : undefined,
      );
      toast.success(t('Submitted for approval. Reply due {date}.', { date: fmtDate(r.due_date) }));
      onSubmitted?.(r.id);
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
      title={t('Submit an approval stage')}
      description={t('Send {name} to the reviewers for one stage. The reply date is set in business days by the server.', { name: product.name })}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={stage === ''}>
            {t('Submit')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[66vh] flex-col gap-4 overflow-y-auto pr-1">
        {product.agreement === '' && <Notice tone="warn">{t('This product has no licence yet, so the standard stages and reviewers apply. Set the licence on the Details tab first if there is one.')}</Notice>}
        {available.length === 0 ? (
          <Notice tone="warn">{t('Every stage of this licence already has an open approval. Open it from the Approvals tab instead.')}</Notice>
        ) : (
          <Select label={t('Approval stage')} value={stage} options={available.map((s) => ({ value: s.key, label: stageName(s) }))} onChange={(e) => setStagePick(e.target.value)} />
        )}
        {blocked.length > 0 && available.length > 0 && (
          <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">{t('Already open, so not listed: {list}', { list: joinList(blocked.map(stageName)) })}</p>
        )}
        {tpl !== undefined && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px] leading-relaxed">
            <div>{t('Reviewers from the licence: {list}', { list: joinList(kinds.map((k) => reviewerKindLabel(k))) })}</div>
            <div className="text-xs text-[var(--agent-app-muted)]">{t('Reply due {n} business days after submission.', { n: days })}</div>
            {agreement.record !== null && agreement.record.approval_timeout !== '' && agreement.record.approval_timeout !== 'none' && (
              <div className="text-xs text-[var(--agent-app-muted)]">{t('No reply by then: {outcome}.', { outcome: enumLabel('agreements.approval_timeout', agreement.record.approval_timeout) })}</div>
            )}
          </div>
        )}
        <Field label={t('Outside reviewers')} help={outside.length === 0 ? t('No outside reviewer accounts yet. An admin can invite them in Settings.') : t('They see only the approvals assigned to them.')}>
          {outside.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {outside.map((u) => (
                <Checkbox
                  key={u.id}
                  checked={picked.includes(u.id)}
                  onChange={(v) => setPicked((list) => (v ? [...list, u.id] : list.filter((x) => x !== u.id)))}
                  label={<span className="min-w-0 break-words">{u.name || u.email}</span>}
                />
              ))}
            </div>
          )}
        </Field>
        <Textarea label={t('Notes for the reviewers')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('For example: second colourway, sample photographed under daylight')} />
        <ImagePicker label={t('Images')} files={files} onChange={setFiles} />
      </div>
    </Dialog>
  );
}
