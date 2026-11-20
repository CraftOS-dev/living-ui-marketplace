/**
 * Pay-out settings per entity: the bank file format and the employer's
 * details the bank gave, the GL accounts for the journal, and filing
 * choices (monthly or quarterly deposits, Japan's 納期の特例).
 */
import { useEffect, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import { Button, Field, Hint, Input, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Row, Segmented, Select, Tabs, Toggle } from '../../../components/ui.tsx';
import { EntityChooser, FormatTag, useEntity } from '../../../components/payroll-out/parts.tsx';
import { op } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { t } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { setQuery } from '../../../lib/router.ts';
import { toast } from '../../../lib/toast.ts';
import type { PayoutSettings } from './types.ts';

type Tab = 'bank' | 'gl' | 'filings';

interface Accounts {
  gl: Record<string, unknown>;
  roles: { role: string; label: string; account: string }[];
  pack_lines: { code: string; kind: string; payee: string; name: string }[];
  journal_format: string;
  formats: { code: string; name: string; label: string }[];
}

interface Calendar {
  prefs: Record<string, string>;
  filings: { code: string; name: string; period: string; has_due_rule: boolean; choice_pref: string; choice: string; choices: string[]; due_rule: string; source: string }[];
}

function BankTab({ s, entity }: { s: PayoutSettings; entity: string }): React.JSX.Element {
  const me = useMe();
  const [format, setFormat] = useState(s.bank_format);
  const info = s.formats.find((f) => f.code === format) ?? s.formats[0];
  const [payer, setPayer] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPayer({ ...(s.payer[format] ?? {}) });
    setOpts({ ...(s.bank_options[format] ?? {}) });
  }, [format, s]);
  const full = can(me, 'payroll', 'full');
  if (info === undefined) return <Notice>{t('po.settings.no_formats')}</Notice>;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('payout.settings-set', { entity, bank_format: format, payer: { [format]: payer }, bank_options: { [format]: opts } });
      changed('payout_settings');
      toast.success(t('po.settings.saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('po.settings.format')}>
        <div className="flex flex-col gap-2">
          <Segmented value={format} onChange={setFormat} label={t('po.settings.format')} options={s.formats.map((f) => ({ value: f.code, label: t('po.fmt.' + f.code) }))} />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Landmark size={15} className="text-[var(--hr-muted)]" aria-hidden />
            <span className="font-medium">{info.name}</span>
            <FormatTag official={info.official} />
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
              {t('po.settings.layout')}
              <Hint text={info.layout} />
            </span>
          </div>
          <p className="hr-wrap max-w-3xl text-[12px] text-[var(--hr-muted)]">{info.label}</p>
          {format !== s.bank_format && <Notice tone="neutral">{t('po.settings.becomes_default')}</Notice>}
        </div>
      </Panel>
      {info.payer_fields.length > 0 && (
        <Panel index="02" label={t('po.settings.employer_details')}>
          <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {info.payer_fields.map((f) => (
              <Field key={f.key} label={f.label} optional={f.required !== true}>
                {f.enum !== undefined ? (
                  <Select value={payer[f.key] ?? ''} disabled={!full} onChange={(e) => setPayer((p) => ({ ...p, [f.key]: e.target.value }))}>
                    <option value="">{t('ui.choose')}</option>
                    {f.enum.map((v) => (
                      <option key={v} value={v}>
                        {t('po.acct.' + v)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={payer[f.key] ?? ''} disabled={!full} maxLength={f.max} placeholder={f.default ?? s.payer_effective[f.key] ?? ''} onChange={(e) => setPayer((p) => ({ ...p, [f.key]: e.target.value }))} />
                )}
              </Field>
            ))}
          </div>
        </Panel>
      )}
      {info.options.length > 0 && (
        <Panel index="03" label={t('po.settings.file_options')}>
          <div className="flex max-w-2xl flex-col gap-1">
            {info.options.map((o) =>
              o.type === 'boolean' ? (
                <Row key={o.key} label={o.label}>
                  <Toggle checked={(opts[o.key] ?? o.default) === true} disabled={!full} onChange={(v) => setOpts((x) => ({ ...x, [o.key]: v }))} label={o.label} />
                </Row>
              ) : o.type === 'enum' ? (
                <Row key={o.key} label={o.label}>
                  <Segmented value={String(opts[o.key] ?? o.default)} onChange={(v) => setOpts((x) => ({ ...x, [o.key]: v }))} label={o.label} size="sm" options={(o.values ?? []).map((v) => ({ value: v, label: t('po.opt.' + v) }))} />
                </Row>
              ) : (
                <Row key={o.key} label={o.label}>
                  <Input value={String(opts[o.key] ?? o.default ?? '')} disabled={!full} onChange={(e) => setOpts((x) => ({ ...x, [o.key]: e.target.value }))} className="w-[120px]" />
                </Row>
              ),
            )}
          </div>
        </Panel>
      )}
      {full && (
        <div>
          <Button variant="primary" icon={Save} busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function GlTab({ entity }: { entity: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<Accounts>('journal.accounts', { entity }, ['payout_settings', 'pay_components'], { name: 'journal.accounts' });
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [payees, setPayees] = useState<Record<string, string>>({});
  const [fmt, setFmt] = useState('');
  const [busy, setBusy] = useState(false);
  const d = live.data;
  useEffect(() => {
    if (d === null) return;
    const r: Record<string, string> = {};
    for (const x of d.roles) r[x.role] = x.account;
    setRoles(r);
    setPayees({ ...((d.gl['by_payee'] as Record<string, string> | undefined) ?? {}) });
    setFmt(d.journal_format);
  }, [d]);
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const edit = can(me, 'payroll', 'edit');
  const payeeList = Array.from(new Set(d.pack_lines.map((l) => l.payee).filter((x) => x !== '')));
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('journal.accounts-set', { entity, gl: { ...roles, by_payee: payees }, journal_format: fmt });
      changed('payout_settings');
      toast.success(t('po.settings.saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('po.settings.gl_defaults')}>
        <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {d.roles.map((r) => (
            <Field key={r.role} label={r.label}>
              <Input value={roles[r.role] ?? ''} disabled={!edit} className="hr-mono" onChange={(e) => setRoles((x) => ({ ...x, [r.role]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </Panel>
      {payeeList.length > 0 && (
        <Panel index="02" label={t('po.settings.gl_payees')}>
          <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {payeeList.map((p) => (
              <Field key={p} label={p}>
                <Input value={payees[p] ?? ''} disabled={!edit} className="hr-mono" placeholder={roles['liabilities'] ?? ''} onChange={(e) => setPayees((x) => ({ ...x, [p]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </Panel>
      )}
      <Panel index="03" label={t('po.journal.format')}>
        <Segmented value={fmt} onChange={setFmt} label={t('po.journal.format')} options={d.formats.map((f) => ({ value: f.code, label: t('po.journal.fmt.' + f.code) }))} />
        <p className="hr-wrap mt-2 text-[12px] text-[var(--hr-muted)]">{d.formats.find((f) => f.code === fmt)?.label}</p>
      </Panel>
      {edit && (
        <div>
          <Button variant="primary" icon={Save} busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function FilingsTab({ entity }: { entity: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<Calendar>('filings.calendar', { entity }, ['payout_settings', 'rule_packs'], { name: 'filings.calendar' });
  const d = live.data;
  const [busy, setBusy] = useState('');
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const full = can(me, 'payroll', 'full');
  const choose = async (pref: string, value: string): Promise<void> => {
    setBusy(pref);
    try {
      await op('payout.settings-set', { entity, filing_prefs: { [pref]: value } });
      await op('filings.generate', { entity });
      changed('payout_settings', 'filings');
      toast.success(t('po.settings.saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  return (
    <Panel index="01" label={t('po.settings.what_to_file')} flush>
      <ul>
        {d.filings.map((f) => (
          <li key={f.code} className="flex min-w-0 flex-wrap items-center gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="hr-wrap text-[13px]">{f.name}</span>
              <span className="hr-wrap text-[12px] text-[var(--hr-muted)]">{f.due_rule}</span>
            </span>
            {!f.has_due_rule && f.period !== 'event' && <span className="text-[12px] text-[var(--hr-warn)]">{t('po.settings.due_by_person')}</span>}
            {f.choices.length > 0 && (
              <Segmented value={f.choice} onChange={(v) => full && void choose(f.choice_pref, v)} label={f.name} size="sm" options={f.choices.map((c) => ({ value: c, label: t('po.choice.' + c) }))} className={busy === f.choice_pref ? 'opacity-60' : ''} />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PayOutSettingsPage({ query }: PageProps): React.JSX.Element {
  const picked = query.get('entity') ?? '';
  const ent = useEntity(picked);
  const tab = (query.get('tab') as Tab | null) ?? 'bank';
  const live = useOp<{ settings: PayoutSettings }>('payout.settings', { entity: ent?.id }, ['payout_settings', 'entities'], { name: 'payout.settings', skip: ent === null });
  const s = live.data?.settings ?? null;
  return (
    <>
      <PageHeader title={t('po.settings.title')} meta={ent?.name} back="#/payroll/pay-out">
        <span className="hidden md:inline-flex">
          <EntityChooser value={ent?.id ?? ''} onChange={(v) => setQuery({ entity: v })} />
        </span>
      </PageHeader>
      <PageBody>
        <div className="mb-3 md:hidden empty:hidden">
          <EntityChooser value={ent?.id ?? ''} onChange={(v) => setQuery({ entity: v })} />
        </div>
        <Tabs
          className="mb-3"
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'bank' ? undefined : v })}
          label={t('po.settings.title')}
          tabs={[
            { value: 'bank', label: t('po.settings.tab.bank') },
            { value: 'gl', label: t('po.settings.tab.gl') },
            { value: 'filings', label: t('po.settings.tab.filings') },
          ]}
        />
        {ent === null ? null : s === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : tab === 'bank' ? (
          <BankTab s={s} entity={ent.id} />
        ) : tab === 'gl' ? (
          <GlTab entity={ent.id} />
        ) : (
          <FilingsTab entity={ent.id} />
        )}
      </PageBody>
    </>
  );
}
