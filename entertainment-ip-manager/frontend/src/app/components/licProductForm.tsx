/**
 * Create or edit a licensed product: the licence it is made under (the
 * licensee follows from the licence), what it shows (franchise, title,
 * characters, talents), what it is (category, channel, occasion), the sales
 * window and price. The reference number is set by the server; the stage
 * moves only through "Move to" on the product page.
 */
import { useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import type { AgreementRec, ProductRec } from '../lib/records.ts';
import { CatalogSelect, PartyPicker, RecordPicker } from './pickers.tsx';
import { Checkbox, GroupHeader } from './ui.tsx';
import { ChipMultiSelect, DateField, NumberField, TIME_ZONES, agreementLabel, numOf, numStr, useDimOptions } from './licShared.tsx';

/** Licences we grant (direction out) can carry products. */
export const OUT_LICENCE_FILTER = 'direction = "out"';
export const AGREEMENT_SEARCH = ['ref', 'title'];

export function ProductFormDialog({
  product,
  onClose,
  onSaved,
}: {
  product?: ProductRec | null | undefined;
  onClose: () => void;
  onSaved?: ((p: ProductRec) => void) | undefined;
}): React.JSX.Element {
  const { homeCurrency, characters, talents, on } = useApp();
  const p = product ?? null;
  const [name, setName] = useState(p?.name ?? '');
  const [agreement, setAgreement] = useState(p?.agreement ?? '');
  const [licensee, setLicensee] = useState(p?.licensee ?? '');
  const [franchise, setFranchise] = useState(p?.franchise ?? '');
  const [work, setWork] = useState(p?.work ?? '');
  const [chars, setChars] = useState<string[]>(p?.characters ?? []);
  const [tals, setTals] = useState<string[]>(p?.talents ?? []);
  const [category, setCategory] = useState(p?.category ?? '');
  const [channel, setChannel] = useState(p?.channel ?? '');
  const [occasion, setOccasion] = useState<string>(p?.occasion || 'regular');
  const [salesStart, setSalesStart] = useState(d10(p?.sales_start));
  const [salesEnd, setSalesEnd] = useState(d10(p?.sales_end));
  const [timezone, setTimezone] = useState(p?.timezone || 'Asia/Tokyo');
  const [salesModel, setSalesModel] = useState<string>(p?.sales_model || 'stock');
  const [shipBy, setShipBy] = useState(d10(p?.ship_by));
  const [price, setPrice] = useState(numStr(p?.retail_price));
  const [currency, setCurrency] = useState((p?.currency || homeCurrency).toUpperCase());
  const [jan, setJan] = useState(p?.jan ?? '');
  const [sku, setSku] = useState(p?.sku ?? '');
  const [digital, setDigital] = useState(p?.digital ?? false);
  const [digitalEnd, setDigitalEnd] = useState(d10(p?.digital_end));
  const [voice, setVoice] = useState(p?.includes_voice ?? false);
  const [regions, setRegions] = useState(p?.regions ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const categoryOptions = useDimOptions('category', category);
  const channelOptions = useDimOptions('channel', channel);

  const applyAgreement = (rec: AgreementRec | null): void => {
    if (rec === null) return;
    if (rec.counterparty !== '') setLicensee(rec.counterparty);
    if (franchise === '' && rec.franchise !== '') setFranchise(rec.franchise);
    if (work === '' && rec.work !== '') setWork(rec.work);
    if (p === null && rec.currency !== '') setCurrency(rec.currency.toUpperCase());
  };

  const characterOptions = characters
    .filter((c) => franchise === '' || c.franchise === franchise || chars.includes(c.id))
    .map((c) => ({ value: c.id, label: c.name }));
  const talentOptions = talents.map((x) => ({ value: x.id, label: x.stage_name }));
  const currencyOptions = (CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => ({ value: c, label: c }));
  const zoneOptions = (TIME_ZONES.includes(timezone) || timezone === '' ? TIME_ZONES : [timezone, ...TIME_ZONES]).map((z) => ({ value: z, label: z }));

  const save = async (): Promise<void> => {
    const errs: Record<string, string> = {};
    if (name.trim() === '') errs['name'] = t('Enter the product name.');
    if (salesStart !== '' && salesEnd !== '' && salesEnd < salesStart) errs['sales'] = t('The sales window must end after it starts.');
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first !== undefined) {
      toast.error(first);
      return;
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      agreement,
      licensee,
      franchise,
      work,
      characters: chars,
      talents: tals,
      category,
      channel,
      occasion,
      sales_start: toPb(salesStart),
      sales_end: toPb(salesEnd),
      timezone,
      sales_model: salesModel,
      ship_by: toPb(shipBy),
      retail_price: numOf(price),
      currency,
      jan: jan.trim(),
      sku: sku.trim(),
      digital,
      digital_end: digital ? toPb(digitalEnd) : '',
      includes_voice: voice,
      regions: regions.trim(),
      notes: notes.trim(),
    };
    setBusy(true);
    try {
      const rec =
        p === null
          ? await createRecord<ProductRec>('products', { ...payload, stage: 'proposal' })
          : await updateRecord<ProductRec>('products', p.id, payload);
      toast.success(p === null ? t('Product added') : t('Product saved'));
      onSaved?.(rec);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={p === null ? t('New product') : t('Edit product')}
      description={p === null ? t('A licensed item under one of your licences. It starts at the proposal stage; the reference number is assigned automatically.') : undefined}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {p === null ? t('Add product') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="-mx-1 flex max-h-[66vh] flex-col gap-3 overflow-y-auto px-1">
        <Input label={t('Product name')} value={name} error={errors['name']} placeholder={t('For example: acrylic stand, 15 cm')} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordPicker<AgreementRec>
            collection="agreements"
            label={t('Licence')}
            value={agreement}
            onChange={(id, rec) => {
              setAgreement(id);
              applyAgreement(rec);
            }}
            labelOf={agreementLabel}
            searchFields={AGREEMENT_SEARCH}
            filter={OUT_LICENCE_FILTER}
            placeholder={t('Search licences we grant')}
          />
          <PartyPicker label={t('Licensee')} value={licensee} onChange={(id) => setLicensee(id)} placeholder={t('Search people and companies')} />
        </div>

        <div className="-mx-1 mt-1">
          <GroupHeader label={t('What it shows')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
          {on('titles') && <CatalogSelect kind="work" label={t('Title')} value={work} onChange={setWork} />}
        </div>
        {on('franchises') && <ChipMultiSelect label={t('Characters')} value={chars} options={characterOptions} onChange={setChars} placeholder={t('Add a character')} />}
        {on('talents') && <ChipMultiSelect label={t('Talents')} value={tals} options={talentOptions} onChange={setTals} placeholder={t('Add a talent')} />}
        <Checkbox checked={voice} onChange={setVoice} label={t('Includes voice (needs the voice actor or talent rights)')} />

        <div className="-mx-1 mt-1">
          <GroupHeader label={t('What it is')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Category')} value={category} placeholder={t('None')} options={categoryOptions} onChange={(e) => setCategory(e.target.value)} />
          <Select label={t('Sales channel')} value={channel} placeholder={t('None')} options={channelOptions} onChange={(e) => setChannel(e.target.value)} />
          <Select label={t('Occasion')} value={occasion} options={enumOptions('products.occasion').map(([value, label]) => ({ value, label }))} onChange={(e) => setOccasion(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('JAN code')} value={jan} inputMode="numeric" className="font-mono" onChange={(e) => setJan(e.target.value)} />
          <Input label={t('SKU')} value={sku} className="font-mono" onChange={(e) => setSku(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox checked={digital} onChange={setDigital} label={t('Digital product (wallpapers, voices, stickers)')} />
          {digital && (
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField label={t('Digital distribution ends')} value={digitalEnd} onChange={setDigitalEnd} />
            </div>
          )}
        </div>

        <div className="-mx-1 mt-1">
          <GroupHeader label={t('Sales')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <DateField label={t('Sales start')} value={salesStart} onChange={setSalesStart} error={errors['sales']} />
          <DateField label={t('Sales end')} value={salesEnd} onChange={setSalesEnd} />
          <Select label={t('Time zone')} value={timezone} options={zoneOptions} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Sales model')} value={salesModel} options={enumOptions('products.sales_model').map(([value, label]) => ({ value, label }))} onChange={(e) => setSalesModel(e.target.value)} />
          <DateField label={t('Ship by')} value={shipBy} onChange={setShipBy} help={t('For preorders and made-to-order items.')} />
          <Input label={t('Sales regions')} value={regions} placeholder={t('For example: JP, TW')} onChange={(e) => setRegions(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label={t('Retail price (jōdai)')} value={price} onChange={setPrice} suffix={currency} min={0} />
          <Select label={t('Currency')} value={currency} options={currencyOptions} onChange={(e) => setCurrency(e.target.value)} />
        </div>
        <Textarea label={t('Notes')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}
