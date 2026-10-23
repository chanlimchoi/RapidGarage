#!/usr/bin/env node
// Accessibility scan: axe-core (WCAG 2.0/2.1/2.2 A + AA) on every main page and
// state, at desktop and phone widths, logged in and out, in English and Korean.
// Also checks html[lang], horizontal overflow (reflow) and dark-theme contrast.
//
//   npm run dev                       # app on http://localhost:3000, API behind /api
//   npm run test:a11y                 # scan; exits 1 on serious/critical issues
//
// It creates its own test accounts and sales through the API, so point it at a
// local or throwaway server, never production. Environment:
//   A11Y_BASE            app URL (default http://localhost:3000)
//   A11Y_ADMIN_EMAIL / A11Y_ADMIN_PASSWORD   an admin account, to scan /admin (optional)
//   A11Y_ALLOW_REMOTE=1  allow a non-localhost A11Y_BASE (disposable test servers only)
//   A11Y_LOCALES         default "en,ko"     A11Y_VIEWPORTS  default "desktop,mobile"
//   A11Y_ONLY            regex on state names, e.g. "messages|admin"
//   A11Y_FAIL_ON         impacts that fail the run (default "serious,critical")
//   A11Y_REPORT          JSON report path (default a11y-report.json)
//   A11Y_SHOTS           folder for a screenshot of every state (optional)
//   A11Y_REFLOW=0        skip the 320px / 640px reflow pass (400% / 200% zoom of 1280px)
//   A11Y_KEYBOARD=0      skip the keyboard checks (skip link, menus, dialogs, focus)
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const B = (process.env.A11Y_BASE || 'http://localhost:3000').replace(/\/$/, '');
// It writes data (users, sales, messages): refuse anything that isn't local
// unless explicitly allowed, so it can't be pointed at production by mistake.
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(B) && process.env.A11Y_ALLOW_REMOTE !== '1') {
  console.error('A11Y_BASE ' + B + ' is not a local URL. The scan creates accounts and sales; set A11Y_ALLOW_REMOTE=1 only for a disposable test server.');
  process.exit(2);
}
const LOCALES = (process.env.A11Y_LOCALES || 'en,ko').split(',');
const VIEWPORTS = (process.env.A11Y_VIEWPORTS || 'desktop,mobile').split(',');
const ONLY = process.env.A11Y_ONLY ? new RegExp(process.env.A11Y_ONLY) : null;
const FAIL_ON = (process.env.A11Y_FAIL_ON || 'serious,critical').split(',');
const REPORT = process.env.A11Y_REPORT || 'a11y-report.json';
const SHOTS = process.env.A11Y_SHOTS || '';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const SIZES = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 }, zoom200: { width: 640, height: 450 }, zoom400: { width: 320, height: 640 } };
const RUN = Date.now().toString(36);
const PASSWORD = 'a11y-scan-pass-123';

// A small solid-color PNG, so the scan needs no image files.
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function api(ctx, method, url, data, multipart) {
  const r = await ctx.request.fetch(B + '/api' + url, multipart ? { method, multipart } : { method, data });
  const body = await r.text();
  if (r.status() >= 400) throw new Error(method + ' ' + url + ' -> ' + r.status() + ' ' + body.slice(0, 200));
  try { return JSON.parse(body); } catch (e) { return body; }
}

