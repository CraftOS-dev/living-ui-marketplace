import React, { useEffect, useRef } from 'react';
import { ResumeProvider } from './context/ResumeContext';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { EditorPanel } from './components/EditorPanel';
import { ResumeCanvas } from './components/Preview/ResumeCanvas';
import { applyThemeToDocument, DEFAULT_CUSTOM_COLORS, type CustomColors, type ThemeId } from './theme/themes';
import './styles/index.css';
import './styles/print.css';

export function App() {
  const themeIdRef = useRef<ThemeId>('craftbot');
  const modeRef = useRef<'dark' | 'light'>('dark');
  const customColorsRef = useRef<CustomColors>({ ...DEFAULT_CUSTOM_COLORS });

  useEffect(() => {
    // Initial theme application
    applyThemeToDocument(themeIdRef.current, modeRef.current, customColorsRef.current);

    // Listen for theme messages from CraftBot shell
    const onMessage = (e: MessageEvent) => {
      if (!e.data) return;

      if (
        e.data.type === 'craftbot-theme' ||
        e.data.type === 'livingui-theme' ||
        e.data.type === 'theme-change' ||
        e.data.type === 'set-theme'
      ) {
        const isLight =
          e.data.theme === 'light' ||
          e.data.mode === 'light' ||
          e.data.themeMode === 'light' ||
          e.data.isDark === false ||
          e.data.dark === false;

        const mode: 'dark' | 'light' = isLight ? 'light' : 'dark';
        modeRef.current = mode;

        if (e.data.themeId) {
          themeIdRef.current = e.data.themeId as ThemeId;
        }
        if (e.data.customColors) {
          customColorsRef.current = e.data.customColors as CustomColors;
        }

        applyThemeToDocument(themeIdRef.current, mode, customColorsRef.current);
      }
    };

    window.addEventListener('message', onMessage);

    // Post theme request to CraftBot shell on mount
    try {
      window.parent.postMessage({ type: 'craftbot-theme-request' }, '*');
    } catch {}

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return (
    <ResumeProvider>
      <div className="app-container">
        <Header />
        <Toolbar />
        <main className="main-workspace">
          <EditorPanel />
          <ResumeCanvas />
        </main>
      </div>
    </ResumeProvider>
  );
}

export default App;
