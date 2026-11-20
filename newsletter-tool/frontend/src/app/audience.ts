import type { Campaign, Subscriber } from './types'

/**
 * Who a campaign goes to: every active subscriber, or with "By tag" only the
 * active subscribers carrying any of its target tags (nobody when no tag is
 * picked). The send records exactly this audience (pb/pb_hooks/send.js).
 */
export function campaignAudience(
  campaign: Pick<Campaign, 'targetAll' | 'targetTags'>,
  subscribers: Subscriber[],
): Subscriber[] {
  const active = subscribers.filter((s) => s.status === 'subscribed')
  if (campaign.targetAll) return active
  if (campaign.targetTags.length === 0) return []
  return active.filter((s) => (s.tags || []).some((t) => campaign.targetTags.includes(t)))
}
