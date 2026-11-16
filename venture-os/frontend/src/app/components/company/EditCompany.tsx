/**
 * Edit a company (fix 5): the sheet the Edit button of a company's hero
 * opens, on the portfolio company page and on the network company page.
 *
 *   Logo                the current logo large; click it or drop an image on
 *                       it, Choose image, Remove; the new one shows at once
 *   Basics              name, one line, website, domain
 *   Details             sector, subsector, stage, business model, HQ city and
 *                       country, founded, team size, LinkedIn
 *   Founders and team   the people linked to the company with their titles;
 *                       change a title, add a person (name, email, title,
 *                       founder), take someone off
 *
 * Save closes the sheet and every screen shows the change at once (act with
 * patches over every view holding the company); the operations run behind:
 * companies.update, companies.logo-set or companies.logo-remove,
 * people.unlink, people.link (titles, founders) and people.upsert. Each is
 * audited by the server. The hero's own logo picker uses actions.ts.
 */
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, UserPlus, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Button, Checkbox, Field, IconButton, Input, LoadError, Section, Sections, Select, Sheet, SheetHeader, Skeleton, Tag, Textarea } from '../ui.tsx';
import { LogoPicker } from '../portfolio/Logo.tsx';
import { op, opForm } from '../../lib/api.ts';
import { logoProblem, primeImage, LOGO_ACCEPT } from '../../lib/images.ts';
import { act, patch, useLive } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import { COMPANY_EDIT_READS, STAGE_LABEL } from './actions.ts';
const MODEL_LABEL: Record<string, string> = { saas: 'SaaS', marketplace: 'Marketplace', transactional: 'Transactional', consumer_subscription: 'Consumer subscription', advertising: 'Advertising', hardware: 'Hardware', licensing: 'Licensing', services: 'Services', other: 'Other' };

interface PersonRow {
  id: string;
  name: string;
  email: string;
  title: string;
  role: 'founder' | 'team';
}

/** companies.get, the parts the sheet edits. */
interface CompanyRecord {
  id: string;
  name: string;
  domain: string;
  website: string;
  description: string;
  sector: string;
  subsector: string;
  stage: string;
  hq_country: string;
  hq_city: string;
  founded_year: number | null;
  team_size: number | null;
  business_model: string;
  linkedin: string;
  logo_url: string;
  logo_domain: string;
  people: PersonRow[];
}

const TEXT_KEYS = ['name', 'description', 'website', 'domain', 'sector', 'subsector', 'stage', 'hq_city', 'hq_country', 'founded_year', 'team_size', 'business_model', 'linkedin'] as const;
type Key = (typeof TEXT_KEYS)[number];
type Draft = Record<Key, string>;

function draftOf(c: CompanyRecord): Draft {
  return {
    name: c.name,
    description: c.description,
    website: c.website,
    domain: c.domain,
    sector: c.sector,
    subsector: c.subsector,
    stage: c.stage,
    hq_city: c.hq_city,
    hq_country: c.hq_country,
    founded_year: c.founded_year !== null ? String(c.founded_year) : '',
    team_size: c.team_size !== null ? String(c.team_size) : '',
    business_model: c.business_model,
    linkedin: c.linkedin,
  };
}

/** The first sentence (the hero's one line), as the server cuts it. */
function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t === '') return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const one = m?.[1] ?? t;
  return one.length <= 160 ? one : one.slice(0, 157).replace(/\s+\S*$/, '') + '...';
}

let regions: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  try {
    regions ??= new Intl.DisplayNames(['en'], { type: 'region' });
    const n = regions.of(code.toUpperCase()) ?? '';
    return n === code.toUpperCase() ? '' : n;
  } catch {
    return '';
  }
}

interface TeamRow extends PersonRow {
  /** The title when the sheet opened ('' for a new person). */
  was: string;
  removed: boolean;
  added: boolean;
  founderNew: boolean;
}

type LogoChange = { kind: 'keep' } | { kind: 'new'; file: File; preview: string } | { kind: 'remove' };

