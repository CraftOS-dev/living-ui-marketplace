/**
 * Hiring settings: the stages new openings start with, rejection reasons
 * and their messages, offer terms, offer letter templates (markdown with
 * placeholders, previewed with sample values), interview kits, how long
 * candidates are kept by country, and whether messages go out by email.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, CalendarCheck, CalendarX, Eye, PencilLine, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, Hint, IconButton, Input, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Row, RowCue, Segmented, Select, Tag, Textarea, Toggle, confirmAsk } from '../../components/ui.tsx';
import { Markdown } from '../../components/hiring/Markdown.tsx';
import { ToggleRow } from '../../components/hiring/bits.tsx';
import { op } from '../../lib/api.ts';
import { addDays, dayKey, fmtDay } from '../../lib/format.ts';
import { formatMoney } from '../../lib/money.ts';
import type { PageProps } from '../../lib/contract.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import type { Kit, Reason, Settings, Stage, StageKind, Template, Term } from './types.ts';

type Sample = Record<string, string>;

/** Sample values for placeholders: the company's own names, dates and money written the app's way. */
function samplesOf(x: Settings['sample']): Sample {
  const today = dayKey();
  const cur = x.currency !== '' ? x.currency : 'USD';
  return {
  today: fmtDay(today, { year: 'always' }),
  candidate_name: 'Jane Doe',
  title: 'Backend engineer',
  company: x.company,
  entity: x.entity,
  entity_legal_name: x.entity_legal_name,
  department: 'Engineering',
  department_line: ', in Engineering',
  location: x.entity,
  employment_type: 'Full time',
  start_day: fmtDay(addDays(today, 27), { year: 'always' }),
  pay: formatMoney(880000, cur) + ' ' + t('hiring.per.month'),
  components: '**Also**\n\n- Signing bonus: ' + formatMoney(300000, cur) + ' ' + t('hiring.per.once'),
  terms: '**Probation**\n\nYour employment starts with a probation period of three months.',
  expires_day: fmtDay(addDays(today, 7), { year: 'always' }),
  sender_name: 'Priya Raman',
  country: x.country,
  job_title: 'Backend engineer',
  };
}

function fill(text: string, sample: Sample): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k: string) => sample[k] ?? all);
}

/** Text with its placeholders shown as chips holding a sample value (the placeholder in the tooltip). */
function Filled({ text, sample }: { text: string; sample: Sample }): React.JSX.Element {
  const parts = text.split(/(\{\{\s*[a-z_]+\s*\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{\s*([a-z_]+)\s*\}\}$/.exec(part);
        if (m === null) return part;
        const k = m[1] ?? '';
        return (
          <span key={i} title={`{{${k}}}`} className="mx-px rounded-[4px] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-1 text-[var(--hr-ink-2)]">
            {sample[k] ?? k}
          </span>
        );
      })}
    </>
  );
}

function ListText({ title, sub }: { title: string; sub: ReactNode }): React.JSX.Element {
  return (
    <>
      <span className="hr-wrap block text-[13px]">{title}</span>
      {sub !== undefined && sub !== null && sub !== '' && <span className="hr-wrap line-clamp-2 block text-[12px] text-[var(--hr-muted)]">{sub}</span>}
    </>
  );
}

/* -------------------------------------------------------------- stages */

