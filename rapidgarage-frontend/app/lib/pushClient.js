// Browser side of push notifications: subscribe this device with the
// server's VAPID public key, or unsubscribe it. Needs the service worker
// (production build); on iPhone/iPad only after "Add to Home Screen".
import { apiFetch } from '../api';

export const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw Object.assign(new Error('no service worker'), { code: 'no_worker' });
  return reg;
}

export async function current() {
  if (!supported()) return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch (e) { return null; }
}

function label() {
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? browser + ' on ' + os : browser;
}

// Resolves to { ok, data } (server answer) or rejects with code
// 'denied' | 'no_worker' | 'unsupported'.
export async function enable(publicKey) {
  if (!supported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' });
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  return apiFetch('/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: label() }) });
}

export async function disable() {
  const sub = await current();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => null);
  return apiFetch('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
}
