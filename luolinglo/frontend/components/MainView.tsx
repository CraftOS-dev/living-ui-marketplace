import { useState, useEffect, useCallback } from 'react'
import type { AppController, LuolingloState } from '../AppController'
import type { ViewName } from '../types'
import { AppLayout } from './layout/AppLayout'
import { SetupWizard } from './setup/SetupWizard'
import { LoadingView } from './shared/LoadingView'
import { DashboardView } from './dashboard/DashboardView'
import { FlashcardsView } from './flashcards/FlashcardsView'
import { VocabularyView } from './vocabulary/VocabularyView'
import { QuizView } from './quiz/QuizView'
import { AITeacherView } from './chat/AITeacherView'
import { ProgressView } from './progress/ProgressView'
import { SettingsView } from './settings/SettingsView'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<LuolingloState>(controller.getState())

  useEffect(() => {
    const unsubscribe = controller.subscribe((newState) => {
      setState(newState)
    })
    return unsubscribe
  }, [controller])

  const handleNavigate = useCallback(
    (view: ViewName) => {
      controller.setActiveView(view)
    },
    [controller]
  )

  const handleSetupSubmit = useCallback(
    async (data: {
      nativeLanguage: string
      targetLanguage: string
      proficiencyLevel: string
      displayName?: string
    }) => {
      try {
        await controller.createProfile(data)
      } catch (err) {
        console.error('[MainView] Failed to create profile:', err)
      }
    },
    [controller]
  )

  if (state.loading || state.profileLoading) {
    return <LoadingView message="Starting Luolinglo..." />
  }

  if (!state.profile) {
    return <SetupWizard onSubmit={handleSetupSubmit} />
  }

  const renderActiveView = () => {
    switch (state.activeView) {
      case 'dashboard':
        return <DashboardView onNavigate={handleNavigate} />
      case 'flashcards':
        return <FlashcardsView />
      case 'vocabulary':
        return <VocabularyView />
      case 'quizzes':
        return <QuizView />
      case 'ai-teacher':
        return <AITeacherView />
      case 'progress':
        return <ProgressView />
      case 'settings':
        return <SettingsView />
      default:
        return <DashboardView onNavigate={handleNavigate} />
    }
  }

  return (
    <AppLayout
      activeView={state.activeView}
      onNavigate={handleNavigate}
      profile={state.profile}
      dashboard={state.dashboard}
    >
      {renderActiveView()}
    </AppLayout>
  )
}
