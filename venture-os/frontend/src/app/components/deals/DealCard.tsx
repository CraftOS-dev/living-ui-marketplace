/**
 * A deal on the board (company, round chip, point partner, days in stage;
 * the kernel Board draws the amber edge when stalled), the side peek that a
 * click opens (summary and Open), and the phone row with its Move to menu.
 */
import { ArrowRight, Lock } from 'lucide-react';
import { Avatar, Button, FigureStrip, Menu, MenuItem, MenuLabel, PhoneRow, Sheet, SheetHeader, StageTrack, Tag, Tip } from '../ui.tsx';
import { CompanyLogo } from '../portfolio/Logo.tsx';
import { ago, days, money } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import { moveDeal } from './actions.ts';
import { roundLabel } from './types.ts';
import type { DealCard as Card, Stage } from './types.ts';

export function DealCardBody({ d }: { d: Card }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="vo-wrap min-w-0 flex-1 text-[13px] font-medium leading-5">{d.title}</span>
        {d.restricted && <Lock size={12} aria-label="Restricted" className="mt-1 shrink-0 text-[var(--vo-muted)]" />}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {d.status === 'hold' && <Tag tone="warn">Hold</Tag>}
        {d.round_type !== '' && <Tag>{roundLabel(d.round_type)}</Tag>}
        {d.raise_minor !== null && (
          <span className="vo-mono vo-num whitespace-nowrap text-[12px] text-[var(--vo-ink-2)]" title="The round they are raising">
            {money(d.raise_minor, d.currency, { compact: true })}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {d.point !== null && (
            <span title={'Point partner: ' + d.point.name}>
              <Avatar name={d.point.name} size={20} />
            </span>
          )}
          <span className={(d.stalled ? 'text-[var(--vo-warn)]' : 'text-[var(--vo-muted)]') + ' whitespace-nowrap text-[12px]'} title={`${days(d.days_in_stage)} in ${d.stage_label}` + (d.stalled ? ', past its stall days' : '')}>
            {days(d.days_in_stage)}
          </span>
        </span>
      </div>
    </div>
  );
}

/** The side peek: the deal at a glance and Open. */
export function DealPeek({ deal, stages, onClose }: { deal: Card | null; stages: Stage[]; onClose: () => void }): React.JSX.Element | null {
  if (deal === null) return null;
  const open = (): void => {
    onClose();
    navigate('/deals/' + deal.number);
  };
  return (
    <Sheet open onClose={onClose} label={deal.title} width={440}>
      <SheetHeader
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <CompanyLogo name={deal.company?.name ?? deal.title} domain={deal.company?.logo_domain ?? ''} logoUrl={deal.company?.logo_url ?? ''} size={28} />
            <span className="vo-wrap min-w-0">{deal.title}</span>
          </span>
        }
        onClose={onClose}
        actions={
          <Button variant="primary" iconRight={ArrowRight} onClick={open}>
            Open
          </Button>
        }
      />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        <StageTrack stages={stages} current={deal.stage} stalled={deal.stalled} />
        <FigureStrip
          items={[
            { label: 'Round', value: roundLabel(deal.round_type) || null },
            { label: 'Raise', value: deal.raise_minor !== null ? money(deal.raise_minor, deal.currency, { compact: true }) : null },
            { label: 'In this stage', value: days(deal.days_in_stage), tone: deal.stalled ? 'warn' : undefined, tip: `Days in ${deal.stage_label}` },
          ]}
        />
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
          <dt className="text-[var(--vo-muted)]">Point</dt>
          <dd className="min-w-0">{deal.point !== null ? <span className="inline-flex items-center gap-2"><Avatar name={deal.point.name} size={20} />{deal.point.name}</span> : ''}</dd>
          <dt className="text-[var(--vo-muted)]">Deal</dt>
          <dd className="vo-mono vo-num">{deal.number}</dd>
          <dt className="text-[var(--vo-muted)]">Activity</dt>
          <dd className="vo-mono vo-num text-[var(--vo-ink-2)]">{ago(deal.last_activity_at)}</dd>
        </dl>
      </div>
    </Sheet>
  );
}

/** A phone row: the deal, its stage and days, and "Move to" (no dragging on a phone). */
export function DealPhoneRow({ d, stages }: { d: Card; stages: Stage[] }): React.JSX.Element {
  return (
    <PhoneRow
      onClick={() => navigate('/deals/' + d.number)}
      lead={<CompanyLogo name={d.company?.name ?? d.title} domain={d.company?.logo_domain ?? ''} logoUrl={d.company?.logo_url ?? ''} size={32} />}
      end={
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Menu label="Move to" icon={ArrowRight} width={220}>
            {(close) => (
              <>
                <MenuLabel>Move to</MenuLabel>
                {stages.map((s, i) => (
                  <MenuItem
                    key={s.key}
                    selected={s.key === d.stage}
                    disabled={s.key === d.stage}
                    onClick={() => {
                      close();
                      void moveDeal(d, { key: s.key, label: s.label, index: i });
                    }}
                  >
                    {s.label}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        </span>
      }
    >
      <div className="vo-wrap text-[14px] font-medium">{d.title}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--vo-muted)]">
        <span className="truncate">{d.stage_label}</span>
        <span className={d.stalled ? 'text-[var(--vo-warn)]' : ''}>{days(d.days_in_stage)}</span>
      </div>
    </PhoneRow>
  );
}
