/**
 * App entry for the V2 platform.
 *
 * Bootstraps the ORIGINAL V1 habit-tracker frontend unchanged — same
 * components, same "CraftBot Browser Interface" design system, same
 * behavior. The only adaptation to the V2 (PocketBase) platform is a
 * client-side API adapter (./services/apiAdapter) that translates the V1
 * REST calls the components make into the V2 backend (PocketBase
 * collections + ops). Nothing about the look or interactions changes.
 *
 * The adapter import is FIRST on purpose — it sets
 * window.__CRAFTBOT_BACKEND_URL__ to a sentinel host at module-eval time,
 * before the component modules (which read that global at their own top
 * level) are evaluated.
 */
import { installApiAdapter } from './services/apiAdapter';
import { useEffect } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MainView } from './components/MainView';
import { AppController } from './AppController';
import { uiCapture } from './services/UICapture';
import './styles/global.css';
import './styles/theme-bridge.css';

// Patch fetch before any component effect can fire a request.
installApiAdapter();

// Preserve V1 main.tsx behavior: point instrumentation at the (sentinel)
// backend with auto-capture; the adapter neutralizes those calls.
const backendUrl =
  ((window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ ?? '') +
  '/api';
uiCapture.initialize(backendUrl, true, 2000);

// Initialize the controller (module singleton, exactly as in V1).
const controller = new AppController();

export function App(): React.JSX.Element {
  useEffect(() => {
    controller.initialize();

    uiCapture.registerComponent('App', {
      initialized: true,
      componentName: 'App',
    });

    return () => {
      controller.cleanup();
      uiCapture.unregisterComponent('App');
    };
  }, []);

  return (
    <div className="app">
      <MainView controller={controller} />
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="colored"
      />
    </div>
  );
}
