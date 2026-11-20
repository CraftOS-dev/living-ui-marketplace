/**
 * Payroll building blocks (payroll-core): status dots, labels, the pack
 * field form (rendered from the packs' field definitions), and small helpers.
 * Built only from the kernel's components/ui.tsx.
 */
import { DayPicker, Field, Hint, Input, Money, Segmented, Select, StatusDot, Toggle } from '../ui.tsx';
import { toOpError } from '../../lib/api.ts';
import type { Tone } from '../ui.tsx';
import { has, t, tn } from '../../lib/i18n.ts';
import type { Vars } from '../../lib/i18n.ts';
import { fmtDay, fmtRange, monthName } from '../../lib/format.ts';
import type { FieldDef, Issue } from '../../pages/payroll/core/types.ts';

export const RUN_TONE: Record<string, Tone> = { draft: 'faint', calculating: 'rh', calculated: 'rh', approved: 'lh', locked: 'good', paid: 'good', void: 'bad' };
export const SLIP_TONE: Record<string, Tone> = { draft: 'faint', calculated: 'rh', locked: 'good', published: 'good', void: 'bad' };
export const LOAN_TONE: Record<string, Tone> = { requested: 'warn', active: 'rh', closed: 'good', written_off: 'faint', rejected: 'bad', cancelled: 'faint' };
export const DECL_TONE: Record<string, Tone> = { draft: 'faint', submitted: 'warn', approved: 'good', rejected: 'bad', cancelled: 'faint' };

export function RunStatus({ status }: { status: string }): React.JSX.Element {
  return <StatusDot tone={RUN_TONE[status] ?? 'neutral'} label={t('payroll.status.' + status)} />;
}

export function kindLabel(kind: string): string {
  return t('payroll.kind.' + kind);
}

export function periodLabel(from: string, to: string): string {
  return fmtRange(from, to);
}

/** A period in words: "November 2026" for a whole month, else the range. */
export function periodWords(from: string, to: string): string {
  const end = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate();
  if (from.slice(8, 10) === '01' && to.slice(0, 7) === from.slice(0, 7) && Number(to.slice(8, 10)) === end) return monthName(Number(from.slice(5, 7)), 'long') + ' ' + from.slice(0, 4);
  return fmtRange(from, to);
}

/** A run's name: its kind and period in words ("November 2026", "Bonus November 2026"); the number goes in the meta line. */
export function runTitle(r: { kind: string; period_start: string; period_end: string; label: string }): string {
  const p = periodWords(r.period_start, r.period_end);
  if (r.kind === 'regular') return p;
  if (r.kind === 'termination' && r.label !== '') return r.label;
  return kindLabel(r.kind) + ' ' + p;
}

/**
 * An issue in plain words: the catalogue sentence for its code (with the
 * person, field, pack and days filled in) when there is one, else the
 * module's own sentence. The code itself only goes in the muted detail line.
 */
export function issueText(i: Issue): string {
  if (i.code === 'opening_balances_missing' && i.people !== undefined) return tn('payroll.issue.opening_balances_run', i.people.length, { day: i.day ? fmtDay(i.day, { year: 'always' }) : '' });
  const key = 'payroll.issue.' + i.code;
  if (!has(key)) return i.message;
  const v: Record<string, string | number> = {
    field: i.field_label ?? (i.field ?? '').replace(/_/g, ' '),
    pack: i.pack_name ?? i.pack ?? '',
    day: i.day ? fmtDay(i.day, { year: 'always' }) : '',
    from: i.from ? fmtDay(i.from) : '',
    to: i.to ? fmtDay(i.to, { year: 'always' }) : '',
    locked_day: i.locked_day ? fmtDay(i.locked_day, { year: 'always' }) : '',
    number: i.run_number ?? '',
    n: i.n ?? 0,
    employed: i.employed ?? 0,
    working: i.working ?? 0,
    pct: i.pct ?? 0,
    seen: (i.reasons ?? []).length > 0 ? (i.reasons ?? []).map((r) => t('payroll.reason.' + r)).join(', ') : t('payroll.seen_none'),
  };
  return t(key, v);
}

/** When an issue happened, written by the screen ("Nov 3, Nov 5", "weeks of Nov 2, Nov 9", "November 2026"). */
export function issueWhen(i: Issue): string {
  if (i.days !== undefined && i.days.length > 0) return i.days.slice(0, 8).map((d) => fmtDay(d)).join(', ') + (i.days.length > 8 ? ' ' + t('payroll.and_more', { n: i.days.length - 8 }) : '');
  if (i.weeks !== undefined && i.weeks.length > 0) return t('payroll.weeks_of', { days: i.weeks.slice(0, 8).map((d) => fmtDay(d)).join(', ') });
  if (i.month !== undefined && i.month !== '') return monthName(Number(i.month.slice(5, 7)), 'long') + ' ' + i.month.slice(0, 4);
  return '';
}

/**
 * A refused change in plain words (never a field name or an engine text): the
 * error's code and its field (`data.param`) pick the sentence; any other
 * refusal keeps the server's own sentence, which is written for people.
 */
