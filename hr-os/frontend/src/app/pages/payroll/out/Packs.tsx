/**
 * Rule packs: the statutory rules per country with their status, dates,
 * sources and test vectors. A pack opens to its steps, tables, fields and
 * vectors (run now); a draft shows what changed against the active
 * version. Activation needs the PIN and passing vectors; your AI agent
 * checks a pack's sources and drafts when a person asks on the pack (or
 * monthly, when that is switched on in Settings) but never activates.
 */
import { useMemo, useState } from 'react';
import { AgentAskStatus } from '../../../components/agent.tsx';
import { BookOpenCheck, ExternalLink, FlaskConical, Power, Sparkle, Trash2 } from 'lucide-react';
import { AgentMark, Button, DataTable, Dialog, Empty, Fact, Field, LoadError, Loading, Notice, PageBody, PageHeader, Panel, RowCue, Section, Segmented, Tabs, Tag, Textarea, confirmAsk } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { AsideLink, PackStatus } from '../../../components/payroll-out/parts.tsx';
import { op } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { ago, fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { toast } from '../../../lib/toast.ts';
import type { PackDetail, PackList, PackListRow, PackStep } from './types.ts';

function dates(r: { effective_from: string; effective_to: string }): string {
  return fmtDay(r.effective_from, { year: 'always' }) + ' · ' + (r.effective_to !== '' ? fmtDay(r.effective_to, { year: 'always' }) : t('po.packs.open_ended'));
}

export function PacksPage({ query }: PageProps): React.JSX.Element {
  const status = (query.get('status') as 'all' | 'active' | 'draft' | null) ?? 'all';
  const live = useOp<PackList>('packs.list', status === 'all' ? {} : { status }, ['rule_packs'], { name: 'packs.list' });
  const d = live.data;
  const columns: Column<PackListRow>[] = useMemo(
    () => [
      { key: 'code', label: t('po.col.pack'), width: 'minmax(220px,2.2fr)', phone: 'title', sort: (r) => r.code, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="hr-wrap">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.code} {r.version}{r.source === 'agent' ? ' · ' + t('po.packs.from_agent') : ''}</span></span> },
      { key: 'dates', label: t('po.col.in_force'), width: 'minmax(170px,1.4fr)', mono: true, hideBelow: 'lg', sort: (r) => r.effective_from, render: (r) => <span className="text-[12px]">{dates(r)}</span> },
      { key: 'vectors', label: t('po.col.vectors'), width: '110px', align: 'right', mono: true, sort: (r) => r.vectors_passed, render: (r) => <span className={r.vectors_passed < r.vectors_total ? 'text-[var(--hr-bad)]' : ''}>{r.vectors_passed}/{r.vectors_total}</span> },
      { key: 'use', label: t('po.col.in_use'), width: '90px', align: 'right', mono: true, hideBelow: 'xl', sort: (r) => r.in_use, render: (r) => (r.in_use > 0 ? r.in_use : '') },
      { key: 'status', label: t('po.col.status'), width: '104px', phone: 'end', sort: (r) => r.status, render: (r) => <PackStatus status={r.status} /> },
    ],
    [],
  );
  return (
    <>
      <PageHeader title={t('po.packs.title')} meta={d !== null ? tn('po.packs.meta', d.packs.filter((p) => p.status === 'active').length) : undefined}>
        <Segmented
          value={status}
          onChange={(v) => setQuery({ status: v === 'all' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          className="hidden md:inline-flex"
          options={[
            { value: 'all', label: t('po.f.all') },
            { value: 'active', label: t('po.pack.status.active') },
            { value: 'draft', label: t('po.pack.status.draft') },
          ]}
        />
      </PageHeader>
      <PageBody>
        <div className="mb-3 md:hidden"><Segmented
          value={status}
          onChange={(v) => setQuery({ status: v === 'all' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          options={[
            { value: 'all', label: t('po.f.all') },
            { value: 'active', label: t('po.pack.status.active') },
            { value: 'draft', label: t('po.pack.status.draft') },
          ]}
        /></div>
        {d === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : (
          <div className="flex flex-col gap-3">
            {d.asks.length > 0 && (
              <div className="hr-panel hr-in flex items-center gap-3 px-3.5 py-2.5">
                <AgentMark size={24} working />
                <span className="min-w-0 flex-1 text-[13px]">{tn('po.packs.jobs', d.asks.length)}</span>
                <AsideLink href={'#/payroll/packs/' + (d.asks[0]?.pack ?? '')}>{d.asks[0]?.code ?? ''}</AsideLink>
              </div>
            )}
            {d.countries.length === 0 && (
              <div className="hr-panel hr-in">
                <Empty icon={BookOpenCheck} title={t('po.packs.empty')} />
              </div>
            )}
            {d.countries.map((c, i) => (
              <Panel key={c.country} index={String(i + 1).padStart(2, '0')} label={c.name + (c.country !== '' ? ' · ' + c.country : '')} flush aside={c.drafts > 0 ? <Tag tone="warn">{tn('po.packs.drafts', c.drafts)}</Tag> : undefined}>
                <DataTable label={c.name} columns={columns} rows={d.packs.filter((p) => p.country === c.country)} rowKey={(r) => r.id} rowHref={(r) => `#/payroll/packs/${r.id}`} />
              </Panel>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

function Expr({ text }: { text: string | undefined }): React.JSX.Element | null {
  if (text === undefined || text === '') return null;
  return <code className="hr-mono hr-wrap block rounded-[var(--hr-radius-sm)] bg-[var(--hr-sunk)] px-2 py-1 text-[12px] leading-5">{text}</code>;
}

function StepRow({ s, i }: { s: PackStep; i: number }): React.JSX.Element {
  const kind = s.var !== undefined ? 'var' : s.check !== undefined ? 'check' : 'line';
  return (
    <li className="flex min-w-0 gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2">
      <span className="hr-mono w-6 shrink-0 text-right text-[12px] text-[var(--hr-faint)]">{i + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
          <Tag tone={kind === 'line' ? 'rh' : kind === 'check' ? 'warn' : 'neutral'}>{t('po.packs.step.' + kind)}</Tag>
          <span className="hr-mono font-medium">{s.var ?? s.code ?? s.issue}</span>
          {s.name !== undefined && <span className="text-[var(--hr-muted)]">{s.name}</span>}
          {s.payee !== undefined && <span className="text-[12px] text-[var(--hr-muted)]">· {s.payee}</span>}
          {s.filing !== undefined && <span className="hr-mono text-[12px] text-[var(--hr-muted)]">· {s.filing}</span>}
        </div>
        {s.when !== undefined && <span className="text-[12px] text-[var(--hr-muted)]">{t('po.packs.when')} <code className="hr-mono">{s.when}</code></span>}
        <Expr text={s.expr ?? s.amount ?? s.check} />
        {s.explain !== undefined && <span className="hr-wrap text-[12px] text-[var(--hr-muted)]">{s.explain}</span>}
        {s.message !== undefined && <span className="hr-wrap text-[12px] text-[var(--hr-muted)]">{s.message}</span>}
      </div>
    </li>
  );
}

function AskDialog({ open, onClose, packId }: { open: boolean; onClose: () => void; packId: string }): React.JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('po.packs.ask_title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="agent"
            icon={Sparkle}
            busy={busy}
            onClick={() => {
              setBusy(true);
              void op<{ asked: boolean }>('packs.ask-update', { pack: packId, note: note.trim() === '' ? undefined : note.trim() })
                .then((r) => {
                  changed('rule_packs');
                  toast.success(r.asked ? t('po.packs.asked') : t('agent.already_asked'));
                  onClose();
                })
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            {t('po.packs.ask_ok')}
          </Button>
        </>
      }
    >
      <Field label={t('po.packs.ask_what')} optional>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={3} />
      </Field>
    </Dialog>
  );
}

type PackTab = 'vectors' | 'steps' | 'tables' | 'fields' | 'changes';

export function PackDetailPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['pack'] ?? '';
  const live = useOp<PackDetail>('packs.get', { pack: id }, ['rule_packs'], { name: 'packs.get' });
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState(false);
  const d = live.data;
  const tab = (query.get('tab') as PackTab | null) ?? (d?.diff ? 'changes' : 'vectors');
  if (d === null)
    return (
      <>
        <PageHeader title={t('po.packs.title')} back="#/payroll/packs" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const p = d.pack;
  const act = async (name: 'packs.test' | 'packs.activate' | 'packs.retire', done: string): Promise<void> => {
    setBusy(name);
    try {
      await op(name, { pack: p.id }, name === 'packs.test' ? {} : { pin: { title: name === 'packs.activate' ? t('po.packs.activate_pin', { code: p.code, version: p.version }) : t('po.packs.retire_pin', { code: p.code, version: p.version }) } });
      changed('rule_packs');
      toast.success(done);
    } catch {
      /* toast shown */
    } finally {
      setBusy('');
    }
  };
  const discard = async (): Promise<void> => {
    if (!(await confirmAsk(t('po.packs.discard_text'), t('po.packs.discard')))) return;
    try {
      await op('packs.discard', { pack: p.id });
      changed('rule_packs');
      navigate('/payroll/packs');
    } catch {
      /* toast shown */
    }
  };
  const editor = can(me, 'payroll', 'edit');
  const full = can(me, 'payroll', 'full');
  const failed = p.vectors.filter((v) => !v.passed).length;
  return (
    <>
      <PageHeader title={p.name} meta={[p.code, p.version, p.country !== '' ? p.country : t('po.packs.template'), t('po.pack.status.' + p.status).toUpperCase()].join(' · ')} back="#/payroll/packs">
        {editor && (
          <Button variant="ghost" icon={FlaskConical} busy={busy === 'packs.test'} onClick={() => void act('packs.test', t('po.packs.tested'))}>
            {t('po.packs.test')}
          </Button>
        )}
        <AgentAskStatus ask={d.agent} reads={['rule_packs']} canRetry={editor} className="hidden sm:inline-flex" />
        {editor && (
          <Button variant="agent" icon={Sparkle} disabled={d.agent !== null && d.agent.open} onClick={() => setAsk(true)}>
            {t('po.packs.ask')}
          </Button>
        )}
        {full && p.status !== 'active' && (
          <Button variant="primary" icon={Power} busy={busy === 'packs.activate'} disabled={!d.can.activate} onClick={() => void act('packs.activate', t('po.packs.activated'))}>
            {t('po.packs.activate')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {p.status !== 'active' && !d.check.ok && (
          <Notice tone="warn" className="mb-3">
            {d.check.errors > 0 ? tn('po.packs.errors', d.check.errors) : d.check.total === 0 ? t('po.packs.no_vectors') : tn('po.packs.failing', d.check.total - d.check.passed)}
          </Notice>
        )}
        {d.against !== null && (
          <Notice tone="neutral" className="mb-3">
            {t('po.packs.against', { version: d.against.version, n: String(d.diff?.changes ?? 0) })}
          </Notice>
        )}
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Fact label={t('po.col.in_force')} mono>
            {dates(p)}
          </Fact>
          <Fact label={t('po.col.vectors')} mono>
            <span className={failed > 0 ? 'text-[var(--hr-bad)]' : 'text-[var(--hr-good)]'}>
              {d.check.passed}/{d.check.total}
            </span>
            {p.official_vectors > 0 && <span className="ml-2 text-[12px] text-[var(--hr-muted)]">{tn('po.packs.official_n', p.official_vectors)}</span>}
          </Fact>
          <Fact label={t('po.packs.tax_year')} mono>
            {fmtDay('2000-' + (p.tax_year.start ?? '01-01'), { year: 'never' })}
          </Fact>
          <Fact label={t('po.packs.activated_on')}>{p.activated_at !== '' ? ago(p.activated_at) + (p.activated_by !== '' ? ' · ' + p.activated_by : '') : t('ui.none')}</Fact>
        </div>
        {p.notes !== '' && <p className="hr-wrap mb-3 max-w-3xl text-[13px] leading-5 text-[var(--hr-ink-2)]">{p.notes}</p>}
        <Tabs
          className="mb-3"
          value={tab}
          onChange={(v) => setQuery({ tab: v })}
          label={t('po.packs.title')}
          tabs={[
            ...(d.diff ? [{ value: 'changes' as PackTab, label: t('po.packs.tab.changes'), count: d.diff.changes }] : []),
            { value: 'vectors', label: t('po.packs.tab.vectors'), count: p.vectors.length },
            { value: 'steps', label: t('po.packs.tab.steps'), count: p.steps.length + p.year_end_steps.length },
            { value: 'tables', label: t('po.packs.tab.tables'), count: p.tables.length },
            { value: 'fields', label: t('po.packs.tab.fields'), count: p.profile_fields.length },
          ]}
        />
        {tab === 'vectors' && (
          <Panel flush label={t('po.packs.tab.vectors')}>
            <ul>
              {p.vectors.map((v) => (
                <li key={v.name} className="flex min-w-0 items-start gap-3 border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px]">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${v.passed ? 'bg-[var(--hr-good)]' : 'bg-[var(--hr-bad)]'}`} aria-label={v.passed ? t('po.packs.passed') : t('po.packs.failed')} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="hr-wrap">{v.name}</span>
                    <span className="hr-wrap text-[12px] text-[var(--hr-muted)]">
                      {t('po.packs.source.' + (v.source === 'official' ? 'official' : 'derived'))}
                      {v.reference !== '' ? ' · ' + v.reference : ''}
                    </span>
                    {v.failure !== null && <code className="hr-mono hr-wrap mt-1 text-[12px] text-[var(--hr-bad)]">{JSON.stringify(v.failure).slice(0, 400)}</code>}
                  </span>
                  <span className="hr-mono hidden shrink-0 text-right text-[12px] text-[var(--hr-muted)] md:block">
                    {Object.entries(v.expect)
                      .slice(0, 3)
                      .map(([k, x]) => k + ' ' + x)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {tab === 'steps' && (
          <Panel flush label={t('po.packs.tab.steps')}>
            <ul>
              {p.steps.map((s, i) => (
                <StepRow key={i} s={s} i={i} />
              ))}
            </ul>
            {p.year_end_steps.length > 0 && (
              <Section title={t('po.packs.year_end_steps')} className="mt-2">
                <ul>
                  {p.year_end_steps.map((s, i) => (
                    <StepRow key={'y' + i} s={s} i={i} />
                  ))}
                </ul>
              </Section>
            )}
          </Panel>
        )}
        {tab === 'tables' && (
          <div className="flex flex-col gap-3">
            {p.tables.length === 0 && <div className="hr-panel"><Empty icon={BookOpenCheck} title={t('po.packs.no_tables')} /></div>}
            {p.tables.map((tb) => (
              <Panel key={tb.name} label={tb.name + ' · ' + tb.type} aside={<span className="hr-mono text-[12px] text-[var(--hr-muted)]">{tn('po.packs.rows', tb.rows)}</span>}>
                <div className="hr-scroll max-h-[320px] overflow-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {tb.preview.map((row, i) => (
                        <tr key={i} className="border-t border-[var(--hr-hair)]">
                          <td className="hr-mono hr-wrap py-1 pr-3">{JSON.stringify(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tb.rows > tb.preview.length && <p className="mt-2 text-[12px] text-[var(--hr-muted)]">{tn('po.packs.more_rows', tb.rows - tb.preview.length)}</p>}
              </Panel>
            ))}
          </div>
        )}
        {tab === 'fields' && (
          <Panel flush label={t('po.packs.tab.fields')}>
            <DataTable
              label={t('po.packs.tab.fields')}
              columns={[
                { key: 'label', label: t('po.col.field'), width: 'minmax(200px,2fr)', phone: 'title', render: (f) => <span className="flex min-w-0 flex-col leading-tight"><span className="hr-wrap">{f.label}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{f.key}{f.form !== undefined ? ' · ' + f.form : ''}</span></span> },
                { key: 'type', label: t('po.col.type'), width: '100px', mono: true, render: (f) => f.type },
                { key: 'scope', label: t('po.col.scope'), width: '110px', render: (f) => (f.scope === 'entity' ? t('po.packs.scope_entity') : t('po.packs.scope_person')) },
                { key: 'default', label: t('po.col.default'), width: '120px', mono: true, phone: 'end', render: (f) => (f.default === undefined ? '' : String(f.default)) },
              ]}
              rows={p.profile_fields}
              rowKey={(f) => f.key}
            />
          </Panel>
        )}
        {tab === 'changes' && d.diff !== null && (
          <div className="flex flex-col gap-3">
            {d.diff.meta.length > 0 && (
              <Panel flush label={t('po.packs.diff.meta')}>
                <ul>
                  {d.diff.meta.map((m) => (
                    <li key={m.field} className="grid grid-cols-[120px_1fr_1fr] gap-3 border-t border-[var(--hr-hair)] px-3.5 py-1.5 text-[12px]">
                      <span className="hr-mono text-[var(--hr-muted)]">{m.field}</span>
                      <span className="hr-wrap text-[var(--hr-bad)] line-through">{String(m.before)}</span>
                      <span className="hr-wrap text-[var(--hr-good)]">{String(m.after)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {d.diff.tables.length > 0 && (
              <Panel flush label={t('po.packs.diff.tables')}>
                <ul>
                  {d.diff.tables.map((tb) => (
                    <li key={tb.name} className="border-t border-[var(--hr-hair)] px-3.5 py-2 text-[12px]">
                      <span className="flex items-center gap-2">
                        <Tag tone={tb.change === 'added' ? 'good' : tb.change === 'removed' ? 'bad' : 'warn'}>{t('po.packs.change.' + tb.change)}</Tag>
                        <span className="hr-mono">{tb.name}</span>
                      </span>
                      {(tb.changed_rows ?? []).slice(0, 12).map((r) => (
                        <span key={String(r.row)} className="hr-mono hr-wrap mt-1 block text-[12px]">
                          <span className="text-[var(--hr-bad)]">{JSON.stringify(r.before)}</span> <span className="text-[var(--hr-muted)]">{'>'}</span> <span className="text-[var(--hr-good)]">{JSON.stringify(r.after)}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {d.diff.steps.length > 0 && (
              <Panel flush label={t('po.packs.diff.steps')}>
                <ul>
                  {d.diff.steps.map((s) => (
                    <li key={s.key} className="border-t border-[var(--hr-hair)] px-3.5 py-2 text-[12px]">
                      <span className="flex items-center gap-2">
                        <Tag tone={s.change === 'added' ? 'good' : s.change === 'removed' ? 'bad' : 'warn'}>{t('po.packs.change.' + s.change)}</Tag>
                        <span className="hr-mono">{s.key}</span>
                      </span>
                      {(s.fields ?? []).map((f) => (
                        <span key={f.field} className="hr-mono hr-wrap mt-1 block text-[12px]">
                          {f.field}: <span className="text-[var(--hr-bad)]">{JSON.stringify(f.before)}</span> <span className="text-[var(--hr-muted)]">{'>'}</span> <span className="text-[var(--hr-good)]">{JSON.stringify(f.after)}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {(d.diff.vectors.added.length > 0 || d.diff.sources.added.length > 0) && (
              <Panel label={t('po.packs.diff.evidence')}>
                {d.diff.vectors.added.map((v) => (
                  <p key={v} className="hr-wrap text-[12px]">+ {v}</p>
                ))}
                {d.diff.sources.added.map((s) => (
                  <p key={s} className="hr-wrap hr-mono text-[12px]">+ {s}</p>
                ))}
              </Panel>
            )}
            {d.diff.changes === 0 && <div className="hr-panel"><Empty icon={BookOpenCheck} title={t('po.packs.no_changes')} /></div>}
          </div>
        )}
        <Section title={t('po.packs.sources')} className="mt-4">
          <ul className="flex flex-col gap-1">
            {p.sources.map((s, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2 text-[12px]">
                <ExternalLink size={13} className="mt-0.5 shrink-0 text-[var(--hr-muted)]" aria-hidden />
                <span className="min-w-0">
                  <a className="hr-link hr-wrap inline-flex min-h-10 items-center md:inline md:min-h-0" href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title !== '' ? s.title : s.url}
                  </a>
                  <span className="text-[var(--hr-muted)]"> · {t('po.packs.retrieved', { when: fmtDay(s.retrieved, { year: 'always' }) })}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
        {(d.versions.length > 1 || d.can.retire || (editor && p.source !== 'builtin' && p.status !== 'active')) && (
          <Section title={t('po.packs.versions')} className="mt-4">
            <ul className="flex flex-col divide-y divide-[var(--hr-hair)] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
              {d.versions.map((v) => (
                <li key={v.id}>
                  <a href={`#/payroll/packs/${v.id}`} className={`group flex min-h-10 items-center gap-3 px-3 py-2 text-[12px] transition-colors hover:bg-[var(--hr-hover)] ${v.id === p.id ? 'bg-[var(--hr-active)]' : ''}`}>
                    <span className="hr-mono w-[80px]">{v.version}</span>
                    <span className="hr-mono min-w-0 flex-1 truncate text-[var(--hr-muted)]">{dates(v)}</span>
                    <PackStatus status={v.status} />
                    <RowCue />
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              {full && d.can.retire && (
                <Button size="sm" variant="ghost" icon={Power} busy={busy === 'packs.retire'} onClick={() => void act('packs.retire', t('po.packs.retired'))}>
                  {t('po.packs.retire')}
                </Button>
              )}
              {editor && p.source !== 'builtin' && p.status !== 'active' && p.status !== 'retired' && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void discard()}>
                  {t('po.packs.discard')}
                </Button>
              )}
            </div>
          </Section>
        )}
      </PageBody>
      <AskDialog open={ask} onClose={() => setAsk(false)} packId={p.id} />
    </>
  );
}
