/**
 * Settings, Rules: the deadline rule catalog, grouped by what a rule is
 * about and the office. Every rule carries its legal basis. Admins switch
 * rules on and off and edit offsets and titles in both languages; anyone
 * who can read the catalog can test a rule against a sample date and see
 * each calculation step.
 */
import { useMemo, useState } from 'react';
import { FlaskConical, Gavel, Save, Search } from 'lucide-react';
import { Button, Drawer, Input, Select, Switch, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, today } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, isJa, t, tf } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import type { RuleRec } from '../lib/records.ts';
import type { Bi } from '../lib/shapes.ts';
import { Checkbox, EmptyHint, ErrorBox, Fact, FactGrid, GroupHeader, JurChip, Loading, Pill, Ref, Section, Tag, Toolbar } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { ReadOnlyNote, SubHeading, num, offsetText } from './orgShared.tsx';

export function subjectTypeLabel(s: string): string {
  return (
    {
      trademark: t('Trademarks'),
      design: t('Designs'),
      matter: t('Trademarks and designs'),
      agreement: t('Agreements'),
      work: t('Titles'),
      character: t('Characters'),
      talent: t('Talents'),
      product: t('Products'),
      approval: t('Approvals'),
      permission: t('Third-party permissions'),
      committee: t('Committees'),
      case: t('Enforcement cases'),
      registration: t('Society registrations'),
      claim: t('Content ID claims'),
      recordation: t('Customs recordations'),
      society_contract: t('Society contracts'),
      fan_registration: t('Fan permits'),
      enrollment: t('Platform enrollments'),
    }[s] ?? s
  );
}

function officeLabel(j: string): string {
  return j === '*' ? t('Every office') : `${j} · ${jurisdictionName(j)}`;
}

interface TestResult {
  base_date: string;
  base_label: Bi;
  nominal: string;
  due: string;
  target: string;
  final: string;
  window_opens: string;
  grace_end: string;
  steps: Bi[];
  office: string;
}

