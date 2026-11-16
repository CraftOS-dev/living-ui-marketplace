/**
 * The top of a portfolio company page, on every tab: who the company is
 * (logo, name, one line, sector, stage, HQ, founded, founders) with its
 * quick links (Website, Latest deck, Data room, Latest update, Board deck,
 * Email the founders), and beside it the fund position (fund, invested,
 * current value, multiple, ownership, last round). Only what is known shows.
 * People who may edit the company get Edit (the edit sheet) and a logo that
 * opens the image chooser (or takes a dropped image); people who may edit
 * the portfolio get Edit beside the fund position (the investment sheet).
 */
import { useState } from 'react';
import { CalendarDays, FileText, FolderOpen, Globe, Mail, MapPin, Pencil, Presentation, Send, Shapes, TrendingUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Button, Tag, Tip } from '../../components/ui.tsx';
import { CompanyLogo, LogoPicker } from '../../components/portfolio/Logo.tsx';
import { setCompanyLogo, STAGE_LABEL } from '../../components/company/actions.ts';
import { fmtDay, money, multiple, pct } from '../../lib/format.ts';
import { openSource } from '../../lib/source.ts';
import type { CompanyView, PagePosition } from './types.ts';

let regions: Intl.DisplayNames | null = null;
/** "US" -> "United States" (the code itself when the browser does not know it). */
function countryName(code: string): string {
  if (code === '') return '';
  try {
    regions ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** A sector as stored ("robotics", "ai") as people read it ("Robotics", "AI"). */
function sectorText(s: string): string {
  const t = s.trim();
  if (t === '' || t !== t.toLowerCase()) return t;
  return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
}

function Fact({ icon: Icon, children, tip }: { icon: LucideIcon; children: React.ReactNode; tip: string }): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--vo-ink-2)]" title={tip}>
      <Icon size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
      <span className="vo-wrap min-w-0">{children}</span>
    </span>
  );
}

const LINK = 'vo-focus vo-tap inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-3 text-[13px] font-medium text-[var(--vo-ink)] transition-[background-color,border-color] duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]';

function Figure({ label, value, tip, tone }: { label: string; value: string; tip?: string | undefined; tone?: 'good' | 'bad' | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-[var(--vo-muted)]">{tip !== undefined ? <Tip text={tip}>{label}</Tip> : label}</div>
      <div className={cn('vo-mono vo-num mt-0.5 truncate text-[15px] leading-6', tone === 'good' ? 'text-[var(--vo-good)]' : tone === 'bad' ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-ink)]')}>{value}</div>
    </div>
  );
}

