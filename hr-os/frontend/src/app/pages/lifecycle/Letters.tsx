/**
 * Letters: drafts to issue first, then issued letters, with a search; the
 * templates by kind; one letter (a draft with its text and live preview,
 * or the issued letter with print, acknowledge and void); one template.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, FileText, Mail, MoreHorizontal, Plus, Printer, Send, Sparkle, Trash2, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Button, DataTable, DayPicker, Dialog, Empty, Field, FactStrip, Input, LoadError, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, Picker, SearchInput, Segmented, StatusDot, Tabs, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { LabeledToggle, LETTER_READS, LETTER_TONE, SkeletonRows } from '../../components/lifecycle/bits.tsx';
import { NewLetterDialog } from '../../components/lifecycle/dialogs.tsx';
import { Markdown } from '../../components/lifecycle/Markdown.tsx';
import type { LetterRow, LetterTemplate, Placeholder } from '../../components/lifecycle/types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';

const KINDS = ['offer', 'appointment', 'confirmation', 'experience', 'salary_certificate', 'warning', 'relieving', 'custom'];

/* ----------------------------------------------------------------- list */

export function LettersPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'people', 'view');
  const tab = hr && query.get('tab') === 'templates' ? 'templates' : 'letters';
  return (
    <>
      <PageHeader title={t('lifecycle.letters')} meta={hr ? t('lifecycle.letters_meta') : t('lifecycle.your_letters')} back={hr ? '#/lifecycle' : undefined} />
      <PageBody>
        {hr && <Tabs value={tab} onChange={(v) => setQuery({ tab: v === 'letters' ? undefined : v })} label={t('lifecycle.letters')} tabs={[{ value: 'letters', label: t('lifecycle.letters') }, { value: 'templates', label: t('lifecycle.templates') }]} className="mb-3" />}
        {tab === 'templates' ? <LetterTemplatesList /> : <LetterList query={query} hr={hr} canWrite={can(me, 'people', 'edit')} />}
      </PageBody>
    </>
  );
}

