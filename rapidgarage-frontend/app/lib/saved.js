// Saved-sales store shared by every star button: which post ids the
// logged-in user has saved. App calls setUser() whenever /me changes.
import { apiFetch, errorMessage, setSavedReminder } from '../api';
import toast, { dismiss } from '../components/toast';
import { t } from '../i18n';

let user;          // undefined until App knows; null when logged out
let ids = new Set();
let reminders = new Set(); // saved ids with a morning-of reminder on
const pending = new Set();
let version = 0;
let lastToast = null; // one confirmation at a time, however fast people star   // bumped by every local change, so a slower refresh can't undo it
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentUser() { return user; }
export function isSaved(id) { return ids.has(id); }
export function isPending(id) { return pending.has(id); }
export function isReminding(id) { return ids.has(id) && reminders.has(id); }

export function refresh() {
  if (!user) return Promise.resolve();
  const forUser = user.id;
  const v = version;
  return apiFetch('/saved/ids').then(({ ok, data }) => {
    if (!ok || !data || !user || user.id !== forUser || v !== version) return;
    ids = new Set(data.ids || []);
    reminders = new Set(data.reminders || []);
    emit();
  }).catch(() => {});
}

export function setUser(next) {
  const was = user === undefined ? undefined : (user ? user.id : null);
  const now = next ? next.id : null;
  user = next || null;
  if (was === now) return;
  ids = new Set();
  reminders = new Set();
  version += 1;
  emit();
  refresh();
}

// Forget a post locally (e.g. after the Saved page learns it's gone).
export function forget(id) {
  version += 1;
  if (ids.delete(id)) emit();
}

// Optimistic toggle. Resolves to the new saved state (or the old one on failure).
export function toggle(post) {
  const id = post.id;
  if (pending.has(id)) return Promise.resolve(ids.has(id));
  const want = !ids.has(id);
  pending.add(id);
  version += 1;
  if (want) ids.add(id); else { ids.delete(id); reminders.delete(id); }
  emit();
  return apiFetch('/saved/' + id, { method: want ? 'PUT' : 'DELETE' })
    .then(({ ok, data }) => {
      if (!ok) throw new Error(errorMessage(data, want ? t('saved.saveFailed') : t('saved.removeFailed')));
      if (want && data && data.remind) reminders.add(id);
      if (lastToast) dismiss(lastToast);
      lastToast = toast.success(want ? (data && data.remind ? t('rem.savedWithReminder') : t('saved.savedToast')) : t('saved.removedToast'));
      return want;
    })
    .catch((err) => {
      if (want) ids.delete(id); else ids.add(id);
      toast.error(err.message && err.message !== 'Failed to fetch' ? err.message : t('common.networkProblem'));
      return !want;
    })
    .then((state) => { pending.delete(id); emit(); return state; });
}

// Morning-of reminder for one sale. Turning it on also saves the sale.
export function setReminder(post, on) {
  const id = post.id;
  if (pending.has(id)) return Promise.resolve(isReminding(id));
  const was = { saved: ids.has(id), remind: reminders.has(id) };
  pending.add(id);
  version += 1;
  if (on) { ids.add(id); reminders.add(id); } else reminders.delete(id);
  emit();
  return setSavedReminder(id, on)
    .then(({ ok, data }) => {
      if (!ok) throw new Error(errorMessage(data, t('rem.failed')));
      if (lastToast) dismiss(lastToast);
      lastToast = toast.success(on ? t('rem.onToast') : t('rem.offToast'));
      return on;
    })
    .catch((err) => {
      if (was.saved) ids.add(id); else ids.delete(id);
      if (was.remind) reminders.add(id); else reminders.delete(id);
      toast.error(err.message && err.message !== 'Failed to fetch' ? err.message : t('common.networkProblem'));
      return was.remind;
    })
    .then((state) => { pending.delete(id); emit(); return state; });
}