function StagesPanel({ s, can }: { s: Settings; can: boolean }): React.JSX.Element {
  const [rows, setRows] = useState<Stage[]>(s.default_stages);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(s.default_stages), [JSON.stringify(s.default_stages)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(s.default_stages);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('hiring.settings-update', { default_stages: rows.map((r) => ({ key: r.key, name: r.name, kind: r.kind })) });
      changed('hiring_config');
      toast.success(t('hiring.stages_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const swap = (i: number, j: number): void => {
    const next = [...rows];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setRows(next);
  };
  return (
    <Panel index="01" label={t('hiring.default_stages')} aside={can ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows([...rows.slice(0, -1), { key: '', name: t('hiring.new_stage'), kind: 'interview' }, ...rows.slice(-1)])}>{t('hiring.add_stage')}</Button> : undefined}>
      <ul className="flex flex-col divide-y divide-[var(--hr-line)]">
        {rows.map((r, i) => {
          const fixed = i === 0 || i === rows.length - 1;
          return (
            <li key={r.key !== '' ? r.key : `n${i}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 py-2 sm:grid-cols-[28px_minmax(0,1fr)_160px_auto]">
              <span className="hr-mono hr-num text-center text-[12px] text-[var(--hr-muted)]">{String(i + 1).padStart(2, '0')}</span>
              <Input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!can} aria-label={t('hiring.stage_name')} />
              <Select value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as StageKind } : x)))} disabled={!can || fixed} aria-label={t('hiring.stage_kind')} className="col-start-2 sm:col-start-auto">
                {(fixed ? [r.kind] : (['screen', 'interview', 'offer', 'other'] as StageKind[])).map((k) => (
                  <option key={k} value={k}>
                    {t(`hiring.stage_kind.${k}`)}
                  </option>
                ))}
              </Select>
              <span className="flex items-center gap-0.5">
                {can && !fixed && (
                  <>
                    <IconButton icon={ArrowUp} label={t('hiring.move_up')} disabled={i <= 1} onClick={() => swap(i, i - 1)} />
                    <IconButton icon={ArrowDown} label={t('hiring.move_down')} disabled={i >= rows.length - 2} onClick={() => swap(i, i + 1)} />
                    <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {can && dirty && (
        <div className="mt-3 flex justify-end gap-2 border-t border-[var(--hr-line)] pt-3">
          <Button onClick={() => setRows(s.default_stages)}>{t('hiring.undo_changes')}</Button>
          <Button variant="primary" busy={busy} disabled={rows.some((r) => r.name.trim() === '')} onClick={() => void save()}>
            {t('hiring.save_stages')}
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- reasons */

function ReasonDialog({ open, onClose, reason }: { open: boolean; onClose: () => void; reason: Reason | null }): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'company' | 'candidate'>('company');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(reason?.name ?? '');
    setKind(reason?.kind ?? 'company');
    setSubject(reason?.subject ?? '');
    setMessage(reason?.message ?? '');
  }, [open, reason?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('rejection-reasons.save', { reason: reason?.id, name, kind, subject, message });
      changed('rejection_reasons');
      toast.success(t('ui.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={reason ? t('hiring.edit_reason') : t('hiring.add_reason')}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('hiring.reason_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.reason_name')} />
        </Field>
        <Field label={t('hiring.reason_kind')}>
          <Segmented value={kind} onChange={setKind} label={t('hiring.reason_kind')} size="sm" options={[{ value: 'company', label: t('hiring.reason_kind.company') }, { value: 'candidate', label: t('hiring.reason_kind.candidate') }]} />
        </Field>
        <Field label={t('hiring.subject')} optional>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t('hiring.subject')} />
        </Field>
        <Field label={t('hiring.message')} optional hint={t('hiring.placeholders_hint')}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} aria-label={t('hiring.message')} minRows={6} />
        </Field>
      </div>
    </Dialog>
  );
}

function ListPanel<T extends { id: string; archived: boolean }>({ index, label, rows, can, title, sub, onAdd, onEdit, onRemove, addLabel, loading }: { loading?: boolean | undefined; index: string; label: string; rows: T[]; can: boolean; title: (r: T) => string; sub?: ((r: T) => ReactNode) | undefined; onAdd: () => void; onEdit: (r: T) => void; onRemove: (r: T) => void; addLabel: string }): React.JSX.Element {
  const live = rows.filter((r) => !r.archived);
  return (
    <Panel index={index} label={label} aside={can ? <Button size="sm" variant="ghost" icon={Plus} onClick={onAdd}>{addLabel}</Button> : undefined}>
      {loading === true ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('ui.loading')}</p>
      ) : live.length === 0 ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{t('hiring.none_yet')}</p>
      ) : (
        // Rows on hairlines; one that edits shows its pencil at rest (remove appears on hover), so it reads as clickable.
        <ul className="-mx-1 flex flex-col">
          {live.map((r) => (
            <li key={r.id} className="group flex min-w-0 items-center gap-2 border-b border-[var(--hr-hair)] last:border-b-0">
              {can ? (
                <button type="button" onClick={() => onEdit(r)} className="hr-focus flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[var(--hr-radius-sm)] px-1 py-2 text-left transition-colors hover:bg-[var(--hr-hover)]">
                  <span className="min-w-0 flex-1">
                    <ListText title={title(r)} sub={sub?.(r)} />
                  </span>
                  <RowCue edit />
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-1 py-2">
                  <ListText title={title(r)} sub={sub?.(r)} />
                </div>
              )}
              {can && (
                <span className="hover-only flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onRow onClick={() => onRemove(r)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- terms */

function TermDialog({ open, onClose, term }: { open: boolean; onClose: () => void; term: Term | null }): React.JSX.Element | null {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(term?.title ?? '');
    setText(term?.text ?? '');
  }, [open, term?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('offer-terms.save', { term: term?.id, title, text });
      changed('offer_terms');
      toast.success(t('ui.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={term ? t('hiring.edit_term') : t('hiring.add_term')}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={title.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('hiring.term_title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('hiring.term_title')} />
        </Field>
        <Field label={t('hiring.term_text')} hint={t('hiring.term_placeholders')}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={t('hiring.term_text')} minRows={5} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- templates */

function TemplateDialog({ open, onClose, tpl, placeholders, sample }: { open: boolean; onClose: () => void; tpl: Template | null; placeholders: string[]; sample: Sample }): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(tpl?.name ?? '');
    setBody(tpl?.body ?? '');
    setIsDefault(tpl?.is_default ?? false);
    setMode('write');
  }, [open, tpl?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('offer-templates.save', { template: tpl?.id, name, body, is_default: isDefault });
      changed('offer_templates');
      toast.success(t('ui.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={tpl ? t('hiring.edit_template') : t('hiring.add_template')}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === '' || body.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label={t('hiring.template_name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.template_name')} />
          </Field>
          <ToggleRow checked={isDefault} onChange={setIsDefault} label={t('hiring.default_template_toggle')} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {placeholders.map((p) => (
            <button key={p} type="button" onClick={() => setBody((b) => b + `{{${p}}}`)} className="hr-focus hit hr-mono cursor-pointer rounded-[4px] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-1.5 py-0.5 text-[12px] hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-active)]">
              {`{{${p}}}`}
            </button>
          ))}
        </div>
        <Segmented value={mode} onChange={setMode} label={t('hiring.post_view')} size="sm" options={[{ value: 'write', label: t('hiring.write_md'), icon: PencilLine }, { value: 'preview', label: t('hiring.preview_sample'), icon: Eye }]} />
        {mode === 'write' ? <Textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('hiring.template_body')} minRows={14} maxRows={30} className="hr-mono text-[13px]" /> : <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] p-4"><Markdown text={fill(body, sample)} /></div>}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- kits */

function KitDialog({ open, onClose, kit }: { open: boolean; onClose: () => void; kit: Kit | null }): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('video');
  const [minutes, setMinutes] = useState('45');
  const [criteria, setCriteria] = useState<{ key: string; name: string; description: string }[]>([]);
  const [questions, setQuestions] = useState<{ key: string; text: string; criterion: string; guidance: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(kit?.name ?? '');
    setKind(kit?.kind ?? 'video');
    setMinutes(String(kit?.duration_min ?? 45));
    setCriteria(kit?.criteria ?? [{ key: '', name: '', description: '' }]);
    setQuestions(kit?.questions ?? []);
  }, [open, kit?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const crit = criteria.filter((c) => c.name.trim() !== '');
      await op('interview-kits.save', { kit: kit?.id, name, kind, duration_min: Number(minutes), criteria: crit.map((c) => ({ key: c.key || undefined, name: c.name, description: c.description })), questions: questions.filter((q) => q.text.trim() !== '').map((q) => ({ text: q.text, criterion: crit.some((c) => c.key === q.criterion) ? q.criterion : '', guidance: q.guidance })) });
      changed('interview_kits');
      toast.success(t('ui.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={kit ? t('hiring.edit_kit') : t('hiring.add_kit')}
      width={700}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_160px_100px]">
          <Field label={t('hiring.kit_name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.kit_name')} />
          </Field>
          <Field label={t('hiring.kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('hiring.kind')}>
              {(['video', 'phone', 'onsite', 'technical', 'panel', 'other'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`hiring.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('hiring.minutes')}>
            <Input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label={t('hiring.minutes')} />
          </Field>
        </div>
        <Field label={t('hiring.criteria')} hint={t('hiring.criteria_hint')}>
          <div className="flex flex-col gap-2">
            {criteria.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_32px] gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_32px]">
                <Input value={c.name} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={t('hiring.criterion_name')} aria-label={t('hiring.criterion_name')} />
                <Input value={c.description} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder={t('hiring.criterion_desc')} aria-label={t('hiring.criterion_desc')} className="col-start-1 sm:col-start-auto" />
                <IconButton icon={Trash2} label={t('ui.remove')} onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} className="row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto" />
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setCriteria([...criteria, { key: '', name: '', description: '' }])}>
                {t('hiring.add_criterion')}
              </Button>
            </div>
          </div>
        </Field>
        <Field label={t('hiring.questions')} optional>
          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_32px] gap-2 sm:grid-cols-[minmax(0,1.6fr)_160px_32px]">
                <Input value={q.text} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder={t('hiring.question_text')} aria-label={t('hiring.question_text')} />
                <Select value={q.criterion} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))} aria-label={t('hiring.criterion')} className="col-start-1 sm:col-start-auto">
                  <option value="">{t('hiring.no_criterion')}</option>
                  {criteria
                    .filter((c) => c.key !== '')
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                </Select>
                <IconButton icon={Trash2} label={t('ui.remove')} onClick={() => setQuestions(questions.filter((_, j) => j !== i))} className="row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto" />
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setQuestions([...questions, { key: '', text: '', criterion: '', guidance: '' }])}>
                {t('hiring.add_question')}
              </Button>
            </div>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------- retention */

