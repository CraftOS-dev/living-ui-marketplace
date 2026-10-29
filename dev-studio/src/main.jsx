/**
 * The View entry (AGENT-OWNED — edit freely to change the human UI).
 *
 * A React SPA over the same records API the agent uses. Same-origin writes are
 * trusted by the adapter's origin rule, so the browser needs no token. A human
 * edits here; an agent operates the same data through A2App — both see each
 * other's changes on the next read.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./toast.jsx";
// Importing the bridge starts the system-owned update watcher (see updater.js).
import "./updater.js";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
