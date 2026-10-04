/**
 * The external portal: what a licensee, a committee member or an outside
 * reviewer sees. Everything comes from portal/context, which the server
 * limits to the companies the account is linked to, and it refreshes live
 * when products, approvals, statements, seal orders, consent requests or
 * distributions change.
 */
import { Building2, Link2 } from 'lucide-react';
import { useApp } from '../lib/context.tsx';
import { useRoute } from '../lib/router.ts';
import { t } from '../lib/i18n.ts';
import { roleHelp } from '../lib/labels.ts';
import type { Role } from '../lib/shapes.ts';
import { ErrorBox, Loading, Notice, PageHeader, Pill } from '../components/ui.tsx';
import { roleLabel } from '../components/orgShared.tsx';
import { usePortal } from '../components/portalShared.tsx';
import { LicenseeView } from '../components/portalLicensee.tsx';
import { CommitteeView } from '../components/portalCommittee.tsx';
import { ReviewerView } from '../components/portalReviewer.tsx';

export function PortalPage(): React.JSX.Element {
  const { settings, role, me } = useApp();
  const portal = usePortal();
  const route = useRoute();
  // Notification deep links: #/approvals/<id>, #/royalties/<id>, #/portal?consent=<id>.
  const focusApproval = route.page === 'approvals' ? route.id : '';
  const focusStatement = route.page === 'royalties' ? route.id : '';
  const focusConsent = route.params.get('consent') ?? '';
  const ctx = portal.data;
  const org = settings?.org_name || t('the licensor');
  const effectiveRole = (ctx?.role || role) as Role | '';

  const subtitle = (): string => {
    if (effectiveRole === 'licensee') return t('Your licences from {org}, the products you make under them, their approvals, royalty statements and seals.', { org });
    if (effectiveRole === 'committee_member') return t('Your production committees with {org}: distribution statements and the consent requests your company answers.', { org });
    if (effectiveRole === 'reviewer') return t('The product approvals {org} asked you to review.', { org });
    return t('Your shared workspace with {org}.', { org });
  };

  return (
    <div>
      <PageHeader
        eyebrow={settings?.org_name ? t('{org} partner portal', { org: settings.org_name }) : t('Partner portal')}
        title={ctx !== null && ctx.parties.length > 0 ? ctx.parties.map((p) => p.name).join(' / ') : me?.name || t('My portal')}
        subtitle={subtitle()}
        actions={effectiveRole !== '' ? <Pill tone="accent" title={roleHelp(effectiveRole)}>{roleLabel(effectiveRole)}</Pill> : undefined}
      />

      {portal.loading && ctx === null ? (
        <Loading />
      ) : portal.error !== null && ctx === null ? (
        <ErrorBox message={portal.error} onRetry={portal.reload} />
      ) : ctx === null ? null : (
        <div className="flex flex-col gap-4">
          {ctx.parties.length === 0 && effectiveRole !== 'reviewer' && (
            <Notice tone="warn" icon={Link2}>
              {t('Your account is not linked to a company yet, so there is nothing to show. Ask your contact at {org} to link your account to your company.', { org })}
            </Notice>
          )}
          {ctx.parties.length > 1 && (
            <Notice tone="info" icon={Building2}>
              {t('You act for several companies. Everything below covers all of them.')}
            </Notice>
          )}
          {effectiveRole === 'licensee' && <LicenseeView ctx={ctx} focusApproval={focusApproval} focusStatement={focusStatement} />}
          {effectiveRole === 'committee_member' && <CommitteeView ctx={ctx} focusConsent={focusConsent} />}
          {effectiveRole === 'reviewer' && <ReviewerView ctx={ctx} focusApproval={focusApproval} />}
        </div>
      )}
    </div>
  );
}