function Position({ p, single }: { p: PagePosition; single: boolean }): React.JSX.Element {
  const m = p.moic_e8 !== null ? p.moic_e8 / 1e8 : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {(!single || p.status !== 'active') && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="vo-wrap min-w-0 text-[13px] font-medium">{p.fund?.name ?? 'Fund'}</span>
          {p.status === 'exited' && <Tag tone="good">Exited</Tag>}
          {p.status === 'written_off' && <Tag tone="bad">Written off</Tag>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Invested" value={money(p.invested_minor, p.currency, { compact: true })} tip={p.first_day !== '' ? 'First check ' + fmtDay(p.first_day) : undefined} />
        <Figure label="Current value" value={money(p.value_minor, p.currency, { compact: true })} tip={p.value_basis === 'mark' ? 'The latest approved mark.' : p.value_basis === 'cost' ? 'Held at cost: no approved mark yet.' : undefined} />
        {m !== null && <Figure label="Multiple" value={multiple(p.moic_e8, 2)} tone={m >= 1.5 ? 'good' : m < 1 ? 'bad' : undefined} tip="Current value and proceeds over the money invested." />}
        {p.ownership_ppm !== null && <Figure label="Ownership" value={pct(p.ownership_ppm, 1)} tip="Fully diluted, after the latest round." />}
      </div>
    </div>
  );
}

export function CompanyHero({ v, onFiles, onUpdate, onEdit, onEditInvestment }: { v: CompanyView; onFiles: () => void; onUpdate: (id: string) => void; onEdit?: (() => void) | undefined; onEditInvestment?: (() => void) | undefined }): React.JSX.Element {
  const c = v.company;
  const [uploading, setUploading] = useState(false);
  const stage = c.stage_key !== undefined && c.stage_key !== '' && STAGE_LABEL[c.stage_key] !== undefined ? STAGE_LABEL[c.stage_key] : c.stage;
  const pickLogo = (file: File): void => {
    setUploading(true);
    void setCompanyLogo(c.id, file).finally(() => setUploading(false));
  };
  const place = [c.hq_city, countryName(c.hq_country)].filter((x) => x !== '').join(', ');
  const people = v.people.list;
  const emails = v.links.emails;
  const firstName = (people[0]?.name ?? '').split(' ')[0] ?? '';
  const mailLabel = v.people.founders ? 'Email the founders' : people.length === 1 && firstName !== '' ? 'Email ' + firstName : 'Email the team';
  const deck = v.links.deck;
  const board = v.links.board_deck;
  const lr = v.last_round;
  const single = v.position.length === 1;
  return (
    <section aria-label={c.name} className="vo-panel vo-in grid min-w-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <div className="flex min-w-0 flex-col gap-4 p-5 md:p-6">
        <div className="flex min-w-0 items-start gap-4">
          {onEdit !== undefined ? <LogoPicker name={c.name} domain={c.logo_domain} logoUrl={c.logo_url ?? ''} size={64} onFile={pickLogo} busy={uploading} label="Change the logo" /> : <CompanyLogo name={c.name} domain={c.logo_domain} logoUrl={c.logo_url ?? ''} size={64} />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-start gap-3">
              <h2 data-data="" className="vo-wrap min-w-0 flex-1 text-[26px] font-semibold leading-8 tracking-[-0.015em]">
                {c.name}
              </h2>
              {onEdit !== undefined && (
                <Button size="sm" icon={Pencil} onClick={onEdit} className="mt-0.5 shrink-0" aria-label="Edit company" title="Edit the company: logo, details, founders and team">
                  Edit
                </Button>
              )}
            </div>
            {c.one_liner !== '' && (
              <p data-data="" className="vo-wrap text-[14px] leading-[22px] text-[var(--vo-ink-2)]" title={c.description !== '' && c.description !== c.one_liner ? c.description : undefined}>
                {c.one_liner}
              </p>
            )}
            <div data-data="" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
              {c.sector !== '' && (
                <Fact icon={Shapes} tip="Sector">
                  {sectorText(c.sector) + (c.subsector !== '' ? ', ' + c.subsector : '')}
                </Fact>
              )}
              {stage !== '' && (
                <Fact icon={TrendingUp} tip={c.stage_key !== undefined && c.stage_key !== '' ? 'Stage' : 'Stage: the latest round'}>
                  {stage}
                </Fact>
              )}
              {place !== '' && (
                <Fact icon={MapPin} tip="Headquarters">
                  {place}
                </Fact>
              )}
              {c.founded_year !== null && (
                <Fact icon={CalendarDays} tip="Year founded">
                  Founded {c.founded_year}
                </Fact>
              )}
              {c.team_size !== null && (
                <Fact icon={Users} tip="Team size">
                  {c.team_size} people
                </Fact>
              )}
            </div>
          </div>
        </div>

        {people.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2">
            <span className="vo-label">{v.people.founders ? 'Founders' : 'People'}</span>
            <ul data-data="" className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
              {people.map((p) => (
                <li key={p.id} className="min-w-0">
                  <a href={'#/people/' + p.id} className="vo-focus -mx-1 flex min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-1 py-0.5 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                    <Avatar name={p.name} size={30} />
                    <span className="flex min-w-0 flex-col">
                      <span className="vo-wrap text-[13px] font-medium leading-[18px] text-[var(--vo-ink)]">{p.name}</span>
                      {p.title !== '' && <span className="vo-wrap text-[12px] leading-4 text-[var(--vo-muted)]">{p.title}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
          {v.links.website !== '' && (
            <a href={v.links.website} target="_blank" rel="noreferrer" className={LINK} title={v.links.website}>
              <Globe size={14} strokeWidth={1.9} aria-hidden />
              Website
            </a>
          )}
          {deck !== null && (
            <Button icon={FileText} onClick={() => openSource({ file: deck.file, name: deck.name })} title={deck.name + ', ' + fmtDay(deck.day)}>
              Latest deck
            </Button>
          )}
          {v.links.files > 0 && (
            <Button icon={FolderOpen} onClick={onFiles} title={v.links.files === 1 ? '1 file' : v.links.files + ' files: decks, board decks, founder updates'}>
              Data room
            </Button>
          )}
          {v.links.update !== null && (
            <Button icon={Mail} onClick={() => v.links.update !== null && onUpdate(v.links.update.id)} title={'Received ' + fmtDay(v.links.update.day)}>
              Latest update
            </Button>
          )}
          {board !== null && (
            <Button icon={Presentation} onClick={() => openSource({ file: board.file, name: board.name })} title={board.name + ', ' + fmtDay(board.day)}>
              Board deck
            </Button>
          )}
          {emails.length > 0 && (
            <a href={'mailto:' + emails.join(',') + '?subject=' + encodeURIComponent(c.name)} className={LINK} title={emails.join(', ')}>
              <Send size={14} strokeWidth={1.9} aria-hidden />
              {mailLabel}
            </a>
          )}
        </div>
      </div>

      <aside aria-label="Fund position" className="flex min-w-0 flex-col gap-4 border-t border-[var(--vo-hair)] bg-[var(--vo-sunk)] p-5 md:p-6 lg:border-l lg:border-t-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="vo-label min-w-0 flex-1">Fund position</span>
          {single && v.position[0]?.fund !== null && v.position[0]?.fund !== undefined && <span className="vo-wrap text-[12px] font-medium text-[var(--vo-ink-2)]">{v.position[0].fund.name}</span>}
          {onEditInvestment !== undefined && (
            <Button size="sm" variant="ghost" icon={Pencil} onClick={onEditInvestment} aria-label="Edit investment" title="Edit the investment: round, security, amount, date, valuation">
              Edit
            </Button>
          )}
        </div>
        {v.position.map((p) => (
          <Position key={p.holding} p={p} single={single} />
        ))}
        {lr !== null && (
          <div className="flex min-w-0 flex-col gap-0.5 border-t border-[var(--vo-hair)] pt-3">
            <span className="text-[12px] text-[var(--vo-muted)]">Last round</span>
            <span data-data="" className="vo-wrap text-[13px] text-[var(--vo-ink)]">
              {lr.label + (lr.day !== '' ? ', ' + fmtDay(lr.day) : '')}
            </span>
            {(lr.raised_minor !== null || lr.post_money_minor !== null) && (
              <span data-data="" className="vo-wrap text-[12px] text-[var(--vo-ink-2)]">
                {[lr.raised_minor !== null ? money(lr.raised_minor, lr.currency, { compact: true }) + ' raised' : '', lr.post_money_minor !== null ? 'valued at ' + money(lr.post_money_minor, lr.currency, { compact: true }) + ' after it' : '']
                  .filter((x) => x !== '')
                  .join(', ')
                  .replace(/^v/, 'V')}
              </span>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}
