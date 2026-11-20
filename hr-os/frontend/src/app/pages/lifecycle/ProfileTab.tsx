/**
 * The Lifecycle tab of a person's profile: their checklists with progress,
 * open tasks, the assets they hold, their letters, a separation in
 * progress, and the handbook pages they still have to read. HR starts a
 * checklist, issues an asset or writes a letter from here; the person
 * hands in their notice here.
 */
import { useState } from 'react';
import { BookOpen, Laptop, ListChecks, LogOut, Mail, Plus, Undo2 } from 'lucide-react';
import { Button, Empty, LoadError, Panel, StatusDot, Tag } from '../../components/ui.tsx';
import { ASSET_READS, ASSET_TONE, kindName, LETTER_READS, LETTER_TONE, panelNumbers, ProgressBar, SEPARATION_READS, SEPARATION_TONE, SkeletonRows, TASK_READS } from '../../components/lifecycle/bits.tsx';
import { AssetDialog, NewLetterDialog, ReturnAssetDialog, SeparationDialog, StartChecklistDialog } from '../../components/lifecycle/dialogs.tsx';
import { TaskRow } from '../../components/lifecycle/TaskRow.tsx';
import type { Asset, Checklist, LetterRow, Separation, Task } from '../../components/lifecycle/types.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { ProfileTabProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';

interface ProfileData {
  employee: string;
  number: string;
  name: string;
  access: string;
  own: boolean;
  checklists: (Checklist & { progress: Checklist['progress'] })[];
  tasks: Task[];
  assets: Asset[];
  letters: LetterRow[];
  separations: Separation[];
  handbook?: { id: string; title: string; version: number }[];
}

