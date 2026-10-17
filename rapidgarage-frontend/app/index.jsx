import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';
import * as pwa from './pwa/pwa';

// Production builds register the service worker (app shell only; see pwa/).
pwa.init({ register: import.meta.env.PROD });

ReactDOM.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);
