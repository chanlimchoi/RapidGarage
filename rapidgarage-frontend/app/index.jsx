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

// Opt into the v7 behaviors early so the two dev-console "future flag" notices
// are gone and v6 already behaves like v7:
//  - v7_startTransition wraps route state updates in React.startTransition, so
//    navigation on React 19 is interruptible instead of blocking.
//  - v7_relativeSplatPath changes relative resolution inside `path="*"` routes.
//    The only splat here is the NotFound catch-all, which has no children and
//    no relative links, so this is a no-op that just future-proofs the tree.
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

// StrictMode double-invokes renders and mount/unmount in development only (it is
// a no-op in production builds). That is how the app's timers and
// add/removeEventListener pairs in App, NavBar, Messages and ui.jsx Dialog are
// kept honest -- a setup that is not matched by a teardown shows up here as a
// duplicated interval or listener. Kept dev-only so production is byte-identical.
function Root() {
  const tree = (
    <ErrorBoundary>
      <BrowserRouter future={ROUTER_FUTURE}>
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
