import type { ReactNode } from 'react'

const BULLET_PATTERN = /^[•\-*]\s+(.*)/

/**
 * Renders briefing text as a real list instead of a raw paragraph.
 * Groups consecutive bullet-prefixed lines (•, -, *) into a <ul>, and
 * renders any other lines as plain paragraphs — this handles both the
 * backend's bulleted fallback template and unstructured LLM prose.
 */
export function formatBriefingContent(content: string): ReactNode {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const elements: ReactNode[] = []
  let currentList: string[] = []

  function flushList(key: string) {
    if (currentList.length === 0) return
    elements.push(
      <ul key={key} style={{ margin: 0, paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {currentList.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    )
    currentList = []
  }

  lines.forEach((line, i) => {
    const match = line.match(BULLET_PATTERN)
    if (match) {
      currentList.push(match[1])
    } else {
      flushList(`list-${i}`)
      elements.push(<p key={`p-${i}`} style={{ margin: 0 }}>{line}</p>)
    }
  })
  flushList('list-end')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {elements}
    </div>
  )
}
