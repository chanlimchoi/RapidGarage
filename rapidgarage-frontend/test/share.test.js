// node --test: share links.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shareUrl, quickLinks, canShare } from '../app/lib/share.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const days = (endsAt) => ({ schedule: { days: [{ date: '2026-10-18', startsAt: '2026-10-18T12:00:00Z', endsAt }] } });

describe('share links', () => {
  test('canonical path per kind; ?lang= only outside English', () => {
    assert.equal(shareUrl('https://rg.example/', 'post', 7, 'en'), 'https://rg.example/post/7');
    assert.equal(shareUrl('https://rg.example', 'event', 3, 'ko'), 'https://rg.example/events/3?lang=ko');
    assert.equal(shareUrl('https://rg.example', 'wanted', 9, 'zh-CN'), 'https://rg.example/wanted/9?lang=zh-CN');
  });
  test('Facebook, WhatsApp and X links, encoded', () => {
    const q = quickLinks('https://rg.example/post/7?lang=ko', 'Moving sale & more');
    assert.equal(new URL(q.facebook).searchParams.get('u'), 'https://rg.example/post/7?lang=ko');
    assert.equal(new URL(q.whatsapp).searchParams.get('text'), 'Moving sale & more https://rg.example/post/7?lang=ko');
    const x = new URL(q.x);
    assert.equal(x.host, 'x.com');
    assert.equal(x.searchParams.get('text'), 'Moving sale & more');
    assert.equal(x.searchParams.get('url'), 'https://rg.example/post/7?lang=ko');
  });
  test('only public, current items are shareable', () => {
    assert.equal(canShare('post', Object.assign({ hidden: false }, days('2026-10-18T20:00:00Z')), NOW), true);
    assert.equal(canShare('post', Object.assign({ hidden: true }, days('2026-10-18T20:00:00Z')), NOW), false);
    assert.equal(canShare('post', days('2026-10-16T20:00:00Z'), NOW), false);
    assert.equal(canShare('post', Object.assign({ curbside: { state: 'active' } }, days('2026-10-16T20:00:00Z')), NOW), true);
    assert.equal(canShare('post', { title: 'no dates' }, NOW), true);
    assert.equal(canShare('event', { ended: true }, NOW), false);
    assert.equal(canShare('wanted', { status: 'expired' }, NOW), false);
    assert.equal(canShare('wanted', { status: 'active' }, NOW), true);
  });
});

import { isPage, inject } from '../share/vite-plugin.js';
describe('vite preview link-preview plugin', () => {
  const req = (url, accept, method) => ({ url, method: method || 'GET', headers: { accept: accept || 'text/html,application/xhtml+xml' } });
  test('only page navigations are handled', () => {
    assert.equal(isPage(req('/post/7?lang=ko')), true);
    assert.equal(isPage(req('/')), true);
    assert.equal(isPage(req('/post/7', '*/*')), true); // crawlers
    for (const u of ['/api/post/7', '/s/AbC123', '/assets/a.js', '/sw.js', '/@vite/client', '/manifest.webmanifest']) assert.equal(isPage(req(u)), false, u);
    assert.equal(isPage(req('/post/7', 'application/json')), false);
    assert.equal(isPage(req('/post/7', undefined, 'POST')), false);
  });
  test('replaces the static block and the page language; leaves HTML alone without an answer', () => {
    const html = '<html lang="en"><head><!-- rg:head --><title>x</title><!-- /rg:head --></head></html>';
    const out = inject(html, { lang: 'ko', head: '<title>세일</title><meta property="og:title" content="세일">' });
    assert.match(out, /<html lang="ko">/);
    assert.match(out, /<!-- rg:head -->\s*<title>세일<\/title><meta property="og:title" content="세일">\s*<!-- \/rg:head -->/);
    assert.ok(!/<title>x<\/title>/.test(out));
    assert.equal(inject(html, null), html);
    assert.match(inject('<html><head></head></html>', { head: '<title>t</title>' }), /<title>t<\/title>\n  <\/head>/);
  });
});