// ---- Test data ---------------------------------------------------------------
async function seed(browser) {
  const ctx = await browser.newContext();
  const user = async (first, last) => {
    const c = await browser.newContext();
    const email = `${first.toLowerCase()}.${RUN}@a11y.example`;
    await api(c, 'POST', '/signup', { email, password: PASSWORD, firstName: first, lastName: last });
    await c.close();
    return { email, password: PASSWORD };
  };
  const seller = await user('Sam', 'Seller');
  const buyer = await user('Bea', 'Buyer');
  const s = await login(browser, seller);
  const b = await login(browser, buyer);
  const post = await api(s, 'POST', '/post', {
    title: 'Moving sale: furniture, books & bikes', street: '12 Hicks St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
    description: 'Couch, bookcases, a blue road bike and kids books. Cash or a payment app.', priceMin: 2, priceMax: 150,
    schedule: { timeZone: 'America/New_York', days: [{ date: day(2), start: '09:00', end: '15:00' }, { date: day(3), start: '10:00', end: '14:00' }] },
  });
  await api(s, 'POST', '/post/' + post.id + '/photos', null, { photos: { name: 'couch.png', mimeType: 'image/png', buffer: png(64, 48, [46, 110, 90]) } });
  const item = await api(s, 'POST', '/post/' + post.id + '/items', { name: 'Blue road bike', price: '120' });
  await api(s, 'POST', '/post/' + post.id + '/items', { name: 'Bookcase', price: '40' });
  const event = await api(s, 'POST', '/events', { name: 'Brooklyn Heights block sale', description: 'Twenty-plus stoops on Hicks and Henry.', areaLabel: 'Brooklyn Heights 11201',
    lat: 40.6939, lng: -73.9897, radiusMiles: 1, joinMode: 'open', schedule: { timeZone: 'America/New_York', days: [{ date: day(2), start: '08:00', end: '15:00' }] } });
  await api(s, 'POST', '/events/' + event.id + '/join', { postId: post.id }).catch(() => {});
  const wanted = await api(b, 'POST', '/wanted', { title: 'Toddler car seat', keywords: 'car seat', category: 'kids', maxPriceCents: 5000, areaLabel: 'Brooklyn Heights', lat: 40.694, lng: -73.99, radiusMiles: 3, emailEnabled: false });
  await api(b, 'PUT', '/saved/' + post.id);
  const conv = await api(b, 'POST', '/conversations', { postId: post.id });
  await api(b, 'POST', '/conversations/' + conv.id + '/messages', { body: 'Hi! Is the bike still available? I could come by on Saturday morning.' });
  await api(s, 'POST', '/conversations/' + conv.id + '/messages', { body: 'Yes, it is. Saturday works.' });
  await api(b, 'POST', '/conversations/' + conv.id + '/holds', { itemId: (item.id || (item.item && item.item.id)), pickupAt: new Date(Date.now() + 2 * 864e5 + 3600e3).toISOString() }).catch((e) => console.warn('hold:', e.message));
  await api(b, 'POST', '/conversations/' + conv.id + '/meetups', { place: { name: 'Brooklyn Heights Library', address: '286 Cadman Plaza W' }, meetAt: new Date(Date.now() + 2 * 864e5).toISOString(), note: 'By the front desk.' }).catch((e) => console.warn('meetup:', e.message));
  const me = await api(s, 'GET', '/me');
  const sellerId = (me.user || me).id;
  await Promise.all([s.close(), b.close(), ctx.close()]);
  return { seller, buyer, post: post.id, event: event.id, wanted: wanted.id, conv: conv.id, sellerId };
}

async function login(browser, who, opts) {
  const ctx = await browser.newContext(opts);
  await api(ctx, 'POST', '/login', { email: who.email, password: who.password });
  return ctx;
}

