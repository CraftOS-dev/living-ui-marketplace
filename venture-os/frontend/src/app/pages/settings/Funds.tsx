/**
 * Settings, Funds: the management company, funds and SPVs (entities.*).
 * A fund opens in a sheet: name, currency, vintage; size, code and the LPA
 * terms behind More (fee rate and basis, step-downs, carry, waterfall,
 * hurdle and its compounding, catch-up, recycling), saved as the entity's
 * `lpa` JSON. The form edits a copy of the stored object, so keys it does
 * not show (funds' own terms) go back unchanged.
 */
import { useState } from 'react';
import { Archive, Landmark, Plus, Trash2 } from 'lucide-react';
import { Avatar, Button, DataTable, Empty, Field, IconButton, Input, LoadError, Menu, MenuItem, More, MoneyInput, Panel, PctInput, Segmented, Sheet, SheetHeader, Skeleton, SubHeader, Tag, confirmAsk } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, refreshMe, useMe } from '../../lib/auth.ts';
import { majorParam, money, pct } from '../../lib/format.ts';
import { act, drop as dropRow, useOp } from '../../lib/live.ts';

/** LPA terms as entities.save takes them (kernel-core lib_entities LPA_KEYS; rates in millionths). */
export interface Lpa {
  confirmed?: boolean | undefined;
  mgmt_fee_ppm?: number | undefined;
  fee_basis?: 'committed' | 'invested' | 'net_invested' | 'nav' | undefined;
  step_downs?: { from_year: number; fee_ppm: number; basis?: string | undefined }[] | undefined;
  carry_ppm?: number | undefined;
  waterfall?: 'european' | 'american' | undefined;
  hurdle_ppm?: number | undefined;
  catch_up_ppm?: number | undefined;
  recycling_cap_ppm?: number | undefined;
  /** The preferred return compounds or not (funds' Fund terms section edits it too). */
  pref_compounding?: 'compound' | 'simple' | undefined;
  /** Keys this form does not show travel back untouched (the save sends the whole object). */
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  kind: 'management' | 'fund' | 'spv';
  name: string;
  short_name: string;
  currency: string;
  vintage: number | null;
  size_minor: number;
  archived: boolean;
  lpa: Lpa | null;
}

const KIND_LABEL: Record<Entity['kind'], string> = { management: 'Manager', fund: 'Fund', spv: 'SPV' };

