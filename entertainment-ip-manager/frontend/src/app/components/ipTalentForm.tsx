/**
 * Talent create and edit dialog: stage name, names, type, affiliation,
 * agency, managers, privacy, revenue share and channels. The lifecycle is
 * chosen at creation; afterwards it moves only through a lifecycle step
 * (talents/lifecycle), which also lays out the playbook.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import type { TalentRec } from '../lib/records.ts';
import type { NameEntry, TalentChannel } from '../lib/shapes.ts';
import { PartyPicker } from './pickers.tsx';
import { BirthdayField, DateField, ImageField, NamesEditor, RowsEditor, UserMultiSelect, asRows, isMonthDay, namesOf, numOrNull, saveImage } from './ipShared.tsx';
import type { EditRow } from './ipShared.tsx';
import { Notice } from './ui.tsx';

/** One row of talents.revenue_share. */
export interface RevenueShareRow {
  category: string;
  talent_pct: number | null;
  agency_pct: number | null;
}

export function readRevenueShare(v: unknown): RevenueShareRow[] {
  return asRows<Partial<RevenueShareRow>>(v)
    .filter((r) => typeof r === 'object' && r !== null)
    .map((r) => ({
      category: typeof r.category === 'string' ? r.category : '',
      talent_pct: typeof r.talent_pct === 'number' ? r.talent_pct : null,
      agency_pct: typeof r.agency_pct === 'number' ? r.agency_pct : null,
    }));
}

/** Platform codes from the platform dimension (all but the "all platforms" root). */
export function usePlatformOptions(): { value: string; label: string }[] {
  const { dimValues, dimLabel } = useApp();
  return useMemo(
    () => dimValues.filter((d) => d.dimension === 'platform' && d.parent_code !== '').map((d) => ({ value: d.code, label: dimLabel('platform', d.code) })),
    [dimValues, dimLabel],
  );
}

