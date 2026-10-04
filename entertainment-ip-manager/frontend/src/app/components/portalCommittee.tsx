/**
 * Committee member portal (製作委員会の構成員): the committees the company
 * belongs to, distribution statements issued to it (分配明細: the pool and
 * the company's own amount and share), and consent requests (同意依頼) the
 * company answers. A refusal needs a reason (Copyright Act art. 65(3)).
 * Other members' amounts and answers are not shown.
 */
import { useEffect, useState } from 'react';
import { Check, HandCoins, Landmark, MessageSquareWarning, X } from 'lucide-react';
import { Button, Dialog, Textarea, toast } from '../../kit/index.ts';
import { errText, op } from '../lib/api.ts';
import { fmtDate, fmtMoney, fmtPct, today } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { ConsentAnswer, PortalContext } from '../lib/shapes.ts';
import { EmptyHint, EnumPill, Fact, Notice, Pill, Prose, Section, TONE_TEXT } from './ui.tsx';
import { DialogBody } from './orgShared.tsx';
import { PortalList, PortalTabs } from './portalShared.tsx';

type Tab = 'consents' | 'distributions' | 'committees';
type Consent = PortalContext['consents'][number];

function answerLabel(a: string): string {
  return { pending: t('Not answered yet'), approve: t('We agreed'), refuse: t('We refused'), no_answer: t('No answer given') }[a] ?? a;
}

/** #/portal?consent=<id> (from a notification) shows and highlights that request. */
export function CommitteeView({ ctx, focusConsent }: { ctx: PortalContext; focusConsent: string }): React.JSX.Element {
  const [raw, setTab] = useHashParam('tab', 'consents');
  const picked: Tab = (['consents', 'distributions', 'committees'] as Tab[]).find((x) => x === raw) ?? 'consents';
  const tab: Tab = focusConsent !== '' ? 'consents' : picked;
  const mine = new Set(ctx.parties.map((p) => p.id));
  const ourAnswers = (c: Consent): ConsentAnswer[] => (c.answers ?? []).filter((a) => mine.has(a.party));
  const waiting = ctx.consents.filter((c) => c.status === 'open' && ourAnswers(c).some((a) => a.answer === 'pending' || a.answer === 'no_answer')).length;
  const committeeName = (id: string): string => ctx.committees.find((c) => c.id === id)?.name ?? t('Committee');

  return (
    <div>
      <PortalTabs<Tab>
        label={t('Section')}
        value={tab}
        onChange={(v) => (focusConsent !== '' ? navigate('portal', undefined, { tab: v }) : setTab(v))}
        options={[
          { value: 'consents', label: waiting > 0 ? t('Consent requests ({n} to answer)', { n: waiting }) : t('Consent requests') },
          { value: 'distributions', label: t('Distribution statements') },
          { value: 'committees', label: t('My committees') },
        ]}
      />
      {tab === 'consents' && <Consents ctx={ctx} ourAnswers={ourAnswers} committeeName={committeeName} focusId={focusConsent} />}
      {tab === 'distributions' && <Distributions ctx={ctx} mine={mine} committeeName={committeeName} />}
      {tab === 'committees' && <Committees ctx={ctx} />}
    </div>
  );
}

function Committees({ ctx }: { ctx: PortalContext }): React.JSX.Element {
  if (ctx.committees.length === 0) {
    return <EmptyHint icon={Landmark} title={t('No committees to show yet')} message={t('Committees appear here once the licensor has linked your account to your company and your company is a member.')} />;
  }
  return (
    <PortalList>
      {ctx.committees.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
          <EnumPill field="committees.status" value={c.status} />
        </li>
      ))}
    </PortalList>
  );
}

function Distributions({ ctx, mine, committeeName }: { ctx: PortalContext; mine: Set<string>; committeeName: (id: string) => string }): React.JSX.Element {
  if (ctx.distributions.length === 0) {
    return <EmptyHint icon={HandCoins} title={t('No distribution statements yet')} message={t('Distribution statements (分配明細) appear here when the managing company issues them.')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {ctx.distributions.map((d) => {
        const ours = (d.members ?? []).filter((m) => mine.has(m.party));
        const amount = ours.reduce((s, m) => s + (m.amount || 0), 0);
        const share = ours.reduce((s, m) => s + (m.share_pct || 0), 0);
        return (
          <Section key={d.id} title={committeeName(d.committee)} meta={t('Period ending {date}', { date: fmtDate(d.period_end) })} actions={<EnumPill field="distributions.status" value={d.status} />}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Fact label={t('Distributable pool')} value={fmtMoney(d.pool, d.currency)} />
              <Fact label={t('Our share')} value={ours.length > 0 ? fmtPct(share) : ''} />
              <Fact label={t('Our amount')} value={ours.length > 0 ? <span className="font-semibold">{fmtMoney(amount, d.currency)}</span> : ''} />
            </div>
            {ours.length === 0 && <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('Your company is not listed in this statement. Contact the managing company if this looks wrong.')}</p>}
          </Section>
        );
      })}
    </div>
  );
}

