/**
 * The facts of a mark or design family and the form that edits them (the
 * mark image, word element, transliteration and translation, Vienna codes,
 * strategy, announcement date and what it protects).
 */
import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import type { FamilyRec } from '../lib/records.ts';
import { CatalogSelect } from './pickers.tsx';
import { DateField, opts } from './protectShared.tsx';

export function FamilyEditDialog({ family: f, onClose }: { family: FamilyRec; onClose: () => void }): React.JSX.Element {
  const { on } = useApp();
  const [form, setForm] = useState({
    title: f.title,
    mark_type: f.mark_type,
    word_element: f.word_element,
    transliteration: f.transliteration,
    translation: f.translation,
    vienna_codes: f.vienna_codes,
    disclaimer: f.disclaimer,
    description: f.description,
    products: f.products,
    strategy: f.strategy,
    strategy_note: f.strategy_note,
    owner_entity: f.owner_entity,
    announcement_date: d10(f.announcement_date),
    franchise: f.franchise,
    character: f.character,
    talent: f.talent,
  });
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]): void => setForm((x) => ({ ...x, [k]: v }));
  const tm = f.kind === 'trademark';

  const save = async (): Promise<void> => {
    if (form.title.trim() === '') return;
    setBusy(true);
    try {
      await updateRecord<FamilyRec>('families', f.id, { ...form, title: form.title.trim(), announcement_date: toPb(form.announcement_date) });
      if (image !== null) {
        const fd = new FormData();
        fd.append('mark_image', image);
        await updateRecord<FamilyRec>('families', f.id, fd);
      }
      toast.success(t('Saved'));
      onClose();
    } catch {
      /* the client showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Edit family')}
      className="w-[min(94vw,44rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={form.title.trim() === ''}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto pr-1">
        <Input label={t('Family title')} value={form.title} onChange={(e) => set('title', e.target.value)} />
        {tm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t('Mark type')} value={form.mark_type} placeholder={t('Not set')} options={opts(enumOptions('families.mark_type'))} onChange={(e) => set('mark_type', e.target.value as FamilyRec['mark_type'])} />
            <Input label={t('Word element')} value={form.word_element} onChange={(e) => set('word_element', e.target.value)} />
            <Input label={t('Transliteration')} value={form.transliteration} onChange={(e) => set('transliteration', e.target.value)} placeholder={t('Reading in Latin letters or kana')} />
            <Input label={t('Translation')} value={form.translation} onChange={(e) => set('translation', e.target.value)} />
            <Input label={t('Vienna codes')} value={form.vienna_codes} onChange={(e) => set('vienna_codes', e.target.value)} placeholder="27.5.1, 2.1.1" />
            <Input label={t('Disclaimer')} value={form.disclaimer} onChange={(e) => set('disclaimer', e.target.value)} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">{tm ? t('Mark image') : t('Design image')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
              <ImagePlus size={13} aria-hidden /> {f.mark_image !== '' ? t('Replace the image') : t('Choose an image')}
            </Button>
            {image !== null && <span className="min-w-0 break-all text-xs">{image.name}</span>}
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Strategy')} value={form.strategy} placeholder={t('Not set')} options={opts(enumOptions('families.strategy'))} onChange={(e) => set('strategy', e.target.value as FamilyRec['strategy'])} />
          <DateField label={t('Announcement date')} value={form.announcement_date} onChange={(v) => set('announcement_date', v)} help={t('Filings before this date are checked for leaks.')} />
        </div>
        <Textarea label={t('Strategy note')} rows={2} value={form.strategy_note} onChange={(e) => set('strategy_note', e.target.value)} />
        {(on('franchises') || on('talents')) && (
          <div className="grid gap-3 sm:grid-cols-3">
            {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={form.franchise} onChange={(v) => set('franchise', v)} />}
            {on('franchises') && <CatalogSelect kind="character" label={t('Character')} value={form.character} onChange={(v) => set('character', v)} />}
            {on('talents') && <CatalogSelect kind="talent" label={t('Talent')} value={form.talent} onChange={(v) => set('talent', v)} />}
          </div>
        )}
        <Input label={t('Owner entity')} value={form.owner_entity} onChange={(e) => set('owner_entity', e.target.value)} />
        <Textarea label={t('Products and services it is used on')} rows={2} value={form.products} onChange={(e) => set('products', e.target.value)} />
        <Textarea label={t('Description')} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
    </Dialog>
  );
}
