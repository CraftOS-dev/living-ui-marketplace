/**
 * A small, safe markdown renderer for letters and handbook pages: headings
 * (#, ##, ###), paragraphs, line breaks (two trailing spaces), lists (-, *,
 * 1.), quotes (>), rules (---), **bold**, *italic*, `code` and http(s)
 * links. Everything else is text: no HTML is ever interpreted.
 */
import type { ReactNode } from 'react';
import { cn } from '../../../kit/index.ts';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="hr-mono rounded-[3px] bg-[var(--hr-sunk)] px-1 text-[0.92em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const close = tok.indexOf('](');
      out.push(
        <a key={k} href={tok.slice(close + 2, -1)} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          {tok.slice(1, close)}
        </a>,
      );
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines of a paragraph, with hard breaks where a line ends in two spaces. */
function lines(ls: string[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  ls.forEach((l, i) => {
    out.push(...inline(l.replace(/\s+$/, ''), `${keyBase}-${i}`));
    if (i < ls.length - 1) out.push(/ {2,}$/.test(l) ? <br key={`${keyBase}-br${i}`} /> : ' ');
  });
  return out;
}

export function Markdown({ text, className, tone = 'app' }: { text: string; className?: string | undefined; tone?: 'app' | 'print' | undefined }): React.JSX.Element {
  const blocks: ReactNode[] = [];
  const src = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let n = 0;
  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push(
      <p key={`p${n++}`} className="my-2.5">
        {lines(para, `p${n}`)}
      </p>,
    );
    para = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    const items = list.items.map((it, i) => (
      <li key={i} className="my-0.5">
        {inline(it, `l${n}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`o${n++}`} className="my-2.5 list-decimal pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`u${n++}`} className="my-2.5 list-disc pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote key={`q${n++}`} className={cn('my-2.5 border-l-2 pl-3', tone === 'print' ? 'border-[#999] text-[#333]' : 'border-[var(--hr-line-2)] text-[var(--hr-ink-2)]')}>
        {lines(quote, `q${n}`)}
      </blockquote>,
    );
    quote = [];
  };
  const flush = (): void => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const raw of src) {
    const l = raw;
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h !== null) {
      flush();
      const level = (h[1] ?? '#').length;
      const body = inline(h[2] ?? '', `h${n}`);
      blocks.push(
        level === 1 ? (
          <h2 key={`h${n++}`} className="mb-3 mt-1 text-[15px] font-semibold leading-6">
            {body}
          </h2>
        ) : level === 2 ? (
          <h3 key={`h${n++}`} className="mb-2 mt-4 text-[15px] font-semibold leading-6">
            {body}
          </h3>
        ) : (
          <h4 key={`h${n++}`} className="mb-1.5 mt-3 text-[13px] font-semibold">
            {body}
          </h4>
        ),
      );
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      flush();
      blocks.push(<hr key={`r${n++}`} className={cn('my-4 border-0 border-t', tone === 'print' ? 'border-[#bbb]' : 'border-[var(--hr-line)]')} />);
      continue;
    }
    const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(l);
    if (li !== null) {
      flushPara();
      flushQuote();
      const ordered = /\d/.test(li[1] ?? '');
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(li[2] ?? '');
      continue;
    }
    const q = /^>\s?(.*)$/.exec(l);
    if (q !== null) {
      flushPara();
      flushList();
      quote.push(q[1] ?? '');
      continue;
    }
    if (l.trim() === '') {
      flush();
      continue;
    }
    flushList();
    flushQuote();
    para.push(l);
  }
  flush();
  return <div className={cn('hr-wrap text-[14px] leading-[1.6]', tone === 'print' && 'text-[13px] leading-[1.65] text-[#111]', className)}>{blocks}</div>;
}
