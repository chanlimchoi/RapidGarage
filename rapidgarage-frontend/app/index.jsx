import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import * as pwa from './pwa/pwa';
import * as i18n from './i18n';

// Production builds register the service worker (app shell only; see pwa/).
pwa.init({ register: import.meta.env.PROD });

// StrictMode double-invokes renders and mount/unmount in development only (it is
// a no-op in production builds). That is how the app's timers and
// add/removeEventListener pairs in App, NavBar, Messages and ui.jsx Dialog are
// kept honest -- a setup that is not matched by a teardown shows up here as a
// duplicated interval or listener. Kept dev-only so production is byte-identical.
function Root() {
  const tree = (
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  );
  return import.meta.env.DEV ? <StrictMode>{tree}</StrictMode> : tree;
}

// Pick the language (saved choice, else the browser's) before the first render
// so the page never flashes English first.
i18n.init().then(() => {
  createRoot(document.getElementById('root')).render(<Root />);
});
