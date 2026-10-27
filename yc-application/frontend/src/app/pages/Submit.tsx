/**
 * Step 5, Submit: what still blocks, the founder video (link and YC's four
 * rules), then three cards: your AI agent fills YC's form, you press Submit
 * on YC, you mark it sent. After that, where it stands. Batch, deadline and
 * exports at the bottom.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowRight, Clock, Copy, Download, ExternalLink, Flag, MicOff, Music, Send, Sparkles, Users, Video } from 'lucide-react';
import { cn, useAgentRequest } from '../../kit/index.ts';
import { copyText, download, op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { setConfirm } from '../lib/actions.ts';
import { ago, deadlineText, fromLocalText, toLocalText } from '../lib/format.ts';
import { href, targetHref, type Route } from '../lib/router.ts';
import type { Answer, ConfirmKey, Packet, Pipeline, Ready } from '../lib/types.ts';
import { notify } from '../lib/toast.tsx';
import { Card, CardHeader, CircleButton, IconBadge, PageHeader, PillButton, PillLink, Segments, StartCard, StatusPill, Tip, ToggleRow, confirmAsk, softInput } from '../components/ui.tsx';

const APPLY_URL = 'https://apply.ycombinator.com';
const RULES: { key: ConfirmKey; label: string; icon: LucideIcon }[] = [
  { key: 'one_minute', label: 'One minute long', icon: Clock },
  { key: 'all_founders', label: 'Every founder in it', icon: Users },
  { key: 'unscripted', label: 'Talking, no script', icon: MicOff },
  { key: 'no_extras', label: 'No demo, music or effects', icon: Music },
];

function VideoCard({ p, video, locked }: { p: Pipeline; video: Answer | null; locked: boolean }): React.JSX.Element {
  const [url, setUrl] = useState(video?.value ?? '');
  useEffect(() => setUrl(video?.value ?? ''), [video?.value]);
  const save = async (): Promise<void> => {
    if (url.trim() === (video?.value ?? '')) return;
    await op('answers.set', { key: 'f_video', value: url.trim() });
    changed('answers');
  };
  return (
    <Card id="video">
      <CardHeader
        title="Founder video"
        subtitle="Applicants with a video are far more likely to get an interview"
        action={
          <a href="https://www.ycombinator.com/video" target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline underline-offset-4 hover:decoration-2">
            YC&apos;s guide
          </a>
        }
      />
      <div className="relative mb-3">
        <Video size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--yc-muted)]" />
        <input
          className={cn(softInput, 'pl-11')}
          value={url}
          placeholder="Paste the video link (unlisted YouTube or Loom)"
          aria-label="Founder video link"
          disabled={locked}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {RULES.map((r) => (
          <ToggleRow key={r.key} icon={r.icon} title={r.label} checked={p.settings.confirms[r.key] === true} disabled={locked} onChange={(v) => setConfirm(r.key, v)} />
        ))}
      </div>
    </Card>
  );
}

function StepCard({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-4">
      <span className="num flex size-9 items-center justify-center rounded-full bg-[var(--yc-ink)] text-[14px] font-bold text-[var(--yc-shell)]">{n}</span>
      <div className="flex-1">
        <p className="text-[15px] font-bold leading-[22px]">{title}</p>
        {sub !== undefined && <p className="mt-1 text-[13px] text-[var(--yc-muted)]">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

export function SubmitPage({ p }: { p: Pipeline; route: Route }): React.JSX.Element {
  const ready = useLive<Ready>('ready', (signal) => op<Ready>('submit.ready', {}, { signal, quiet: true }), ['answers', 'founders', 'settings']);
  const video = useLive<Answer>('video', (signal) => op<Answer>('answers.get', { key: 'f_video' }, { signal, quiet: true }), ['answers']);
  const fillReq = useAgentRequest(p.settings.fill_request !== '' ? p.settings.fill_request : null).request;
  const [interview, setInterview] = useState('');
  const [when, setWhen] = useState(toLocalText(p.settings.deadline));
  useEffect(() => setWhen(toLocalText(p.settings.deadline)), [p.settings.deadline]);
  const s = p.settings;
  const r = ready.data;
  const submitted = s.status !== 'preparing';
  const filling = (s.fill_state === 'requested' || s.fill_state === 'filling') && (fillReq === null || fillReq.status === 'pending' || fillReq.status === 'claimed');
  const dl = deadlineText(s.deadline);
  const filledSections = s.fill_log.filter((l) => l.status === 'filled' || l.status === 'mismatch').length;
  const nothingYet = !submitted && p.counts.answered === 0;

  const fill = async (): Promise<void> => {
    let anyway = false;
    if (r !== null && !r.ready) {
      anyway = await confirmAsk('Fill it with ' + r.blockers.length + (r.blockers.length === 1 ? ' thing' : ' things') + ' left to fix?', r.blockers.map((b) => b.title).join('. ') + '.', 'Fill anyway', 'Fix first');
      if (!anyway) return;
    }
    await op('submit.fill', { anyway });
    changed('settings');
  };
  const markSubmitted = async (): Promise<void> => {
    if (!(await confirmAsk('Did you press Submit on YC?', 'Your answers lock, because YC allows no edits after submitting.', 'Yes, it is sent'))) return;
    await op('submit.done');
    changed('settings', 'answers');
  };
  const exportMd = async (): Promise<void> => {
    const res = await op<{ filename: string; markdown: string }>('export.markdown');
    download(res.filename, res.markdown);
  };
  const copyAll = async (): Promise<void> => {
    const pk = await op<Packet>('submit.packet');
    const form = pk.sections.map((sec) => sec.section + '\n\n' + sec.fields.map((f) => f.question + '\n' + f.value).join('\n\n'));
    const people = pk.founders.map((f) => f.name + (f.role !== '' ? ', ' + f.role : '') + '\n\n' + f.profile.map((a) => a.question + '\n' + a.value).join('\n\n'));
    const text = form.concat(people).join('\n\n');
    if (await copyText(text)) notify.info('Copied the whole application');
  };
  const setStatus = async (status: string, at?: string): Promise<void> => {
    await op('submit.status', at ? { status, when: at } : { status });
    changed('settings');
  };
  const saveSettings = async (patch: Record<string, unknown>): Promise<void> => {
    await op('settings.update', patch);
    changed('settings');
  };
  const nextBatch = async (): Promise<void> => {
    const next = s.next_batch;
    if (!(await confirmAsk('Apply again for ' + next + '?', 'Your answers stay; your AI agent helps you show what changed.', 'Start ' + next))) return;
    await op('submit.next-batch', { batch: next });
    changed('settings', 'answers');
  };

  const fillStatus = s.fill_state === 'requested' ? (fillReq?.status === 'claimed' ? 'Opening YC\'s form' : 'Waiting for your AI agent') : s.fill_state === 'filling' ? 'Filling now, watch it in the browser panel' : s.fill_state === 'filled' ? 'Every section filled' : s.fill_state === 'stopped' ? 'Stopped, see the chat' : '';

  return (
    <>
      <PageHeader title={submitted ? 'Sent to YC' : 'Send it'} {...(submitted ? { subtitle: 'Submitted ' + ago(s.submitted_at) } : r !== null && r.ready ? { subtitle: 'Ready when you are' } : {})} />
      <div className="grid gap-4">
        {nothingYet ? (
          <StartCard
            icon={Send}
            title="Nothing to send yet"
            actions={
              <PillLink variant="dark" dot icon={ArrowRight} href={href(p.sources.length === 0 ? 'links' : 'answers')}>
                {p.sources.length === 0 ? 'Add links or files' : 'Go to answers'}
              </PillLink>
            }
          >
            Fill your application first. This is where your AI agent types it into YC&apos;s form for you to submit.
          </StartCard>
        ) : submitted ? (
          <Card tone="dark">
            <CardHeader title="Where it stands" />
            <div className="mb-5 flex flex-wrap gap-2">
              {(['submitted', 'interview', 'accepted'] as const).map((k) => {
                const reached = k === 'submitted' || (k === 'interview' && (s.status === 'interview' || s.status === 'accepted')) || (k === 'accepted' && s.status === 'accepted');
                return (
                  <StatusPill key={k} tone={reached ? 'good' : 'dark'}>
                    {k === 'submitted' ? 'Submitted' : k === 'interview' ? 'Interview' + (s.interview_at !== '' ? ' ' + new Date(s.interview_at).toLocaleDateString() : '') : 'Accepted'}
                  </StatusPill>
                );
              })}
              {s.status === 'rejected' && <StatusPill tone="bad">Not this time</StatusPill>}
            </div>
            {(s.status === 'submitted' || s.status === 'interview') && (
              <div className="flex flex-wrap gap-2">
                <input className={cn(softInput, 'max-w-[240px]')} placeholder="Interview: YYYY-MM-DD HH:MM" aria-label="Interview time" value={interview} onChange={(e) => setInterview(e.target.value)} />
                <PillButton variant="light" disabled={fromLocalText(interview) === null} onClick={() => void setStatus('interview', fromLocalText(interview) ?? '')}>
                  Interview booked
                </PillButton>
                <PillButton variant="accent" onClick={() => void setStatus('accepted')}>
                  Accepted
                </PillButton>
                <PillButton variant="ghost" className="text-[var(--yc-on-dark)]" onClick={() => void setStatus('rejected')}>
                  Not this time
                </PillButton>
              </div>
            )}
            {s.status === 'rejected' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-[var(--yc-muted)]">About half of each batch applied more than once.</span>
                <PillButton variant="accent" onClick={() => void nextBatch()}>
                  Apply again
                </PillButton>
              </div>
            )}
          </Card>
        ) : (
          <>
            {r !== null && r.blockers.length > 0 && (
              <Card>
                <CardHeader title="Fix these first" subtitle="These hurt your chances most. Fix them, or send it anyway" />
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {r.blockers.slice(0, 5).map((b) => (
                    <div key={b.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--yc-row)] px-3 py-2.5">
                      <IconBadge icon={AlertTriangle} tone="bad" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold">{b.title}</span>
                        <span className="block truncate text-[12px] text-[var(--yc-muted)]">{b.detail !== '' ? b.detail : b.fix}</span>
                      </span>
                      <PillLink variant="light" className="h-9" href={targetHref(b.target)}>
                        Fix
                      </PillLink>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <VideoCard p={p} video={video.data} locked={submitted} />

            <div className="grid gap-4 md:grid-cols-3">
              <StepCard n={1} title="Your AI agent fills YC's form" sub="It types every answer and stops before Submit">
                {s.fill_log.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Segments value={filledSections} max={6} count={6} />
                    <span className="text-[12px] text-[var(--yc-muted)]">{Math.min(filledSections, 6)} of 6 sections</span>
                  </div>
                )}
                {fillStatus !== '' && <StatusPill tone={s.fill_state === 'stopped' ? 'bad' : s.fill_state === 'filled' ? 'good' : 'info'} pulse={filling}>{fillStatus}</StatusPill>}
                <PillButton variant="dark" dot icon={Sparkles} disabled={filling} onClick={() => void fill()}>
                  {s.fill_state === 'filled' || s.fill_state === 'stopped' ? 'Fill again' : 'Fill the form'}
                </PillButton>
              </StepCard>
              <StepCard n={2} title="You check it and press Submit" sub="Only you can submit. YC allows no edits after">
                <PillLink variant={s.fill_state === 'filled' ? 'dark' : 'row'} icon={ExternalLink} href={APPLY_URL} target="_blank" rel="noreferrer">
                  Open YC
                </PillLink>
              </StepCard>
              <StepCard n={3} title="Tell us it is sent" sub="Your answers then lock as sent, and you track the interview here">
                <PillButton variant="row" icon={Send} onClick={() => void markSubmitted()}>
                  I submitted
                </PillButton>
              </StepCard>
            </div>
          </>
        )}

        <Card>
          <CardHeader title="Batch and deadline" subtitle={s.deadline_note !== '' ? s.deadline_note : 'The deadline in your time zone'} />
          <div className="flex flex-wrap items-center gap-2">
            <select className={cn(softInput, 'w-auto min-w-[200px] appearance-none pr-10 font-semibold')} value={s.batches.includes(s.batch) ? s.batch : ''} aria-label="Batch" disabled={submitted} onChange={(e) => void saveSettings({ batch: e.target.value })}>
              {!s.batches.includes(s.batch) && <option value="">{s.batch}</option>}
              {s.batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <input
              className={cn(softInput, 'num w-[200px]')}
              value={when}
              placeholder="YYYY-MM-DD HH:MM"
              aria-label="Deadline"
              disabled={submitted}
              onChange={(e) => setWhen(e.target.value)}
              onBlur={() => {
                const iso = when.trim() === '' ? '' : fromLocalText(when);
                if (iso === null) {
                  notify.error('Write the deadline as YYYY-MM-DD HH:MM');
                  return;
                }
                if (iso !== s.deadline) void saveSettings({ deadline: iso, deadline_note: '' });
              }}
            />
            {dl.left !== '' && <StatusPill tone={dl.late ? 'bad' : 'info'}>{dl.left}</StatusPill>}
            <span className="flex-1" />
            <Tip text="Copy every answer">
              <CircleButton icon={Copy} label="Copy every answer" variant="row" onClick={() => void copyAll()} />
            </Tip>
            <Tip text="Download the application">
              <CircleButton icon={Download} label="Download" variant="row" onClick={() => void exportMd()} />
            </Tip>
          </div>
          <div className="mt-3">
            <ToggleRow icon={Flag} title="A YC founder recommends us" checked={s.recommended} disabled={submitted} onChange={(v) => saveSettings({ recommended: v })} />
          </div>
        </Card>
      </div>
    </>
  );
}