export function plainError(err: unknown): string {
  const e = toOpError(err);
  const param = typeof e.data['param'] === 'string' ? e.data['param'] : '';
  const field = has('payroll.param.' + param) ? t('payroll.param.' + param) : t('payroll.param.value');
  if (e.code === 'before_start') return t('payroll.err.before_start', { day: fmtDay(String(e.data['start_day'] ?? ''), { year: 'always' }) });
  if (e.code === 'missing_param') return t('payroll.err.missing', { field: field });
  if (e.code === 'invalid_param') return t('payroll.err.invalid', { field: field });
  if (e.status === 403) return t('payroll.err.not_permitted');
  return e.message;
}

/** The Fix button's words for an issue (what it opens). */
export function issueFix(i: Issue): string {
  const key = 'payroll.issue_fix.' + i.code;
  if (has(key)) return t(key);
  return i.fix ? t('payroll.fix_in', { where: i.fix.label }) : t('payroll.fix');
}

/**
 * A translated sentence with amounts in it ("{amount} a month"): each name in
 * `money` renders as <Money> where its placeholder stands, so Hide pay hides
 * it and the currency follows the rules of every other amount.
 */
export function MoneyText({ k, money, currency, vars, className }: { k: string; money: Record<string, number>; currency: string; vars?: Vars | undefined; className?: string | undefined }): React.JSX.Element {
  const marks: Vars = {};
  for (const name of Object.keys(money)) marks[name] = '\u0001' + name + '\u0001';
  const parts = t(k, { ...(vars ?? {}), ...marks }).split('\u0001');
  return (
    <span className={className}>
      {parts.map((p, i) => (i % 2 === 1 && money[p] !== undefined ? <Money key={i} minor={money[p]} currency={currency} /> : <span key={i}>{p}</span>))}
    </span>
  );
}

/** A value shown for a field (option label, yes or no, the number). */
export function fieldText(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return f.default !== null && f.default !== undefined ? fieldText(f, f.default) + ' ' + t('payroll.default_mark') : t('payroll.not_set');
  if (f.type === 'enum') return f.options.find((o) => String(o.value) === String(v))?.label ?? String(v);
  if (f.type === 'boolean') return v === true || v === 'true' ? t('ui.yes') : t('ui.no');
  return String(v);
}

/**
 * The form of a set of pack fields (tax profile fields of a person, or the
 * employer fields of an entity), grouped by pack, one column.
 */
export function FieldForm({ fields, values, onChange, readOnly, missing }: { fields: FieldDef[]; values: Record<string, unknown>; onChange: (key: string, v: unknown) => void; readOnly?: boolean | undefined; missing?: string[] | undefined }): React.JSX.Element {
  const packs: { pack: string; name: string; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    let g = packs.find((x) => x.pack === f.pack);
    if (g === undefined) {
      g = { pack: f.pack, name: f.pack_name, fields: [] };
      packs.push(g);
    }
    g.fields.push(f);
  }
  return (
    <div className="flex flex-col gap-5">
      {packs.map((g) => (
        <div key={g.pack} className="min-w-0">
          <div className="hr-label mb-2">{g.name}</div>
          <div className="flex flex-col gap-3">
            {g.fields.map((f) => {
              const v = values[f.key];
              const err = missing !== undefined && missing.indexOf(f.key) >= 0 ? t('payroll.field_needed') : null;
              const label = (
                <span className="inline-flex items-center gap-1.5">
                  {f.label}
                  {f.help !== '' && <Hint text={f.help} />}
                  {f.form !== '' && <span className="hr-mono ml-1 text-[10.5px] text-[var(--hr-faint)]">{f.form}</span>}
                </span>
              );
              if (readOnly)
                return (
                  <Field key={f.key} label={label}>
                    <div className="hr-wrap text-[13px] text-[var(--hr-ink-2)]">{fieldText(f, v)}</div>
                  </Field>
                );
              return (
                <Field key={f.key} label={label} optional={!f.required} error={err}>
                  <FieldInput f={f} v={v} onChange={(x) => onChange(f.key, x)} />
                </Field>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FieldInput({ f, v, onChange }: { f: FieldDef; v: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const shown = v === null || v === undefined ? (f.default === null || f.default === undefined ? '' : f.default) : v;
  if (f.type === 'boolean') return <Toggle checked={shown === true || shown === 'true'} onChange={(x) => onChange(x)} label={f.label} />;
  if (f.type === 'enum') {
    if (f.options.length <= 3 && f.options.every((o) => o.label.length <= 14))
      return <Segmented value={String(shown)} onChange={(x) => onChange(x)} label={f.label} options={f.options.map((o) => ({ value: String(o.value), label: o.label }))} size="sm" />;
    return (
      <Select value={String(shown)} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
        {f.default === null && <option value="">{t('ui.choose')}</option>}
        {f.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  if (f.type === 'date') return <DayPicker value={typeof shown === 'string' ? shown : ''} onChange={(d) => onChange(d === '' ? null : d)} label={f.label} clearable />;
  if (f.type === 'number' || f.type === 'money')
    return (
      <Input
        inputMode="decimal"
        className="hr-mono max-w-[220px]"
        value={shown === null || shown === undefined ? '' : String(shown)}
        onChange={(e) => {
          const s = e.target.value.trim();
          onChange(s === '' ? null : Number.isFinite(Number(s)) ? Number(s) : s);
        }}
        aria-label={f.label}
      />
    );
  return <Input value={shown === null || shown === undefined ? '' : String(shown)} onChange={(e) => onChange(e.target.value)} aria-label={f.label} />;
}

/** Values that differ from the stored ones (what a form sends). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after)) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = after[k] ?? null;
  return out;
}
