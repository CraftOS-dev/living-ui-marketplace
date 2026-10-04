/**
 * Guidelines (二次創作ガイドライン): published and draft fan, clip, cover,
 * AI-use and event guidelines per franchise, talent or characters; the
 * starter templates that ship with the app (copied into editable drafts,
 * never sample data); the editor with a sanitized preview; publishing a
 * draft, which supersedes the previous version for the same scope.
 */
import { useMemo, useState } from 'react';
import { BookMarked, ExternalLink, FilePlus2, Pencil, Send, Sparkles } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { createRecord, errText, getRecord, op, updateRecord } from '../lib/api.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, isJa, joinList, t } from '../lib/i18n.ts';
import type { CharacterRec, GuidelineRec } from '../lib/records.ts';
import { CatalogSelect, MultiRecordPicker } from './pickers.tsx';
import { Checkbox, EmptyHint, EnumPill, Fact, FactGrid, ListRow, Notice, Prose, Section, Segmented, Tag } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { DialogBody, HtmlPreview, SubHeading } from './orgShared.tsx';

type Kind = GuidelineRec['kind'];

/** Who a guideline covers, in words. */
export function useScopeLabel(): (g: Pick<GuidelineRec, 'franchise' | 'talent' | 'characters'>) => string {
  const { nameOf } = useApp();
  return (g) => {
    const parts: string[] = [];
    if (g.franchise !== '') parts.push(nameOf('franchise', g.franchise) || t('Franchise'));
    if (g.talent !== '') parts.push(nameOf('talent', g.talent) || t('Talent'));
    if (g.characters.length > 0) parts.push(joinList(g.characters.map((c) => nameOf('character', c)).filter((x) => x !== '')));
    return parts.length ? parts.join(' · ') : t('The whole company');
  };
}

/** Same kind and scope (the publish op supersedes along this key). */
function sameScope(a: GuidelineRec, b: GuidelineRec): boolean {
  return a.kind === b.kind && a.franchise === b.franchise && a.talent === b.talent;
}

