import { useState, useEffect } from 'react'
import { useAgentAware } from '../agent/hooks'
import type { AppController } from '../AppController'
import type { AppState } from '../types'
import { Sidebar } from './Sidebar'
import { ComposerView } from './ComposerView'
import { CalendarView } from './CalendarView'
import { QueueView } from './QueueView'
import { AnalyticsView } from './AnalyticsView'
import HookCreatorView from './HookCreatorView'
import TextHumanizerView from './TextHumanizerView'
import CommentInsightsView from './CommentInsightsView'

interface MainViewProps {
  controller: AppController
}

export function MainView({ controller }: MainViewProps) {
  const [state, setState] = useState<AppState>(controller.getState())

  useEffect(() => {
    const unsub = controller.subscribe(setState)
    return unsub
  }, [controller])

  useAgentAware('MainView', { currentSection: state.activeSection })

  const { activeSection } = state

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar controller={controller} state={state} />
      <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {activeSection === 'composer' && <ComposerView controller={controller} state={state} />}
        {activeSection === 'calendar' && <CalendarView controller={controller} state={state} />}
        {activeSection === 'queue' && <QueueView controller={controller} state={state} />}
        {activeSection === 'analytics' && <AnalyticsView controller={controller} state={state} />}
        {activeSection === 'hooks' && <HookCreatorView controller={controller} state={state} />}
        {activeSection === 'humanizer' && <TextHumanizerView controller={controller} state={state} />}
        {activeSection === 'insights' && <CommentInsightsView controller={controller} state={state} />}
      </main>
    </div>
  )
}