export function LifecycleTab({ employee, self }: ProfileTabProps): React.JSX.Element {
  const me = useMe();
  const hrEdit = can(me, 'people', 'edit');
  const live = useOp<ProfileData>('lifecycle.profile', { employee }, [...TASK_READS, ...ASSET_READS, ...LETTER_READS, ...SEPARATION_READS, 'handbook_acks'], { name: 'lifecycle.profile' });
  const [dialog, setDialog] = useState<'start' | 'asset' | 'letter' | 'separation' | 'notice' | null>(null);
  const [returning, setReturning] = useState<Asset | null>(null);
  const d = live.data;
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />;
  const number = d.number;
  const ix = panelNumbers();
  const openSep = d.separations.find((s) => s.status === 'pending' || s.status === 'approved') ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
        <Panel
          index={ix()}
          label={t('lifecycle.checklists')}
          flush
          aside={
            hrEdit ? (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDialog('start')}>
                {t('lifecycle.start')}
              </Button>
            ) : undefined
          }
        >
          {d.checklists.length === 0 ? (
            <Empty icon={ListChecks} title={t('lifecycle.no_checklists_person')} className="py-6" />
          ) : (
            <ul className="px-3.5 pb-1">
              {d.checklists.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                  <a href={`#/lifecycle/checklists/${c.id}`} className="hr-focus min-w-0 flex-1 rounded-[3px]">
                    <span className="hr-link block text-[13px] font-medium">{c.name}</span>
                    <span className="block text-[12px] text-[var(--hr-muted)]">{[kindName(c.kind), fmtDay(c.anchor_day)].join(' · ')}</span>
                  </a>
                  {c.status === 'open' ? <ProgressBar progress={c.progress} /> : <StatusDot tone={c.status === 'done' ? 'good' : 'faint'} label={t(`lifecycle.cl_status.${c.status}`)} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {d.tasks.length > 0 && (
          <Panel index={ix()} label={t('lifecycle.open_tasks')} flush>
            <ul className="px-3.5 pb-1">
              {d.tasks.map((x) => (
                <TaskRow key={x.id} task={x} show="lane" compact leaves />
              ))}
            </ul>
          </Panel>
        )}
        <Panel
          index={ix()}
          label={t('lifecycle.letters')}
          flush
          aside={
            hrEdit ? (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDialog('letter')}>
                {t('lifecycle.new_letter')}
              </Button>
            ) : undefined
          }
        >
          {d.letters.length === 0 ? (
            <Empty icon={Mail} title={t('lifecycle.no_letters_person')} className="py-6" />
          ) : (
            <ul className="px-3.5 pb-1">
              {d.letters.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                  <a href={`#/lifecycle/letters/${l.id}`} className="hr-focus min-w-0 flex-1 rounded-[3px]">
                    <span className="hr-link hr-wrap block text-[13px] font-medium">{l.title}</span>
                    <span className="block text-[12px] text-[var(--hr-muted)]">{[l.number, l.kind_label, fmtDay(l.letter_day)].join(' · ')}</span>
                  </a>
                  {l.status === 'issued' && l.needs_ack ? <StatusDot tone={l.acked_at !== '' ? 'good' : 'warn'} label={l.acked_at !== '' ? t('lifecycle.acknowledged') : t('lifecycle.waiting_ack')} /> : <StatusDot tone={LETTER_TONE[l.status] ?? 'neutral'} label={t(`lifecycle.letter_status.${l.status}`)} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
        <Panel
          index={ix()}
          label={t('lifecycle.assets')}
          flush
          aside={
            hrEdit ? (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDialog('asset')}>
                {t('lifecycle.issue')}
              </Button>
            ) : undefined
          }
        >
          {d.assets.length === 0 ? (
            <Empty icon={Laptop} title={t('lifecycle.no_assets_person')} className="py-6" />
          ) : (
            <ul className="px-3.5 pb-1">
              {d.assets.map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{a.name}</span>
                    <span className="hr-mono block text-[12px] text-[var(--hr-muted)]">{[a.tag, a.status === 'issued' ? t('lifecycle.since', { day: fmtDay(a.issued_day) }) : t('lifecycle.returned_on', { day: fmtDay(a.returned_day) })].join(' · ')}</span>
                  </span>
                  {a.status === 'issued' && hrEdit ? (
                    <Button size="sm" icon={Undo2} onClick={() => setReturning(a)}>
                      {t('lifecycle.returned')}
                    </Button>
                  ) : (
                    <StatusDot tone={ASSET_TONE[a.status] ?? 'neutral'} label={t(`lifecycle.asset_status.${a.status}`)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel index={ix()} label={t('lifecycle.leaving_label')}>
          {openSep !== null ? (
            <a href={`#/lifecycle/separations/${openSep.id}`} className="hr-focus block rounded-[3px]">
              <span className="flex items-center gap-2">
                <span className="hr-link text-[13px] font-medium">{openSep.kind_label}</span>
                <StatusDot tone={SEPARATION_TONE[openSep.status] ?? 'neutral'} label={t(`lifecycle.sep_status.${openSep.status}`)} />
              </span>
              <span className="mt-0.5 block text-[12px] text-[var(--hr-muted)]">{t('lifecycle.last_day') + ' ' + fmtDay(openSep.last_day, { weekday: true })}</span>
              {openSep.checklist !== null && <ProgressBar progress={openSep.checklist.progress} wide className="mt-2" />}
            </a>
          ) : self ? (
            <Button icon={LogOut} onClick={() => setDialog('notice')}>
              {t('lifecycle.hand_in_notice')}
            </Button>
          ) : hrEdit || isManager(me) ? (
            <Button icon={LogOut} onClick={() => setDialog('separation')}>
              {t('lifecycle.record_separation')}
            </Button>
          ) : (
            <span className="text-[13px] text-[var(--hr-muted)]">-</span>
          )}
          {d.separations
            .filter((s) => s !== openSep)
            .map((s) => (
              <div key={s.id} className="mt-2 flex items-center gap-2 text-[12px] text-[var(--hr-muted)]">
                <Tag tone="faint">{s.kind_label}</Tag>
                {t(`lifecycle.sep_status.${s.status}`)} · {fmtDay(s.last_day)}
              </div>
            ))}
        </Panel>
        {d.handbook !== undefined && d.handbook.length > 0 && (
          <Panel index={ix()} label={t('lifecycle.to_read')} flush>
            <ul className="px-3.5 pb-1">
              {d.handbook.map((p) => (
                <li key={p.id} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                  <BookOpen size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                  <a href={`#/lifecycle/handbook/${p.id}`} className="hr-link hr-focus min-w-0 flex-1 rounded-[3px] text-[13px]">
                    {p.title}
                  </a>
                  <span className="hr-label">v{p.version}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <StartChecklistDialog open={dialog === 'start'} onClose={() => setDialog(null)} employee={number} kind="custom" />
      <AssetDialog open={dialog === 'asset'} onClose={() => setDialog(null)} employee={number} />
      <NewLetterDialog open={dialog === 'letter'} onClose={() => setDialog(null)} employee={number} />
      <SeparationDialog open={dialog === 'separation' || dialog === 'notice'} onClose={() => setDialog(null)} employee={number} self={dialog === 'notice'} hr={hrEdit} />
      <ReturnAssetDialog open={returning !== null} onClose={() => setReturning(null)} asset={returning} />
    </div>
  );
}
