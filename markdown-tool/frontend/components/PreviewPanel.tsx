import { useMemo } from 'react'
import { marked } from 'marked'

interface PreviewPanelProps {
  content: string
  filePath: string | null
}

export function PreviewPanel({ content, filePath }: PreviewPanelProps) {
  const html = useMemo(() => {
    if (!content) return ''
    return marked.parse(content, { breaks: true, gfm: true }) as string
  }, [content])

  if (!filePath) {
    return (
      <div className="preview-empty">
        <p>Preview will appear here when a file is open</p>
        <style>{`
          .preview-empty {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: var(--font-size-base);
            padding: var(--space-6);
            text-align: center;
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="preview-panel">
      <div
        className="markdown-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .preview-panel {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-5) var(--space-6);
          min-height: 0;
        }

        .markdown-preview { line-height: 1.7; color: var(--text-primary); }
        .markdown-preview > *:first-child { margin-top: 0; }

        .markdown-preview h1,
        .markdown-preview h2,
        .markdown-preview h3,
        .markdown-preview h4 {
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          font-weight: 600;
          line-height: var(--line-height-tight);
        }
        .markdown-preview h1 {
          font-size: 1.75em;
          border-bottom: 1px solid var(--border-primary);
          padding-bottom: 0.3em;
        }
        .markdown-preview h2 {
          font-size: 1.4em;
          border-bottom: 1px solid var(--border-primary);
          padding-bottom: 0.25em;
        }
        .markdown-preview h3 { font-size: 1.15em; }
        .markdown-preview h4 { font-size: 1em; }

        .markdown-preview p { margin-bottom: 1em; }

        .markdown-preview a { color: var(--color-primary); text-decoration: underline; }
        .markdown-preview a:hover { color: var(--color-primary-hover); }

        .markdown-preview strong { font-weight: 600; }
        .markdown-preview em { font-style: italic; }

        .markdown-preview code {
          background-color: var(--bg-tertiary);
          padding: 0.15em 0.4em;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 0.875em;
          color: var(--color-primary);
        }

        .markdown-preview pre {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: var(--space-4);
          border-radius: var(--radius-md);
          overflow-x: auto;
          margin: 1em 0;
        }
        .markdown-preview pre code {
          background: none;
          padding: 0;
          color: var(--text-primary);
          font-size: 0.875em;
        }

        .markdown-preview blockquote {
          border-left: 3px solid var(--color-primary);
          padding-left: var(--space-4);
          margin: 1em 0;
          color: var(--text-secondary);
          font-style: italic;
        }

        .markdown-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
          font-size: var(--font-size-sm);
        }
        .markdown-preview th,
        .markdown-preview td {
          border: 1px solid var(--border-primary);
          padding: var(--space-2) var(--space-3);
          text-align: left;
        }
        .markdown-preview th {
          background-color: var(--bg-secondary);
          font-weight: 600;
        }
        .markdown-preview tr:nth-child(even) td {
          background-color: var(--bg-secondary);
        }

        .markdown-preview ul,
        .markdown-preview ol {
          margin: 0.75em 0;
          padding-left: 1.75em;
        }
        .markdown-preview li { margin: 0.3em 0; }
        .markdown-preview li > ul,
        .markdown-preview li > ol { margin: 0.2em 0; }

        .markdown-preview hr {
          border: none;
          border-top: 1px solid var(--border-primary);
          margin: 1.5em 0;
        }

        .markdown-preview img {
          max-width: 100%;
          border-radius: var(--radius-md);
        }
      `}</style>
    </div>
  )
}
