/**
 * Character create and edit dialog, and the AI policy (training, fan AI art,
 * voice cloning) stored in characters.ai_policy as
 * { training, fan_ai_art, voice_clone } with values no | labelled | yes.
 */
import { useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import type { Tone } from '../lib/labels.ts';
import type { CharacterRec, TitleRec } from '../lib/records.ts';
import type { NameEntry } from '../lib/shapes.ts';
import { CatalogSelect, MultiRecordPicker } from './pickers.tsx';
import { BirthdayField, DateField, ImageField, NamesEditor, isMonthDay, namesOf, saveImage } from './ipShared.tsx';
import { Field } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* AI policy                                                           */
/* ------------------------------------------------------------------ */

export type AiValue = 'no' | 'labelled' | 'yes';
export interface AiPolicy {
  training?: AiValue | undefined;
  fan_ai_art?: AiValue | undefined;
  voice_clone?: AiValue | undefined;
}
export const AI_KEYS = ['training', 'fan_ai_art', 'voice_clone'] as const;
export type AiKey = (typeof AI_KEYS)[number];

export function aiKeyLabel(k: AiKey): string {
  return k === 'training' ? t('AI training') : k === 'fan_ai_art' ? t('Fan AI art') : t('Voice cloning');
}

export function aiKeyHelp(k: AiKey): string {
  return k === 'training'
    ? t('Whether the character art, voice or lore may be used to train AI models.')
    : k === 'fan_ai_art'
      ? t('Whether fans may post AI-generated images of the character.')
      : t('Whether the character voice may be cloned or synthesized.');
}

export function aiValueLabel(v: string): string {
  return v === 'no' ? t('Not allowed') : v === 'labelled' ? t('Allowed if labelled') : v === 'yes' ? t('Allowed') : t('Not decided');
}

export const AI_TONE: Record<string, Tone> = { no: 'bad', labelled: 'warn', yes: 'good' };

function aiOptions(k: AiKey): { value: string; label: string }[] {
  const vals: AiValue[] = k === 'fan_ai_art' ? ['no', 'labelled', 'yes'] : ['no', 'yes'];
  return vals.map((v) => ({ value: v, label: aiValueLabel(v) }));
}

export function readAiPolicy(v: object | null | undefined): AiPolicy {
  const out: AiPolicy = {};
  if (v === null || v === undefined) return out;
  for (const k of AI_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (x === 'no' || x === 'labelled' || x === 'yes') out[k] = x;
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function CharacterForm({
  character,
  defaults,
  onClose,
  onSaved,
}: {
  character: CharacterRec | null;
  defaults?: Partial<Pick<CharacterRec, 'franchise' | 'kind'>> | undefined;
  onClose: () => void;
  onSaved?: ((c: CharacterRec) => void) | undefined;
}): React.JSX.Element {
  const { on } = useApp();
  const [name, setName] = useState(character?.name ?? '');
  const [names, setNames] = useState<NameEntry[]>(namesOf(character?.names));
  const [kind, setKind] = useState<string>(character?.kind ?? defaults?.kind ?? '');
  const [ownership, setOwnership] = useState<string>(character?.ownership_model ?? '');
  const [status, setStatus] = useState<string>(character?.status ?? 'development');
  const [franchise, setFranchise] = useState(character?.franchise ?? defaults?.franchise ?? '');
  const [appearsIn, setAppearsIn] = useState<string[]>(character?.appears_in ?? []);
  const [debut, setDebut] = useState(d10(character?.debut_date));
  const [birthday, setBirthday] = useState(character?.birthday ?? '');
  const [announced, setAnnounced] = useState(d10(character?.announcement_date));
  const [copyrightLine, setCopyrightLine] = useState(character?.copyright_line ?? '');
  const [profile, setProfile] = useState(character?.profile ?? '');
  const [ai, setAi] = useState<AiPolicy>(readAiPolicy(character?.ai_policy));
  const [image, setImage] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (name.trim() === '') {
      setError(t('Enter the name.'));
      return;
    }
    if (birthday !== '' && !isMonthDay(birthday)) return;
    setBusy(true);
    const policy: Record<string, string> = {};
    for (const k of AI_KEYS) {
      const v = ai[k];
      if (v !== undefined) policy[k] = v;
    }
    const data: Record<string, unknown> = {
      name: name.trim(),
      names: names.filter((n) => n.value.trim() !== '').map((n) => ({ script: n.script, value: n.value.trim() })),
      kind,
      ownership_model: ownership,
      status,
      debut_date: toPb(debut),
      birthday,
      announcement_date: toPb(announced),
      copyright_line: copyrightLine.trim(),
      profile,
      ai_policy: Object.keys(policy).length > 0 ? policy : null,
    };
    if (on('franchises') || character === null) data['franchise'] = franchise;
    if (on('titles')) data['appears_in'] = appearsIn;
    try {
      const saved = character === null ? await createRecord<CharacterRec>('characters', data) : await updateRecord<CharacterRec>('characters', character.id, data);
      await saveImage('characters', saved.id, image, imageRemoved);
      toast.success(character === null ? t('Character created') : t('Saved'));
      onSaved?.(saved);
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={character === null ? t('New character') : t('Edit character')}
      description={t('The character is the centre: products, licences, songs, marks and cases link to it.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {character === null ? t('Create character') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Name')} value={name} onChange={(e) => setName(e.target.value)} error={error !== '' ? error : undefined} autoFocus />
        <NamesEditor value={names} onChange={setNames} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Kind')} value={kind} placeholder={t('Not set')} options={enumOptions('characters.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
          <Select
            label={t('Ownership model')}
            value={ownership}
            placeholder={t('Not set')}
            options={enumOptions('characters.ownership_model').map(([value, label]) => ({ value, label }))}
            onChange={(e) => setOwnership(e.target.value)}
          />
          <Select label={t('Status')} value={status} options={enumOptions('characters.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
          {on('franchises') && <CatalogSelect kind="franchise" label={t('Franchise')} value={franchise} onChange={setFranchise} />}
          <DateField label={t('Debut date')} value={debut} onChange={setDebut} />
          <BirthdayField value={birthday} onChange={setBirthday} />
          <DateField label={t('Announcement date')} value={announced} onChange={setAnnounced} help={t('Until this date the character is confidential.')} />
          <Input label={t('Copyright line')} value={copyrightLine} onChange={(e) => setCopyrightLine(e.target.value)} placeholder="© ..." />
        </div>
        {on('titles') && (
          <MultiRecordPicker<TitleRec> collection="titles" label={t('Appears in')} value={appearsIn} onChange={setAppearsIn} labelOf={(x) => x.title} searchFields={['title', 'names']} placeholder={t('Add a title')} />
        )}
        <Field label={t('AI policy')} help={t('What the rights holder allows. Fan guidelines and licences quote it.')}>
          <div className="grid gap-3 sm:grid-cols-3">
            {AI_KEYS.map((k) => (
              <Select
                key={k}
                label={aiKeyLabel(k)}
                value={ai[k] ?? ''}
                placeholder={t('Not decided')}
                options={aiOptions(k)}
                onChange={(e) => {
                  const v = e.target.value;
                  setAi((p) => {
                    const n: AiPolicy = { ...p };
                    if (v === 'no' || v === 'labelled' || v === 'yes') n[k] = v;
                    else delete n[k];
                    return n;
                  });
                }}
              />
            ))}
          </div>
        </Field>
        <Textarea label={t('Profile')} value={profile} onChange={(e) => setProfile(e.target.value)} rows={4} placeholder={t('Persona, lore and the canon fans rely on.')} />
        <ImageField record={character} current={character?.image ?? ''} file={image} removed={imageRemoved} onFile={setImage} onRemove={setImageRemoved} />
      </div>
    </Dialog>
  );
}
