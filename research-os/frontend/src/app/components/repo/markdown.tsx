/**
 * Markdown as people write READMEs, drawn as React elements (nothing is put
 * in the page as HTML): headings, paragraphs, lists (indent nests them, task
 * boxes), code blocks, quotes, rules, tables, and inline code, bold, italic,
 * links and pictures. A relative link or picture names a file in the
 * repository: `resolve` finds it (links open it, pictures show it).
 */
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';

type Align = 'left' | 'center' | 'right' | '';
type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' }
  | { t: 'list'; ordered: boolean; items: { text: string; depth: number; task: boolean; done: boolean }[] }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] };

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(s: string): string[] {
  return s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  const at = (k: number): string => lines[k] ?? '';
  while (i < lines.length) {
    const line = at(i);
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const end = fence[1] as string;
      const body: string[] = [];
      i++;
      while (i < lines.length && !at(i).trim().startsWith(end)) body.push(at(i++));
      i++;
      out.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      out.push({ t: 'h', level: (h[1] as string).length, text: h[2] as string });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(at(i))) body.push(at(i++).replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: body.join(' ') });
      continue;
    }
    if (line.includes('|') && DIVIDER.test(at(i + 1))) {
      const head = cells(line);
      const align = cells(at(i + 1)).map((c): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes('|') && at(i).trim() !== '') rows.push(cells(at(i++)));
      out.push({ t: 'table', head, align, rows });
      continue;
    }
    if (ITEM.test(line)) {
      const ordered = /\d/.test((line.match(ITEM) as RegExpMatchArray)[2] as string);
      const items: { text: string; depth: number; task: boolean; done: boolean }[] = [];
      while (i < lines.length) {
        const m = at(i).match(ITEM);
        if (m === null) {
          const last = items[items.length - 1];
          if (last !== undefined && /^\s{2,}\S/.test(at(i))) {
            last.text += ' ' + at(i++).trim();
            continue;
          }
          break;
        }
        const depth = Math.min(4, Math.floor((m[1] as string).replace(/\t/g, '    ').length / 2));
        const task = (m[3] as string).match(/^\[([ xX])\]\s+(.*)$/);
        items.push(task ? { text: task[2] as string, depth, task: true, done: task[1] !== ' ' } : { text: m[3] as string, depth, task: false, done: false });
        i++;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const body = [line];
    i++;
    while (i < lines.length && at(i).trim() !== '' && !/^(#{1,6})\s/.test(at(i)) && !/^\s*(```|~~~)/.test(at(i)) && !ITEM.test(at(i)) && !/^\s*>/.test(at(i)) && !RULE.test(at(i))) body.push(at(i++));
    out.push({ t: 'p', text: body.join(' ') });
  }
  return out;
}

export interface Resolved {
  /** Open the file a relative link names. */
  open?: () => void;
  /** Where a relative picture's bytes are. */
  src?: string;
}

const INLINE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const EXTERNAL = /^(https?:|mailto:)/i;

function inline(text: string, resolve: (href: string) => Resolved | null, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const k = key + '.' + n++;
    if (m[2] !== undefined) out.push(<code key={k} className="rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1 font-mono text-[12px]">{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{inline((m[3] ?? m[4]) as string, resolve, k)}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={k}>{inline((m[5] ?? m[6]) as string, resolve, k)}</em>);
    else if (m[9] !== undefined) {
      const label = m[8] as string;
      const href = m[9];
      const picture = m[7] === '!';
      const external = EXTERNAL.test(href);
      const r = external ? null : resolve(href);
      if (picture && r?.src) out.push(<img key={k} src={r.src} alt={label} className="my-1 inline-block max-h-80 max-w-full rounded-[var(--ro-r)] border border-[var(--ro-line)]" />);
      else if (external) out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener" className="font-semibold text-[var(--ro-accent-text)] underline-offset-2 hover:underline">{label || href}</a>);
      else if (r?.open) {
        const go = r.open;
        out.push(<button key={k} type="button" onClick={go} className="font-semibold text-[var(--ro-accent-text)] underline-offset-2 hover:underline">{label || href}</button>);
      } else out.push(<span key={k} className="font-semibold">{label || href}</span>);
    } else if (m[10] !== undefined) out.push(<a key={k} href={m[10]} target="_blank" rel="noreferrer noopener" className="text-[var(--ro-accent-text)] underline-offset-2 hover:underline">{m[10]}</a>);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING = ['text-[26px] leading-8', 'text-[15px] leading-6', 'text-[14px] leading-5', 'text-[13px] leading-5', 'text-[13px] leading-5', 'text-[12px] leading-5'];

export function Markdown({ source, resolve, className }: { source: string; resolve: (href: string) => Resolved | null; className?: string }): React.JSX.Element {
  const blocks = parse(source);
  return (
    <div className={cn('flex flex-col gap-3 text-[13px] leading-6 text-[var(--ro-ink)]', className)}>
      {blocks.map((b, i) => {
        const k = String(i);
        if (b.t === 'h') {
          const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[b.level - 1] ?? 'h6';
          return (
            <Tag key={k} className={cn('font-bold', HEADING[b.level - 1], b.level <= 2 && 'border-b border-[var(--ro-hair)] pb-1', i > 0 && 'mt-2')}>
              {inline(b.text, resolve, k)}
            </Tag>
          );
        }
        if (b.t === 'p') return <p key={k}>{inline(b.text, resolve, k)}</p>;
        if (b.t === 'code')
          return (
            <pre key={k} className="overflow-x-auto rounded-[var(--ro-r)] bg-[var(--ro-row)] px-3 py-2 font-mono text-[12px] leading-5">
              {b.text}
            </pre>
          );
        if (b.t === 'quote') return <blockquote key={k} className="border-l-2 border-[var(--ro-line)] pl-3 text-[var(--ro-ink-2)]">{inline(b.text, resolve, k)}</blockquote>;
        if (b.t === 'hr') return <hr key={k} className="border-[var(--ro-hair)]" />;
        if (b.t === 'table')
          return (
            <div key={k} className="overflow-x-auto">
              <table className="border-collapse text-[12px]">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} className="border border-[var(--ro-line)] bg-[var(--ro-row)] px-2 py-1 font-semibold" style={{ textAlign: b.align[j] || 'left' }}>
                        {inline(c, resolve, k + 'h' + j)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {b.head.map((_, j) => (
                        <td key={j} className="border border-[var(--ro-line)] px-2 py-1" style={{ textAlign: b.align[j] || 'left' }}>
                          {inline(r[j] ?? '', resolve, k + 'r' + ri + 'c' + j)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        const List = b.ordered ? 'ol' : 'ul';
        return (
          <List key={k} className={cn('flex flex-col gap-0.5 pl-5', b.ordered ? 'list-decimal' : 'list-disc')}>
            {b.items.map((it, j) => (
              <li key={j} style={{ marginLeft: it.depth * 16 - (it.task ? 20 : 0) }} className={cn(it.task && 'list-none')}>
                {it.task && <input type="checkbox" checked={it.done} readOnly aria-label={it.done ? 'Done' : 'Not done'} className="mr-1.5 align-middle" />}
                {inline(it.text, resolve, k + 'i' + j)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
