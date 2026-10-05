import { Pill } from '../../kit/index.ts';
import { capitalize, severityTone, statusTone } from '../lib/format.ts';
import type { FindingStatus, Health, Severity } from '../lib/types.ts';
import { useDetailed } from '../lib/view.tsx';
import { CHECK_STATE, checkState, ISSUE_STATUS, SEVERITY_ACTION, URGENCY } from '../lib/words.ts';

/** Severity colour + the action it implies ("High · Today") when `action` is set. */
export function SeverityPill({ severity, action }: { severity: Severity; action?: boolean }): React.JSX.Element {
  const detailed = useDetailed();
  if (!detailed) return <Pill tone={severityTone(severity)}>{URGENCY[severity]}</Pill>;
  return (
    <span title={SEVERITY_ACTION[severity]}>
      <Pill tone={severityTone(severity)}>
        {capitalize(severity)}
        {action ? ` · ${SEVERITY_ACTION[severity]}` : ''}
      </Pill>
    </span>
  );
}

export function StatusPill({ status }: { status: FindingStatus }): React.JSX.Element {
  return <Pill tone={statusTone(status)}>{ISSUE_STATUS[status] ?? capitalize(status)}</Pill>;
}

export function HealthPill({ health, error }: { health: Health; error?: string | undefined }): React.JSX.Element {
  const st = CHECK_STATE[checkState({ enabled: true, health, last_error: error ?? '', last_run: '' })];
  return <Pill tone={st.tone}>{st.label}</Pill>;
}

export function ActorLabel({ label }: { label: string }): React.JSX.Element {
  const tag = label === 'agent' ? 'Agent' : label === 'system' || label === 'scheduler' ? 'NetSentry' : label === 'sensor' ? 'Monitor' : null;
  return tag !== null ? (
    <Pill tone={tag === 'Agent' ? 'accent' : 'neutral'}>{tag}</Pill>
  ) : (
    <span className="text-[13px]">{label || '—'}</span>
  );
}