function FundSheet({ entity, onClose, currency }: { entity: Entity | null; onClose: () => void; currency: string }): React.JSX.Element {
  const isNew = entity === null;
  const [kind, setKind] = useState<Entity['kind']>(entity?.kind ?? 'fund');
  const [name, setName] = useState(entity?.name ?? '');
  const [cur, setCur] = useState(entity?.currency ?? currency);
  const [vintage, setVintage] = useState(String(entity?.vintage ?? new Date().getFullYear()));
  const [size, setSize] = useState<number | null>(entity?.size_minor ?? null);
  const [code, setCode] = useState(entity?.short_name ?? '');
  const [lpa, setLpa] = useState<Lpa>(entity?.lpa ?? {});
  const [busy, setBusy] = useState(false);
  const steps = lpa.step_downs ?? [];
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('entities.save', { entity: entity?.id, kind, name: name.trim(), currency: cur.toUpperCase(), vintage: kind === 'management' ? undefined : Number(vintage), size: kind === 'management' ? undefined : majorParam(size, cur), short_name: code.trim(), lpa: kind === 'management' ? undefined : lpa }), ['entities']);
    setBusy(false);
    if (out !== null) {
      void refreshMe();
      onClose();
    }
  };
  return (
    <Sheet open onClose={onClose} label={isNew ? 'New fund' : name} width={480}>
      <SheetHeader title={isNew ? 'New fund' : name} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Field label="Name">
          <Input value={name} autoFocus={isNew} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="Fund II" />
        </Field>
        <Field label="Currency">
          <Input className="vo-mono w-24 uppercase" maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} aria-label="Currency" />
        </Field>
        {kind !== 'management' && (
          <Field label="Vintage">
            <Input className="vo-mono w-24" inputMode="numeric" maxLength={4} value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, ''))} aria-label="Vintage" />
          </Field>
        )}
        {kind !== 'management' && (
        <More defaultOpen={!isNew}>
          <Field label="Kind">
            <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'fund', label: 'Fund' }, { value: 'spv', label: 'SPV' }]} />
          </Field>
          <Field label="Size" tip="Committed capital.">
            <MoneyInput value={size} onChange={setSize} currency={cur} label="Size" className="max-w-[240px]" />
          </Field>
          <Field label="Short name">
            <Input className="w-40" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Short name" placeholder="Fund II" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fee" tip="Management fee per year.">
              <PctInput value={lpa.mgmt_fee_ppm ?? null} onChange={(v) => setLpa({ ...lpa, mgmt_fee_ppm: v ?? 0 })} label="Fee" />
            </Field>
            <Field label="Fee basis">
              <Segmented size="sm" label="Fee basis" value={lpa.fee_basis ?? 'committed'} onChange={(v) => setLpa({ ...lpa, fee_basis: v })} options={[{ value: 'committed', label: 'Committed' }, { value: 'invested', label: 'Invested' }, { value: 'net_invested', label: 'Net invested' }, { value: 'nav', label: 'NAV' }]} />
            </Field>
            <Field label="Carry">
              <PctInput value={lpa.carry_ppm ?? null} onChange={(v) => setLpa({ ...lpa, carry_ppm: v ?? 0 })} label="Carry" />
            </Field>
            <Field label="Waterfall" tip="European: whole fund first. American: deal by deal.">
              <Segmented size="sm" label="Waterfall" value={lpa.waterfall ?? 'european'} onChange={(v) => setLpa({ ...lpa, waterfall: v })} options={[{ value: 'european', label: 'European' }, { value: 'american', label: 'American' }]} />
            </Field>
            <Field label="Hurdle">
              <PctInput value={lpa.hurdle_ppm ?? null} onChange={(v) => setLpa({ ...lpa, hurdle_ppm: v ?? 0 })} label="Hurdle" />
            </Field>
            <Field label="Compounding" tip="How the hurdle grows.">
              <Segmented size="sm" label="Compounding" value={lpa.pref_compounding ?? 'compound'} onChange={(v) => setLpa({ ...lpa, pref_compounding: v })} options={[{ value: 'compound', label: 'Compound' }, { value: 'simple', label: 'Simple' }]} />
            </Field>
            <Field label="Catch-up">
              <PctInput value={lpa.catch_up_ppm ?? null} onChange={(v) => setLpa({ ...lpa, catch_up_ppm: v ?? 0 })} label="Catch-up" />
            </Field>
            <Field label="Recycling" tip="Share of commitments that may be reinvested.">
              <PctInput value={lpa.recycling_cap_ppm ?? null} onChange={(v) => setLpa({ ...lpa, recycling_cap_ppm: v ?? 0 })} label="Recycling" />
            </Field>
          </div>
          <Field label="Step-downs" tip="The fee from a fund year on.">
            <div className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--vo-muted)]">Year</span>
                  <Input className="vo-mono w-16" inputMode="numeric" value={String(s.from_year)} onChange={(e) => setLpa({ ...lpa, step_downs: steps.map((x, j) => (j === i ? { ...x, from_year: Number(e.target.value.replace(/\D/g, '') || 0) } : x)) })} aria-label="From year" />
                  <PctInput value={s.fee_ppm} onChange={(v) => setLpa({ ...lpa, step_downs: steps.map((x, j) => (j === i ? { ...x, fee_ppm: v ?? 0 } : x)) })} label="Rate" />
                  <IconButton icon={Trash2} label="Remove step" tone="danger" size={28} onClick={() => setLpa({ ...lpa, step_downs: steps.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Button size="sm" icon={Plus} className="self-start" onClick={() => setLpa({ ...lpa, step_downs: [...steps, { from_year: 6, fee_ppm: 15000 }] })}>
                Step
              </Button>
            </div>
          </Field>
        </More>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={name.trim() === '' || !/^[A-Z]{3}$/.test(cur) || (kind !== 'management' && !/^\d{4}$/.test(vintage))} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

export function FundsSettings(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ entities: Entity[] }>('entities.list', {}, ['entities'], { name: 'settings.entities' });
  const [open, setOpen] = useState<Entity | 'new' | null>(null);
  const edit = allowed(me, 'funds:full');
  const rows = (live.data?.entities ?? []).filter((e) => !e.archived);
  const archive = async (e: Entity): Promise<void> => {
    if (!(await confirmAsk(`Archive ${e.name}?`, 'Archive'))) return;
    await act([dropRow(e.id)], () => op('entities.archive', { entity: e.id, archived: true }), ['entities']);
    void refreshMe();
  };
  return (
    <>
      <SubHeader title="Funds">
        {edit && (
          <Button variant="primary" icon={Plus} onClick={() => setOpen('new')}>
            New fund
          </Button>
        )}
      </SubHeader>
      <Panel flush>
        {live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <div className="p-5">
              <Skeleton className="h-24 w-full" />
            </div>
          )
        ) : (
          <DataTable
            label="Funds"
            rows={rows}
            rowKey={(e) => e.id}
            onRowClick={edit ? (e: Entity) => setOpen(e) : undefined}
            stickyTop={0}
            empty={<Empty icon={Landmark} title="No funds yet" action={edit ? <Button onClick={() => setOpen('new')}>New fund</Button> : undefined} />}
            columns={[
              {
                key: 'name',
                label: 'Name',
                width: 'minmax(180px,2fr)',
                phone: 'title',
                fixed: true,
                render: (e) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={e.name} size={22} square />
                    <span className="truncate font-medium">{e.name}</span>
                  </span>
                ),
              },
              { key: 'kind', label: 'Kind', width: '90px', render: (e) => <Tag tone={e.kind === 'management' ? 'faint' : 'neutral'}>{KIND_LABEL[e.kind] ?? e.kind}</Tag> },
              { key: 'vintage', label: 'Vintage', width: '80px', mono: true, render: (e) => (e.kind === 'management' ? '' : (e.vintage ?? '')) },
              { key: 'fee', label: 'Fee', width: '70px', mono: true, render: (e) => pct(e.lpa?.mgmt_fee_ppm ?? null) },
              { key: 'size', label: 'Size', width: '150px', mono: true, phone: 'end', render: (e) => (e.size_minor > 0 ? money(e.size_minor, e.currency, { compact: true }) : '') },
              {
                key: 'more',
                label: '',
                width: '40px',
                fixed: true,
                phone: 'hide',
                render: (e) =>
                  edit && e.kind !== 'management' ? (
                    <span onClick={(ev) => ev.stopPropagation()}>
                      <Menu label="More" onRow>
                        {(close) => (
                          <MenuItem
                            icon={Archive}
                            danger
                            onClick={() => {
                              close();
                              void archive(e);
                            }}
                          >
                            Archive
                          </MenuItem>
                        )}
                      </Menu>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      {open !== null && <FundSheet entity={open === 'new' ? null : open} onClose={() => setOpen(null)} currency={me.firm.base_currency} />}
    </>
  );
}