export function EditCompanySheet({ company, open, onClose }: { company: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <EditBody company={company} onClose={onClose} />;
}

function EditBody({ company, onClose }: { company: string; onClose: () => void }): React.JSX.Element {
  // Never a remembered answer: the form starts from the company as it is now (a remembered one could be from before the last save).
  const live = useLive<{ company: CompanyRecord }>((signal) => op('companies.get', { company }, { quiet: true, signal }), ['companies', 'people', 'employments', 'deal_people'], ['edit-company', company]);
  const c = live.data?.company ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [team, setTeam] = useState<TeamRow[] | null>(null);
  const [logo, setLogo] = useState<LogoChange>({ kind: 'keep' });
  const [add, setAdd] = useState({ name: '', email: '', title: '', founder: false });
  useEffect(() => {
    if (c === null) return;
    setDraft((d) => d ?? draftOf(c));
    setTeam((t) => t ?? c.people.map((p) => ({ ...p, was: p.title, removed: false, added: false, founderNew: false })));
  }, [c]);
  useEffect(
    () => () => {
      if (logo.kind === 'new') setTimeout(() => URL.revokeObjectURL(logo.preview), 30000);
    },
    [logo],
  );

  const base = useMemo(() => (c !== null ? draftOf(c) : null), [c]);
  const set = (k: Key, v: string): void => setDraft((d) => (d === null ? d : { ...d, [k]: v }));
  const pick = (file: File): void => {
    const problem = logoProblem(file);
    if (problem !== null) {
      toast.error(problem);
      return;
    }
    setLogo({ kind: 'new', file, preview: URL.createObjectURL(file) });
  };

  const yearBad = draft !== null && draft.founded_year.trim() !== '' && !/^(18|19|20|21)\d\d$/.test(draft.founded_year.trim());
  const sizeBad = draft !== null && draft.team_size.trim() !== '' && !/^\d{1,7}$/.test(draft.team_size.trim());
  const countryBad = draft !== null && draft.hq_country.trim() !== '' && !/^[A-Za-z]{2}$/.test(draft.hq_country.trim());
  const nameBad = draft !== null && draft.name.trim() === '';
  const addReady = add.name.trim() !== '' || add.email.trim() !== '';

  const changes = (): Partial<Draft> => {
    if (draft === null || base === null) return {};
    const out: Partial<Draft> = {};
    for (const k of TEXT_KEYS) {
      const v = k === 'hq_country' ? draft[k].trim().toUpperCase() : draft[k].trim();
      if (v !== base[k].trim()) out[k] = v;
    }
    return out;
  };

  const save = (): void => {
    if (c === null || draft === null || team === null) return;
    const fields = changes();
    const removed = team.filter((r) => r.removed && !r.added);
    const retitled = team.filter((r) => !r.removed && !r.added && r.title.trim() !== r.was.trim());
    const pending = team.filter((r) => r.added && !r.removed);
    if (addReady) pending.push({ id: '', name: add.name.trim(), email: add.email.trim(), title: add.title.trim(), role: add.founder ? 'founder' : 'team', was: '', removed: false, added: true, founderNew: add.founder });
    // What every screen shows at once.
    const shown: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'founded_year' || k === 'team_size') shown[k] = v === '' ? null : Number(v);
      else shown[k] = v;
    }
    if (fields.description !== undefined) shown['one_liner'] = firstSentence(fields.description);
    if (fields.stage !== undefined) shown['stage_key'] = fields.stage;
    if (logo.kind === 'new') shown['logo_url'] = logo.preview;
    if (logo.kind === 'remove') shown['logo_url'] = '';
    const chosen = logo;
    onClose();
    void act(
      Object.keys(shown).length > 0 ? [patch(c.id, shown)] : [],
      async () => {
        if (Object.keys(fields).length > 0) await op('companies.update', { company: c.id, ...fields });
        if (chosen.kind === 'new') {
          const out = await opForm<{ company: { logo_url: string } }>('companies.logo-set', { company: c.id }, { file: chosen.file });
          primeImage(out.company.logo_url, chosen.preview);
        } else if (chosen.kind === 'remove') await op('companies.logo-remove', { company: c.id });
        for (const r of removed) await op('people.unlink', { person: r.id, company: c.id });
        for (const r of retitled) await op('people.link', { person: r.id, company: c.id, title: r.title.trim() });
        for (const r of pending) {
          const out = await op<{ person: { id: string } }>('people.upsert', { name: r.name || undefined, email: r.email || undefined, title: r.title || undefined, company: c.id });
          if (r.founderNew) await op('people.link', { person: out.person.id, company: c.id, title: r.title || undefined, founder: true });
        }
        return true;
      },
      COMPANY_EDIT_READS,
    );
  };

  const logoUrl = logo.kind === 'new' ? logo.preview : logo.kind === 'remove' ? '' : (c?.logo_url ?? '');
  const hasOwn = logoUrl !== '';
  const dirty = draft !== null && team !== null && (Object.keys(changes()).length > 0 || logo.kind !== 'keep' || addReady || team.some((r) => r.removed || r.added || r.title.trim() !== r.was.trim()));

  return (
    <Sheet open onClose={onClose} label={'Edit ' + (c?.name ?? 'company')} width={600}>
      <SheetHeader title={'Edit ' + (c?.name ?? 'company')} onClose={onClose} />
      {live.error !== null && c === null ? (
        <div className="p-5">
          <LoadError message={live.error} onRetry={live.reload} />
        </div>
      ) : c === null || draft === null || team === null ? (
        <div className="flex flex-col gap-4 p-5">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="vo-scroll min-h-0 flex-1 overflow-y-auto">
          <Sections pad="card">
            <Section title="Logo" tip="A PNG, JPG, WebP or SVG image, 2 MB at most. Without one, screens show the website icon, else the first letter.">
              <div className="flex min-w-0 flex-wrap items-center gap-4">
                <LogoPicker name={draft.name || c.name} domain={c.logo_domain} logoUrl={logoUrl} size={88} onFile={pick} label="Choose a logo image" />
                <div className="flex min-w-0 flex-col gap-2">
                  <ChooseButton onFile={pick} label={hasOwn ? 'Replace image' : 'Choose image'} />
                  {hasOwn && (
                    <Button variant="ghost" size="sm" icon={X} onClick={() => setLogo(c.logo_url !== '' ? { kind: 'remove' } : { kind: 'keep' })}>
                      Remove
                    </Button>
                  )}
                  {!hasOwn && logo.kind === 'remove' && (
                    <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setLogo({ kind: 'keep' })}>
                      Keep the logo
                    </Button>
                  )}
                </div>
              </div>
            </Section>

            <Section title="Basics">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Name" className="sm:col-span-2" error={nameBad ? 'A company needs a name.' : null}>
                  <Input value={draft.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" maxLength={200} />
                </Field>
                <Field label="One line" className="sm:col-span-2" tip="What the company does. The first sentence shows under its name.">
                  <Textarea value={draft.description} minRows={2} maxRows={6} onChange={(e) => set('description', e.target.value)} aria-label="One line" maxLength={4000} placeholder="Builds warehouse robots for mid-size retailers." />
                </Field>
                <Field label="Website">
                  <Input value={draft.website} onChange={(e) => set('website', e.target.value)} aria-label="Website" placeholder="https://acme.com" inputMode="url" />
                </Field>
                <Field label="Domain" tip="The company's web address without https, e.g. acme.com. It finds the company in email and imports.">
                  <Input className="vo-mono" value={draft.domain} onChange={(e) => set('domain', e.target.value)} aria-label="Domain" placeholder="acme.com" />
                </Field>
              </div>
            </Section>

            <Section title="Details">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Sector">
                  <Input value={draft.sector} onChange={(e) => set('sector', e.target.value)} aria-label="Sector" placeholder="Robotics" maxLength={80} />
                </Field>
                <Field label="Subsector">
                  <Input value={draft.subsector} onChange={(e) => set('subsector', e.target.value)} aria-label="Subsector" placeholder="Warehouse automation" maxLength={80} />
                </Field>
                <Field label="Stage" tip="The company's stage. Without one, its page shows the latest round.">
                  <Select value={draft.stage} onChange={(e) => set('stage', e.target.value)} aria-label="Stage">
                    <option value="">Not set</option>
                    {Object.entries(STAGE_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Business model">
                  <Select value={draft.business_model} onChange={(e) => set('business_model', e.target.value)} aria-label="Business model">
                    <option value="">Not set</option>
                    {Object.entries(MODEL_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="HQ city">
                  <Input value={draft.hq_city} onChange={(e) => set('hq_city', e.target.value)} aria-label="HQ city" placeholder="New York" maxLength={120} />
                </Field>
                <Field label="HQ country" tip="Two letters, e.g. US, GB, SG." error={countryBad ? 'Two letters, e.g. US.' : null}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input className="vo-mono w-16 shrink-0 uppercase" value={draft.hq_country} maxLength={2} onChange={(e) => set('hq_country', e.target.value.toUpperCase())} aria-label="HQ country" placeholder="US" />
                    <span className="min-w-0 truncate text-[13px] text-[var(--vo-ink-2)]">{countryName(draft.hq_country)}</span>
                  </div>
                </Field>
                <Field label="Founded" error={yearBad ? 'A year such as 2021.' : null}>
                  <Input className="vo-mono" value={draft.founded_year} inputMode="numeric" maxLength={4} onChange={(e) => set('founded_year', e.target.value.replace(/[^\d]/g, ''))} aria-label="Year founded" placeholder="2021" />
                </Field>
                <Field label="Team size" error={sizeBad ? 'A whole number of people.' : null}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input className="vo-mono w-28" value={draft.team_size} inputMode="numeric" maxLength={7} onChange={(e) => set('team_size', e.target.value.replace(/[^\d]/g, ''))} aria-label="Team size" placeholder="24" />
                    <span className="text-[13px] text-[var(--vo-ink-2)]">people</span>
                  </div>
                </Field>
                <Field label="LinkedIn" className="sm:col-span-2">
                  <Input value={draft.linkedin} onChange={(e) => set('linkedin', e.target.value)} aria-label="LinkedIn" placeholder="https://www.linkedin.com/company/acme" inputMode="url" />
                </Field>
              </div>
            </Section>

            <Section title="Founders and team" aside={team.filter((r) => !r.removed).length > 0 ? plural(team.filter((r) => !r.removed).length) : undefined}>
              <div className="flex min-w-0 flex-col gap-3">
                {team.length > 0 && (
                  <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]" aria-label="People">
                    {team.map((r, i) => (
                      <li key={r.id !== '' ? r.id : 'new' + i} className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2', r.removed && 'opacity-60')}>
                        <Avatar name={r.name || r.email} size={28} />
                        <span className="flex min-w-0 flex-1 basis-[160px] flex-col">
                          <span className={cn('vo-wrap text-[13px] font-medium text-[var(--vo-ink)]', r.removed && 'line-through')}>{r.name || r.email}</span>
                          {r.email !== '' && r.name !== '' && <span className="vo-wrap text-[12px] text-[var(--vo-muted)]">{r.email}</span>}
                        </span>
                        <Input className="order-last w-full min-[480px]:order-none min-[480px]:w-44" value={r.title} disabled={r.removed} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label={'Title of ' + (r.name || r.email)} placeholder="Title" maxLength={160} />
                        <span className="flex shrink-0 items-center gap-1.5">
                          {r.added ? <Tag tone="a">New</Tag> : r.role === 'founder' || r.founderNew ? <Tag>Founder</Tag> : <Tag tone="faint">Team</Tag>}
                          {r.removed ? (
                            <IconButton icon={RotateCcw} label={'Keep ' + (r.name || r.email)} onClick={() => setTeam(team.map((x, j) => (j === i ? { ...x, removed: false } : x)))} />
                          ) : (
                            <IconButton icon={X} label={'Take ' + (r.name || r.email) + ' off the company'} onClick={() => setTeam(r.added ? team.filter((_, j) => j !== i) : team.map((x, j) => (j === i ? { ...x, removed: true } : x)))} />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex min-w-0 flex-col gap-2 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-sunk)] p-3">
                  <span className="text-[12px] font-medium text-[var(--vo-ink-2)]">Add a person</span>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-3">
                    <Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} aria-label="New person's name" placeholder="Name" maxLength={160} />
                    <Input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} aria-label="New person's email" placeholder="Email" inputMode="email" />
                    <Input value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} aria-label="New person's title" placeholder="Title" maxLength={160} />
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <Checkbox checked={add.founder} onChange={(v) => setAdd({ ...add, founder: v })} label="Founder" />
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      icon={UserPlus}
                      disabled={!addReady}
                      onClick={() => {
                        setTeam([...team, { id: '', name: add.name.trim(), email: add.email.trim(), title: add.title.trim(), role: add.founder ? 'founder' : 'team', was: '', removed: false, added: true, founderNew: add.founder }]);
                        setAdd({ name: '', email: '', title: '', founder: false });
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </Section>
          </Sections>
        </div>
      )}
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--vo-line)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!dirty || nameBad || yearBad || sizeBad || countryBad} onClick={save}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

function plural(n: number): string {
  return n === 1 ? '1 person' : n + ' people';
}

/** A plain "Choose image" button with its own file chooser. */
function ChooseButton({ onFile, label }: { onFile: (f: File) => void; label: string }): React.JSX.Element {
  const [el, setEl] = useState<HTMLInputElement | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => el?.click()}>
        {label}
      </Button>
      <input
        ref={setEl}
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f !== undefined) onFile(f);
        }}
      />
    </>
  );
}
