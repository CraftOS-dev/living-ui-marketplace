/**
 * Renders finding evidence as plain text. Evidence can contain values an
 * attacker controls (DNS TXT, hostnames, banners), so it is never rendered as
 * HTML and long values are truncated.
 */
function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null)) return v.map(String).join(', ') || '—';
  // A list of flat records (e.g. vulnerabilities) reads better as one line each than as JSON.
  if (Array.isArray(v) && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    const lines = v.slice(0, 20).map((x) =>
      Object.entries(x as Record<string, unknown>)
        .filter(([, y]) => y !== null && y !== '' && !(Array.isArray(y) && y.length === 0))
        .map(([k, y]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(y) ? y.map(String).join(', ') : typeof y === 'object' ? JSON.stringify(y) : String(y)}`)
        .join(' · '),
    );
    return (lines.join('\n') + (v.length > 20 ? `\n… ${v.length - 20} more` : '')).slice(0, 3000) || '—';
  }
  const s = JSON.stringify(v, null, 2);
  return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
}

export function EvidenceView({ evidence }: { evidence: unknown }): React.JSX.Element {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return <pre className="whitespace-pre-wrap break-words text-[13px]">{show(evidence)}</pre>;
  }
  const entries = Object.entries(evidence as Record<string, unknown>);
  if (entries.length === 0) return <p className="text-[13px] text-[var(--agent-app-muted)]">No evidence recorded.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[12px] font-medium text-[var(--agent-app-muted)]">{k.replace(/_/g, ' ')}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px]">{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