function Consents({
  ctx,
  ourAnswers,
  committeeName,
  focusId,
}: {
  ctx: PortalContext;
  ourAnswers: (c: Consent) => ConsentAnswer[];
  committeeName: (id: string) => string;
  focusId: string;
}): React.JSX.Element {
  const [answering, setAnswering] = useState<{ consent: Consent; member: string; answer: 'approve' | 'refuse' } | null>(null);
  const found = focusId !== '' && ctx.consents.some((c) => c.id === focusId);
  useEffect(() => {
    if (!found) return;
    document.getElementById(`portal-consent-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [found, focusId]);
  if (ctx.consents.length === 0) {
    return <EmptyHint icon={MessageSquareWarning} title={t('No consent requests')} message={t('When a use of the work needs the agreement of every committee member, the request arrives here for your answer.')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info">{t('Under Copyright Act article 65(3), a co-owner may not refuse consent without a legitimate reason. If you refuse, give the reason; it is shared with the managing company.')}</Notice>
      <PortalList>
        {ctx.consents.map((c) => {
          const ours = ourAnswers(c);
          const late = c.status === 'open' && c.due_date !== '' && c.due_date < today();
          return (
            <li
              key={c.id}
              id={`portal-consent-${c.id}`}
              className={
                c.id === focusId
                  ? 'flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-accent)]/5 px-4 py-3 outline outline-1 outline-[var(--agent-app-accent)] last:border-0'
                  : 'flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0'
              }
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-56">
                  <Prose className="font-medium">{c.subject}</Prose>
                  <div className="text-xs text-[var(--agent-app-muted)]">
                    {committeeName(c.committee)}
                    {c.due_date !== '' && <span className={late ? TONE_TEXT.bad : ''}> · {t('Answer by {date}', { date: fmtDate(c.due_date) })}</span>}
                  </div>
                </div>
                <EnumPill field="consent_requests.status" value={c.status} />
              </div>
              {ours.map((a) => (
                <div key={a.member} className="flex flex-wrap items-center gap-2 border-t border-[var(--agent-app-border)]/60 pt-2">
                  <span className="min-w-0 text-xs text-[var(--agent-app-muted)]">{a.name}</span>
                  <Pill tone={a.answer === 'approve' ? 'good' : a.answer === 'refuse' ? 'bad' : 'info'}>{answerLabel(a.answer)}</Pill>
                  {a.date !== '' && a.answer !== 'pending' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(a.date)}</span>}
                  {a.reason !== '' && <span className="min-w-0 basis-full break-words text-xs">{a.reason}</span>}
                  {c.status === 'open' && (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant={a.answer === 'approve' ? 'outline' : 'primary'} onClick={() => setAnswering({ consent: c, member: a.member, answer: 'approve' })}>
                        <Check size={13} aria-hidden /> {t('Agree')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setAnswering({ consent: c, member: a.member, answer: 'refuse' })}>
                        <X size={13} aria-hidden /> {t('Refuse')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {ours.length === 0 && <p className="text-xs text-[var(--agent-app-muted)]">{t('Your company is not asked to answer this request.')}</p>}
            </li>
          );
        })}
      </PortalList>
      {answering !== null && <AnswerDialog {...answering} committee={committeeName(answering.consent.committee)} onClose={() => setAnswering(null)} />}
    </div>
  );
}

function AnswerDialog({ consent, member, answer, committee, onClose }: { consent: Consent; member: string; answer: 'approve' | 'refuse'; committee: string; onClose: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = answer === 'approve' || reason.trim() !== '';
  const submit = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      await op('consent/answer', { request_id: consent.id, member_id: member, answer, reason: reason.trim() });
      toast.success(answer === 'approve' ? t('Your agreement was sent') : t('Your refusal and its reason were sent'));
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={answer === 'approve' ? t('Agree to this request') : t('Refuse this request')}
      description={`${committee} · ${enumLabel('consent_requests.status', consent.status)}`}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant={answer === 'approve' ? 'primary' : 'danger'} loading={busy} disabled={!ok} onClick={() => void submit()}>
            {answer === 'approve' ? t('Send agreement') : t('Send refusal')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Prose className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2">{consent.subject}</Prose>
        <Textarea
          label={answer === 'approve' ? t('Comment (optional)') : t('Reason for refusing (required)')}
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {answer === 'refuse' && <p className="-mt-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Copyright Act article 65(3): consent may not be refused without a legitimate reason.')}</p>}
      </DialogBody>
    </Dialog>
  );
}
