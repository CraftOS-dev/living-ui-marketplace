/** Names for the approval kinds modules register (leave_request, claim, ...). */
import { humanize } from './format.ts';
import { has, t } from './i18n.ts';

export function kindLabel(kind: string): string {
  return has(`kind.${kind}`) ? t(`kind.${kind}`) : humanize(kind);
}
