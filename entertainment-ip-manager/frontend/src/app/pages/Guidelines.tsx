/**
 * Guidelines and fans (module "guidelines"): the company's fan, clip,
 * cover, AI-use and event guidelines (二次創作ガイドライン) with starter
 * templates and versions; clip channels and fan permits (切り抜き・個人許諾・
 * 当日版権); and where violations go (enforcement cases). ?open=<id> opens
 * a fan registration.
 */
import { ShieldAlert } from 'lucide-react';
import { Button } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { CaseRec } from '../lib/records.ts';
import { EmptyHint, EnumPill, ListRow, Notice, PageHeader, Ref, Section } from '../components/ui.tsx';
import { PortalTabs } from '../components/portalShared.tsx';
import { GuidelinesTab } from '../components/orgGuidelines.tsx';
import { FansTab, useOpenFanApplications } from '../components/orgFans.tsx';

type Tab = 'guidelines' | 'fans' | 'violations';

export function GuidelinesPage(): React.JSX.Element {
  const [rawTab, setTab] = useHashParam('tab', 'guidelines');
  const [openId, setOpen] = useHashParam('open', '');
  const applied = useOpenFanApplications();
  const tab: Tab = openId !== '' ? 'fans' : rawTab === 'fans' || rawTab === 'violations' ? rawTab : 'guidelines';

  return (
    <div>
      <PageHeader
        title={t('Guidelines and fans')}
        subtitle={t('What fans, clip channels and creators may do with your characters and talents, who has a permit, and where violations are handled.')}
      />
      <PortalTabs<Tab>
        label={t('Section')}
        value={tab}
        onChange={(v) => {
          if (openId !== '') setOpen('');
          setTab(v);
        }}
        options={[
          { value: 'guidelines', label: t('Guidelines') },
          { value: 'fans', label: applied > 0 ? t('Fan permits ({n} new)', { n: applied }) : t('Fan permits') },
          { value: 'violations', label: t('Violations') },
        ]}
      />
      {tab === 'guidelines' && <GuidelinesTab />}
      {tab === 'fans' && <FansTab />}
      {tab === 'violations' && <ViolationsTab />}
    </div>
  );
}

function ViolationsTab(): React.JSX.Element {
  const cases = useCollection<CaseRec>('enforcement_cases', { filter: 'case_type = "clip_violation" || case_type = "unauthorized_derivative"', sort: '-opened_date,-created' });
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={ShieldAlert}>
        {t('Violations of a guideline are handled as enforcement cases, of type "Clip guideline violation" or "Unauthorized derivative". A case keeps the evidence, the notices sent, the platform takedown requests and the outcome, and a permit can be suspended or revoked from Fan permits.')}
      </Notice>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1 text-left" onClick={() => navigate('enforcement', undefined, { type: 'clip_violation' })}>
          <ShieldAlert size={13} aria-hidden /> {t('Open clip violations in Enforcement')}
        </Button>
        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1 text-left" onClick={() => navigate('enforcement', undefined, { type: 'unauthorized_derivative' })}>
          <ShieldAlert size={13} aria-hidden /> {t('Open unauthorized derivatives in Enforcement')}
        </Button>
      </div>
      <Section title={t('Guideline violations')} meta={cases.loading ? undefined : String(cases.records.length)} flush>
        {cases.records.length === 0 ? (
          <EmptyHint
            compact
            icon={ShieldAlert}
            title={cases.loading ? t('Loading') : t('No violation cases')}
            message={cases.loading ? undefined : t('When a clip channel or fan work breaks a guideline, open an enforcement case of one of these types from the Enforcement page.')}
          />
        ) : (
          <div>
            {cases.records.map((c) => (
              <ListRow
                key={c.id}
                onClick={() => navigate('case', c.id)}
                leading={<Ref>{c.ref}</Ref>}
                primary={c.title}
                secondary={`${enumLabel('enforcement_cases.case_type', c.case_type)}${c.platform !== '' ? ` · ${c.platform}` : ''}${c.opened_date !== '' ? ` · ${fmtDate(c.opened_date)}` : ''}`}
                trailing={<EnumPill field="enforcement_cases.status" value={c.status} />}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
