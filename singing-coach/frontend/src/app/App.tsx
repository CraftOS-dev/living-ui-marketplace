/**
 * Singing Coach: one person learns to sing, from the first matched note to a
 * recital, with their AI agent as coach. The app listens through the
 * microphone, shows the voice on the Voice Dial and a pitch lane, judges
 * every note, keeps each phrase's progress, plans the day and looks after
 * the voice; the coach adds the songs asked for, reviews sessions and
 * answers questions.
 *
 * Teaching runs from the first note to recital level: 80 lessons in thirteen
 * units, drills for every skill, a ten-level path, and a reference.
 *
 * Layout: a sidebar (Practice, Today, Learn, Train, Library, Reference,
 * Coach, Settings) and the page beside it; the practice screen, a lesson and
 * a drill fold the sidebar to a rail.
 */
import { useEffect, useState } from 'react';
import { toast } from '../kit/index.ts';
import { Onboarding } from './components/Onboarding.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { api } from './lib/api.ts';
import { AppProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { navigate, useRoute } from './lib/router.ts';
import { audio } from './music/audio.ts';
import { specKey } from './music/generate.ts';
import type { PlanBlock } from './lib/types.ts';
import { CoachPage } from './pages/Coach.tsx';
import { LearnPage } from './pages/Learn.tsx';
import { ReferencePage } from './pages/Reference.tsx';
import { TrainPage, openSkillKey } from './pages/Train.tsx';
import { LibraryPage } from './pages/Library.tsx';
import { PracticePage } from './pages/Practice.tsx';
import { EditorPage } from './pages/Editor.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { TodayPage } from './pages/Today.tsx';
import './theme.css';

const COLLAPSE = 'sc.sidebar';

export function App(): React.JSX.Element {
  useEffect(() => startLive(), []);
  useEffect(() => audio.unlockOnGesture(), []);
  return (
    <AppProvider>
      <Layout />
    </AppProvider>
  );
}

/** Open a block of today's plan: a song section, a vocalise (warm-up, technique, cool-down), a lesson or a drill. */
export function openBlock(b: PlanBlock): void {
  if (b.kind === 'lesson' && b.lesson !== undefined) navigate('learn', { lesson: b.lesson, block: b.i });
  else if (b.kind === 'drill' && b.skill !== undefined) openSkillKey(b.skill, b.i);
  else if ((b.kind === 'warmup' || b.kind === 'cooldown' || b.kind === 'exercise') && b.ex !== undefined) navigate('practice', { gen: specKey({ k: 'vocalise', ex: b.ex, vowel: b.kind === 'cooldown' && b.ex === 'desc5' ? 'mm' : b.vowel || undefined }), block: b.i, back: 'today', phase: b.kind === 'exercise' ? undefined : b.kind, skill: b.skill });
  else if (b.song !== undefined) navigate('practice', { song: b.song, from: b.from, to: b.to, mode: b.mode, tempo: b.tempo === 100 ? undefined : b.tempo, block: b.i });
}

/** Practice: the next block of today's plan, else the last song, else the library. */
export async function goPractice(lastSong: string): Promise<void> {
  try {
    const { plan } = await api.plan();
    const next = plan.blocks.find((b) => !b.done);
    if (next !== undefined) {
      if (plan.status === 'proposed') await api.startPlan();
      openBlock(next);
      return;
    }
  } catch (err) {
    toast.error((err as { message?: string }).message ?? 'Could not open the plan');
  }
  if (lastSong !== '') navigate('practice', { song: lastSong });
  else navigate('library');
}

function Layout(): React.JSX.Element {
  const app = useApp();
  const { page, query } = useRoute();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE) === '1';
    } catch {
      return false;
    }
  });
  const collapse = (v: boolean): void => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE, v ? '1' : '0');
    } catch {
      /* a convenience */
    }
  };
  const { setMenu } = app;
  const where = page + '|' + query.toString();
  useEffect(() => setMenu(false), [where, setMenu]);

  // Tell the coach where the person is (outside the practice screen, which reports itself).
  const lesson = query.get('lesson') ?? undefined;
  const skill = query.get('skill') ?? undefined;
  const editing = page === 'edit' ? (query.get('song') ?? undefined) : undefined;
  useEffect(() => {
    if (page !== 'practice') void api.reportUi({ view: page, lesson: page === 'learn' ? lesson : undefined, skill: page === 'train' ? skill : undefined, song: editing }).catch(() => undefined);
  }, [page, lesson, skill, editing]);

  const onPractice = (): void => {
    if (page === 'practice') return;
    void goPractice(app.settings?.last_song ?? '');
  };

  let body: React.JSX.Element;
  if (page === 'learn') body = <LearnPage />;
  else if (page === 'train') body = <TrainPage />;
  else if (page === 'reference') body = <ReferencePage />;
  else if (page === 'library') body = <LibraryPage />;
  else if (page === 'practice') body = <PracticePage key={query.toString()} />;
  else if (page === 'edit') body = <EditorPage />;
  else if (page === 'coach') body = <CoachPage />;
  else if (page === 'settings') body = <SettingsPage />;
  else body = <TodayPage />;

  const focus = page === 'practice' || page === 'edit' || (page === 'learn' && query.has('lesson')) || (page === 'train' && query.has('skill'));
  const rail = focus ? true : collapsed;
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[var(--sc-page)] text-[13px] text-[var(--sc-ink)]" style={{ fontFamily: 'var(--sc-font)' }}>
      <div className="hidden h-full md:flex">
        <Sidebar page={page} collapsed={rail} onCollapse={collapse} onPractice={onPractice} />
      </div>
      <main key={page} className="sc-fade min-w-0 flex-1">
        {body}
      </main>
      {app.menu && (
        <div className="sc-scrim fixed inset-0 z-[66] md:hidden" onPointerDown={(e) => e.target === e.currentTarget && app.setMenu(false)}>
          <div role="dialog" aria-modal="true" aria-label="Menu" className="sc-drawer h-full w-[min(290px,86vw)] border-r border-[var(--sc-line)] shadow-[var(--sc-shadow-lg)]">
            <Sidebar page={page} collapsed={false} onCollapse={() => app.setMenu(false)} onPractice={() => (app.setMenu(false), onPractice())} drawer />
          </div>
        </div>
      )}
      {app.settings !== null && !app.settings.onboarded && <Onboarding />}
    </div>
  );
}