export function TalentForm({ talent, onClose, onSaved }: { talent: TalentRec | null; onClose: () => void; onSaved?: ((x: TalentRec) => void) | undefined }): React.JSX.Element {
  const { me } = useApp();
  const platforms = usePlatformOptions();
  const [stageName, setStageName] = useState(talent?.stage_name ?? '');
  const [names, setNames] = useState<NameEntry[]>(namesOf(talent?.names));
  const [type, setType] = useState<string>(talent?.talent_type ?? '');
  const [affiliation, setAffiliation] = useState<string>(talent?.affiliation ?? 'ours');
  const [agency, setAgency] = useState(talent?.agency ?? '');
  const [party, setParty] = useState(talent?.party ?? '');
  const [lifecycle, setLifecycle] = useState<string>(talent?.lifecycle ?? 'pre_debut');
  const [debut, setDebut] = useState(d10(talent?.debut_date));
  const [birthday, setBirthday] = useState(talent?.birthday ?? '');
  const [managers, setManagers] = useState<string[]>(talent?.managers ?? (me !== null ? [me.id] : []));
  const [privacy, setPrivacy] = useState<string>(talent?.privacy_class ?? 'restricted');
  const [share, setShare] = useState<EditRow[]>(() =>
    readRevenueShare(talent?.revenue_share).map((r) => ({ category: r.category, talent_pct: r.talent_pct === null ? '' : String(r.talent_pct), agency_pct: r.agency_pct === null ? '' : String(r.agency_pct) })),
  );
  const [channels, setChannels] = useState<EditRow[]>(() => asRows<TalentChannel>(talent?.channels).map((c) => ({ platform: c.platform ?? '', handle: c.handle ?? '', url: c.url ?? '' })));
  const [profile, setProfile] = useState(talent?.profile ?? '');
  const [notes, setNotes] = useState(talent?.notes ?? '');
  const [image, setImage] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (stageName.trim() === '') {
      setError(t('Enter the stage name.'));
      return;
    }
    if (birthday !== '' && !isMonthDay(birthday)) return;
    setBusy(true);
    const data: Record<string, unknown> = {
      stage_name: stageName.trim(),
      names: names.filter((n) => n.value.trim() !== '').map((n) => ({ script: n.script, value: n.value.trim() })),
      talent_type: type,
      affiliation,
      agency,
      party,
      debut_date: toPb(debut),
      birthday,
      managers,
      privacy_class: privacy,
      revenue_share: share
        .filter((r) => (r['category'] ?? '').trim() !== '')
        .map((r) => ({ category: (r['category'] ?? '').trim(), talent_pct: numOrNull(r['talent_pct']), agency_pct: numOrNull(r['agency_pct']) })),
      channels: channels
        .filter((c) => (c['platform'] ?? '') !== '' || (c['handle'] ?? '').trim() !== '' || (c['url'] ?? '').trim() !== '')
        .map((c) => ({ platform: c['platform'] ?? '', handle: (c['handle'] ?? '').trim(), url: (c['url'] ?? '').trim() })),
      profile,
      notes: notes.trim(),
    };
    if (talent === null) data['lifecycle'] = lifecycle;
    try {
      const saved = talent === null ? await createRecord<TalentRec>('talents', data) : await updateRecord<TalentRec>('talents', talent.id, data);
      await saveImage('talents', saved.id, image, imageRemoved);
      toast.success(talent === null ? t('Talent created') : t('Saved'));
      onSaved?.(saved);
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  const platformOptions = [{ value: '', label: t('Choose') }, ...platforms];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={talent === null ? t('New talent') : t('Edit talent')}
      description={t('Stage names only. The legal identity is kept separately and only admins and the managers of this talent can see it.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {talent === null ? t('Create talent') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label={t('Stage name|talent')} value={stageName} onChange={(e) => setStageName(e.target.value)} error={error !== '' ? error : undefined} autoFocus />
        <NamesEditor value={names} onChange={setNames} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Type')} value={type} placeholder={t('Not set')} options={enumOptions('talents.talent_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
          <Select label={t('Affiliation')} value={affiliation} options={enumOptions('talents.affiliation').map(([value, label]) => ({ value, label }))} onChange={(e) => setAffiliation(e.target.value)} />
          <PartyPicker label={t('Agency|talent')} value={agency} onChange={(id) => setAgency(id)} />
          <PartyPicker label={t('Contract party')} value={party} onChange={(id) => setParty(id)} />
          {talent === null ? (
            <Select label={t('Lifecycle')} value={lifecycle} options={enumOptions('talents.lifecycle').map(([value, label]) => ({ value, label }))} onChange={(e) => setLifecycle(e.target.value)} />
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('Lifecycle')}</span>
              <span className="text-[13px]">{enumLabel('talents.lifecycle', talent.lifecycle)}</span>
              <span className="text-xs text-[var(--agent-app-muted)]">{t('Change it with a lifecycle step so the playbook follows.')}</span>
            </div>
          )}
          <Select label={t('Privacy|talent')} value={privacy} options={enumOptions('talents.privacy_class').map(([value, label]) => ({ value, label }))} onChange={(e) => setPrivacy(e.target.value)} />
          <DateField label={t('Debut date')} value={debut} onChange={setDebut} help={t('Debut anniversaries become yearly reminders.')} />
          <BirthdayField value={birthday} onChange={setBirthday} />
        </div>
        <UserMultiSelect label={t('Managers|talent')} value={managers} onChange={setManagers} help={t('Managers can see and edit the legal identity of this talent.')} />
        {talent === null && managers.length === 0 && <Notice tone="warn">{t('Without a manager only admins can see the legal identity.')}</Notice>}
        <RowsEditor
          label={t('Revenue share|talent')}
          help={t('Talent and agency percentages per revenue category, from the talent agreement.')}
          cols={[
            { key: 'category', label: t('Category'), placeholder: t('For example Super Chat'), grow: 2 },
            { key: 'talent_pct', label: t('Talent %'), kind: 'number', grow: 1 },
            { key: 'agency_pct', label: t('Agency %'), kind: 'number', grow: 1 },
          ]}
          rows={share}
          onChange={setShare}
          addLabel={t('Add a category')}
        />
        <RowsEditor
          label={t('Channels')}
          cols={[
            { key: 'platform', label: t('Platform'), kind: 'select', options: platformOptions, grow: 1 },
            { key: 'handle', label: t('Handle|channel'), placeholder: '@', grow: 1 },
            { key: 'url', label: t('URL'), placeholder: 'https://', grow: 2 },
          ]}
          rows={channels}
          onChange={setChannels}
          addLabel={t('Add a channel')}
        />
        <Textarea label={t('Profile')} value={profile} onChange={(e) => setProfile(e.target.value)} rows={3} />
        <Textarea label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <ImageField record={talent} current={talent?.image ?? ''} file={image} removed={imageRemoved} onFile={setImage} onRemove={setImageRemoved} />
      </div>
    </Dialog>
  );
}
