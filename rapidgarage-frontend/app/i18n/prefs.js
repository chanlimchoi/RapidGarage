import { setLocale } from './index';
import { apiFetch } from '../api';

// The user picked a language: switch now, remember it on this device, and
// (when logged in) save it to the account so emails and other devices use it.
export function chooseLocale(code, user) {
  return setLocale(code).then((c) => {
    if (user) apiFetch('/me/locale', { method: 'PUT', body: JSON.stringify({ locale: c }) }).catch(() => null);
    return c;
  });
}