function LetterList({ query, hr, canWrite }: { query: URLSearchParams; hr: boolean; canWrite: boolean }): React.JSX.Element {
  const status = (['draft', 'issued', 'void', 'all'] as const).find((s) => s === query.get('status')) ?? 'all';
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const live = useOp<{ letters: LetterRow[]; total: number; counts: Record<string, number> }>('letters.list', { status, q: debounced === '' ? undefined : debounced, limit }, LETTER_READS, { name: 'lifecycle.letters' });
  const d = live.data;
  const columns: Column<LetterRow>[] = [
    { key: 'title', label: t('lifecycle.f.title'), width: 'minmax(220px,2fr)', phone: 'title', sort: (r) => r.title, render: (r) => <span className="hr-wrap font-medium">{r.title}</span> },
    { key: 'person', label: t('lifecycle.person'), width: 'minmax(140px,1.2fr)', sort: (r) => r.employee_name, render: (r) => r.employee_name },
    { key: 'kind', label: t('lifecycle.f.kind'), width: '130px', hideBelow: 'lg', render: (r) => r.kind_label },
    { key: 'number', label: t('lifecycle.number'), width: '80px', mono: true, hideBelow: 'xl', render: (r) => r.number },
    { key: 'day', label: t('lifecycle.f.letter_day'), width: '110px', mono: true, sort: (r) => r.letter_day, hideBelow: 'lg', render: (r) => fmtDay(r.letter_day) },
    {
      key: 'status',
      label: t('lifecycle.status'),
      width: '140px',
      phone: 'end',
      render: (r) =>
        r.agent_drafting ? (
          <span className="inline-flex items-center gap-1.5 text-[12px]">
            <AgentMark size={14} working="waiting" />
            {t('lifecycle.agent_drafting')}
          </span>
        ) : r.status === 'issued' && r.needs_ack ? (
          <StatusDot tone={r.acked_at !== '' ? 'good' : 'warn'} label={r.acked_at !== '' ? t('lifecycle.acknowledged') : t('lifecycle.waiting_ack')} />
        ) : (
          <StatusDot tone={LETTER_TONE[r.status] ?? 'neutral'} label={t(`lifecycle.letter_status.${r.status}`)} />
        ),
    },
  ];
  return (
    <>
      <div className="hr-panel hr-in min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
          {hr && <SearchInput value={q} onChange={setQ} placeholder={t('lifecycle.search_letters')} className="w-full sm:w-[240px]" />}
          {hr && (
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'all' ? undefined : v })}
              label={t('lifecycle.status')}
              size="sm"
              options={[
                { value: 'all', label: t('lifecycle.all') },
                { value: 'draft', label: t('lifecycle.drafts_n', { n: d?.counts['draft'] ?? 0 }) },
                { value: 'issued', label: t('lifecycle.letter_status.issued') },
                { value: 'void', label: t('lifecycle.letter_status.void') },
              ]}
            />
          )}
          <span className="flex-1" />
          {canWrite && (
            <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
              {t('lifecycle.new_letter')}
            </Button>
          )}
        </div>
        {d === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <SkeletonRows />
          )
        ) : (
          <DataTable
            label={t('lifecycle.letters')}
            columns={columns}
            rows={d.letters}
            rowKey={(r) => r.id}
            rowHref={(r) => `#/lifecycle/letters/${r.id}`}
            hasMore={d.total > d.letters.length}
            onMore={() => setLimit((l) => l + 50)}
            loadingMore={live.loading}
            empty={<Empty icon={Mail} title={hr ? t('lifecycle.no_letters') : t('lifecycle.no_letters_self')} action={canWrite ? <Button icon={Plus} onClick={() => setOpen(true)}>{t('lifecycle.new_letter')}</Button> : undefined} />}
          />
        )}
      </div>
      <NewLetterDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LetterTemplatesList(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ templates: LetterTemplate[] }>('letter-templates.list', { archived: true }, ['letter_templates'], { name: 'lifecycle.lettpl.all' });
  const canEdit = can(me, 'people', 'edit');
  const columns: Column<LetterTemplate>[] = [
    { key: 'name', label: t('lifecycle.f.name'), width: 'minmax(220px,2fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className={cn('hr-wrap font-medium', r.archived && 'text-[var(--hr-muted)]')}>{r.name}</span> },
    { key: 'kind', label: t('lifecycle.f.kind'), width: '150px', sort: (r) => r.kind, render: (r) => r.kind_label },
    { key: 'country', label: t('lifecycle.country'), width: '100px', mono: true, render: (r) => (r.country !== '' ? r.country : t('lifecycle.any')) },
    { key: 'flags', label: '', width: 'minmax(120px,1fr)', phone: 'end', render: (r) => <span className="flex flex-wrap gap-1">{r.uses_pay && <Tag tone="faint">{t('lifecycle.shows_pay')}</Tag>}{r.needs_ack && <Tag tone="faint">{t('lifecycle.ack')}</Tag>}{r.archived && <Tag tone="faint">{t('lifecycle.archived')}</Tag>}{r.language === 'ja' && <Tag tone="faint">JA</Tag>}</span> },
    { key: 'used', label: t('lifecycle.used'), width: '70px', mono: true, align: 'right', hideBelow: 'lg', render: (r) => r.used },
  ];
  return (
    <div className="hr-panel hr-in min-w-0">
      <div className="flex items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
        <span className="hr-label flex-1">{t('lifecycle.letter_templates')}</span>
        {canEdit && (
          <Button icon={Plus} onClick={() => navigate('/lifecycle/letter-templates/new')}>
            {t('lifecycle.new_template_letter')}
          </Button>
        )}
      </div>
      {live.data === null ? (
        <SkeletonRows />
      ) : (
        <DataTable label={t('lifecycle.letter_templates')} columns={columns} rows={live.data.templates} rowKey={(r) => r.id} rowHref={(r) => `#/lifecycle/letter-templates/${r.id}`} empty={<Empty icon={FileText} title={t('lifecycle.no_letter_templates')} />} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- letter */

function insertAt(el: HTMLTextAreaElement | null, value: string, token: string): { text: string; at: number } {
  if (el === null) return { text: value + token, at: value.length + token.length };
  const s = el.selectionStart ?? value.length;
  const e = el.selectionEnd ?? value.length;
  return { text: value.slice(0, s) + token + value.slice(e), at: s + token.length };
}

function PlaceholderChips({ items, onPick }: { items: Placeholder[]; onPick: (key: string) => void }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((p) => (
        <button key={p.key} type="button" onClick={() => onPick(p.key)} title={'{{' + p.key + '}}'} className="hr-focus hit inline-flex h-6 cursor-pointer items-center rounded-[3px] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-1.5 text-[12px] text-[var(--hr-ink-2)] hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
          {p.label}
        </button>
      ))}
    </div>
  );
}

function DraftEditor({ letter, placeholders }: { letter: LetterRow; placeholders: Placeholder[] }): React.JSX.Element {
  const [title, setTitle] = useState(letter.title);
  const [body, setBody] = useState(letter.body ?? '');
  const [values, setValues] = useState<Record<string, string>>(letter.values);
  const [preview, setPreview] = useState(letter);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [issuing, setIssuing] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, body, values });
  latest.current = { title, body, values };
  useEffect(() => setPreview(letter), [letter]);
  const save = async (): Promise<void> => {
    const cur = latest.current;
    setState('saving');
    try {
      const r = await op<{ letter: LetterRow }>('letters.update', { letter: letter.id, title: cur.title.trim() === '' ? letter.title : cur.title, body: cur.body, values: cur.values }, { quiet: true });
      setPreview(r.letter);
      setState('saved');
    } catch (e) {
      setState('dirty');
      toast.error(errMessage(e));
    }
  };
  const touch = (): void => {
    setState('dirty');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 600);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const pick = (key: string): void => {
    const r = insertAt(ta.current, body, '{{' + key + '}}');
    setBody(r.text);
    touch();
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(r.at, r.at);
    });
  };
  const issue = async (): Promise<void> => {
    if (state !== 'saved') await save();
    setIssuing(true);
    try {
      await op('letters.issue', { letter: letter.id });
      changed(...LETTER_READS);
      toast.success(t('lifecycle.letter_issued', { who: letter.employee_name }), { label: t('lifecycle.print'), run: () => navigate(`/print/lifecycle/letter/${letter.id}`) });
    } catch {
      /* toast shown */
    } finally {
      setIssuing(false);
    }
  };
  const missing = preview.missing ?? [];
  const labelOf = (k: string): string => placeholders.find((p) => p.key === k)?.label ?? k.replace(/^letter\./, '').replace(/_/g, ' ');
  const custom = preview.custom ?? [];
  const blocked = missing.length > 0 || (preview.hidden ?? []).length > 0 || body.trim() === '';
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={title} onChange={(e) => (setTitle(e.target.value), touch())} aria-label={t('lifecycle.f.title')} className="min-w-[240px] flex-1 !text-[14px] font-semibold" />
        <span className="hr-label w-16 text-right" aria-live="polite">
          {state === 'saving' ? t('lifecycle.saving') : state === 'dirty' ? t('lifecycle.editing') : t('ui.saved')}
        </span>
        <Button variant="primary" icon={Send} busy={issuing} disabled={blocked} onClick={() => void issue()} title={blocked ? t('lifecycle.fill_first') : undefined}>
          {t('lifecycle.issue_letter')}
        </Button>
      </div>
      {letter.agent !== null && letter.agent.ended_at === '' && (
        <Notice tone="agent" className="mb-3">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-2">
              <AgentMark size={16} working="waiting" />
              {t('lifecycle.agent_drafting_long')}
            </span>
            <AgentAskStatus ask={letter.agent} reads={LETTER_READS} />
          </span>
        </Notice>
      )}
      {letter.note !== '' && letter.drafted_actor === 'person' && letter.agent_drafting && <Notice className="mb-3">{letter.note}</Notice>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel index="01" label={t('lifecycle.text')}>
          <Textarea ref={ta} value={body} onChange={(e) => (setBody(e.target.value), touch())} minRows={14} maxRows={40} className="hr-mono !text-[13px]" aria-label={t('lifecycle.text')} />
          <div className="mt-3">
            <div className="hr-label mb-1.5">{t('lifecycle.insert')}</div>
            <PlaceholderChips items={placeholders.filter((p) => p.key !== 'letter.number')} onPick={pick} />
          </div>
          {custom.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {custom.map((k) => (
                <Field key={k} label={labelOf('letter.' + k)}>
                  <Input value={values[k] ?? ''} onChange={(e) => (setValues((v) => ({ ...v, [k]: e.target.value })), touch())} />
                </Field>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <Field label={t('lifecycle.f.letter_day')} className="w-[170px]">
              <DayPicker
                value={letter.letter_day}
                onChange={(d) =>
                  void op('letters.update', { letter: letter.id, letter_day: d })
                    .then(() => changed('letters'))
                    .catch(() => undefined)
                }
                label={t('lifecycle.f.letter_day')}
              />
            </Field>
            <LabeledToggle
              checked={letter.needs_ack}
              onChange={(v) =>
                void op('letters.update', { letter: letter.id, needs_ack: v })
                  .then(() => changed('letters'))
                  .catch(() => undefined)
              }
              label={t('lifecycle.ask_to_ack')}
            />
          </div>
        </Panel>
        <Panel index="02" label={t('lifecycle.preview')} className="xl:sticky xl:top-3 xl:self-start">
          {missing.length > 0 && <Notice tone="warn" className="mb-3">{t('lifecycle.missing_values', { list: missing.map(labelOf).join(', ') })}</Notice>}
          {(preview.hidden ?? []).length > 0 && <Notice tone="bad" className="mb-3">{t('lifecycle.pay_hidden_issue')}</Notice>}
          <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-5 py-4">
            {body.trim() === '' ? <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.empty_letter')}</span> : <Markdown text={preview.rendered ?? ''} />}
          </div>
        </Panel>
      </div>
    </>
  );
}

function VoidDialog({ open, onClose, letter }: { open: boolean; onClose: () => void; letter: LetterRow }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (reason.trim() === '') return;
    setBusy(true);
    try {
      await op('letters.void', { letter: letter.id, reason });
      changed(...LETTER_READS);
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
      title={t('lifecycle.void_letter')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="danger" busy={busy} disabled={reason.trim() === ''} onClick={() => void submit()}>
            {t('lifecycle.void')}
          </Button>
        </>
      }
    >
      <Field label={t('lifecycle.f.void_reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

export function LetterPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const hrEdit = can(me, 'people', 'edit');
  const live = useOp<{ letter: LetterRow; placeholders: Placeholder[] }>('letters.get', { letter: params['id'] ?? '' }, [...LETTER_READS, 'proposals'], { name: 'lifecycle.letter' });
  const [voiding, setVoiding] = useState(false);
  const l = live.data?.letter ?? null;
  if (l === null) {
    return (
      <>
        <PageHeader title={t('lifecycle.letter')} back="#/lifecycle/letters" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  }
  const ack = async (): Promise<void> => {
    try {
      await op('letters.acknowledge', { letter: l.id });
      changed(...LETTER_READS);
      toast.success(t('lifecycle.thanks_ack'));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.delete_draft_text', { title: l.title }), t('lifecycle.delete_draft')))) return;
    try {
      await op('letters.delete', { letter: l.id });
      changed(...LETTER_READS);
      navigate('/lifecycle/letters');
    } catch {
      /* toast shown */
    }
  };
  const hr = l.can?.edit === true || l.can?.issue === true;
  const actions =
    l.status !== 'draft' || l.can?.acknowledge === true ? (
      <>
        {l.status !== 'draft' && (
          <Button icon={Printer} onClick={() => navigate(`/print/lifecycle/letter/${l.id}`)}>
            {t('lifecycle.print')}
          </Button>
        )}
        {l.can?.acknowledge === true && (
          <Button variant="primary" icon={CheckCheck} onClick={() => void ack()}>
            {t('lifecycle.acknowledge')}
          </Button>
        )}
      </>
    ) : null;
  return (
    <>
      <PageHeader title={l.status === 'draft' ? l.employee_name + ': ' + t('lifecycle.draft') : l.title} meta={[l.number, t(`lifecycle.letter_status.${l.status}`), l.kind_label, l.employee_name].join(' · ')} back="#/lifecycle/letters">
        {actions !== null && <Acts>{actions}</Acts>}
        {(l.status === 'draft' ? hr : l.status === 'issued' && hrEdit) && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.letter_menu')}>
            {(close) =>
              l.status === 'draft' ? (
                <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                  {t('lifecycle.delete_draft')}
                </MenuItem>
              ) : (
                <MenuItem icon={X} danger onClick={() => (close(), setVoiding(true))}>
                  {t('lifecycle.void_letter')}
                </MenuItem>
              )
            }
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        {actions !== null && <PhoneActs>{actions}</PhoneActs>}
        {l.status === 'draft' && l.can?.edit === true ? (
          <DraftEditor letter={l} placeholders={live.data?.placeholders ?? []} />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <div className="hr-panel hr-in px-6 py-6 md:px-10">
                {l.print && <div className="mb-4 text-[13px] font-semibold">{l.print.legal_name}</div>}
                <Markdown text={l.rendered ?? ''} />
              </div>
            </div>
            <Panel index="01" label={t('lifecycle.about_letter')} className="self-start lg:col-span-4">
              <FactStrip
                className="!grid-cols-1 sm:!flex-col"
                items={[
                  { label: t('lifecycle.person'), value: l.employee_name },
                  { label: t('lifecycle.f.letter_day'), value: fmtDay(l.letter_day), mono: true },
                  { label: t('lifecycle.issued_by'), value: l.issued_by_name !== '' ? l.issued_by_name + ' · ' + fmtStampDay(l.issued_at, { entity: l.entity }) : '-' },
                  { label: t('lifecycle.acknowledgement'), value: !l.needs_ack ? t('lifecycle.not_asked') : l.acked_at !== '' ? t('lifecycle.acked_on', { day: fmtStampDay(l.acked_at, { entity: l.entity }) }) : t('lifecycle.waiting_ack') },
                  ...(l.status === 'void' ? [{ label: t('lifecycle.void_reason'), value: l.void_reason }] : []),
                ]}
              />
              {l.drafted_actor === 'agent' && (
                <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--hr-muted)]">
                  <Sparkle size={12} aria-hidden />
                  {t('lifecycle.drafted_by_agent')}
                </div>
              )}
            </Panel>
          </div>
        )}
      </PageBody>
      <VoidDialog open={voiding} onClose={() => setVoiding(false)} letter={l} />
    </>
  );
}

/* --------------------------------------------------------------- template */

export function LetterTemplatePage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? 'new';
  const isNew = id === 'new';
  const me = useMe();
  const canEdit = can(me, 'people', 'edit');
  const live = useOp<{ template: LetterTemplate; placeholders: Placeholder[] }>('letter-templates.get', { template: id }, ['letter_templates'], { name: 'lifecycle.lettpl.one', skip: isNew });
  const all = useOp<{ placeholders: Placeholder[] }>('letter-templates.list', { kind: 'custom' }, ['letter_templates'], { name: 'lifecycle.lettpl.ph' });
  const tpl = live.data?.template ?? null;
  const placeholders = live.data?.placeholders ?? all.data?.placeholders ?? [];
  const [name, setName] = useState('');
  const [kind, setKind] = useState('custom');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState<'en' | 'ja'>('en');
  const [body, setBody] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const [loaded, setLoaded] = useState('');
  if (tpl !== null && loaded !== tpl.id + tpl.body.length) {
    setLoaded(tpl.id + tpl.body.length);
    setName(tpl.name);
    setKind(tpl.kind);
    setCountry(tpl.country);
    setLanguage(tpl.language === 'ja' ? 'ja' : 'en');
    setBody(tpl.body);
    setAck(tpl.needs_ack);
  }
  const save = async (archived?: boolean): Promise<void> => {
    if (name.trim() === '') return setErr(t('lifecycle.name_needed'));
    if (body.trim() === '') return setErr(t('lifecycle.text_needed'));
    setBusy(true);
    setErr(null);
    try {
      const r = await op<{ template: LetterTemplate }>('letter-templates.save', { template: isNew ? undefined : id, name, kind, country, language, body, needs_ack: ack, archived }, { quiet: true });
      changed('letter_templates');
      toast.success(t('ui.saved'));
      if (isNew) navigate(`/lifecycle/letter-templates/${r.template.id}`);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (tpl === null || !(await confirmAsk(t('lifecycle.delete_template_text', { name: tpl.name }), t('lifecycle.delete_template')))) return;
    try {
      await op('letter-templates.delete', { template: tpl.id });
      changed('letter_templates');
      navigate('/lifecycle/letters', { tab: 'templates' });
    } catch {
      /* toast shown */
    }
  };
  const pick = (key: string): void => {
    const r = insertAt(ta.current, body, '{{' + key + '}}');
    setBody(r.text);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(r.at, r.at);
    });
  };
  const sample = useMemo(() => {
    const vals: Record<string, string> = {};
    for (const p of placeholders) vals[p.key] = '[' + p.label + ']';
    return body.replace(/\{\{\s*([a-z_]+\.[a-z0-9_]+)\s*\}\}/g, (_m, k: string) => vals[k] ?? '[' + k.replace(/^letter\./, '').replace(/_/g, ' ') + ']');
  }, [body, placeholders]);
  if (!isNew && tpl === null) {
    return (
      <>
        <PageHeader title={t('lifecycle.letter_template')} back="#/lifecycle/letters?tab=templates" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  }
  return (
    <>
      <PageHeader title={isNew ? t('lifecycle.new_template_letter') : name} meta={tpl !== null ? [tpl.kind_label, tpl.country !== '' ? tpl.country : t('lifecycle.any_country'), tn('lifecycle.used_letters', tpl.used)].join(' · ') : ''} back="#/lifecycle/letters?tab=templates">
        {canEdit && tpl !== null && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.template_menu')}>
            {(close) => (
              <>
                <MenuItem icon={X} onClick={() => (close(), void save(!tpl.archived))}>
                  {tpl.archived ? t('lifecycle.restore') : t('lifecycle.archive')}
                </MenuItem>
                {tpl.used === 0 && (
                  <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                    {t('ui.remove')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
        {canEdit && (
          <Acts>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              {t('ui.save')}
            </Button>
          </Acts>
        )}
      </PageHeader>
      <PageBody>
        {canEdit && (
          <PhoneActs>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              {t('ui.save')}
            </Button>
          </PhoneActs>
        )}
        {err !== null && (
          <Notice tone="bad" className="mb-3">
            {err}
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel index="01" label={t('lifecycle.template')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('lifecycle.f.name')} className="sm:col-span-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
              </Field>
              <Field label={t('lifecycle.f.kind')}>
                <Picker value={kind} onChange={(v) => setKind(v)} items={KINDS.map((k) => ({ value: k, label: t(`lifecycle.lk.${k}`) }))} label={t('lifecycle.f.kind')} disabled={!canEdit} />
              </Field>
              <Field label={t('lifecycle.country')} optional>
                <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder={t('lifecycle.any_country')} className="hr-mono" disabled={!canEdit} />
              </Field>
              <Field label={t('lifecycle.f.language')}>
                <Segmented value={language} onChange={setLanguage} label={t('lifecycle.f.language')} options={[{ value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }]} />
              </Field>
              <LabeledToggle checked={ack} onChange={setAck} label={t('lifecycle.ask_to_ack')} disabled={!canEdit} />
            </div>
            <Field label={t('lifecycle.text')} className="mt-3">
              <Textarea ref={ta} value={body} onChange={(e) => setBody(e.target.value)} minRows={14} maxRows={40} className="hr-mono !text-[13px]" disabled={!canEdit} />
            </Field>
            <div className="mt-3">
              <div className="hr-label mb-1.5">{t('lifecycle.insert')}</div>
              <PlaceholderChips items={placeholders} onPick={pick} />
            </div>
          </Panel>
          <Panel index="02" label={t('lifecycle.preview')} className="xl:sticky xl:top-3 xl:self-start">
            <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] px-5 py-4">{body.trim() === '' ? <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.empty_letter')}</span> : <Markdown text={sample} />}</div>
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