// ---- Pages and states ----------------------------------------------------------
// who: 'out' (logged out), 'any' (both), or seller / buyer / admin.
const click = (sel) => async (p) => { await p.locator(sel).first().click(); };
function states(d) {
  return [
    { name: 'home', path: '/', who: 'any' },
    { name: 'home-map', path: '/', who: 'any', act: async (p) => { // phones: switch to the map; wider screens show it beside the list
      const b = p.locator('.view-toggle button:nth-child(2)'); if (await b.isVisible()) await b.click();
    }, waitAfter: '.rg-map-fallback, .map-box' },
    { name: 'post', path: '/post/' + d.post, who: 'any' },
    { name: 'post-share-menu', path: '/post/' + d.post, who: 'buyer', act: click('.share-btn') },
    { name: 'event', path: '/events/' + d.event, who: 'any' },
    { name: 'events', path: '/events', who: 'any' },
    { name: 'wanted', path: '/wanted', who: 'any' },
    { name: 'wanted-post', path: '/wanted/' + d.wanted, who: 'any' },
    { name: 'person', path: '/people/' + d.sellerId, who: 'any' },
    { name: 'safety', path: '/safety', who: 'any' },
    { name: 'about', path: '/about', who: 'out' },
    { name: 'not-found', path: '/no-such-page', who: 'any' },
    { name: 'unsubscribe', path: '/alerts/unsubscribe?a=1&t=not-a-real-token', who: 'out' },
    { name: 'login', path: '/login', who: 'out' },
    { name: 'login-errors', path: '/login', who: 'out', act: async (p) => { await p.locator('form button[type=submit]').first().click(); } },
    { name: 'signup', path: '/signup', who: 'out' },
    { name: 'signup-errors', path: '/signup', who: 'out', act: async (p) => { await p.locator('form button[type=submit]').first().click(); } },
    { name: 'mobile-nav', path: '/', who: 'any', mobileOnly: true, act: click('.nav-toggle') },
    { name: 'user-menu', path: '/', who: 'buyer', act: click('.menu-trigger') },
    { name: 'newpost', path: '/newpost', who: 'seller' },
    { name: 'newpost-photos', path: '/newpost', who: 'seller', act: async (p) => { await p.locator('input[type=file]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png(64, 48, [200, 120, 60]) }); await p.waitForTimeout(300); } },
    { name: 'newpost-errors', path: '/newpost', who: 'seller', act: async (p) => { await p.locator('form button[type=submit]').last().click(); } },
    { name: 'edit-post', path: '/post/' + d.post + '/edit', who: 'seller' },
    { name: 'items', path: '/post/' + d.post + '/items', who: 'seller' },
    { name: 'event-new', path: '/events/new', who: 'seller' },
    { name: 'wanted-new', path: '/wanted/new', who: 'buyer' },
    { name: 'saved-route', path: '/saved', who: 'buyer' },
    { name: 'inbox', path: '/messages', who: 'buyer' },
    { name: 'conversation', path: '/messages/' + d.conv, who: 'buyer', wait: '.composer, .thread-log' },
    { name: 'conversation-seller', path: '/messages/' + d.conv, who: 'seller', wait: '.composer, .thread-log' },
    { name: 'conversation-menu', path: '/messages/' + d.conv, who: 'buyer', wait: '.thread-menu', act: click('.thread-menu > button') },
    { name: 'report-dialog', path: '/messages/' + d.conv, who: 'buyer', wait: '.thread-menu', act: async (p) => { await p.locator('.thread-menu > button').click(); await p.locator('.thread-menu [role=menuitem]').last().click(); }, waitAfter: '.dialog' },
    { name: 'meetup-dialog', path: '/messages/' + d.conv, who: 'seller', wait: '.composer-tools', act: async (p) => {
      const btn = p.locator('.meet-card .btn-secondary').first(); // "Suggest another" on the pending suggestion
      if (await btn.count()) await btn.click(); else await p.locator('.meet-suggest').click();
    }, waitAfter: '.dialog .meet-choice, .dialog .meet-other' },
    { name: 'hold-form', path: '/messages/' + d.conv, who: 'buyer', wait: '.hold-panel', act: click('.hold-panel .btn-secondary') },
    { name: 'send-nudge', path: '/messages/' + d.conv, who: 'buyer', wait: '#composer-input', act: async (p) => { await p.fill('#composer-input', 'Text me at 718 555 0142'); await p.press('#composer-input', 'Enter'); }, waitAfter: '.send-nudge' },
    { name: 'post-print', path: '/post/' + d.post + '/print', who: 'seller' },
    { name: 'event-print', path: '/events/' + d.event + '/print', who: 'seller' },
    { name: 'calendar-menu', path: '/post/' + d.post, who: 'buyer', act: click('.cal-menu-btn') },
    { name: 'dashboard', path: '/dashboard', who: 'seller' },
    { name: 'dashboard-sale', path: '/dashboard/sales/' + d.post, who: 'seller' },
    { name: 'profile', path: '/profile', who: 'seller' },
    { name: 'settings', path: '/settings', who: 'buyer' },
    { name: 'admin-reports', path: '/admin', who: 'admin' },
    { name: 'admin-conversation-reports', path: '/admin', who: 'admin', act: click('.report-kind > button:nth-child(2)') },
    { name: 'admin-spots', path: '/admin', who: 'admin', act: click('.admin-tabs:not(.report-kind) > button:nth-child(2)') },
    { name: 'admin-spot-form', path: '/admin', who: 'admin', act: async (p) => { await p.locator('.admin-tabs:not(.report-kind) > button:nth-child(2)').click(); await p.locator('.rg-admin-spots .btn-primary').first().click(); } },
    // Tabs: reports, spots, analytics, users, settings.
    { name: 'admin-analytics', path: '/admin', who: 'admin', act: click('.admin-tabs:not(.report-kind) > button:nth-child(3)'), waitAfter: '#an-cities, .rg-analytics, [aria-labelledby="an-cities"]' },
    { name: 'admin-users', path: '/admin', who: 'admin', act: click('.admin-tabs:not(.report-kind) > button:nth-child(4)') },
    { name: 'admin-settings', path: '/admin', who: 'admin', act: click('.admin-tabs:not(.report-kind) > button:nth-child(5)') },
  ];
}

// ---- Checks --------------------------------------------------------------------
async function scan(page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 3).join(' ') })) }));
  }, TAGS);
}
async function extra(page, locale) {
  return page.evaluate((loc) => {
    const out = [];
    if (document.querySelector('vite-error-overlay') || !document.getElementById('main')) out.push({ id: 'rg-app-error', impact: 'critical', help: 'The app did not render (build error or crash)', nodes: [{ target: 'body' }] });
    const lang = document.documentElement.lang;
    if (lang !== loc) out.push({ id: 'rg-html-lang', impact: 'serious', help: 'html[lang] should be ' + loc + ', is "' + lang + '"', nodes: [{ target: 'html' }] });
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (over > 1) out.push({ id: 'rg-reflow', impact: 'serious', help: 'Page scrolls sideways by ' + over + 'px (WCAG 1.4.10 reflow)', nodes: [{ target: 'html' }] });
    if (!document.querySelector('a.skip-link[href="#main"]') || !document.getElementById('main')) out.push({ id: 'rg-skip-link', impact: 'moderate', help: 'Skip link and #main target', nodes: [{ target: 'body' }] });
    return out;
  }, locale);
}

