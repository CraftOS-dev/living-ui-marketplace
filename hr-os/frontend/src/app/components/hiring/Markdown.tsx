/**
 * A small, safe markdown renderer for job posts and offer letters: headings
 * (#, ##, ###), paragraphs, line breaks, **bold**, *italic*, `code`, links
 * to http(s) addresses, bullet and numbered lists, and pipe tables. Text is
 * rendered as React text (never as HTML), so nothing in it can run.
 */
import type { ReactNode } from 'react';
import { cx } from './bits.tsx';

type Block = { kind: 'h'; level: number; text: string } | { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] } | { kind: 'table'; head: string[]; rows: string[][] } | { kind: 'hr' };

function cells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map((c) => c.trim());
}

function parse(src: string): Block[] {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const tr = line.trim();
    if (tr === '') {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(tr);
    if (h) {
      out.push({ kind: 'h', level: h[1]?.length ?? 1, text: h[2] ?? '' });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(tr)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }
    if (tr.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test((lines[i + 1] ?? '').trim())) {
      const head = cells(tr);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(cells(lines[i] ?? ''));
        i++;
      }
      out.push({ kind: 'table', head, rows });
      continue;
    }
    if (/^[-*]\s+/.test(tr)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push({ kind: 'ul', items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(tr)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      out.push({ kind: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = (lines[i] ?? '').trim();
      if (l === '' || /^(#{1,3})\s+/.test(l) || /^[-*]\s+/.test(l) || /^\d+[.)]\s+/.test(l) || (l.startsWith('|') && /^\|?\s*:?-{2,}/.test((lines[i + 1] ?? '').trim()))) break;
      para.push(l);
      i++;
    }
    out.push({ kind: 'p', lines: para });
  }
  return out;
}

/** Inline marks: **bold**, *italic* or _italic_, `code`, [text](https://...). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[4] !== undefined) out.push(<code key={k} className="hr-mono rounded-[3px] bg-[var(--hr-sunk)] px-1 text-[0.92em]">{m[4]}</code>);
    else if (m[6] !== undefined && m[7] !== undefined)
      out.push(
        <a key={k} href={m[7]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {m[6]}
        </a>,
      );
    else if (m[9] !== undefined) out.push(<em key={k}>{m[9]}</em>);
    else if (m[11] !== undefined) out.push(<em key={k}>{m[11]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className, print }: { text: string; className?: string | undefined; print?: boolean | undefined }): React.JSX.Element {
  const blocks = parse(text);
  const line = print === true ? 'border-[#ccc]' : 'border-[var(--hr-line)]';
  return (
    <div className={cx('hr-wrap min-w-0 text-[13px] leading-[1.6]', className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === 'h') {
          const cls = b.level === 1 ? 'mb-2 mt-4 text-[15px] font-semibold first:mt-0' : b.level === 2 ? 'mb-1.5 mt-4 text-[14px] font-semibold first:mt-0' : 'mb-1 mt-3 text-[13px] font-semibold first:mt-0';
          return (
            <div key={k} role="heading" aria-level={b.level + 1} className={cls}>
              {inline(b.text, k)}
            </div>
          );
        }
        if (b.kind === 'hr') return <hr key={k} className={cx('my-4 border-t', line)} />;
        if (b.kind === 'ul' || b.kind === 'ol') {
          const Tag = b.kind === 'ul' ? 'ul' : 'ol';
          return (
            <Tag key={k} className={cx('my-2 pl-5', b.kind === 'ul' ? 'list-disc' : 'list-decimal')}>
              {b.items.map((it, j) => (
                <li key={j} className="my-0.5">
                  {inline(it, `${k}-${j}`)}
                </li>
              ))}
            </Tag>
          );
        }
        if (b.kind === 'table') {
          const blankHead = b.head.every((h) => h === '');
          return (
            <table key={k} className="my-3 w-full border-collapse text-[13px]">
              {!blankHead && (
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j} className={cx('border-b py-1.5 pr-3 text-left font-semibold', line)}>
                        {inline(h, `${k}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, x) => (
                      <td key={x} className={cx('border-b py-1.5 pr-3 align-top', line, x === 0 && blankHead ? 'w-[38%] text-[var(--hr-muted)] print:text-[#555]' : '')}>
                        {inline(c, `${k}-${j}-${x}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        const para = b as { kind: 'p'; lines: string[] };
        return (
          <p key={k} className="my-2 first:mt-0">
            {para.lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