function RetentionPanel({ s, can }: { s: Settings; can: boolean }): React.JSX.Element {
  const [rows, setRows] = useState(s.retention.countries.map((c) => ({ country: c.country, days: String(c.days), basis: c.basis })));
  const [def, setDef] = useState(String(s.retention.default_days));
  const [consent, setConsent] = useState(String(s.retention.consent_days));
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const base = JSON.stringify([s.retention.countries.map((c) => [c.country, String(c.days)]), String(s.retention.default_days), String(s.retention.consent_days)]);
  useEffect(() => {
    setRows(s.retention.countries.map((c) => ({ country: c.country, days: String(c.days), basis: c.basis })));
    setDef(String(s.retention.default_days));
    setConsent(String(s.retention.consent_days));
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify([rows.map((r) => [r.country, r.days]), def, consent]) !== base;
  const valid = rows.every((r) => Number(r.days) >= 1 && Number(r.days) <= 3650) && Number(def) >= 1 && Number(consent) >= 1;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('hiring.settings-update', { retention: Object.fromEntries(rows.map((r) => [r.country, Number(r.days)])), retention_default: Number(def), consent_days: Number(consent) });
      changed('hiring_config', 'candidates');
      toast.success(t('hiring.retention_saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel index="07" label={t('hiring.retention')} aside={<Hint text={t('hiring.retention_help')} />}>
      <div className="flex flex-col gap-1">
        <Row label={t('hiring.retention_default')} hint={s.retention.other_basis}>
          <Input value={def} onChange={(e) => setDef(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" disabled={!can} aria-label={t('hiring.retention_default')} className="w-[88px] text-right" />
        </Row>
        <Row label={t('hiring.retention_consent')}>
          <Input value={consent} onChange={(e) => setConsent(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" disabled={!can} aria-label={t('hiring.retention_consent')} className="w-[88px] text-right" />
        </Row>
        <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {rows.map((r, i) => (
            <div key={r.country} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-1.5">
              <span className="hr-mono w-8 text-[12px]">{r.country}</span>
              <span className="hr-wrap min-w-0 flex-1 text-[12px] text-[var(--hr-muted)]">{r.basis}</span>
              <Input value={r.days} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, days: e.target.value.replace(/[^0-9]/g, '') } : x)))} inputMode="numeric" disabled={!can} aria-label={t('hiring.days_for', { country: r.country })} className="w-[72px] text-right" />
              {can && <IconButton icon={Trash2} label={t('ui.remove')} onClick={() => setRows(rows.filter((_, j) => j !== i))} />}
            </div>
          ))}
        </div>
        {can && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input value={add} onChange={(e) => setAdd(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} placeholder={t('hiring.country_code')} aria-label={t('hiring.country_code')} className="w-[96px]" />
            <Button size="sm" icon={Plus} disabled={add.length !== 2 || rows.some((r) => r.country === add)} onClick={() => (setRows([...rows, { country: add, days: def, basis: s.retention.other_basis }]), setAdd(''))}>
              {t('hiring.add_country')}
            </Button>
            <span className="flex-1" />
            {dirty && (
              <Button variant="primary" busy={busy} disabled={!valid} onClick={() => void save()}>
                {t('ui.save')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- page */

export function HiringSettingsPage(_props: PageProps): React.JSX.Element {
  const live = useOp<Settings>('hiring.settings', {}, ['hiring_config', 'rejection_reasons', 'offer_terms', 'offer_templates'], { name: 'hiring.settings' });
  const kitsLive = useOp<{ kits: Kit[] }>('interview-kits.list', {}, ['interview_kits'], { name: 'hiring.kits.shared' });
  const kits = useMemo(() => kitsLive.data?.kits ?? [], [kitsLive.data]);
  const [reason, setReason] = useState<Reason | null | 'new'>(null);
  const [term, setTerm] = useState<Term | null | 'new'>(null);
  const [tpl, setTpl] = useState<Template | null | 'new'>(null);
  const [kit, setKit] = useState<Kit | null | 'new'>(null);
  const s = live.data;
  const kitsShown = useMemo(() => kits.filter((k) => k.opening === ''), [kits]);
  const sample = useMemo(() => (s === null ? {} : samplesOf(s.sample)), [s]);
  if (s === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const can = s.can_edit;
  const removeOf = (opName: 'rejection-reasons.delete' | 'offer-terms.delete' | 'offer-templates.delete' | 'interview-kits.delete', param: string, coll: string) => async (r: { id: string }): Promise<void> => {
    if (!(await confirmAsk(t('hiring.remove_item_text'), t('ui.remove')))) return;
    try {
      const res = await op<{ archived?: boolean }>(opName, { [param]: r.id });
      changed(coll);
      toast.success(res.archived === true ? t('hiring.archived_in_use') : t('hiring.removed'));
    } catch {
      /* toast shown */
    }
  };
  const setEmail = async (v: boolean): Promise<void> => {
    try {
      await op('hiring.settings-update', { email_candidates: v });
      changed('hiring_config');
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={t('hiring.settings')} meta={t('hiring.settings_meta')} back="#/hiring" />
      <PageBody>
        {!can && <Notice className="mb-3 max-w-[880px]">{t('hiring.settings_read_only')}</Notice>}
        {/* One column of full-width panels in a readable width, as on the main Settings page. */}
        <div className="flex min-w-0 max-w-[880px] flex-col gap-3">
          <StagesPanel s={s} can={can} />
          <Panel index="02" label={t('hiring.messages_calendar')}>
            <div className="flex flex-col gap-3">
              <Row label={t('hiring.email_candidates')} hint={t('hiring.email_candidates_hint')}>
                <Toggle checked={s.email_candidates} onChange={(v) => void setEmail(v)} label={t('hiring.email_candidates')} disabled={!can} />
              </Row>
              <Row label={t('hiring.google_calendar')}>
                {s.calendar.connected ? (
                  <Tag tone="good">
                    <CalendarCheck size={12} className="mr-1 inline" aria-hidden />
                    {t('hiring.connected')}
                  </Tag>
                ) : (
                  <Tag tone="faint">
                    <CalendarX size={12} className="mr-1 inline" aria-hidden />
                    {t('hiring.not_connected')}
                  </Tag>
                )}
              </Row>
            </div>
          </Panel>
          <ListPanel index="03" label={t('hiring.rejection_reasons')} rows={s.rejection_reasons} can={can} title={(r) => r.name} sub={(r) => [t(`hiring.reason_kind.${r.kind}`), r.message !== '' ? t('hiring.has_message') : ''].filter((x) => x !== '').join(' · ')} onAdd={() => setReason('new')} onEdit={(r) => setReason(r)} onRemove={(r) => void removeOf('rejection-reasons.delete', 'reason', 'rejection_reasons')(r)} addLabel={t('hiring.add_reason')} />
          <ListPanel index="04" label={t('hiring.offer_terms')} rows={s.offer_terms} can={can} title={(r) => r.title} sub={(r) => <Filled text={r.text} sample={sample} />} onAdd={() => setTerm('new')} onEdit={(r) => setTerm(r)} onRemove={(r) => void removeOf('offer-terms.delete', 'term', 'offer_terms')(r)} addLabel={t('hiring.add_term')} />
          <ListPanel index="05" label={t('hiring.letter_templates')} rows={s.offer_templates} can={can} title={(r) => r.name + (r.is_default ? ` (${t('hiring.default')})` : '')} sub={(r) => r.entity_name} onAdd={() => setTpl('new')} onEdit={(r) => setTpl(r)} onRemove={(r) => void removeOf('offer-templates.delete', 'template', 'offer_templates')(r)} addLabel={t('hiring.add_template')} />
          <ListPanel index="06" label={t('hiring.interview_kits')} loading={kitsLive.data === null} rows={kitsShown} can={can} title={(r) => r.name} sub={(r) => [t(`hiring.kind.${r.kind}`), tn('hiring.n_minutes', r.duration_min), tn('hiring.n_criteria', r.criteria.length)].join(' · ')} onAdd={() => setKit('new')} onEdit={(r) => setKit(r)} onRemove={(r) => void removeOf('interview-kits.delete', 'kit', 'interview_kits')(r)} addLabel={t('hiring.add_kit')} />
          <RetentionPanel s={s} can={can} />
        </div>
      </PageBody>
      <ReasonDialog open={reason !== null} onClose={() => setReason(null)} reason={reason === 'new' ? null : reason} />
      <TermDialog open={term !== null} onClose={() => setTerm(null)} term={term === 'new' ? null : term} />
      <TemplateDialog open={tpl !== null} onClose={() => setTpl(null)} tpl={tpl === 'new' ? null : tpl} placeholders={s.placeholders.offer} sample={sample} />
      <KitDialog open={kit !== null} onClose={() => setKit(null)} kit={kit === 'new' ? null : kit} />
    </>
  );
}
