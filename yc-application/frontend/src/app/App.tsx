/**
 * YC Application: five steps from the founders' links to a submitted YC
 * application (Links, Team, Answers, Polish, Submit), in the Expenses
 * tracker's visual system. With no step chosen the app opens the step the
 * founders are on.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useEffect } from 'react';
import { getPbClient } from '../kit/index.ts';
import { op } from './lib/api.ts';
import { startLive, useLive } from './lib/live.ts';
import { useRoute } from './lib/router.ts';
import type { Message, Pipeline } from './lib/types.ts';
import { Notices } from './lib/toast.tsx';
import { ConfirmHost } from './components/ui.tsx';
import { Frame, currentStep } from './components/Shell.tsx';
import { LinksPage } from './pages/Links.tsx';
import { TeamPage } from './pages/Team.tsx';
import { AnswersPage } from './pages/Answers.tsx';
import { PolishPage } from './pages/Polish.tsx';
import { SubmitPage } from './pages/Submit.tsx';

// Views load the same operation more than once; the SDK's auto-cancel would blank one.
getPbClient().pb.autoCancellation(false);

export function App(): React.JSX.Element {
  const route = useRoute();
  const pipe = useLive<Pipeline>('pipeline', (signal) => op<Pipeline>('pipeline.get', {}, { signal, quiet: true }), ['settings', 'founders', 'answers', 'sources', 'activity', 'agent_requests']);
  const msgs = useLive<{ messages: Message[] }>('messages', (signal) => op<{ messages: Message[] }>('messages.list', { limit: 30 }, { signal, quiet: true }), ['messages', 'agent_requests']);
  useEffect(() => {
    startLive();
  }, []);
  useEffect(() => {
    if (route.focus === '') window.scrollTo({ top: 0 });
  }, [route.page, route.sub, route.focus]);
  const p = pipe.data;
  if (p === null) {
    return (
      <div className="yc-app grid min-h-screen place-items-center bg-[var(--yc-canvas)] text-[13px] text-[var(--yc-muted)]">
        {pipe.error ?? 'Loading'}
      </div>
    );
  }
  const page = route.page !== '' ? route.page : currentStep(p);
  return (
    <>
      <Frame p={p} on={page} messages={msgs.data?.messages ?? []}>
        {page === 'links' && <LinksPage p={p} />}
        {page === 'team' && <TeamPage p={p} route={route} />}
        {page === 'answers' && <AnswersPage p={p} route={route} />}
        {page === 'polish' && <PolishPage p={p} route={route} />}
        {page === 'submit' && <SubmitPage p={p} route={route} />}
      </Frame>
      <Notices />
      <ConfirmHost />
    </>
  );
}