export function GuidelinesTab(): React.JSX.Element {
  const { can } = useApp();
  const scopeLabel = useScopeLabel();
  const [editing, setEditing] = useState<GuidelineRec | 'new' | null>(null);
  const [viewing, setViewing] = useState<GuidelineRec | null>(null);
  const [publishing, setPublishing] = useState<GuidelineRec | null>(null);
  const [fromTemplate, setFromTemplate] = useState<GuidelineRec | null>(null);
  const all = useGuidelines();

  const templates = all.records.filter((g) => g.template);
  const real = all.records.filter((g) => !g.template);
  const published = real.filter((g) => g.status === 'published');
  const drafts = real.filter((g) => g.status === 'draft');
  const superseded = real.filter((g) => g.status === 'superseded');

  const row = (g: GuidelineRec, onClick: () => void, trailing?: React.ReactNode): React.JSX.Element => (
    <ListRow
      key={g.id}
      onClick={onClick}
      primary={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{g.title}</span>
          {g.version !== '' && <span className="shrink-0 font-mono text-[11px] text-[var(--agent-app-muted)]">v{g.version}</span>}
        </span>
      }
      secondary={`${enumLabel('guidelines.kind', g.kind)} · ${scopeLabel(g)}${d10(g.effective_date) !== '' ? ` · ${t('in effect from {date}', { date: fmtDate(g.effective_date) })}` : ''}`}
      trailing={
        <>
          <EnumPill field="guidelines.status" value={g.status} className="hidden sm:inline-flex" />
          {trailing}
        </>
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('Published guidelines')}
        meta={String(published.length)}
        flush
        actions={
          can.edit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <FilePlus2 size={13} aria-hidden /> <span className="hidden sm:inline">{t('New draft')}</span>
            </Button>
          ) : undefined
        }
      >
        {published.length === 0 ? (
          <EmptyHint
            compact
            icon={BookMarked}
            title={t('No published guideline yet')}
            message={t('Start from a starter template below, adjust it to your rules, then publish it. Fans and clip channels read the published version.')}
          />
        ) : (
          <div>{published.map((g) => row(g, () => setViewing(g)))}</div>
        )}
      </Section>

      {(drafts.length > 0 || can.edit) && (
        <Section title={t('Drafts')} meta={String(drafts.length)} flush>
          {drafts.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-[var(--agent-app-muted)]">{t('No drafts. Use a template or start a new draft.')}</p>
          ) : (
            <div>
              {drafts.map((g) =>
                row(
                  g,
                  () => (can.edit ? setEditing(g) : setViewing(g)),
                  can.manage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPublishing(g);
                      }}
                    >
                      <Send size={12} aria-hidden /> <span className="hidden sm:inline">{t('Publish')}</span>
                    </Button>
                  ) : undefined,
                ),
              )}
            </div>
          )}
        </Section>
      )}

      <Section title={t('Starter templates')} meta={String(templates.length)} flush>
        <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
          {t('Editable starting points based on common Japanese industry practice. Using one copies it into a draft for the franchise, talent or characters you choose; the template itself stays unchanged. Have your counsel review a draft before you publish it.')}
        </p>
        {templates.length === 0 ? (
          <EmptyHint compact icon={Sparkles} title={t('No templates')} message={t('The starter templates ship with the app. If none appear, the reference data has not loaded.')} />
        ) : (
          <div>
            {templates.map((g) => (
              <ListRow
                key={g.id}
                onClick={() => setViewing(g)}
                primary={g.title}
                secondary={`${enumLabel('guidelines.kind', g.kind)} · ${(g.languages ?? []).map((l) => (l === 'ja' ? '日本語' : l === 'en' ? 'English' : l)).join(' / ')}`}
                trailing={
                  can.edit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFromTemplate(g);
                      }}
                    >
                      <Sparkles size={12} aria-hidden /> {t('Use template')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </Section>

      {superseded.length > 0 && (
        <Section title={t('History')} meta={String(superseded.length)} flush>
          <div>{superseded.map((g) => row(g, () => setViewing(g)))}</div>
        </Section>
      )}

      {editing !== null && <GuidelineEditor guideline={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onPublish={(g) => setPublishing(g)} />}
      {viewing !== null && (
        <GuidelineViewer
          guideline={all.records.find((g) => g.id === viewing.id) ?? viewing}
          history={real.filter((g) => g.id !== viewing.id && sameScope(g, viewing) && g.status !== 'draft')}
          onClose={() => setViewing(null)}
          onEdit={(g) => {
            setViewing(null);
            setEditing(g);
          }}
          onUseTemplate={(g) => {
            setViewing(null);
            setFromTemplate(g);
          }}
        />
      )}
      {publishing !== null && <PublishDialog guideline={publishing} onClose={() => setPublishing(null)} />}
      {fromTemplate !== null && (
        <FromTemplateDialog
          template={fromTemplate}
          onClose={() => setFromTemplate(null)}
          onCreated={(id) => {
            setFromTemplate(null);
            getRecord<GuidelineRec>('guidelines', id)
              .then((fresh) => setEditing(fresh))
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export function useGuidelines(): { records: GuidelineRec[]; loading: boolean } {
  const g = useCollection<GuidelineRec>('guidelines', { sort: '-effective_date,-created' });
  return { records: g.records, loading: g.loading };
}

/* ------------------------------------------------------------------ */
/* Scope fields                                                        */
/* ------------------------------------------------------------------ */

function ScopeFields({
  franchise,
  talent,
  characters,
  onFranchise,
  onTalent,
  onCharacters,
}: {
  franchise: string;
  talent: string;
  characters: string[];
  onFranchise: (v: string) => void;
  onTalent: (v: string) => void;
  onCharacters: (v: string[]) => void;
}): React.JSX.Element {
  const { on } = useApp();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {(on('franchises') || franchise !== '') && <CatalogSelect kind="franchise" label={t('Franchise')} placeholder={t('Not limited to a franchise')} value={franchise} onChange={onFranchise} />}
        {(on('talents') || talent !== '') && <CatalogSelect kind="talent" label={t('Talent')} placeholder={t('Not limited to a talent')} value={talent} onChange={onTalent} />}
      </div>
      <MultiRecordPicker<CharacterRec>
        collection="characters"
        label={t('Characters')}
        placeholder={t('Add a character')}
        value={characters}
        onChange={onCharacters}
        labelOf={(c) => c.name}
        searchFields={['name']}
      />
      <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Leave everything empty for a company-wide guideline.')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function GuidelineEditor({ guideline, onClose, onPublish }: { guideline: GuidelineRec | null; onClose: () => void; onPublish: (g: GuidelineRec) => void }): React.JSX.Element {
  const { can } = useApp();
  const g = guideline;
  const [title, setTitle] = useState(g?.title ?? '');
  const [kind, setKind] = useState<string>(g?.kind || 'fan_work');
  const [franchise, setFranchise] = useState(g?.franchise ?? '');
  const [talent, setTalent] = useState(g?.talent ?? '');
  const [characters, setCharacters] = useState<string[]>(g?.characters ?? []);
  const [version, setVersion] = useState(g?.version ?? '1.0');
  const [effective, setEffective] = useState(d10(g?.effective_date) || '');
  const [languages, setLanguages] = useState<string[]>(g?.languages ?? ['ja', 'en']);
  const [body, setBody] = useState(g?.body ?? '');
  const [bodyJa, setBodyJa] = useState(g?.body_ja ?? '');
  const [changelog, setChangelog] = useState(g?.changelog ?? '');
  const [url, setUrl] = useState(g?.url ?? '');
  const [lang, setLang] = useState<'ja' | 'en'>(isJa() ? 'ja' : 'en');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const readOnly = g !== null && g.status !== 'draft';
  const ok = title.trim() !== '';

  const toggleLang = (l: string, v: boolean): void => setLanguages((cur) => (v ? [...new Set([...cur, l])] : cur.filter((x) => x !== l)));

  const save = async (): Promise<GuidelineRec | null> => {
    if (!ok) {
      toast.error(t('Give the guideline a title.'));
      return null;
    }
    setBusy(true);
    const data = {
      title: title.trim(),
      kind,
      franchise,
      talent,
      characters,
      version: version.trim(),
      effective_date: effective !== '' ? toPb(effective) : '',
      languages,
      body,
      body_ja: bodyJa,
      changelog,
      url: url.trim(),
    };
    try {
      const rec = g === null ? await createRecord<GuidelineRec>('guidelines', { ...data, status: 'draft', template: false }) : await updateRecord<GuidelineRec>('guidelines', g.id, data);
      toast.success(t('Draft saved'));
      return rec;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  };

  const current = lang === 'ja' ? bodyJa : body;
  const setCurrent = lang === 'ja' ? setBodyJa : setBody;

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={g === null ? t('New guideline draft') : readOnly ? g.title : t('Edit draft: {title}', { title: g.title })}
      className="w-[min(94vw,60rem)]"
      footer={
        readOnly ? (
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button
              variant="outline"
              loading={busy}
              disabled={!ok}
              onClick={() =>
                void save().then((r) => {
                  if (r !== null) onClose();
                })
              }
            >
              {t('Save draft')}
            </Button>
            {can.manage && (
              <Button
                loading={busy}
                disabled={!ok}
                onClick={() =>
                  void save().then((r) => {
                    if (r !== null) {
                      onClose();
                      onPublish(r);
                    }
                  })
                }
              >
                <Send size={13} aria-hidden /> {t('Save and publish')}
              </Button>
            )}
          </>
        )
      }
    >
      <DialogBody>
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select label={t('Kind')} value={kind} options={enumOptions('guidelines.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
          </div>
          <ScopeFields franchise={franchise} talent={talent} characters={characters} onFranchise={setFranchise} onTalent={setTalent} onCharacters={setCharacters} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label={t('Version')} className="font-mono" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input label={t('In effect from')} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('Languages')}</span>
              <div className="flex flex-wrap gap-4 pt-1.5">
                <Checkbox checked={languages.includes('ja')} onChange={(v) => toggleLang('ja', v)} label="日本語" />
                <Checkbox checked={languages.includes('en')} onChange={(v) => toggleLang('en', v)} label="English" />
              </div>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<'ja' | 'en'>
              size="sm"
              ariaLabel={t('Body language')}
              value={lang}
              onChange={setLang}
              options={[
                { value: 'ja', label: t('Japanese text') },
                { value: 'en', label: t('English text') },
              ]}
            />
            <Segmented<'edit' | 'preview'>
              size="sm"
              ariaLabel={t('Edit or preview')}
              value={readOnly ? 'preview' : mode}
              onChange={setMode}
              options={[
                { value: 'edit', label: t('HTML') },
                { value: 'preview', label: t('Preview') },
              ]}
            />
          </div>
          {mode === 'edit' && !readOnly ? (
            <Textarea aria-label={lang === 'ja' ? t('Japanese text') : t('English text')} rows={16} className="font-mono text-xs" value={current} onChange={(e) => setCurrent(e.target.value)} />
          ) : (
            <div className="max-h-[50vh] overflow-y-auto border border-[var(--agent-app-border)] p-3">
              <HtmlPreview html={current} />
            </div>
          )}
          <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Write the body in HTML (headings, paragraphs, lists, links). Scripts, embedded frames and event handlers are removed when it is shown.')}</p>
        </div>

        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-3">
          <Textarea label={t('What changed in this version')} rows={2} value={changelog} onChange={(e) => setChangelog(e.target.value)} />
          <Input label={t('Public URL')} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </fieldset>
      </DialogBody>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

function GuidelineViewer({
  guideline,
  history,
  onClose,
  onEdit,
  onUseTemplate,
}: {
  guideline: GuidelineRec;
  history: GuidelineRec[];
  onClose: () => void;
  onEdit: (g: GuidelineRec) => void;
  onUseTemplate: (g: GuidelineRec) => void;
}): React.JSX.Element {
  const { can } = useApp();
  const scopeLabel = useScopeLabel();
  const g = guideline;
  const [lang, setLang] = useState<'ja' | 'en'>(isJa() ? (g.body_ja !== '' ? 'ja' : 'en') : g.body !== '' ? 'en' : 'ja');
  return (
    <Drawer
      open
      onClose={onClose}
      title={g.title}
      width={760}
      footer={
        can.edit ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <DeleteButton
              collection="guidelines"
              id={g.id}
              onDeleted={onClose}
              className="mr-auto"
              note={!g.template && g.status !== 'draft' ? t('Fans and licensees who agreed to this version keep the link on their permits only while it exists. To change the terms, publish a new version instead.') : undefined}
            />
            {g.template ? (
              <Button size="sm" onClick={() => onUseTemplate(g)}>
                <Sparkles size={13} aria-hidden /> {t('Use template')}
              </Button>
            ) : g.status === 'draft' ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(g)}>
                <Pencil size={13} aria-hidden /> {t('Edit')}
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          {g.template ? <Tag>{t('Starter template')}</Tag> : <EnumPill field="guidelines.status" value={g.status} />}
          <Tag>{enumLabel('guidelines.kind', g.kind)}</Tag>
        </div>
        {!g.template && (
          <FactGrid cols={2}>
            <Fact label={t('Applies to')} value={scopeLabel(g)} />
            <Fact label={t('Version')} value={g.version} mono />
            <Fact label={t('In effect from')} value={fmtDate(g.effective_date)} />
            <Fact
              label={t('Public URL')}
              value={
                g.url !== '' ? (
                  <a href={g.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-[var(--agent-app-accent)] hover:underline">
                    <span className="min-w-0 truncate">{g.url}</span> <ExternalLink size={11} aria-hidden className="shrink-0" />
                  </a>
                ) : (
                  ''
                )
              }
            />
          </FactGrid>
        )}
        {g.changelog !== '' && (
          <div>
            <SubHeading>{t('What changed in this version')}</SubHeading>
            <Prose>{g.changelog}</Prose>
          </div>
        )}
        <div>
          <SubHeading
            right={
              <Segmented<'ja' | 'en'>
                size="sm"
                ariaLabel={t('Body language')}
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'ja', label: '日本語' },
                  { value: 'en', label: 'English' },
                ]}
              />
            }
          >
            {t('Text')}
          </SubHeading>
          <div className="border border-[var(--agent-app-border)] p-3">
            <HtmlPreview html={lang === 'ja' ? g.body_ja : g.body} />
          </div>
        </div>
        {history.length > 0 && (
          <div>
            <SubHeading>{t('Other versions for the same scope')}</SubHeading>
            <ul className="flex flex-col border border-[var(--agent-app-border)]">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                  <span className="font-mono text-xs">v{h.version}</span>
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(h.effective_date)}</span>
                  <EnumPill field="guidelines.status" value={h.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Publish and use-template dialogs                                    */
/* ------------------------------------------------------------------ */

function PublishDialog({ guideline, onClose }: { guideline: GuidelineRec; onClose: () => void }): React.JSX.Element {
  const scopeLabel = useScopeLabel();
  const all = useGuidelines();
  const [version, setVersion] = useState(guideline.version || '1.0');
  const [effective, setEffective] = useState(d10(guideline.effective_date) || today());
  const [changelog, setChangelog] = useState(guideline.changelog);
  const [url, setUrl] = useState(guideline.url);
  const [busy, setBusy] = useState(false);
  const replaces = useMemo(() => all.records.filter((g) => g.status === 'published' && !g.template && g.id !== guideline.id && sameScope(g, guideline)), [all.records, guideline]);

  const publish = async (): Promise<void> => {
    if (version.trim() === '') {
      toast.error(t('Give a version number.'));
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ superseded: string[] }>('guidelines/publish', { guideline_id: guideline.id, version: version.trim(), effective_date: effective, changelog: changelog.trim(), url: url.trim() });
      toast.success(r.superseded.length > 0 ? t('Published. The previous version is now marked superseded.') : t('Published'));
      onClose();
    } catch (err) {
      toast.error(errText(err));
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
      title={t('Publish {title}', { title: guideline.title })}
      description={t('{kind} for {scope}', { kind: enumLabel('guidelines.kind', guideline.kind), scope: scopeLabel(guideline) })}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} onClick={() => void publish()}>
            <Send size={13} aria-hidden /> {t('Publish')}
          </Button>
        </>
      }
    >
      <DialogBody>
        {replaces.length > 0 && (
          <Notice tone="warn">
            {t('This replaces the published version {versions}. It is kept in History as superseded.', { versions: replaces.map((r) => `v${r.version}`).join(', ') })}
          </Notice>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Version')} className="font-mono" value={version} onChange={(e) => setVersion(e.target.value)} />
          <Input label={t('In effect from')} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        <Textarea label={t('What changed in this version')} rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)} />
        <Input label={t('Public URL')} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}

function FromTemplateDialog({ template, onClose, onCreated }: { template: GuidelineRec; onClose: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState(template.title);
  const [franchise, setFranchise] = useState('');
  const [talent, setTalent] = useState('');
  const [characters, setCharacters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ id: string; title: string }>('guidelines/from-template', { template_id: template.id, title: title.trim(), franchise_id: franchise, talent_id: talent, characters });
      toast.success(t('Draft created from the template. Adjust it, then publish.'));
      onCreated(r.id);
    } catch (err) {
      toast.error(errText(err));
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
      title={t('Use template')}
      description={t('Copies "{title}" into a new draft. The template stays as it is.', { title: template.title })}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={title.trim() === ''} onClick={() => void create()}>
            {t('Create draft')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Input label={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <ScopeFields franchise={franchise} talent={talent} characters={characters} onFranchise={setFranchise} onTalent={setTalent} onCharacters={setCharacters} />
      </DialogBody>
    </Dialog>
  );
}

/** Kind as a label (fan registrations reuse it). */
export function guidelineKindLabel(k: Kind | string): string {
  return enumLabel('guidelines.kind', k);
}