const results = [];

// ---- Keyboard checks -------------------------------------------------------------
// Things axe can't see: where focus goes. Each check records a pass or a
// serious "rg-keyboard" issue.
async function keyboard(browser, d, admin) {
  const check = async (name, opts, who, fn) => {
    const o = Object.assign({ viewport: SIZES.desktop, locale: 'en-US', reducedMotion: 'reduce' }, opts || {});
    const ctx = who ? await login(browser, d[who] || who, o) : await browser.newContext(o);
    if (who) await api(ctx, 'PUT', '/me/locale', { locale: 'en' });
    const page = await ctx.newPage();
    let problems = [];
    try { problems = (await fn(page)) || []; } catch (e) { problems = ['error: ' + String(e.message).split('\n')[0]]; }
    await ctx.close();
    const violations = problems.map((p) => ({ id: 'rg-keyboard', impact: 'serious', help: p, nodes: [{ target: name }] }));
    results.push({ state: 'keyboard · ' + name, path: '', violations });
    console.log((violations.length ? '✖ ' : '✔ ') + 'keyboard · ' + name + (violations.length ? '  ' + problems.join('; ') : ''));
  };
  const active = (page) => page.evaluate(() => {
    // Does focusing this element visibly change it (outline / shadow / border on
    // it, its ::after, or a wrapper up to 3 levels)? Compare focused vs. not.
    const snap = (e) => { const out = []; let n = e; for (let i = 0; n && i < 4; i++, n = n.parentElement) { const a = getComputedStyle(n); const b = getComputedStyle(n, '::after');
      out.push([a.outlineStyle, a.outlineWidth, a.outlineColor, a.boxShadow, a.borderColor, b.outlineStyle, b.boxShadow].join('|')); } return out.join('#'); };
    function ringOf(el) { const on = snap(el); el.blur(); const off = snap(el); el.focus({ preventScroll: true }); return on !== off; }
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'BODY' };
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, id: el.id, cls: String(el.className), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      ring: ringOf(el),
      inDialog: !!el.closest('[role=dialog]'), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight };
  });
  const go = async (page, path, wait) => { await page.goto(B + path, { waitUntil: 'networkidle' }); if (wait) await page.waitForSelector(wait); };

  await check('skip link', null, null, async (page) => {
    const bad = [];
    await go(page, '/');
    await page.keyboard.press('Tab');
    let a = await active(page);
    if (!/skip-link/.test(a.cls)) bad.push('first Tab is not the skip link (got ' + a.tag + ' ' + a.text + ')');
    if (!a.visible || !a.ring) bad.push('skip link not visible with a focus ring when focused');
    await page.keyboard.press('Enter');
    a = await active(page);
    if (a.id !== 'main') bad.push('Enter on skip link does not move focus to #main (got ' + a.tag + ')');
    await page.keyboard.press('Tab');
    a = await active(page);
    if (a.tag === 'BODY') bad.push('Tab after skipping goes nowhere');
    return bad;
  });

  for (const [path, who] of [['/', null], ['/post/' + d.post, 'buyer'], ['/messages/' + d.conv, 'buyer'], ['/newpost', 'seller'], ['/settings', 'buyer']]) {
    await check('focus visible ' + path + (who ? ' (' + who + ')' : ''), null, who, async (page) => {
      await go(page, path);
      const bad = new Set();
      let seen = 0, wraps = 0;
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab');
        const a = await active(page);
        // Pages may focus a field on load (the message box): Tab wraps around.
        if (a.tag === 'BODY') { if (++wraps > 1) break; continue; }
        seen++;
        if (!a.ring) bad.add('no visible focus ring on ' + a.tag + (a.cls ? '.' + a.cls.split(' ')[0] : '') + ' "' + a.text + '"');
      }
      if (seen < 5) bad.add('only ' + seen + ' focusable elements reached with Tab');
      return Array.from(bad).slice(0, 5);
    });
  }

  await check('user menu', null, 'buyer', async (page) => {
    const bad = [];
    await go(page, '/', '.menu-trigger');
    await page.focus('.menu-trigger');
    await page.keyboard.press('Enter');
    let a = await active(page);
    if (!/menu-item/.test(a.cls)) bad.push('opening the account menu does not focus its first item');
    await page.keyboard.press('ArrowDown');
    const b = await active(page);
    if (b.text === a.text) bad.push('ArrowDown does not move in the menu');
    await page.keyboard.press('Escape');
    a = await active(page);
    if (await page.locator('.user-menu .menu-panel').count()) bad.push('Escape does not close the menu');
    if (!/menu-trigger/.test(a.cls)) bad.push('Escape does not return focus to the menu button');
    await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    if (await page.locator('.user-menu .menu-panel').count()) bad.push('Tab out of the menu leaves it open');
    return bad;
  });

  await check('mobile menu', { viewport: SIZES.mobile, isMobile: true, hasTouch: true }, 'buyer', async (page) => {
    const bad = [];
    await go(page, '/', '.nav-toggle');
    await page.focus('.nav-toggle');
    await page.keyboard.press('Enter');
    let a = await active(page);
    if (!(await page.locator('#mobile-nav').count())) return ['menu button does not open the menu'];
    if (!(await page.evaluate(() => document.getElementById('mobile-nav').contains(document.activeElement)))) bad.push('opening the menu does not move focus into it');
    await page.keyboard.press('Escape');
    a = await active(page);
    if (await page.locator('#mobile-nav').count()) bad.push('Escape does not close the menu');
    if (!/nav-toggle/.test(a.cls)) bad.push('Escape does not return focus to the menu button');
    return bad;
  });

  for (const [name, path, who, open, wait] of [
    ['share popover', '/post/' + d.post, 'buyer', '.share-btn', '.share-menu-list'],
    ['calendar popover', '/post/' + d.post, 'buyer', '.cal-menu-btn', '.cal-menu-list'],
    ['conversation menu', '/messages/' + d.conv, 'buyer', '.thread-menu > button', '.thread-menu [role=menu]'],
  ]) {
    await check(name, null, who, async (page) => {
      const bad = [];
      await go(page, path, open);
      await page.focus(open);
      await page.keyboard.press('Enter');
      await page.waitForSelector(wait);
      if (!(await page.evaluate((w) => document.querySelector(w).contains(document.activeElement), wait))) bad.push('opening does not move focus inside');
      await page.keyboard.press('Escape');
      if (await page.locator(wait).count()) bad.push('Escape does not close it');
      const ok = await page.evaluate((o) => document.activeElement === document.querySelector(o), open);
      if (!ok) bad.push('Escape does not return focus to its button');
      return bad;
    });
  }

  for (const [name, who, open, ready] of [
    ['report dialog', 'buyer', async (p) => { await p.focus('.thread-menu > button'); await p.keyboard.press('Enter'); await p.keyboard.press('End'); await p.keyboard.press('Enter'); }, '.thread-menu > button'],
    ['meetup dialog', 'seller', async (p) => { const b = p.locator('.meet-card .btn-secondary').first(); if (await b.count()) await b.focus(); else await p.focus('.meet-suggest'); await p.keyboard.press('Enter'); }, null],
  ]) {
    await check(name, null, who, async (page) => {
      const bad = [];
      await go(page, '/messages/' + d.conv, '.composer, .thread-log');
      await open(page);
      await page.waitForSelector('[role=dialog]');
      const opener = ready || (await page.evaluate(() => null));
      let a = await active(page);
      if (!a.inDialog) bad.push('focus does not move into the dialog');
      for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); a = await active(page); if (!a.inDialog) { bad.push('Tab leaves the dialog (to ' + a.tag + ' ' + a.text + ')'); break; } }
      for (let i = 0; i < 5; i++) { await page.keyboard.press('Shift+Tab'); a = await active(page); if (!a.inDialog) { bad.push('Shift+Tab leaves the dialog'); break; } }
      await page.keyboard.press('Escape');
      if (await page.locator('[role=dialog]').count()) bad.push('Escape does not close the dialog');
      a = await active(page);
      if (a.tag === 'BODY') bad.push('focus is lost (on <body>) after the dialog closes');
      if (opener && !(await page.evaluate((o) => document.activeElement === document.querySelector(o), opener))) bad.push('focus does not return to ' + opener);
      return bad;
    });
  }

  await check('language picker sets html[lang]', null, null, async (page) => {
    const bad = [];
    await go(page, '/', '#nav-language');
    for (const [code, lang] of [['ko', 'ko'], ['es', 'es'], ['zh-CN', 'zh-CN'], ['en', 'en']]) {
      await page.selectOption('#nav-language', code);
      await page.waitForTimeout(400);
      const got = await page.evaluate(() => document.documentElement.lang);
      if (got !== lang) bad.push('picked ' + code + ', html lang is ' + got);
    }
    return bad;
  });

  await check('reduced motion', { reducedMotion: 'reduce' }, null, async (page) => {
    await go(page, '/');
    const d2 = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
    return parseFloat(d2) > 0.01 ? ['transitions still run with prefers-reduced-motion (' + d2 + ')'] : [];
  });

  await check('live regions', null, 'buyer', async (page) => {
    await go(page, '/');
    const n = await page.evaluate(() => ({ polite: document.querySelectorAll('[aria-live=polite]').length, assertive: document.querySelectorAll('[role=alert][aria-live=assertive], [aria-live=assertive]').length }));
    const bad = [];
    if (!n.polite) bad.push('no polite live region on the page for toasts / badges');
    if (!n.assertive) bad.push('no assertive live region for error toasts');
    return bad;
  });
}
async function run() {
  const browser = await chromium.launch();
  console.log('Seeding test data on', B);
  const d = await seed(browser);
  const admin = process.env.A11Y_ADMIN_EMAIL ? { email: process.env.A11Y_ADMIN_EMAIL, password: process.env.A11Y_ADMIN_PASSWORD } : null;
  const list = states(d).filter((s) => !ONLY || ONLY.test(s.name));
  const combos = [];
  for (const vp of VIEWPORTS) for (const loc of LOCALES) {
    for (const who of ['out', 'buyer', 'seller', 'admin']) {
      if (who === 'admin' && !admin) continue;
      const mine = list.filter((s) => (s.who === who || (s.who === 'any' && (who === 'out' || who === 'buyer'))) && !(s.mobileOnly && vp !== 'mobile'));
      if (mine.length) combos.push({ vp, loc, who, mine, scheme: 'light' });
    }
  }
  // Dark theme: contrast only, desktop English, a representative set.
  if (VIEWPORTS.includes('desktop')) {
    const dark = list.filter((s) => /^(home|post|conversation|meetup-dialog|safety|login|dashboard|settings|admin-spots|newpost)$/.test(s.name));
    for (const who of ['out', 'buyer', 'seller', 'admin']) {
      if (who === 'admin' && !admin) continue;
      const mine = dark.filter((s) => s.who === who || (s.who === 'any' && who === 'out'));
      if (mine.length) combos.push({ vp: 'desktop', loc: 'en', who, mine, scheme: 'dark' });
    }
  }
  // Reflow: 1280px at 200% and 400% zoom is 640 and 320 CSS px. Overflow only.
  if (process.env.A11Y_REFLOW !== '0') {
    for (const [vp, locs] of [['zoom400', LOCALES], ['zoom200', ['en']]]) for (const loc of locs) {
      for (const who of ['out', 'buyer', 'seller', 'admin']) {
        if (who === 'admin' && !admin) continue;
        const mine = list.filter((s) => (s.who === who || (s.who === 'any' && (who === 'out' || who === 'buyer'))) && !s.mobileOnly);
        if (mine.length) combos.push({ vp, loc, who, mine, scheme: 'light', reflowOnly: true });
      }
    }
  }
  for (const c of combos) {
    const opts = { viewport: SIZES[c.vp], locale: c.loc === 'ko' ? 'ko-KR' : 'en-US', timezoneId: 'America/New_York', colorScheme: c.scheme, reducedMotion: 'reduce' };
    if (c.vp === 'mobile') Object.assign(opts, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (c.vp === 'zoom200' || c.vp === 'zoom400') opts.deviceScaleFactor = c.vp === 'zoom200' ? 2 : 4;
    const ctx = c.who === 'out' ? await browser.newContext(opts) : await login(browser, c.who === 'admin' ? admin : d[c.who], opts);
    // Logged in, the account's language wins over the device's: set it.
    if (c.who !== 'out') await api(ctx, 'PUT', '/me/locale', { locale: c.loc });
    await ctx.addInitScript((loc) => { try { localStorage.setItem('rg-locale', loc); } catch (e) {} }, c.loc);
    const page = await ctx.newPage();
    for (const s of c.mine) {
      const label = [s.name, c.who, c.vp, c.loc, c.scheme === 'dark' ? 'dark' : null].filter(Boolean).join(' · ');
      let violations = [];
      try {
        await page.goto(B + s.path, { waitUntil: 'networkidle' });
        if (s.wait) await page.waitForSelector(s.wait, { timeout: 10000 });
        if (s.act) { await s.act(page); if (s.waitAfter) await page.waitForSelector(s.waitAfter, { timeout: 10000 }); }
        await page.waitForTimeout(250);
        if (c.reflowOnly) violations = (await extra(page, c.loc)).filter((v) => v.id === 'rg-reflow');
        else {
          violations = await scan(page);
          if (c.scheme === 'dark') violations = violations.filter((v) => v.id === 'color-contrast');
          else violations = violations.concat(await extra(page, c.loc));
        }
        if (SHOTS && !c.reflowOnly) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, label.replace(/ · /g, '_') + '.png'), fullPage: true }); }
      } catch (e) {
        violations = [{ id: 'rg-scan-error', impact: 'serious', help: String(e.message).split('\n')[0], nodes: [{ target: s.path }] }];
      }
      results.push({ state: label, path: s.path, violations });
      const n = violations.reduce((a, v) => a + v.nodes.length, 0);
      console.log((violations.length ? '✖ ' : '✔ ') + label + (violations.length ? '  ' + violations.map((v) => v.id + '(' + v.impact + ')').join(', ') + ' [' + n + ' nodes]' : ''));
    }
    await ctx.close();
  }
  if (process.env.A11Y_KEYBOARD !== '0') await keyboard(browser, d, admin);
  await browser.close();

  const byRule = {};
  for (const r of results) for (const v of r.violations) {
    const k = v.id;
    byRule[k] = byRule[k] || { id: k, impact: v.impact, help: v.help, states: 0, nodes: 0, examples: [] };
    byRule[k].states++; byRule[k].nodes += v.nodes.length;
    if (byRule[k].examples.length < 4) byRule[k].examples.push(r.state + ' → ' + v.nodes[0].target);
  }
  const rules = Object.values(byRule).sort((a, b) => ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impact));
  const totals = {}; rules.forEach((r) => { totals[r.impact] = (totals[r.impact] || 0) + r.nodes; });
  fs.writeFileSync(REPORT, JSON.stringify({ base: B, when: new Date().toISOString(), states: results.length, totals, rules, results }, null, 2));
  console.log('\n' + results.length + ' states scanned. Issues by impact (nodes):', JSON.stringify(totals));
  for (const r of rules) console.log(`  ${r.impact.padEnd(8)} ${r.id}: ${r.nodes} nodes in ${r.states} states — ${r.help}\n           e.g. ${r.examples.join('\n                ')}`);
  console.log('Report: ' + path.resolve(REPORT));
  const failing = rules.filter((r) => FAIL_ON.includes(r.impact));
  if (failing.length) { console.log('\nFAIL: ' + failing.map((r) => r.id).join(', ')); process.exit(1); }
  console.log('\nPASS: no ' + FAIL_ON.join('/') + ' issues');
}
run().catch((e) => { console.error(e); process.exit(2); });
