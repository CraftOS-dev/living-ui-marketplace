/**
 * App entry for the V2 platform.
 *
 * This bootstraps the ORIGINAL V1 trading-view frontend unchanged — same
 * components, same "CraftBot Browser Interface" design system, same
 * behavior. The only adaptation to the V2 (PocketBase) platform is a
 * client-side API adapter (./services/apiAdapter) that translates the V1
 * REST calls the components make into the V2 backend (live Yahoo ops +
 * PocketBase collections). Nothing about the look or interactions changes.
 *
 * NOTE: the adapter import is FIRST on purpose — it sets
 * window.__CRAFTBOT_BACKEND_URL__ to a sentinel host at module-eval time,
 * before the component modules (which read that global at their own top
 * level) are evaluated.
 */
import { installApiAdapter } from './services/apiAdapter';
import { useEffect } from 'react';
import { MainView } from './components/MainView';
import { AppController } from './AppController';
import { uiCapture } from './services/UICapture';
import './styles/global.css';
import './styles/theme-bridge.css';

// Patch fetch before any component effect can fire a request.
installApiAdapter();

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
    </div>
  );
}
