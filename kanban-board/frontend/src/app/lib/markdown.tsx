/**
 * A small markdown renderer for card descriptions, comments and agent
 * output: headings, paragraphs, lists (with task boxes), quotes, code blocks,
 * tables, bold, italic, inline code and links. Text is never injected as
 * HTML, so agent output cannot run script.
 */
import type { ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    const t = m[0];
    if (m[1] !== undefined) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else if (m[4] !== undefined) {
      const label = t.slice(1, t.indexOf(']'));
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else if (m[6] !== undefined)
      out.push(
        <a key={k} href={t} target="_blank" rel="noreferrer">
          {t}
        </a>,
      );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function Markdown({ text, className }: { text: string; className?: string | undefined }): React.JSX.Element {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const key = `b${n++}`;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) body.push(lines[i++] ?? '');
      i++;
      blocks.push(
        <pre key={key}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = (h[1] ?? '#').length;
      const content = inline(h[2] ?? '', key);
      blocks.push(level <= 1 ? <h3 key={key}>{content}</h3> : level === 2 ? <h4 key={key}>{content}</h4> : <h5 key={key}>{content}</h5>);
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) rows.push(cells(lines[i++] ?? ''));
      blocks.push(
        <div key={key} className="kb-md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: ReactNode[] = [];
      let j = 0;
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i] ?? '')) {
        const raw = (lines[i] ?? '').replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(raw);
        items.push(
          <li key={j} className={task ? 'kb-md-task' : undefined}>
            {task ? <span className={task[1] === ' ' ? 'kb-md-box' : 'kb-md-box kb-md-box-on'} aria-hidden /> : null}
            {inline(task ? (task[2] ?? '') : raw, `${key}i${j}`)}
          </li>,
        );
        j++;
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) body.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(body.join(' '), key)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i] ?? '') && !(lines[i] ?? '').trim().startsWith('|')) para.push(lines[i++] ?? '');
    if (para.length === 0) {
      blocks.push(<p key={key}>{inline(line, key)}</p>);
      i++;
      continue;
    }
    blocks.push(
      <p key={key}>
        {para.flatMap((p, pi) => (pi === 0 ? inline(p, `${key}p${pi}`) : [<br key={`${key}br${pi}`} />, ...inline(p, `${key}p${pi}`)]))}
      </p>,
    );
  }
  return <div className={`kb-md ${className ?? ''}`}>{blocks}</div>;
}
