// Assistent – Oberfläche ohne Framework. Hier wird nur entschieden, welche Seite gezeigt wird.

import { h, api, go } from './js/ui.js';
import { renderDashboard, stopDashboard } from './js/dashboard.js';
import { renderSetup, renderSingleStep, renderConnections, renderSettings } from './js/setup.js';
import { renderPermissionsPage } from './js/permissions.js';

const root = document.getElementById('app');
let status = null;

const currentPath = () => (location.hash || '#/').slice(1) || '/';

window.addEventListener('hashchange', () => route());

async function route() {
  stopDashboard();
  try {
    status = await api('GET', '/api/status');
  } catch (err) {
    root.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Keine Verbindung'), h('p', {}, err.message), h('button', { class: 'btn', type: 'button', onclick: () => route() }, 'Nochmal versuchen'))));
    return;
  }
  // In der Mac-App ist man ohne Passwort angemeldet
  if (status.needsPassword && !status.loggedIn) return renderCreatePassword();
  if (!status.loggedIn) return renderLogin();
  const path = currentPath();
  if (!status.setupDone && !path.startsWith('/einrichtung')) return go('/einrichtung/willkommen');
  if (path.startsWith('/einrichtung')) return renderSetup(path.split('/')[2] || 'willkommen');
  if (path.startsWith('/verbindungen/')) return renderSingleStep(path.split('/')[2]);
  if (path === '/verbindungen') return renderConnections();
  if (path === '/einstellungen') return renderSettings();
  if (path === '/berechtigungen') return renderPermissionsPage();
  return renderDashboard();
}

const wordmark = () => h('span', { class: 'wordmark' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Assistent');

function renderCreatePassword() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'new-password', minlength: '8', required: true });
  const pw2 = h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password', required: true });
  const codeInput = h('input', { type: 'text', id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true });
  const err = h('p', { class: 'error-line', role: 'alert' });
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw.value !== pw2.value) {
      err.textContent = 'Die beiden Passwörter sind nicht gleich.';
      return;
    }
    try {
      await api('POST', '/api/setup/password', { password: pw.value, code: codeInput.value });
      go('/einrichtung/willkommen');
    } catch (ex) {
      err.textContent = ex.message;
    }
  } },
  wordmark(),
  h('h1', {}, 'Leg ein Passwort fest'),
  h('p', {}, 'Damit nur du an deine Termine, Mails und To-dos kommst. Du brauchst es, wenn du das Dashboard auf einem anderen Gerät öffnest.'),
  status.needsCode && h('div', { class: 'field' }, h('label', { for: 'code' }, 'Einrichtungscode'), codeInput, h('span', { class: 'hint' }, 'Steht im Fenster, in dem der Assistent auf deinem Mac läuft.')),
  h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Passwort'), pw, h('span', { class: 'hint' }, 'Mindestens 8 Zeichen.')),
  h('div', { class: 'field' }, h('label', { for: 'pw2' }, 'Passwort wiederholen'), pw2),
  err,
  h('button', { class: 'btn', type: 'submit' }, 'Passwort festlegen'));
  root.replaceChildren(h('main', { class: 'auth' }, form));
  (status.needsCode ? codeInput : pw).focus();
}

function renderLogin() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error-line', role: 'alert' });
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('POST', '/api/login', { password: pw.value });
      route();
    } catch (ex) {
      err.textContent = ex.message;
      pw.select();
    }
  } },
  wordmark(),
  h('h1', {}, 'Anmelden'),
  h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Passwort'), pw),
  err,
  h('button', { class: 'btn', type: 'submit' }, 'Anmelden'));
  root.replaceChildren(h('main', { class: 'auth' }, form));
  pw.focus();
}

route();
