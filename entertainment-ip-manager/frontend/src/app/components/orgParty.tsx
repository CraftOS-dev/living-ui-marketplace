/**
 * People and companies: the create/edit dialog for a party and the detail
 * drawer (facts, involvements in works, songs, recordings and characters,
 * agreements, committee memberships, products as licensee, and Portal
 * access, where an admin links outside accounts to the company they act
 * for; the server derives every record's portal visibility from it).
 */
import { useState } from 'react';
import { ExternalLink, KeyRound, Pencil, Plus, X } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, TagInput, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate, fmtPct } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { AgreementRec, CommitteeMemberRec, InvolvementRec, PartyRec, ProductRec } from '../lib/records.ts';
import type { Role } from '../lib/shapes.ts';
import { EXTERNAL_ROLES } from '../lib/shapes.ts';
import { JurisdictionSelect } from './pickers.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, IdentityChip, JurChip, Notice, Prose, Ref, Tag } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { DialogBody, PARTY_ROLES, SubHeading, partyRoleLabel, roleLabel, useAsk } from './orgShared.tsx';

/** An alias as stored (plain text; older rows may hold { type, name }). */
export function aliasText(a: unknown): string {
  if (typeof a === 'string') return a;
  if (typeof a === 'object' && a !== null && 'name' in a) return String((a as { name: unknown }).name ?? '');
  return '';
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                       */
/* ------------------------------------------------------------------ */

export function PartyDialog({ party, onClose }: { party: PartyRec | null; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(party?.name ?? '');
  const [kana, setKana] = useState(party?.name_kana ?? '');
  const [kind, setKind] = useState<'person' | 'organization'>(party?.kind === 'person' ? 'person' : 'organization');
  const [roles, setRoles] = useState<string[]>(party?.roles ?? []);
  const [aliases, setAliases] = useState<string[]>((party?.aliases ?? []).map(aliasText).filter((a) => a !== ''));
  const [email, setEmail] = useState(party?.email ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [org, setOrg] = useState(party?.organization ?? '');
  const [country, setCountry] = useState(party?.country ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [extRef, setExtRef] = useState(party?.external_ref ?? '');
  const [ipi, setIpi] = useState(party?.ipi ?? '');
  const [society, setSociety] = useState(party?.society ?? '');
  const [notes, setNotes] = useState(party?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const ok = name.trim() !== '';

  const toggleRole = (r: string): void => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      name_kana: kana.trim(),
      kind,
      roles,
      aliases,
      email: email.trim(),
      phone: phone.trim(),
      organization: org.trim(),
      country: country.toUpperCase(),
      address: address.trim(),
      external_ref: extRef.trim(),
      ipi: ipi.trim(),
      society: society.trim(),
      notes,
    };
    try {
      if (party === null) {
        const rec = await createRecord<PartyRec>('parties', body);
        toast.success(t('{name} added', { name: rec.name }));
        onClose();
        navigate('people', rec.id);
      } else {
        await updateRecord('parties', party.id, body);
        toast.success(t('Saved'));
        onClose();
      }
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={party === null ? t('Add a person or company') : t('Edit {name}', { name: party.name })}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Name|party')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t('Name in kana')} placeholder={t('For example: カブシキガイシャサクラ')} value={kana} onChange={(e) => setKana(e.target.value)} />
        </div>
        <Select
          label={t('Kind')}
          value={kind}
          options={[
            { value: 'organization', label: enumLabel('parties.kind', 'organization') },
            { value: 'person', label: enumLabel('parties.kind', 'person') },
          ]}
          onChange={(e) => setKind(e.target.value === 'person' ? 'person' : 'organization')}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">{t('Roles')}</span>
          <div className="flex flex-wrap gap-1.5">
            {PARTY_ROLES.map((r) => {
              const on = roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRole(r)}
                  className={
                    on
                      ? 'border border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 px-2 py-0.5 text-xs text-[var(--agent-app-accent)]'
                      : 'border border-[var(--agent-app-border)] px-2 py-0.5 text-xs text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30'
                  }
                >
                  {partyRoleLabel(r)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <TagInput label={t('Other names')} value={aliases} onChange={setAliases} placeholder={t('Type a name and press Enter')} />
          <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Legal name, pen name, stage name, character name or former company name. Search finds the record by any of them.')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Email|field')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label={t('Phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={t('Organization|company of a person')} placeholder={t('Company or agency they belong to')} value={org} onChange={(e) => setOrg(e.target.value)} />
          <JurisdictionSelect label={t('Country')} value={country} onChange={setCountry} />
        </div>
        <Textarea label={t('Address')} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t('External reference')} value={extRef} onChange={(e) => setExtRef(e.target.value)} />
          <Input label={t('IPI number')} className="font-mono" value={ipi} onChange={(e) => setIpi(e.target.value)} />
          <Input label={t('Collecting society')} placeholder="JASRAC, NexTone" value={society} onChange={(e) => setSociety(e.target.value)} />
        </div>
        <Textarea label={t('Notes')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */

export function PartyDrawer({ party, onClose, onEdit }: { party: PartyRec; onClose: () => void; onEdit: () => void }): React.JSX.Element {
  const { can, on, userName } = useApp();
  const id = party.id;
  const inv = useCollection<InvolvementRec>('involvements', { filter: `party = ${q(id)}`, sort: 'role', expand: 'work,song,recording,character,matter,agreement' });
  const agreements = useCollection<AgreementRec>('agreements', { filter: `counterparty = ${q(id)} || agent = ${q(id)}`, sort: '-term_end' });
  const memberships = useCollection<CommitteeMemberRec>('committee_members', on('committees') ? { filter: `party = ${q(id)}`, expand: 'committee' } : { filter: 'id = "__none__"' });
  const products = useCollection<ProductRec>('products', on('products') ? { filter: `licensee = ${q(id)}`, sort: '-updated' } : { filter: 'id = "__none__"' });

  const involvementTarget = (r: InvolvementRec): { label: string; link: string | null; type: string } | null => {
    const ex = (r.expand ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const name = (k: string, f: string): string => {
      const rec = ex[k];
      return rec !== undefined ? String(rec[f] ?? '') : '';
    };
    if (r.work !== '') return { type: t('Title'), label: name('work', 'title') || r.work, link: on('titles') ? href('title', r.work) : null };
    if (r.song !== '') return { type: t('Song'), label: name('song', 'title') || r.song, link: on('music') ? href('song', r.song) : null };
    if (r.recording !== '') return { type: t('Recording'), label: name('recording', 'title') || r.recording, link: on('music') ? href('recording', r.recording) : null };
    if (r.character !== '') return { type: t('Character'), label: name('character', 'name') || r.character, link: href('character', r.character) };
    if (r.matter !== '') return { type: t('Trademark or design'), label: name('matter', 'ref') || name('matter', 'title') || r.matter, link: href('matter', r.matter) };
    if (r.agreement !== '') return { type: t('Agreement'), label: name('agreement', 'ref') || name('agreement', 'title') || r.agreement, link: href('agreement', r.agreement) };
    return null;
  };

  const aliases = (party.aliases ?? []).map(aliasText).filter((a) => a !== '');

  return (
    <Drawer
      open
      onClose={onClose}
      title={party.name}
      width={680}
      footer={
        can.edit ? (
          <>
            <DeleteButton collection="parties" id={id} className="mr-auto" onDeleted={onClose} />
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil size={13} aria-hidden /> {t('Edit')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <IdentityChip name={party.name} square={party.kind === 'organization'} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{party.name}</div>
            {party.name_kana !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{party.name_kana}</div>}
          </div>
        </div>
        {(party.roles ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(party.roles ?? []).map((r) => (
              <Tag key={r}>{partyRoleLabel(r)}</Tag>
            ))}
          </div>
        )}
        <FactGrid cols={2}>
          <Fact label={t('Kind')} value={enumLabel('parties.kind', party.kind)} />
          <Fact label={t('Organization|company of a person')} value={party.organization} />
          <Fact label={t('Email|field')} value={party.email !== '' ? <a className="text-[var(--agent-app-accent)] hover:underline" href={`mailto:${party.email}`}>{party.email}</a> : ''} />
          <Fact label={t('Phone')} value={party.phone} />
          <Fact label={t('Country')} value={party.country !== '' ? <span className="inline-flex items-center gap-1.5"><JurChip code={party.country} /> {jurisdictionName(party.country)}</span> : ''} />
          <Fact label={t('External reference')} value={party.external_ref} mono />
          <Fact label={t('IPI number')} value={party.ipi} mono />
          <Fact label={t('Collecting society')} value={party.society} />
          {party.user !== '' && <Fact label={t('Linked account')} value={userName(party.user)} />}
        </FactGrid>
        {aliases.length > 0 && (
          <div>
            <SubHeading>{t('Other names')}</SubHeading>
            <div className="flex flex-wrap gap-1.5">
              {aliases.map((a) => (
                <span key={a} className="border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
        {party.address !== '' && (
          <div>
            <SubHeading>{t('Address')}</SubHeading>
            <Prose>{party.address}</Prose>
          </div>
        )}
        {party.notes !== '' && (
          <div>
            <SubHeading>{t('Notes')}</SubHeading>
            <Prose>{party.notes}</Prose>
          </div>
        )}

        <div>
          <SubHeading>{t('Involvements')}</SubHeading>
          {inv.records.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{inv.loading ? t('Loading') : t('Not credited on any title, song, recording, character or trademark yet.')}</p>
          ) : (
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {inv.records.map((r) => {
                const target = involvementTarget(r);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                    <span className="w-full shrink-0 text-xs text-[var(--agent-app-muted)] sm:w-32">{enumLabel('involvements.role', r.role)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {target === null ? (
                        '-'
                      ) : target.link !== null ? (
                        <a className="text-[var(--agent-app-accent)] hover:underline" href={target.link}>
                          {target.label}
                        </a>
                      ) : (
                        target.label
                      )}
                    </span>
                    {target !== null && <Tag>{target.type}</Tag>}
                    {r.share > 0 && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtPct(r.share)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <SubHeading>{t('Agreements')}</SubHeading>
          {agreements.records.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">{agreements.loading ? t('Loading') : t('No agreements with them yet.')}</p>
          ) : (
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {agreements.records.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                  <Ref>{a.ref}</Ref>
                  <a className="min-w-0 flex-1 basis-40 truncate text-[var(--agent-app-accent)] hover:underline" href={href('agreement', a.id)}>
                    {a.title}
                  </a>
                  <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('agreements.agreement_type', a.agreement_type)}</span>
                  <EnumPill field="agreements.status" value={a.status} />
                  {a.term_end !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('until {date}', { date: fmtDate(a.term_end) })}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {on('committees') && memberships.records.length > 0 && (
          <div>
            <SubHeading>{t('Committee memberships')}</SubHeading>
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {memberships.records.map((m) => {
                const c = (m.expand as { committee?: { name?: string } } | undefined)?.committee;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                    <a className="min-w-0 flex-1 basis-40 truncate text-[var(--agent-app-accent)] hover:underline" href={href('committee', m.committee)}>
                      {c?.name ?? m.name}
                    </a>
                    {m.share_pct > 0 && <span className="text-xs tabular-nums">{t('Share {pct}', { pct: fmtPct(m.share_pct) })}</span>}
                    <EnumPill field="committee_members.status" value={m.status} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {on('products') && products.records.length > 0 && (
          <div>
            <SubHeading>{t('Products as licensee')}</SubHeading>
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {products.records.slice(0, 50).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                  <Ref>{p.ref}</Ref>
                  <a className="min-w-0 flex-1 basis-40 truncate text-[var(--agent-app-accent)] hover:underline" href={href('product', p.id)}>
                    {p.name}
                  </a>
                  <EnumPill field="products.stage" value={p.stage} />
                </li>
              ))}
            </ul>
            {products.records.length > 50 && <p className="mt-1 text-xs text-[var(--agent-app-muted)]">{t('Showing 50 of {n}. See all on the Products page.', { n: products.records.length })}</p>}
          </div>
        )}

        {can.admin && <PortalAccess party={party} />}
      </div>
    </Drawer>
  );
}

/** Admin: which outside accounts log in for this company. */
function PortalAccess({ party }: { party: PartyRec }): React.JSX.Element {
  const { users } = useApp();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [askEl, ask] = useAsk();
  const linked = party.portal_users ?? [];
  const external = users.filter((u) => EXTERNAL_ROLES.includes(u.role as Role));
  const candidates = external.filter((u) => !linked.includes(u.id));
  const nameOf = (id: string): string => {
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.email : id;
  };
  const roleOf = (id: string): string => roleLabel(users.find((x) => x.id === id)?.role ?? '');

  const write = async (next: string[], success: string): Promise<void> => {
    setBusy(true);
    try {
      await updateRecord('parties', party.id, { portal_users: next });
      toast.success(success);
      setPick('');
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    if (pick === '' || linked.includes(pick)) return;
    await write([...linked, pick], t('{name} now sees {company}\'s records in the portal', { name: nameOf(pick), company: party.name }));
  };

  const remove = async (uid: string): Promise<void> => {
    const ok = await ask(t('{name} will no longer see {company}\'s agreements, products, statements or committee records in the portal.', { name: nameOf(uid), company: party.name }), t('Remove portal access?'), { confirmLabel: t('Remove') });
    if (!ok) return;
    await write(linked.filter((x) => x !== uid), t('Portal access removed'));
  };

  return (
    <div className="flex flex-col gap-2 border border-[var(--agent-app-border)] p-3">
      {askEl}
      <SubHeading>{t('Portal access')}</SubHeading>
      <Notice tone="info" icon={KeyRound}>
        {t('Outside accounts linked here act for {company}. This decides what they see: their agreements, products, approvals, statements, seals, committees and consent requests follow from it. Nothing from other companies is shown.', { company: party.name })}
      </Notice>
      {linked.length === 0 ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No outside account acts for this company yet.')}</p>
      ) : (
        <ul className="flex flex-col border border-[var(--agent-app-border)]">
          {linked.map((uid) => (
            <li key={uid} className="flex min-w-0 items-center gap-2 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
              <IdentityChip name={nameOf(uid)} size="sm" />
              <span className="min-w-0 flex-1 truncate">{nameOf(uid)}</span>
              <Tag>{roleOf(uid)}</Tag>
              <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t('Remove {name}|link', { name: nameOf(uid) })} disabled={busy} onClick={() => void remove(uid)}>
                <X size={13} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <Select
              aria-label={t('Outside account')}
              value={pick}
              placeholder={t('Choose an outside account')}
              options={candidates.map((u) => ({ value: u.id, label: `${u.name || u.email} (${roleLabel(u.role)})` }))}
              onChange={(e) => setPick(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" loading={busy} disabled={pick === ''} onClick={() => void add()}>
            <Plus size={13} aria-hidden /> {t('Link account')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--agent-app-muted)]">
          {t('To add someone, first invite them with an outside role in Settings, People and roles.')}{' '}
          <a href={href('settings', undefined, { tab: 'people' })} className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
            {t('Open People and roles')} <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      )}
    </div>
  );
}

/** Empty state for the list. */
export function PartiesEmpty({ canAdd, onAdd, filtered }: { canAdd: boolean; onAdd: () => void; filtered: boolean }): React.JSX.Element {
  return (
    <EmptyHint
      compact
      title={filtered ? t('No one matches') : t('No people or companies yet')}
      message={filtered ? t('Try another search or clear the filters.') : t('Add licensors, licensees, committee members, studios, agencies, creators and counsel. Agreements, credits and portal access all point to them.')}
      action={!filtered && canAdd ? <Button size="sm" onClick={onAdd}>{t('Add a person or company')}</Button> : undefined}
    />
  );
}

/** Used by the list's name column: the kana under the name. */
export function partyNameCell(p: PartyRec): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <IdentityChip name={p.name} size="sm" square={p.kind === 'organization'} />
      <div className="min-w-0">
        <div className="truncate font-medium">{p.name}</div>
        {p.name_kana !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{p.name_kana}</div>}
      </div>
    </div>
  );
}

