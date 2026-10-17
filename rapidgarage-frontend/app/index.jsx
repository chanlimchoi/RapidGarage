import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';
import * as pwa from './pwa/pwa';
import * as i18n from './i18n';

// Production builds register the service worker (app shell only; see pwa/).
pwa.init({ register: import.meta.env.PROD });

// Pick the language (saved choice, else the browser's) before the first render
// so the page never flashes English first.
i18n.init().then(() => {
  ReactDOM.render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
    document.getElementById('root')
  );
});
