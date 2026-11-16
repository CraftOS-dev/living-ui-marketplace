/**
 * Lifecycle dialogs: start a checklist, write a letter (from a template or
 * by your AI agent), record or hand in a separation, add or issue an asset.
 * Each is one short column with defaults; after it the next step is offered.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sparkle } from 'lucide-react';
import { majorParam, Button, DayPicker, Dialog, Field, Input, MoneyInput, Notice, Picker, Segmented, Textarea, toast } from '../ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { addDays, dayKey } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { ASSET_READS, LETTER_READS, SEPARATION_READS, TASK_READS, useEntities, usePeopleItems, LabeledToggle } from './bits.tsx';
import type { Asset, ChecklistKind, ChecklistTemplate, LetterRow, LetterTemplate, Separation } from './types.ts';

/* ------------------------------------------------------- start checklist */

export function StartChecklistDialog({ open, onClose, employee, kind: kind0 }: { open: boolean; onClose: () => void; employee?: string | undefined; kind?: ChecklistKind | undefined }): React.JSX.Element {
  const people = usePeopleItems();
  const [who, setWho] = useState(employee ?? '');
  const [kind, setKind] = useState<ChecklistKind>(kind0 ?? 'onboarding');
  const [template, setTemplate] = useState('');
  const [anchor, setAnchor] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tpls = useOp<{ templates: ChecklistTemplate[] }>('checklist-templates.list', { kind }, ['checklist_templates'], { name: 'lifecycle.tpl.' + kind, skip: !open });
  useEffect(() => {
    if (open) {
      setWho(employee ?? '');
      setErr(null);
      setAnchor('');
      setTemplate('');
    }
  }, [open, employee]);
  const items = (tpls.data?.templates ?? []).map((x) => ({ value: x.id, label: x.name, sub: [x.entity_name || t('lifecycle.all_entities'), t('lifecycle.n_tasks', { n: x.task_count }), x.is_default ? t('lifecycle.default') : ''].filter((s) => s !== '').join(' · ') }));
  const submit = async (): Promise<void> => {
    if (who === '') return setErr(t('lifecycle.pick_person'));
    setBusy(true);
    setErr(null);
    try {
      const r = await op<{ checklist: { id: string } }>('checklists.start', { employment: who, kind, template: template === '' ? undefined : template, anchor_day: anchor === '' ? undefined : anchor }, { quiet: true });
      changed(...TASK_READS);
      onClose();
      navigate(`/lifecycle/checklists/${r.checklist.id}`);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.start_checklist')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {t('lifecycle.start')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.person')}>
          <Picker value={who} onChange={(v) => setWho(v)} items={people} label={t('lifecycle.f.person')} placeholder={t('lifecycle.pick_person')} />
        </Field>
        <Field label={t('lifecycle.f.kind')}>
          <Segmented
            value={kind}
            onChange={(v) => (setKind(v), setTemplate(''))}
            label={t('lifecycle.f.kind')}
            options={[
              { value: 'onboarding', label: kindName2('onboarding') },
              { value: 'offboarding', label: kindName2('offboarding') },
              { value: 'custom', label: kindName2('custom') },
            ]}
          />
        </Field>
        <Field label={t('lifecycle.f.template')} hint={template === '' ? t('lifecycle.template_default_hint') : undefined}>
          <Picker value={template} onChange={(v) => setTemplate(v)} items={items} label={t('lifecycle.f.template')} placeholder={t('lifecycle.entity_default')} clearable />
        </Field>
        <Field label={t('lifecycle.f.anchor')} optional hint={t(`lifecycle.anchor_hint.${kind}`)}>
          <DayPicker value={anchor} onChange={setAnchor} label={t('lifecycle.f.anchor')} clearable />
        </Field>
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function kindName2(k: string): string {
  return t(`lifecycle.kind.${k}`);
}

/* ------------------------------------------------------------ new letter */

export function NewLetterDialog({ open, onClose, employee }: { open: boolean; onClose: () => void; employee?: string | undefined }): React.JSX.Element {
  const people = usePeopleItems();
  const [who, setWho] = useState(employee ?? '');
  const [how, setHow] = useState<'template' | 'agent'>('template');
  const [template, setTemplate] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tpls = useOp<{ templates: LetterTemplate[] }>('letter-templates.list', {}, ['letter_templates'], { name: 'lifecycle.lettpl', skip: !open });
  useEffect(() => {
    if (open) {
      setWho(employee ?? '');
      setErr(null);
      setTitle('');
      setInstructions('');
    }
  }, [open, employee]);
  const items = (tpls.data?.templates ?? []).map((x) => ({ value: x.id, label: x.name, sub: [x.kind_label, x.country !== '' ? x.country : '', x.uses_pay ? t('lifecycle.shows_pay') : ''].filter((s) => s !== '').join(' · ') }));
  const submit = async (): Promise<void> => {
    if (who === '') return setErr(t('lifecycle.pick_person'));
    if (how === 'template' && template === '') return setErr(t('lifecycle.pick_template'));
    if (how === 'agent' && instructions.trim() === '') return setErr(t('lifecycle.say_what'));
    setBusy(true);
    setErr(null);
    try {
      const r =
        how === 'template'
          ? await op<{ letter: LetterRow }>('letters.draft', { employee: who, template }, { quiet: true })
          : await op<{ letter: LetterRow }>('letters.request-draft', { employee: who, instructions, title: title.trim() === '' ? undefined : title }, { quiet: true });
      changed(...LETTER_READS);
      onClose();
      if (how === 'agent') toast.success(t('lifecycle.agent_asked_letter'));
      navigate(`/lifecycle/letters/${r.letter.id}`);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.new_letter')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant={how === 'agent' ? 'agent' : 'primary'} icon={how === 'agent' ? Sparkle : undefined} busy={busy} onClick={() => void submit()}>
            {how === 'agent' ? t('lifecycle.ask_agent_draft') : t('lifecycle.write_draft')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.person')}>
          <Picker value={who} onChange={(v) => setWho(v)} items={people} label={t('lifecycle.f.person')} placeholder={t('lifecycle.pick_person')} />
        </Field>
        <Segmented
          value={how}
          onChange={setHow}
          label={t('lifecycle.f.how')}
          options={[
            { value: 'template', label: t('lifecycle.from_template') },
            { value: 'agent', label: t('lifecycle.by_agent'), icon: Sparkle },
          ]}
        />
        {how === 'template' ? (
          <Field label={t('lifecycle.f.template')}>
            <Picker value={template} onChange={(v) => setTemplate(v)} items={items} label={t('lifecycle.f.template')} placeholder={t('lifecycle.pick_template')} />
          </Field>
        ) : (
          <>
            <Field label={t('lifecycle.f.title')} optional>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('lifecycle.title_example')} />
            </Field>
            <Field label={t('lifecycle.f.instructions')}>
              <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} minRows={3} placeholder={t('lifecycle.instructions_example')} />
            </Field>
          </>
        )}
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ separation */

const KINDS = ['resignation', 'termination', 'retirement', 'end_of_contract', 'death', 'other'] as const;
const REASONS = ['better_opportunity', 'compensation', 'career_change', 'relocation', 'personal', 'health', 'study', 'performance', 'conduct', 'redundancy', 'restructuring', 'probation', 'contract_end', 'retirement', 'death', 'other'];

/** HR or a manager records a separation; `self` is the person handing in their notice. */
export function SeparationDialog({ open, onClose, employee, self, hr }: { open: boolean; onClose: () => void; employee?: string | undefined; self?: boolean | undefined; hr?: boolean | undefined }): React.JSX.Element {
  const people = usePeopleItems();
  const [who, setWho] = useState(employee ?? '');
  const [kind, setKind] = useState<string>('resignation');
  const [notice, setNotice] = useState(dayKey());
  const [last, setLast] = useState(addDays(dayKey(), 30));
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [rehire, setRehire] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setWho(employee ?? '');
      setErr(null);
      setNotice(dayKey());
      setLast(addDays(dayKey(), 30));
    }
  }, [open, employee]);
  const kinds = self === true ? ['resignation', 'retirement'] : hr === true ? [...KINDS] : ['resignation', 'termination', 'end_of_contract', 'retirement'];
  const submit = async (): Promise<void> => {
    if (self !== true && who === '') return setErr(t('lifecycle.pick_person'));
    setBusy(true);
    setErr(null);
    try {
      const r = await op<{ separation: Separation }>(
        'separations.request',
        { employment: self === true ? undefined : who, kind, notice_day: notice, last_day: last, reason: reason.trim() === '' ? undefined : reason, reason_code: reasonCode === '' ? undefined : reasonCode, rehire_eligible: hr === true ? rehire : undefined },
        { quiet: true },
      );
      changed(...SEPARATION_READS);
      onClose();
      toast.success(self === true ? t('lifecycle.notice_sent') : t('lifecycle.separation_sent'));
      navigate(`/lifecycle/separations/${r.separation.id}`);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={self === true ? t('lifecycle.hand_in_notice') : t('lifecycle.record_separation')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {self === true ? t('lifecycle.send_notice') : t('lifecycle.send_for_approval')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {self !== true && (
          <Field label={t('lifecycle.f.person')}>
            <Picker value={who} onChange={(v) => setWho(v)} items={people} label={t('lifecycle.f.person')} placeholder={t('lifecycle.pick_person')} />
          </Field>
        )}
        {kinds.length > 1 && (
          <Field label={t('lifecycle.f.separation_kind')}>
            <Picker value={kind} onChange={(v) => setKind(v)} items={kinds.map((k) => ({ value: k, label: t(`lifecycle.sep.${k}`) }))} label={t('lifecycle.f.separation_kind')} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('lifecycle.f.notice_day')}>
            <DayPicker value={notice} onChange={setNotice} label={t('lifecycle.f.notice_day')} />
          </Field>
          <Field label={t('lifecycle.f.last_day')}>
            <DayPicker value={last} onChange={setLast} label={t('lifecycle.f.last_day')} min={notice} />
          </Field>
        </div>
        <Field label={t('lifecycle.f.reason_code')} optional>
          <Picker value={reasonCode} onChange={(v) => setReasonCode(v)} items={REASONS.map((r) => ({ value: r, label: t(`lifecycle.reason.${r}`) }))} label={t('lifecycle.f.reason_code')} clearable placeholder={t('lifecycle.choose')} />
        </Field>
        <Field label={t('lifecycle.f.reason')} optional hint={self === true ? t('lifecycle.reason_self_hint') : t('lifecycle.reason_hr_hint')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} />
        </Field>
        {hr === true && (
          <Field label={t('lifecycle.f.rehire')}>
            <Segmented
              value={rehire}
              onChange={setRehire}
              label={t('lifecycle.f.rehire')}
              options={[
                { value: 'yes', label: t('ui.yes') },
                { value: 'no', label: t('ui.no') },
                { value: 'unsure', label: t('lifecycle.unsure') },
              ]}
            />
          </Field>
        )}
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- assets */

export const CATEGORIES = ['laptop', 'phone', 'tablet', 'monitor', 'peripheral', 'access_card', 'keys', 'vehicle', 'uniform', 'furniture', 'license', 'other'];
export const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'lost'];

export function AssetDialog({ open, onClose, asset, employee }: { open: boolean; onClose: () => void; asset?: Asset | null | undefined; employee?: string | undefined }): React.JSX.Element {
  const ents = useEntities();
  const entities = ents.map((e) => ({ value: e.id, label: e.name, sub: e.country + ' · ' + e.currency }));
  const people = usePeopleItems();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('laptop');
  const [serial, setSerial] = useState('');
  const [tag, setTag] = useState('');
  const [entity, setEntity] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [condition, setCondition] = useState('new');
  const [who, setWho] = useState(employee ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entCurrency = useMemo(() => ents.find((e) => e.id === entity)?.currency ?? '', [ents, entity]);
  const currency = asset?.currency !== undefined && asset.currency !== '' && entity === asset.entity ? asset.currency : entCurrency !== '' ? entCurrency : (asset?.currency ?? 'USD');
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setName(asset?.name ?? '');
    setCategory(asset?.category ?? 'laptop');
    setSerial(asset?.serial ?? '');
    setTag(asset?.tag ?? '');
    setEntity(asset?.entity ?? entities[0]?.value ?? '');
    setValue(asset?.value_minor ?? null);
    setCondition(asset?.condition ?? 'new');
    setWho(employee ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset, employee]);
  useEffect(() => {
    if (open && entity === '' && entities.length > 0 && asset === undefined) setEntity(entities[0]?.value ?? '');
  }, [open, entity, entities, asset]);
  const submit = async (): Promise<void> => {
    if (name.trim() === '') return setErr(t('lifecycle.name_needed'));
    setBusy(true);
    setErr(null);
    const p = { name, category, serial, entity: entity === '' ? undefined : entity, value: value === null ? undefined : majorParam(value, currency), currency, condition };
    try {
      if (asset) await op('assets.update', { asset: asset.id, ...p, tag: tag.trim() === '' ? undefined : tag }, { quiet: true });
      else await op('assets.add', { ...p, tag: tag.trim() === '' ? undefined : tag, employee: who === '' ? undefined : who }, { quiet: true });
      changed(...ASSET_READS);
      toast.success(asset ? t('ui.saved') : who !== '' ? t('lifecycle.asset_issued') : t('lifecycle.asset_added'));
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={asset ? t('lifecycle.edit_asset') : t('lifecycle.add_asset')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {asset ? t('ui.save') : who !== '' ? t('lifecycle.add_and_issue') : t('lifecycle.add_asset')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.asset_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('lifecycle.asset_example')} autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('lifecycle.f.category')}>
            <Picker value={category} onChange={(v) => setCategory(v)} items={CATEGORIES.map((c) => ({ value: c, label: t(`lifecycle.cat.${c}`) }))} label={t('lifecycle.f.category')} />
          </Field>
          <Field label={t('lifecycle.f.condition')}>
            <Picker value={condition} onChange={(v) => setCondition(v)} items={CONDITIONS.map((c) => ({ value: c, label: t(`lifecycle.cond.${c}`) }))} label={t('lifecycle.f.condition')} />
          </Field>
          <Field label={t('lifecycle.f.serial')} optional>
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
          <Field label={t('lifecycle.f.tag')} optional hint={asset ? undefined : t('lifecycle.tag_hint')}>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} className="hr-mono" />
          </Field>
          <Field label={t('lifecycle.f.entity')}>
            <Picker value={entity} onChange={(v) => setEntity(v)} items={entities} label={t('lifecycle.f.entity')} />
          </Field>
          <Field label={t('lifecycle.f.value')} optional>
            <MoneyInput value={value} onChange={setValue} currency={currency} label={t('lifecycle.f.value')} />
          </Field>
        </div>
        {!asset && (
          <Field label={t('lifecycle.f.issue_to')} optional>
            <Picker value={who} onChange={(v) => setWho(v)} items={people} label={t('lifecycle.f.issue_to')} placeholder={t('lifecycle.in_stock')} clearable />
          </Field>
        )}
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function IssueAssetDialog({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset | null }): React.JSX.Element {
  const people = usePeopleItems();
  const [who, setWho] = useState('');
  const [day, setDay] = useState(dayKey());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setWho('');
      setDay(dayKey());
      setErr(null);
    }
  }, [open]);
  const submit = async (): Promise<void> => {
    if (asset === null) return;
    if (who === '') return setErr(t('lifecycle.pick_person'));
    setBusy(true);
    try {
      await op('assets.issue', { asset: asset.id, employee: who, day }, { quiet: true });
      changed(...ASSET_READS);
      toast.success(t('lifecycle.asset_issued'));
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.issue_asset', { name: asset?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {t('lifecycle.issue')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.issue_to')}>
          <Picker value={who} onChange={(v) => setWho(v)} items={people} label={t('lifecycle.f.issue_to')} placeholder={t('lifecycle.pick_person')} />
        </Field>
        <Field label={t('lifecycle.f.on_day')}>
          <DayPicker value={day} onChange={setDay} label={t('lifecycle.f.on_day')} />
        </Field>
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function ReturnAssetDialog({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: Asset | null }): React.JSX.Element {
  const [condition, setCondition] = useState('good');
  const [retire, setRetire] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCondition(asset?.condition === 'new' || asset?.condition === undefined || asset.condition === '' ? 'good' : asset.condition);
      setRetire(false);
      setNote('');
    }
  }, [open, asset]);
  const submit = async (): Promise<void> => {
    if (asset === null) return;
    setBusy(true);
    try {
      await op('assets.return', { asset: asset.id, condition, retire, note: note === '' ? undefined : note });
      changed(...ASSET_READS, 'separations');
      toast.success(condition === 'lost' ? t('lifecycle.asset_lost') : t('lifecycle.asset_returned'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.return_asset', { name: asset?.name ?? '' })}
      meta={asset !== null ? [asset.tag, asset.employee_name].join(' · ') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {condition === 'lost' ? t('lifecycle.record_lost') : t('lifecycle.mark_returned')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('lifecycle.f.condition')}>
          <Segmented value={condition} onChange={setCondition} label={t('lifecycle.f.condition')} options={CONDITIONS.filter((c) => c !== 'new').map((c) => ({ value: c, label: t(`lifecycle.cond.${c}`) }))} />
        </Field>
        {condition !== 'lost' && <LabeledToggle checked={retire} onChange={setRetire} label={t('lifecycle.retire_instead')} />}
        <Field label={t('lifecycle.f.note')} optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