export function RulesTab(): React.JSX.Element {
  const { can, meta } = useApp();
  const rules = useCollection<RuleRec>('rules', { sort: 'subject_type,jurisdiction,code' });
  const [subject, setSubject] = useState('');
  const [office, setOffice] = useState('');
  const [query, setQuery] = useState('');
  const [showOff, setShowOff] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const subjects = useMemo(() => [...new Set(rules.records.map((r) => r.subject_type))].sort(), [rules.records]);
  const offices = useMemo(() => [...new Set(rules.records.map((r) => r.jurisdiction))].sort(), [rules.records]);

  const eventLabel = (code: string): string => {
    const ev = meta?.event_codes[code];
    if (ev === undefined) return code;
    return isJa() ? ev.label_ja || ev.label : ev.label;
  };

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rules.records.filter((r) => {
      if (subject !== '' && r.subject_type !== subject) return false;
      if (office !== '' && r.jurisdiction !== office) return false;
      if (!showOff && !r.enabled) return false;
      if (term !== '') {
        const hay = `${r.code} ${r.name} ${r.name_ja} ${r.title} ${r.title_ja} ${r.citation}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rules.records, subject, office, query, showOff]);

  const groups = useMemo(() => {
    const m = new Map<string, RuleRec[]>();
    for (const r of rows) {
      const k = `${r.subject_type}|${r.jurisdiction}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  const toggle = async (r: RuleRec, enabled: boolean): Promise<void> => {
    try {
      await updateRecord('rules', r.id, { enabled });
      toast.success(enabled ? t('Rule switched on') : t('Rule switched off'));
    } catch {
      /* the client already showed the server's message */
    }
  };

  const selected = open !== null ? (rules.records.find((r) => r.id === open) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {!can.admin && <ReadOnlyNote>{t('Only administrators can change rules. You can read them and test them.')}</ReadOnlyNote>}
      <Section title={t('Deadline rules')} meta={rules.loading ? undefined : t('{n} of {total}', { n: rows.length, total: rules.records.length })} flush>
        <div className="border-b border-[var(--agent-app-border)] px-3 pt-3">
          <Toolbar className="mb-3">
            <div className="relative w-full sm:w-60">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search rules')} placeholder={t('Search name, code or basis')} className="h-8 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="w-full sm:w-48">
              <Select aria-label={t('Subject')} className="h-8" value={subject} placeholder={t('Every subject')} options={subjects.map((s) => ({ value: s, label: subjectTypeLabel(s) }))} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="w-full sm:w-48">
              <Select aria-label={t('Office')} className="h-8" value={office} placeholder={t('Every office')} options={offices.map((o) => ({ value: o, label: officeLabel(o) }))} onChange={(e) => setOffice(e.target.value)} />
            </div>
            <Checkbox checked={showOff} onChange={setShowOff} label={t('Show switched-off rules')} />
          </Toolbar>
        </div>
        {rules.loading ? (
          <Loading />
        ) : rules.error !== null ? (
          <div className="p-4">
            <ErrorBox message={rules.error} onRetry={rules.refresh} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyHint compact icon={Gavel} title={t('No rules match')} message={t('Clear the filters to see the whole catalog.')} />
        ) : (
          <div>
            {groups.map(([key, list]) => {
              const [st = '', jur = ''] = key.split('|');
              return (
                <div key={key}>
                  <GroupHeader label={`${subjectTypeLabel(st)} · ${jur === '*' ? t('Every office') : jur}`} count={list.length} />
                  {list.map((r) => (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOpen(r.id);
                      }}
                      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0 hover:bg-[var(--agent-app-border)]/20"
                    >
                      <div className="min-w-0 flex-1 basis-56">
                        <div className={r.enabled ? 'truncate text-[13px] font-medium' : 'truncate text-[13px] font-medium text-[var(--agent-app-muted)] line-through'}>{tf(r, 'name')}</div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-[var(--agent-app-muted)]">
                          <Ref>{r.code}</Ref>
                          <span className="min-w-0 truncate">
                            {eventLabel(r.trigger_event)} · {enumLabel('rules.base', r.base)} + {offsetText(r.offset_years, r.offset_months, r.offset_days, r.offset_unit === 'business')}
                          </span>
                        </div>
                      </div>
                      <Pill tone={r.kind === 'hard' ? 'bad' : r.kind === 'extendable' || r.kind === 'designated' ? 'warn' : 'neutral'}>{enumLabel('rules.kind', r.kind)}</Pill>
                      {r.category !== '' && <Tag className="hidden sm:inline-flex">{enumLabel('rules.category', r.category)}</Tag>}
                      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Switch checked={r.enabled} disabled={!can.admin} onCheckedChange={(v) => void toggle(r, v)} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      {selected !== null && <RuleDrawer rule={selected} eventLabel={eventLabel(selected.trigger_event)} onClose={() => setOpen(null)} />}
    </div>
  );
}

interface RuleDraft {
  name: string;
  name_ja: string;
  title: string;
  title_ja: string;
  offset_years: string;
  offset_months: string;
  offset_days: string;
  offset_unit: 'calendar' | 'business';
  due_end_of_month: boolean;
  summary: string;
  summary_ja: string;
  notes: string;
}

function draftOf(r: RuleRec): RuleDraft {
  return {
    name: r.name,
    name_ja: r.name_ja,
    title: r.title,
    title_ja: r.title_ja,
    offset_years: String(r.offset_years),
    offset_months: String(r.offset_months),
    offset_days: String(r.offset_days),
    offset_unit: r.offset_unit === 'business' ? 'business' : 'calendar',
    due_end_of_month: r.due_end_of_month,
    summary: r.summary,
    summary_ja: r.summary_ja,
    notes: r.notes,
  };
}

function RuleDrawer({ rule, eventLabel, onClose }: { rule: RuleRec; eventLabel: string; onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [d, setD] = useState<RuleDraft>(() => draftOf(rule));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(rule));
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]): void => setD((x) => ({ ...x, [k]: v }));

  const save = async (): Promise<void> => {
    if (d.name.trim() === '' || d.title.trim() === '') {
      toast.error(t('The rule needs a name and a deadline title.'));
      return;
    }
    setBusy(true);
    try {
      await updateRecord('rules', rule.id, {
        name: d.name.trim(),
        name_ja: d.name_ja.trim(),
        title: d.title.trim(),
        title_ja: d.title_ja.trim(),
        offset_years: Math.round(num(d.offset_years)),
        offset_months: Math.round(num(d.offset_months)),
        offset_days: Math.round(num(d.offset_days)),
        offset_unit: d.offset_unit,
        due_end_of_month: d.due_end_of_month,
        summary: d.summary.trim(),
        summary_ja: d.summary_ja.trim(),
        notes: d.notes,
      });
      toast.success(t('Rule saved. Deadlines computed from now on use it; existing deadlines keep their dates until recalculated.'));
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={tf(rule, 'name')}
      width={680}
      footer={
        can.admin ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <DeleteButton
              collection="rules"
              id={rule.id}
              onDeleted={onClose}
              className="mr-auto"
              note={t('Deadlines this rule already made stay. Events recorded from now on no longer create its deadline.')}
            />
            <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
              <Save size={13} aria-hidden /> {t('Save changes')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <FactGrid cols={2}>
          <Fact label={t('Code')} value={<Ref>{rule.code}</Ref>} />
          <Fact label={t('Office')} value={rule.jurisdiction === '*' ? t('Every office') : <span className="inline-flex items-center gap-1.5"><JurChip code={rule.jurisdiction} /> {jurisdictionName(rule.jurisdiction)}</span>} />
          <Fact label={t('Applies to')} value={subjectTypeLabel(rule.subject_type)} />
          <Fact label={t('Triggered by')} value={eventLabel} />
          <Fact label={t('Counted from')} value={enumLabel('rules.base', rule.base)} />
          <Fact label={t('Offset')} value={offsetText(rule.offset_years, rule.offset_months, rule.offset_days, rule.offset_unit === 'business')} />
          <Fact label={t('Kind')} value={enumLabel('rules.kind', rule.kind)} />
          <Fact label={t('Category')} value={enumLabel('rules.category', rule.category)} />
          {rule.recurring_years > 0 && <Fact label={t('Repeats every')} value={t('{n} years', { n: rule.recurring_years })} />}
          {rule.grace_months > 0 && <Fact label={t('Grace period')} value={t('{n} months', { n: rule.grace_months })} />}
          {rule.window_months > 0 && <Fact label={t('Window opens')} value={t('{n} months before', { n: rule.window_months })} />}
          <Fact label={t('Version')} value={String(rule.version)} />
          {d10(rule.effective_from) !== '' && d10(rule.effective_from) > '1900-01-01' && <Fact label={t('In force from')} value={fmtDate(rule.effective_from)} />}
          {d10(rule.effective_to) !== '' && <Fact label={t('In force until')} value={fmtDate(rule.effective_to)} />}
        </FactGrid>
        {rule.citation !== '' && (
          <div>
            <SubHeading>{t('Legal basis')}</SubHeading>
            <p className="break-words text-[13px] leading-relaxed">{rule.citation}</p>
          </div>
        )}
        {(rule.summary !== '' || rule.summary_ja !== '') && (
          <div>
            <SubHeading>{t('Summary')}</SubHeading>
            <p className="break-words text-[13px] leading-relaxed">{tf(rule, 'summary')}</p>
          </div>
        )}
        {rule.system && <p className="text-xs text-[var(--agent-app-muted)]">{t('This rule ships with the app. Check the legal basis before changing it.')}</p>}

        <RuleTest rule={rule} />

        {can.admin && (
          <div className="flex flex-col gap-3">
            <SubHeading>{t('Edit')}</SubHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t('Rule name (English)')} value={d.name} onChange={(e) => set('name', e.target.value)} />
              <Input label={t('Rule name (Japanese)')} value={d.name_ja} onChange={(e) => set('name_ja', e.target.value)} />
              <Input label={t('Deadline title (English)')} value={d.title} onChange={(e) => set('title', e.target.value)} />
              <Input label={t('Deadline title (Japanese)')} value={d.title_ja} onChange={(e) => set('title_ja', e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label={t('Years')} type="number" value={d.offset_years} onChange={(e) => set('offset_years', e.target.value)} />
              <Input label={t('Months')} type="number" value={d.offset_months} onChange={(e) => set('offset_months', e.target.value)} />
              <Input label={t('Days')} type="number" value={d.offset_days} onChange={(e) => set('offset_days', e.target.value)} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-48">
                <Select label={t('Days are counted as')} value={d.offset_unit} options={enumOptions('rules.offset_unit').map(([value, label]) => ({ value, label }))} onChange={(e) => set('offset_unit', e.target.value === 'business' ? 'business' : 'calendar')} />
              </div>
              <Checkbox checked={d.due_end_of_month} onChange={(v) => set('due_end_of_month', v)} label={t('Due at the end of that month')} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label={t('Summary (English)')} rows={3} value={d.summary} onChange={(e) => set('summary', e.target.value)} />
              <Textarea label={t('Summary (Japanese)')} rows={3} value={d.summary_ja} onChange={(e) => set('summary_ja', e.target.value)} />
            </div>
            <Textarea label={t('Notes')} rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function RuleTest({ rule }: { rule: RuleRec }): React.JSX.Element {
  const [base, setBase] = useState(today());
  const [jur, setJur] = useState(rule.jurisdiction === '*' ? 'JP' : rule.jurisdiction);
  const [cycle, setCycle] = useState(String(rule.recurring_first_cycle || 1));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { rule_id: rule.id, base_date: base, jurisdiction: jur };
      if (rule.recurring_years > 0) body['cycle'] = Math.round(num(cycle));
      setRes(await op<TestResult>('rules/test', body));
    } catch (err) {
      setRes(null);
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const dates: [string, string][] = res === null ? [] : ([
    [t('Base date'), res.base_date],
    [t('Nominal date'), res.nominal],
    [t('Due'), res.due],
    [t('Target'), res.target],
    [t('Final'), res.final],
    [t('Window opens'), res.window_opens],
    [t('Grace ends'), res.grace_end],
  ] as [string, string][]).filter(([, v]) => d10(v) !== '');

  return (
    <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
      <SubHeading>{t('Test a rule')}</SubHeading>
      <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Enter a sample base date to see the dates this rule would give and how each one is worked out. Nothing is saved.')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t('Sample base date')} type="date" value={base} onChange={(e) => setBase(e.target.value)} />
        {rule.jurisdiction === '*' && <Select label={t('Office')} value={jur} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setJur(e.target.value)} />}
        {rule.recurring_years > 0 && <Input label={t('Cycle')} type="number" min={1} value={cycle} onChange={(e) => setCycle(e.target.value)} />}
      </div>
      <div>
        <Button size="sm" variant="outline" loading={busy} disabled={d10(base) === ''} onClick={() => void run()}>
          <FlaskConical size={13} aria-hidden /> {t('Run the test')}
        </Button>
      </div>
      {res !== null && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {dates.map(([label, v]) => (
              <Fact key={label} label={label} value={fmtDate(v)} />
            ))}
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {res.steps.map((s, i) => (
              <li key={i} className="break-words text-[13px] leading-relaxed">
                {bi(s)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
