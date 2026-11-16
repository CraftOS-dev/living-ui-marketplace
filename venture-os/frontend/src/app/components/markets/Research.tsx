/**
 * Market research (fix 4, the Research tab):
 *
 *   Ask    one field (a topic, or a sector chosen from the chips) and one
 *          button: your AI agent writes a market brief (trigger market_brief)
 *   List   the briefs, newest first: title, sector, status, who asked
 *   Read   #/markets/research/:id, a clean document: summary, the seven
 *          sections (overview, size, trends, key players, recent funding,
 *          risks, what it means for the firm) with numbered sources;
 *          Export as Markdown, Print or save as PDF, Remove
 */
import { Download, FileText, Printer, Sparkle, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';
import { op, saveBlob } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { fmtDay } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { Button, Empty, Input, LoadError, Menu, MenuItem, MenuSep, Skeleton, StatusDot, Tag, confirmAsk } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { DCard, DSection } from './Divided.tsx';
import type { Pulse } from './MarketPulse.tsx';
import { PULSE_READS } from './MarketPulse.tsx';
import { agoWords } from './types.ts';
import { AskStatus } from '../agent.tsx';
import type { AgentAsks } from '../../lib/types.ts';

export interface ReportRow {
  id: string;
  title: string;
  topic: string;
  sector: string;
  sector_label: string;
  status: 'requested' | 'writing' | 'ready' | 'failed';
  /** The brief's ask of your AI agent (market_brief), followed live. */
  agent?: AgentAsks | undefined;
  summary: string;
  requested_by: { id: string; name: string } | null;
  created_at: string;
  ready_at: string;
  citations_count: number;
  error: string;
}

export interface Report extends ReportRow {
  sections: { key: string; title: string; body: string }[];
  citations: { n: number; title: string; url: string; source: string }[];
}

const READS = ['research_reports', 'agent_requests'];

const STATUS: Record<ReportRow['status'], { tone: Tone; label: string; pulse?: boolean }> = {
  requested: { tone: 'faint', label: 'Waiting for your AI agent' },
  writing: { tone: 'agent', label: 'Your AI agent is writing it', pulse: true },
  ready: { tone: 'good', label: 'Ready' },
  failed: { tone: 'bad', label: 'Could not be written' },
};

/* ------------------------------------------------------------------ ask */

export function AskBrief(): React.JSX.Element {
  const me = useMe();
  const pulse = useOp<Pulse>('markets.pulse', {}, PULSE_READS, { name: 'markets.pulse', keep: true });
  const [text, setText] = useState('');
  const [sector, setSector] = useState('');
  const [busy, setBusy] = useState(false);
  const sectors = pulse.data?.sectors ?? [];
  const ask = async (): Promise<void> => {
    const topic = text.trim();
    if (topic === '' && sector === '') return;
    setBusy(true);
    const params: Record<string, unknown> = sector !== '' ? { sector } : { topic };
    if (sector !== '' && topic !== '' && topic !== sectors.find((s) => s.key === sector)?.label) params['topic'] = topic;
    const out = await act([], () => op<{ report: ReportRow; request: string; message: string }>('research.ask', params), READS);
    setBusy(false);
    if (out !== null) {
      setText('');
      setSector('');
      if (out.message !== '') toast.success(out.message);
      else toast.success('Sent to your AI agent; the brief appears in the list when it is ready');
    }
  };
  return (
    <DCard label="Ask for a market brief">
      <DSection title="Ask your AI agent for a market brief" tip="Your AI agent researches the market and writes a brief: overview, size with sources, trends, key players, recent funding, risks and what it means for the firm">
        <form
          className="flex min-w-0 flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (sector !== '') setSector('');
              }}
              placeholder="A topic or a sector, e.g. Embedded payments for vertical software"
              aria-label="Topic or sector"
              className="h-9 min-w-0 flex-1"
            />
            <Button type="submit" variant="primary" icon={Sparkle} busy={busy} disabled={me === null || (text.trim() === '' && sector === '')} className="h-9 shrink-0">
              Ask your AI agent
            </Button>
          </div>
          {sectors.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-[var(--vo-muted)]">Your sectors</span>
              {sectors.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={sector === s.key}
                  onClick={() => {
                    setSector(s.key);
                    setText(s.label);
                  }}
                  className={cn('vo-focus inline-flex h-[22px] cursor-pointer items-center rounded-[4px] border px-1.5 text-[12px] font-medium transition-colors duration-150', sector === s.key ? 'border-[var(--vo-ink)] bg-[var(--vo-active)] text-[var(--vo-ink)]' : 'border-[var(--vo-line)] bg-[var(--vo-raised)] text-[var(--vo-ink-2)] hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </form>
      </DSection>
    </DCard>
  );
}

/* ----------------------------------------------------------------- list */

export function BriefList(): React.JSX.Element {
  const live = useOp<{ reports: ReportRow[]; total: number }>('research.list', {}, READS, { name: 'markets.research', keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-48 w-full" />;
  const rows = live.data.reports;
  return (
    <DCard label="Market briefs">
      <DSection title="Market briefs" aside={<span>{rows.length === 1 ? '1 brief' : `${rows.length} briefs`}</span>} />
      {rows.length === 0 ? (
        <Empty icon={FileText} title="Briefs you ask for appear here" />
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-line)]">
          {rows.map((r) => {
            const st = STATUS[r.status];
            return (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/markets/research/${r.id}`)} disabled={r.status !== 'ready'} className={cn('vo-focus grid w-full min-w-0 grid-cols-1 gap-1.5 px-4 py-3 text-left transition-colors duration-150 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center sm:gap-4', r.status === 'ready' ? 'cursor-pointer hover:bg-[var(--vo-hover)]' : 'cursor-default')}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="vo-wrap min-w-0 text-[14px] font-semibold leading-5 text-[var(--vo-ink)]">{r.title}</span>
                      {r.sector_label !== '' && <Tag className="shrink-0">{r.sector_label}</Tag>}
                    </span>
                    {r.summary !== '' ? <span className="vo-wrap line-clamp-2 text-[13px] leading-[18px] text-[var(--vo-ink-2)]">{r.summary}</span> : r.status === 'failed' && r.error !== '' ? <span className="vo-wrap text-[13px] text-[var(--vo-bad)]">{r.error}</span> : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 sm:items-end">
                    {r.status === 'requested' && r.agent?.market_brief ? <AskStatus state={r.agent.market_brief} /> : <StatusDot tone={st.tone} label={st.label} pulse={st.pulse} />}
                    <span className="text-[12px] text-[var(--vo-muted)]">{`${r.requested_by !== null ? `Asked by ${r.requested_by.name}, ` : 'Asked '}${agoWords(r.created_at)}`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DCard>
  );
}

/* ----------------------------------------------------------------- read */

/** A body: paragraphs and "- " lists, [n] marks as links to the numbered sources. */
function Body({ text }: { text: string }): React.JSX.Element {
  const marks = (s: string): ReactNode[] =>
    s.split(/(\[\d{1,2}\])/g).map((part, i) => {
      const m = /^\[(\d{1,2})\]$/.exec(part);
      if (m === null) return <Fragment key={i}>{part}</Fragment>;
      const n = Number(m[1]);
      return (
        <button key={i} type="button" title={`Source ${n}`} onClick={() => document.getElementById(`cite-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="vo-focus ml-0.5 cursor-pointer rounded-[2px] align-super text-[11px] font-medium leading-none text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)] hover:underline">
          {n}
        </button>
      );
    });
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l === '') continue;
    const list = l.startsWith('- ');
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.list === list && list) last.lines.push(l.slice(2));
    else blocks.push({ list, lines: [list ? l.slice(2) : l] });
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 text-[14px] leading-[22px] text-[var(--vo-ink)]">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-[var(--vo-muted)]">
            {b.lines.map((l, j) => (
              <li key={j} className="vo-wrap">
                {marks(l)}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="vo-wrap">
            {marks(b.lines[0] ?? '')}
          </p>
        ),
      )}
    </div>
  );
}

/** The brief as Markdown (Export). */
export function reportMarkdown(r: Report): string {
  const out = [`# ${r.title}`, '', `${r.sector_label !== '' ? `${r.sector_label}. ` : ''}Written by your AI agent on ${fmtDay(r.ready_at || r.created_at, { year: 'always' })}.`, ''];
  if (r.summary !== '') out.push(r.summary, '');
  for (const s of r.sections) out.push(`## ${s.title}`, '', s.body, '');
  out.push('## Sources', '');
  for (const c of r.citations) out.push(`${c.n}. ${c.title}${c.source !== '' ? `, ${c.source}` : ''}. ${c.url}`);
  return out.join('\n') + '\n';
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A print view of the brief in its own window (print, or save as PDF). */
function printReport(r: Report): void {
  const para = (t: string): string => {
    const lines = t.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    let html = '';
    let inList = false;
    for (const l of lines) {
      const body = esc(l.startsWith('- ') ? l.slice(2) : l).replace(/\[(\d{1,2})\]/g, '<sup>$1</sup>');
      if (l.startsWith('- ')) {
        if (!inList) html += '<ul>';
        inList = true;
        html += `<li>${body}</li>`;
      } else {
        if (inList) html += '</ul>';
        inList = false;
        html += `<p>${body}</p>`;
      }
    }
    return html + (inList ? '</ul>' : '');
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#111;max-width:720px;margin:40px auto;padding:0 24px}h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 6px;padding-top:12px;border-top:1px solid #ddd}.meta{color:#666;font-size:12px}sup{font-size:10px}ol{padding-left:20px;font-size:12px;color:#333}a{color:#111}</style></head><body><h1>${esc(r.title)}</h1><div class="meta">${esc(r.sector_label !== '' ? r.sector_label + '. ' : '')}Written by your AI agent on ${esc(fmtDay(r.ready_at || r.created_at, { year: 'always' }))}</div>${r.summary !== '' ? `<p><strong>${esc(r.summary)}</strong></p>` : ''}${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${para(s.body)}`).join('')}<h2>Sources</h2><ol>${r.citations.map((c) => `<li value="${c.n}">${esc(c.title)}${c.source !== '' ? ', ' + esc(c.source) : ''}. <a href="${esc(c.url)}">${esc(c.url)}</a></li>`).join('')}</ol></body></html>`;
  const w = window.open('', '_blank');
  if (w === null) {
    toast.error('Allow pop-ups for this page to print the brief');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function ReportView({ id }: { id: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ report: Report }>('research.get', { report: id }, READS, { name: `markets.research.${id}` });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="mx-auto h-[600px] w-full max-w-[800px]" />;
  const r = live.data.report;
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(`Remove the brief "${r.title}"?`, 'Remove'))) return;
    const out = await act([], () => op<{ _activity?: string }>('research.delete', { report: r.id }), READS);
    if (out === null) return;
    navigate('/markets/research');
    const entry = out._activity ?? '';
    if (entry !== '') toast.undo('Brief removed', () => void act([], () => op('activity.undo', { entry }), READS));
  };
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[800px] flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Button icon={Download} onClick={() => saveBlob(new Blob([reportMarkdown(r)], { type: 'text/markdown;charset=utf-8' }), `${r.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'market_brief'}.md`)}>
          Export
        </Button>
        <Button icon={Printer} onClick={() => printReport(r)} title="Opens a print view: print it or save it as a PDF">
          Print or PDF
        </Button>
        {can(me, 'markets', 'edit') && (
          <Menu label="More">
            {(close) => (
              <>
                <MenuItem
                  icon={Trash2}
                  danger
                  onClick={() => {
                    close();
                    void remove();
                  }}
                >
                  Remove brief
                </MenuItem>
                <MenuSep />
                <MenuItem icon={FileText} onClick={() => { close(); navigate('/markets/research'); }}>
                  All briefs
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
      <DCard as="article" label={r.title}>
        <div className="flex min-w-0 flex-col gap-2 px-6 py-5">
          <h1 className="vo-wrap text-[26px] font-semibold leading-[32px] tracking-[-0.01em] text-[var(--vo-ink)]">{r.title}</h1>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--vo-muted)]">
            {r.sector_label !== '' && <Tag>{r.sector_label}</Tag>}
            <span>{[`Written by your AI agent on ${fmtDay(r.ready_at || r.created_at, { year: 'auto' })}`, r.requested_by !== null ? `for ${r.requested_by.name}` : '', r.citations.length === 1 ? '1 source' : `${r.citations.length} sources`].filter((x) => x !== '').join(' · ')}</span>
          </span>
          {r.summary !== '' && <p className="vo-wrap pt-1 text-[15px] leading-[23px] text-[var(--vo-ink)]">{r.summary}</p>}
        </div>
        {r.sections.map((s) => (
          <DSection key={s.key} title={<span className="text-[15px]">{s.title}</span>} className="px-6 py-4">
            <Body text={s.body} />
          </DSection>
        ))}
        <DSection title={<span className="text-[15px]">Sources</span>} className="px-6 py-4">
          <ol className="flex min-w-0 flex-col gap-1.5">
            {r.citations.map((c) => (
              <li key={c.n} id={`cite-${c.n}`} className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-1 text-[13px] leading-[19px]">
                <span className="vo-mono vo-num text-[var(--vo-muted)]">{c.n}</span>
                <a href={c.url} target="_blank" rel="noreferrer" className="vo-focus vo-wrap min-w-0 rounded-[3px] text-[var(--vo-ink)] hover:underline hover:underline-offset-[3px]">
                  {c.title}
                  {c.source !== '' && <span className="text-[var(--vo-muted)]">{`, ${c.source}`}</span>}
                </a>
              </li>
            ))}
          </ol>
        </DSection>
      </DCard>
    </div>
  );
}
