import { useState, useMemo, useEffect, useRef } from 'react';
import type { AudioSession, ActiveTab, ActionItem, AppViewMode } from './types.ts';
import {
  getPbClient,
  useCollection,
  toast,
  Spinner,
} from '../kit/index.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { SessionHeader } from './components/SessionHeader.tsx';
import { AudioRecorder } from './components/AudioRecorder.tsx';
import { AudioPlayer } from './components/AudioPlayer.tsx';
import { AudioToTextSection } from './components/AudioToTextSection.tsx';
import { OverviewSection } from './components/OverviewSection.tsx';
import { SummarySection } from './components/SummarySection.tsx';
import { HighlightsSection } from './components/HighlightsSection.tsx';
import { WeeklySummaryView } from './components/WeeklySummaryView.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { parseActionItems, extractNamesFromTranscript, mergeAttendees } from './utils.ts';
import { Menu, AudioLines, CalendarDays, Plus, Sun, Moon } from 'lucide-react';
import './styles.css';

export function App(): React.JSX.Element {
  const { records: sessions, loading, error, refresh } = useCollection<AudioSession>('sessions', {
    sort: '-created',
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const deletedSessionIdsRef = useRef<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<AppViewMode>('note');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [localAudioUrls, setLocalAudioUrls] = useState<Record<string, string>>({});

  // Theme synchronization with CraftBot host
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined') {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    // 1. Observe data-theme changes on <html> (applied by CraftBot ThemeBridge)
    const observer = new MutationObserver(() => {
      const mode = document.documentElement.getAttribute('data-theme');
      if (mode === 'dark' || mode === 'light') {
        setThemeMode(mode);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-style'],
    });

    // 2. Direct message listener for host theme messages
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'livingui-theme' && e.data.mode) {
        setThemeMode(e.data.mode);
        document.documentElement.setAttribute('data-theme', e.data.mode);
      }
    };
    window.addEventListener('message', handleMessage);

    return () => {
      observer.disconnect();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleToggleTheme = () => {
    const nextMode = themeMode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextMode);
    setThemeMode(nextMode);
  };

  // Auto-select first session if none selected or reset when empty
  useEffect(() => {
    if (sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null);
      }
    } else {
      const exists = sessions.some((s) => s.id === activeSessionId);
      if (!exists && sessions[0]) {
        setActiveSessionId(sessions[0].id);
      }
    }
  }, [sessions, activeSessionId]);

  // Current active session
  const [failedAudioSessionIds, setFailedAudioSessionIds] = useState<Record<string, boolean>>({});

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId) || null;
  }, [sessions, activeSessionId]);

  // Aima

  // Derive audio playback URL (safely ignores broken/failed audio sessions)
  const audioPlaybackUrl = useMemo(() => {
    if (!activeSession) return null;
    if (failedAudioSessionIds[activeSession.id]) return null;
    if (localAudioUrls[activeSession.id]) {
      return localAudioUrls[activeSession.id];
    }
    if (activeSession.audio) {
      return `/api/files/sessions/${activeSession.id}/${activeSession.audio}`;
    }
    if (activeSession.audio_url) {
      return activeSession.audio_url;
    }
    return null;
  }, [activeSession, localAudioUrls, failedAudioSessionIds]);

  const handleAudioLoadError = (sessionId: string) => {
    console.warn(`Audio playback failed for session ${sessionId}. Reverting to recording controls.`);
    setFailedAudioSessionIds((prev) => ({ ...prev, [sessionId]: true }));
  };

  // Update active session fields in PocketBase
  const handleUpdateSession = async (fields: Partial<AudioSession>) => {
    if (!activeSessionId) return;
    if (deletedSessionIdsRef.current.has(activeSessionId)) return;
    const sessionExists = sessions.some((s) => s.id === activeSessionId);
    if (!sessionExists) return;
    try {
      await getPbClient().call(
        (pb) => pb.collection('sessions').update(activeSessionId, fields),
        { silent: true }
      );
      refresh();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        deletedSessionIdsRef.current.add(activeSessionId);
        refresh();
        return;
      }
      console.error('Failed to update session:', err);
    }
  };

  // Update specific session by ID (used by Weekly Summary and cross-session actions)
  const handleUpdateSpecificSession = async (sessionId: string, fields: Partial<AudioSession>) => {
    if (!sessionId) return;
    if (deletedSessionIdsRef.current.has(sessionId)) return;
    const sessionExists = sessions.some((s) => s.id === sessionId);
    if (!sessionExists) return;
    try {
      await getPbClient().call(
        (pb) => pb.collection('sessions').update(sessionId, fields),
        { silent: true }
      );
      refresh();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        deletedSessionIdsRef.current.add(sessionId);
        refresh();
        return;
      }
      console.error('Failed to update specific session:', err);
    }
  };

  // Create new empty session
  const handleNewSession = async () => {
    try {
      const today = new Date().toISOString().split('T')[0] ?? '';
      const newSession = await getPbClient().call((pb) =>
        pb.collection('sessions').create({
          title: 'Untitled Note',
          category: 'General',
          date: today,
          duration: 0,
          attendees: '',
          is_starred: false,
          overview: '',
          summary: '',
          meeting_notes: '',
          key_highlights: '',
          action_items: [],
          transcript: '',
          audio: '',
          audio_url: '',
        })
      );
      refresh();
      setActiveSessionId(newSession.id);
      setActiveTab('overview');
      toast.success('New empty note created');
    } catch (err) {
      console.error('Failed to create new session:', err);
      toast.error('Failed to create note');
    }
  };

  // Permanent Delete session without leaving any caches, object URLs, or storage remnants
  const handleDeleteSession = async (session: AudioSession) => {
    const sessionId = session?.id;
    if (!sessionId) return;
    deletedSessionIdsRef.current.add(sessionId);

    try {
      // 1. Immediately revoke and purge any in-memory audio object URLs
      if (localAudioUrls[sessionId]) {
        try {
          URL.revokeObjectURL(localAudioUrls[sessionId]);
        } catch {
          // ignore
        }
        setLocalAudioUrls((prev) => {
          const updated = { ...prev };
          delete updated[sessionId];
          return updated;
        });
      }

      setFailedAudioSessionIds((prev) => {
        const updated = { ...prev };
        delete updated[sessionId];
        return updated;
      });

      // 2. Clear any cached session data from browser localStorage and sessionStorage
      if (typeof window !== 'undefined') {
        try {
          if (window.localStorage) {
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.includes(sessionId) || key.startsWith(`note_${sessionId}`))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach((k) => localStorage.removeItem(k));
          }
          if (window.sessionStorage) {
            const keysToRemove: string[] = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && (key.includes(sessionId) || key.startsWith(`note_${sessionId}`))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach((k) => sessionStorage.removeItem(k));
          }
        } catch {
          // ignore
        }
      }

      // 3. Update active session selection immediately
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        const nextSession = remaining[0];
        setActiveSessionId(nextSession ? nextSession.id : null);
      }

      // 4. Permanently delete from PocketBase database and storage cascade (silently ignore if already removed)
      try {
        await getPbClient().call((pb) => pb.collection('sessions').delete(sessionId), { silent: true });
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status !== 404) {
          console.warn('Delete session error:', err);
        }
      }

      refresh();
      toast.success(`Permanently deleted "${session.title || 'Untitled note'}"`);
    } catch (err) {
      console.error('Failed to delete session:', err);
      toast.error('Failed to delete session');
      refresh();
    }
  };

  // Duplicate session via custom operation or PB client
  const handleDuplicateSession = async (session: AudioSession) => {
    try {
      const res = await fetch('/api/ops/sessions/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id }),
      });

      if (res.ok) {
        const data = (await res.json()) as { id: string };
        refresh();
        setActiveSessionId(data.id);
        toast.success(`Duplicated "${session.title}"`);
      } else {
        // Fallback via client
        const copy = await getPbClient().call((pb) =>
          pb.collection('sessions').create({
            title: `${session.title} (Copy)`,
            category: session.category,
            date: session.date,
            duration: session.duration,
            attendees: session.attendees,
            is_starred: session.is_starred,
            overview: session.overview,
            summary: session.summary,
            meeting_notes: session.meeting_notes || '',
            key_highlights: session.key_highlights,
            action_items: session.action_items,
            transcript: session.transcript,
          })
        );
        refresh();
        setActiveSessionId(copy.id);
        toast.success(`Duplicated "${session.title}"`);
      }
    } catch (err) {
      console.error('Failed to duplicate session:', err);
      toast.error('Failed to duplicate session');
    }
  };

  // Toggle star
  const handleToggleStar = async (session: AudioSession) => {
    if (!session?.id || deletedSessionIdsRef.current.has(session.id)) return;
    try {
      await getPbClient().call(
        (pb) =>
          pb.collection('sessions').update(session.id, {
            is_starred: !session.is_starred,
          }),
        { silent: true }
      );
      refresh();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        deletedSessionIdsRef.current.add(session.id);
        refresh();
        return;
      }
      console.error('Failed to toggle star:', err);
    }
  };

  // Handle recorded audio completion
  const handleRecordingComplete = async (
    audioBlob: Blob,
    durationSeconds: number,
    fileName: string = 'recording.webm',
    transcriptText?: string
  ) => {
    const objectUrl = URL.createObjectURL(audioBlob);

    if (activeSessionId) {
      setLocalAudioUrls((prev) => ({ ...prev, [activeSessionId]: objectUrl }));
      setFailedAudioSessionIds((prev) => {
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });

      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, fileName);
        formData.append('duration', String(durationSeconds));
        formData.append('audio_format', audioBlob.type);
        if (transcriptText && transcriptText.trim()) {
          formData.append('transcript', transcriptText.trim());
          const detectedNames = extractNamesFromTranscript(transcriptText, activeSession?.attendees || '');
          if (detectedNames.length > 0) {
            const updatedAttendees = mergeAttendees(activeSession?.attendees || '', detectedNames);
            formData.append('attendees', updatedAttendees);
          }
        }

        await getPbClient().call((pb) =>
          pb.collection('sessions').update(activeSessionId, formData)
        );
        refresh();
        toast.success('Audio recording and transcript saved');
      } catch (err) {
        console.error('Failed to save audio file to session:', err);
        // Save duration locally if file upload fails
        const detectedNames = transcriptText ? extractNamesFromTranscript(transcriptText, activeSession?.attendees || '') : [];
        void handleUpdateSession({
          duration: durationSeconds,
          ...(transcriptText && transcriptText.trim() ? { transcript: transcriptText.trim() } : {}),
          ...(detectedNames.length > 0 ? { attendees: mergeAttendees(activeSession?.attendees || '', detectedNames) } : {}),
        });
      }
    } else {
      // Create new session with recording
      try {
        const today = new Date().toISOString().split('T')[0] ?? '';
        const detectedNames = transcriptText ? extractNamesFromTranscript(transcriptText, '') : [];
        const formData = new FormData();
        formData.append('title', `Voice Memo - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        formData.append('category', 'Voice Memo');
        formData.append('date', today);
        formData.append('duration', String(durationSeconds));
        formData.append('attendees', detectedNames.join(', '));
        formData.append('audio', audioBlob, fileName);
        formData.append('audio_format', audioBlob.type || 'audio/webm');
        formData.append('overview', 'Voice recording captured via microphone.');
        formData.append('summary', 'Summary will be generated once transcription completes.');
        formData.append('key_highlights', '• Voice memo recorded on ' + today);
        formData.append('action_items', JSON.stringify([]));
        if (transcriptText && transcriptText.trim()) {
          formData.append('transcript', transcriptText.trim());
        }

        const newRecord = await getPbClient().call((pb) =>
          pb.collection('sessions').create(formData)
        );
        refresh();
        setLocalAudioUrls((prev) => ({ ...prev, [newRecord.id]: objectUrl }));
        setActiveSessionId(newRecord.id);
        toast.success('Recorded and created new session with transcript');
      } catch (err) {
        console.error('Failed to create session with audio:', err);
        toast.error('Failed to save recording');
      }
    }
  };

  // Clear completed action items via operation
  const handleClearCompletedActions = async () => {
    if (!activeSessionId) return;
    try {
      const res = await fetch('/api/ops/sessions/clear-completed-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSessionId }),
      });

      if (res.ok) {
        toast.success('Completed action items cleared');
      } else {
        // Local fallback
        if (activeSession) {
          const activeOnly = parseActionItems(activeSession.action_items).filter((i) => !i.completed);
          void handleUpdateSession({ action_items: activeOnly });
        }
      }
    } catch {
      if (activeSession) {
        const activeOnly = parseActionItems(activeSession.action_items).filter((i) => !i.completed);
        void handleUpdateSession({ action_items: activeOnly });
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--lui-background)]">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={32} />
          <p className="text-xs text-[var(--lui-muted)]">Loading audio notes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--lui-background)] p-4">
        <div className="p-6 rounded-xl border border-red-200 bg-red-50 text-center max-w-md">
          <p className="text-sm font-semibold text-red-600 mb-2">Failed to load notes</p>
          <p className="text-xs text-red-500 mb-4">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--lui-background)] text-[var(--lui-foreground)] font-sans antialiased">
      {/* Collapsible Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          setViewMode('note');
          setActiveTab('overview');
        }}
        onNewSession={() => {
          setViewMode('note');
          void handleNewSession();
        }}
        onDeleteSession={handleDeleteSession}
        onDuplicateSession={handleDuplicateSession}
        onToggleStar={handleToggleStar}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-[var(--lui-background)]">
        {/* Mobile Navigation Bar (< 768px) */}
        <div className="md:hidden flex items-center justify-between px-4 py-2.5 border-b border-[var(--lui-border)]/50 bg-[var(--lui-surface)] sticky top-0 z-20 select-none">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] transition-colors"
              aria-label="Open notes list"
            >
              <Menu size={18} />
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'note' ? 'weekly-summary' : 'note')}
              className="flex items-center gap-1.5 font-semibold text-xs text-[var(--lui-foreground)] hover:opacity-80"
            >
              {viewMode === 'weekly-summary' ? (
                <>
                  <CalendarDays size={15} className="text-[#FF4F18] shrink-0" />
                  <span>Weekly Summary</span>
                </>
              ) : (
                <>
                  <AudioLines size={15} className="text-[var(--lui-foreground)] shrink-0" />
                  <span>Audio Notes</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode(viewMode === 'note' ? 'weekly-summary' : 'note')}
              className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'weekly-summary'
                  ? 'bg-[#FF4F18]/15 text-[#FF4F18]'
                  : 'text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20'
              }`}
              title={viewMode === 'note' ? 'Switch to Weekly Summary' : 'Switch to Notes'}
            >
              {viewMode === 'note' ? <CalendarDays size={15} /> : <AudioLines size={15} />}
            </button>

            <button
              onClick={handleToggleTheme}
              className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors"
              title={themeMode === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
            >
              {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button
              onClick={() => {
                setViewMode('note');
                void handleNewSession();
              }}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-[#FF4F18] hover:bg-[#E64515] text-white shadow-xs transition-all active:scale-95"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>
        </div>

        {viewMode === 'weekly-summary' ? (
          <WeeklySummaryView
            sessions={sessions}
            onOpenSession={(id) => {
              setActiveSessionId(id);
              setViewMode('note');
              setActiveTab('overview');
            }}
            onUpdateSession={handleUpdateSpecificSession}
            onNewSession={() => {
              setViewMode('note');
              void handleNewSession();
            }}
          />
        ) : activeSession ? (
          <div key={activeSession.id} className="flex-1 flex flex-col h-full overflow-y-auto">
            <div className="max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl w-full mx-auto px-3.5 py-4 sm:px-6 sm:py-6 md:px-8 md:py-8 lg:px-12 lg:py-10 flex flex-col gap-6 lg:gap-8">
              {/* Header with Title, Controls, Tabs */}
              <SessionHeader
                session={activeSession}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onUpdateTitle={(title) => void handleUpdateSession({ title })}
                onUpdateCategory={(category) => void handleUpdateSession({ category })}
                onToggleStar={() => void handleToggleStar(activeSession)}
                onDuplicate={() => void handleDuplicateSession(activeSession)}
                onDelete={() => void handleDeleteSession(activeSession)}
                onUpdateSession={handleUpdateSession}
                themeMode={themeMode}
                onToggleTheme={handleToggleTheme}
                audioUrl={audioPlaybackUrl}
              />

              {/* Audio Playback Player (only rendered when audio file exists and is playable) */}
              {audioPlaybackUrl && (
                <AudioPlayer
                  audioUrl={audioPlaybackUrl}
                  duration={activeSession.duration}
                  title={activeSession.title}
                  onAudioError={() => handleAudioLoadError(activeSession.id)}
                />
              )}

              {/* Audio Recorder Controls - shown when no playable audio is present */}
              {!audioPlaybackUrl && (
                <AudioRecorder
                  onRecordingComplete={handleRecordingComplete}
                  onLiveTranscriptChange={(liveText) => {
                    if (activeSessionId) {
                      const detectedNames = extractNamesFromTranscript(liveText, activeSession?.attendees || '');
                      const updatedAttendees = detectedNames.length > 0 ? mergeAttendees(activeSession?.attendees || '', detectedNames) : (activeSession?.attendees || '');
                      void handleUpdateSession({
                        transcript: liveText,
                        ...(detectedNames.length > 0 ? { attendees: updatedAttendees } : {}),
                      });
                    }
                  }}
                />
              )}

              {/* Audio to Text Section (Shown directly in Overview and All tabs) */}
              {(activeTab === 'overview' || activeTab === 'all') && (
                <AudioToTextSection
                  session={activeSession}
                  audioUrl={audioPlaybackUrl ?? undefined}
                  duration={activeSession.duration}
                  onUpdateSession={handleUpdateSession}
                  onNavigateTab={setActiveTab}
                />
              )}

              {/* Tabbed Content Areas */}
              {activeTab === 'overview' && (
                <OverviewSection
                  session={activeSession}
                  onUpdateSession={handleUpdateSession}
                />
              )}

              {activeTab === 'summary' && (
                <SummarySection
                  session={activeSession}
                  onUpdateSession={handleUpdateSession}
                  onOpenWeeklySummary={() => setViewMode('weekly-summary')}
                />
              )}

              {activeTab === 'highlights' && (
                <HighlightsSection
                  session={activeSession}
                  onUpdateSession={handleUpdateSession}
                  onClearCompletedActions={handleClearCompletedActions}
                />
              )}

              {/* All-in-One unified document view */}
              {activeTab === 'all' && (
                <div className="flex flex-col gap-6">
                  <OverviewSection
                    session={activeSession}
                    onUpdateSession={handleUpdateSession}
                  />
                  <SummarySection
                    session={activeSession}
                    onUpdateSession={handleUpdateSession}
                    onOpenWeeklySummary={() => setViewMode('weekly-summary')}
                  />
                  <HighlightsSection
                    session={activeSession}
                    onUpdateSession={handleUpdateSession}
                    onClearCompletedActions={handleClearCompletedActions}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState onNewSession={handleNewSession} />
        )}
      </main>
    </div>
  );
}

