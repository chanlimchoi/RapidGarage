'use strict';
// Print assets for a sale: QR codes (PNG/SVG) and PDFs drawn with pdfkit.
//   letter  US Letter flyer (8.5x11 in, portrait)
//   half    half-page flyer (5.5x8.5 in), same layout scaled down
//   sign    bold yard sign (11x8.5 in, landscape) with an optional arrow
// The QR is drawn as vector squares (crisp at any size) with error correction
// "Q" (25%), so a bit of rain, tape or a staple doesn't stop it scanning.
// Text is localized (lib/flyerText.js). Each string is drawn in Helvetica when
// it fits Windows-1252 (the PDF built-in fonts, nothing embedded), otherwise in
// a subset of Noto Sans CJK SC (assets/fonts, OFL) covering Latin, Hangul,
// kana and GB2312 Chinese; pdfkit embeds only the glyphs a flyer uses. The CJK
// face has no bold here, so bold CJK text is drawn with a thin outline.
// Characters neither font has (e.g. emoji) are dropped.
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const schedule = require('./schedule');
const i18n = require('./i18n');
const ft = require('./flyerText');

const CJK_FONT = path.join(__dirname, '..', 'assets', 'fonts', 'RapidGarageCJK-Regular.otf');
let cjk = null; // { buf, font } loaded on first use
function cjkFont() {
  if (!cjk) { const buf = fs.readFileSync(CJK_FONT); cjk = { buf, font: fontkit.create(buf) }; }
  return cjk;
}

const BRAND = '#c2410c';
const INK = '#1c1917';
const MUTED = '#57534e';
const EC = 'Q';
const LAYOUTS = ['letter', 'half', 'sign'];
const ARROWS = ['none', 'left', 'right'];
const HEADLINES = ft.HEADLINES; // choice -> catalog key

// ---- text -----------------------------------------------------------------
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const winAnsiChar = (ch) => { const c = ch.charCodeAt(0); return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.indexOf(ch) !== -1; };
const tidy = (s) => String(s == null ? '' : s)
  .replace(/[\u2010-\u2012]/g, '-').replace(/\u2212/g, '-').replace(/[\u00a0\u2007\u2009\u202f]/g, ' ');
// Windows-1252 only (what Helvetica can show).
function pdfText(s) {
  return Array.from(tidy(s)).filter(winAnsiChar).join('').replace(/\s+/g, ' ').trim();
}
const isWinAnsi = (s) => Array.from(String(s)).every((ch) => ch === '\n' || winAnsiChar(ch));
// Anything either font can draw.
function flyerText(s) {
  const t = tidy(s);
  if (isWinAnsi(t)) return t.replace(/\s+/g, ' ').trim();
  const f = cjkFont().font;
  return Array.from(t).filter((ch) => winAnsiChar(ch) || /\s/.test(ch) || f.hasGlyphForCodePoint(ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim();
}
// Keeps line breaks (address block).

// Pick the face for `text` and return extra text() options (outline for bold CJK).
function face(doc, text, bold, size, color) {
  doc.fontSize(size);
  if (isWinAnsi(text)) { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica'); return {}; }
  if (!doc._rgCjk) { doc.registerFont('RG-CJK', cjkFont().buf); doc._rgCjk = true; }
  doc.font('RG-CJK');
  if (!bold) return {};
  doc.lineWidth(Math.max(0.2, size * 0.035)).strokeColor(color || INK);
  return { fill: true, stroke: true };
}
// Draw text in the face it needs.
function put(doc, text, x, y, o) {
  const opts = Object.assign({}, o);
  const extra = face(doc, text, opts.bold, opts.size, opts.color);
  ['bold', 'size', 'color'].forEach((k) => delete opts[k]);
  if (!isWinAnsi(text)) delete opts.characterSpacing; // letter-spacing reads badly in Hangul/Chinese
  doc.fillColor(o.color || INK);
  doc.text(text, x, y, Object.assign(opts, extra));
}

// ---- schedule -------------------------------------------------------------
// Upcoming (not ended) days, sorted; all days marked ended if none are left.
function saleDays(post, at) {
  const t = +(at || schedule.now());
  const all = (post.saleDays || []).map((d) => ({ date: d.date, start: String(d.startTime).slice(0, 5), end: String(d.endTime).slice(0, 5), endsAt: +new Date(d.endsAt) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1));
  const live = all.filter((d) => d.endsAt > t);
  return { days: live.length ? live : all, ended: all.length > 0 && !live.length };
}
const scheduleLines = (days, lang) => ft.dayLines(lang || 'en', days);
const signWhen = (days, lang) => ft.signLines(lang || 'en', days);

// What goes on the flyer (also used by tests and the HTML print view).
// opts.lang: 'en' | 'es' | 'ko' | 'zh-CN' (default English).
// opts.kind 'event': a neighborhood sale (see eventAsPost); its "items" are the
// participating sales, with the street in the price column.
function flyerData(post, opts) {
  const o = opts || {};
  const lang = i18n.CODES.includes(o.lang) ? o.lang : 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const { days, ended } = saleDays(post, o.now);
  const unsold = (o.noItems ? [] : post.items || []).filter((i) => !i.sold).sort((a, b) => a.position - b.position || a.id - b.id);
  const cityLine = [post.city, [post.state, post.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    lang,
    title: flyerText(post.title) || L(HEADLINES.garage),
    headline: L(o.kind === 'event' ? 'flyer.headline.neighborhood' : HEADLINES[o.headline] || HEADLINES.garage),
    street: flyerText(post.street),
    cityLine: flyerText(cityLine),
    price: flyerText(ft.priceIn(lang, post)),
    // Built from Intl and the catalog (not user text), spacing kept as designed.
    when: scheduleLines(days, lang),
    signWhen: signWhen(days, lang),
    ended,
    items: unsold.slice(0, o.itemCount || 6).map((i) => ({ name: flyerText(i.name), price: i.label !== undefined ? flyerText(i.label || '') : ft.centsIn(lang, i.priceCents) })).filter((i) => i.name),
    unsoldCount: unsold.length,
    url: o.url,
    text: {
      brand: 'RapidGarage',
      tagline: L('flyer.tagline'), when: L('flyer.when'), where: L('flyer.where'), prices: L('flyer.prices'),
      featured: L(o.kind === 'event' ? 'flyer.eventSales' : 'flyer.featured'),
      ended: L('flyer.ended'), seeDates: L('flyer.seeDates'), seeAddress: L('flyer.seeAddress'),
      scanTitle: L('flyer.scanTitle'), scanHint: L(o.kind === 'event' ? 'flyer.eventScanHint' : 'flyer.scanHint'), listed: L('flyer.listed'),
      seeListing: L('flyer.seeListing'), scanForItems: L(o.kind === 'event' ? 'flyer.eventScanForMap' : 'flyer.scanForItems'),
      moreWhen: (n) => L('flyer.moreWhen', { count: n }), moreItems: (n) => L(o.kind === 'event' ? 'flyer.moreSales' : 'flyer.more', { count: n }),
      upper: (str) => ft.upper(lang, str),
    },
  };
}

// ---- QR -------------------------------------------------------------------
const qrPng = (url, size) => QRCode.toBuffer(url, { errorCorrectionLevel: EC, margin: 4, width: size || 1024, color: { dark: '#000000ff', light: '#ffffffff' } });
const qrSvg = (url) => QRCode.toString(url, { type: 'svg', errorCorrectionLevel: EC, margin: 4, color: { dark: '#000000ff', light: '#ffffffff' } });

// Vector QR with a 4-module quiet zone; (x, y) top-left, `size` outer width.
function drawQr(doc, url, x, y, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: EC });
  const n = qr.modules.size;
  const cell = size / (n + 8);
  doc.save().rect(x, y, size, size).fill('#ffffff');
  doc.fillColor('#000000');
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let e = c;
      while (e + 1 < n && qr.modules.get(r, e + 1)) e++;
      // Slight overlap avoids hairline gaps between modules in some viewers.
      doc.rect(x + (c + 4) * cell, y + (r + 4) * cell, (e - c + 1) * cell + 0.05, cell + 0.05);
      c = e + 1;
    }
  }
  doc.fill().restore();
}

// ---- layout helpers ---------------------------------------------------------
// Largest size (<= max, >= min) at which `text` fits `width` on `lines` lines.
function fit(doc, text, bold, max, min, width, lines) {
  for (let s = max; s > min; s -= 1) {
    face(doc, text, bold, s);
    // Measured in the face's own line height (CJK lines are taller than Helvetica's).
    if (doc.heightOfString(text, { width, lineGap: 0 }) <= Math.max(s * 1.2, doc.currentLineHeight(true)) * (lines || 1) + 0.5) return s;
  }
  return min;
}
const widthOf = (doc, text, bold, size) => { face(doc, text, bold, size); return doc.widthOfString(text); };
// Line box height per point of font size: ~1.15 for Helvetica (the layout's
// original numbers), ~1.45 for the CJK face.
const lineRatio = (doc, text) => { if (isWinAnsi(text)) return 1.15; face(doc, text, false, 100); return doc.currentLineHeight(true) / 100; };

function coverImage(doc, buf, x, y, w, h) {
  doc.save();
  doc.roundedRect(x, y, w, h, 8).clip();
  doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
  doc.restore();
}

// ---- flyers (letter / half) ---------------------------------------------
function drawFlyer(doc, d, photo, half) {
  const T = d.text;
  const W = doc.page.width;
  const H = doc.page.height;
  const s = half ? 0.68 : 1;
  const m = 40 * s;
  const inner = W - 2 * m;
  // Brand band.
  const band = 54 * s;
  doc.rect(0, 0, W, band).fill(BRAND);
  put(doc, T.brand, m, band / 2 - 11 * s, { bold: true, size: 22 * s, color: '#ffffff', lineBreak: false });
  put(doc, T.tagline, m, band / 2 - 5 * s, { size: 10 * s, color: '#ffffff', width: inner, align: 'right', lineBreak: false });
  let y = band + 26 * s;
  put(doc, T.upper(d.headline), m, y, { bold: true, size: 13 * s, color: BRAND, characterSpacing: 2 * s, lineBreak: false });
  y += 22 * s;
  const tSize = fit(doc, d.title, true, 44 * s, 18 * s, inner, 2);
  put(doc, d.title, m, y, { bold: true, size: tSize, width: inner, height: tSize * 2.5, ellipsis: true, lineGap: 0 });
  y = doc.y + 18 * s;
  // Details (left) and photo (right).
  const photoW = photo ? (half ? 130 : 220) : 0;
  const leftW = photo ? inner - photoW - 20 * s : inner;
  const top = y;
  const label = (t) => { put(doc, T.upper(t), m, y, { bold: true, size: 10 * s, color: BRAND, width: leftW, characterSpacing: 1 }); y = doc.y + 3 * s; };
  const body = (t, size, bold) => { put(doc, t, m, y, { bold, size: size * s, width: leftW, lineGap: 2 * s }); y = doc.y + 12 * s; };
  label(T.when);
  if (d.when.length) {
    const shown = d.when.slice(0, half ? 3 : 4);
    shown.forEach((l, i) => body(l + (i === shown.length - 1 && d.when.length > shown.length ? '  ' + T.moreWhen(d.when.length - shown.length) : ''), 16, true));
    if (d.ended) body(T.ended, 12, false);
  } else body(T.seeDates, 14, false);
  label(T.where);
  body([d.street, d.cityLine].filter(Boolean).join('\n') || T.seeAddress, 15, false);
  if (d.price) { label(T.prices); body(d.price, 15, true); }
  if (photo) coverImage(doc, photo, W - m - photoW, top, photoW, photoW * 0.75);
  y = Math.max(y, photo ? top + photoW * 0.75 + 16 * s : y);
  // Featured items.
  const qrSize = half ? 124 : 196;
  const qrTop = H - m - qrSize - 18 * s;
  const items = d.items.slice(0, half ? 4 : 6);
  if (items.length) {
    label(T.featured);
    const colW = half ? inner : (inner - 24) / 2;
    const rows = half ? items.length : Math.ceil(items.length / 2);
    const rowH = 19 * s;
    const startY = y;
    items.forEach((it, i) => {
      const col = half ? 0 : Math.floor(i / rows);
      const row = half ? i : i % rows;
      const ix = m + col * (colW + 24);
      const iy = startY + row * rowH;
      if (iy + rowH > qrTop - 10) return;
      put(doc, '•', ix, iy, { bold: true, size: 12 * s, color: BRAND, lineBreak: false });
      const priceW = it.price ? widthOf(doc, it.price, true, 12 * s) : 0;
      put(doc, it.name, ix + 12 * s, iy, { size: 12 * s, width: colW - 12 * s - priceW - 8, height: rowH, ellipsis: true, lineBreak: false });
      if (it.price) put(doc, it.price, ix + colW - priceW, iy, { bold: true, size: 12 * s, lineBreak: false });
    });
    y = startY + rows * rowH;
    const more = d.unsoldCount - items.length;
    if (more > 0 && y + 14 * s < qrTop - 6) put(doc, T.moreItems(more), m + 12 * s, y, { size: 10 * s, color: MUTED });
  }
  // QR block.
  doc.save().roundedRect(m, qrTop - 12 * s, inner, qrSize + 24 * s, 12 * s).lineWidth(1.5).stroke('#e7e5e4').restore();
  drawQr(doc, d.url, m + 12 * s, qrTop, qrSize);
  const tx = m + qrSize + 32 * s;
  const tw = inner - qrSize - 44 * s;
  put(doc, T.scanTitle, tx, qrTop + 14 * s, { bold: true, size: 20 * s, width: tw });
  put(doc, T.scanHint, tx, doc.y + 8 * s, { size: 11 * s, color: MUTED, width: tw });
  const urlY = doc.y + 4 * s;
  doc.font('Courier-Bold');
  const us = (() => { for (let z = 15 * s; z > 7; z -= 1) { doc.fontSize(z); if (doc.widthOfString(d.url) <= tw) return z; } return 7; })();
  doc.fillColor(BRAND).font('Courier-Bold').fontSize(us).text(d.url, tx, urlY, { width: tw, lineBreak: false });
  put(doc, T.listed, m, H - m + 4 * s, { size: 8 * s, color: MUTED, width: inner, align: 'center', lineBreak: false });
}

// ---- yard sign ------------------------------------------------------------
function drawArrow(doc, dir, x, y, w, h) {
  const shaft = h * 0.42;
  const head = w * 0.45;
  const pts = dir === 'left'
    ? [[x, y + h / 2], [x + head, y], [x + head, y + (h - shaft) / 2], [x + w, y + (h - shaft) / 2], [x + w, y + (h + shaft) / 2], [x + head, y + (h + shaft) / 2], [x + head, y + h]]
    : [[x + w, y + h / 2], [x + w - head, y], [x + w - head, y + (h - shaft) / 2], [x, y + (h - shaft) / 2], [x, y + (h + shaft) / 2], [x + w - head, y + (h + shaft) / 2], [x + w - head, y + h]];
  doc.save().polygon(...pts).fill(BRAND).restore();
}

function drawSign(doc, d, arrow) {
  const T = d.text;
  const W = doc.page.width;
  const H = doc.page.height;
  const m = 30;
  doc.save().lineWidth(10).rect(m / 2, m / 2, W - m, H - m).stroke(INK).restore();
  const inner = W - 2 * m - 20;
  const x0 = m + 10;
  let y = m + 22;
  const head = T.upper(d.headline);
  const hs = fit(doc, head, true, 120, 40, inner, 1);
  put(doc, head, x0, y, { bold: true, size: hs, width: inner, align: 'center', lineBreak: false });
  y += hs * (isWinAnsi(head) ? 1.05 : lineRatio(doc, head) * 0.92);
  // Arrow + when.
  const rowH = 150;
  const qrSize = 150;
  let wx = x0;
  let ww = inner;
  if (arrow === 'left' || arrow === 'right') {
    const aw = 210;
    drawArrow(doc, arrow, arrow === 'left' ? x0 : x0 + inner - aw, y + 4, aw, rowH - 8);
    ww = inner - aw - 20;
    wx = arrow === 'left' ? x0 + aw + 20 : x0;
  }
  const when = d.signWhen.length ? d.signWhen : [T.seeListing];
  const lines = when.slice(0, 3);
  const per = (rowH - 6) / lines.length;
  lines.forEach((l, i) => {
    const r = lineRatio(doc, l);
    const sz = Math.min(fit(doc, l, true, 96, 22, ww, 1), per / r);
    put(doc, l, wx, y + i * per + (per - sz * (r === 1.15 ? 1 : r)) / 2, { bold: true, size: sz, color: BRAND, width: ww, align: 'center', lineBreak: false });
  });
  y += rowH + 14;
  // Address (left) + QR (right).
  const aw2 = inner - qrSize - 24;
  const street = T.upper(d.street || '');
  if (street) {
    const ss = fit(doc, street, true, 54, 22, aw2, 1);
    put(doc, street, x0, y + 6, { bold: true, size: ss, width: aw2, lineBreak: false, ellipsis: true });
    y = y + 6 + ss * 1.15;
  }
  if (d.cityLine) put(doc, d.cityLine, x0, y + 2, { size: fit(doc, d.cityLine, false, 26, 12, aw2, 1), color: MUTED, width: aw2, lineBreak: false });
  const qy = H - m - 10 - qrSize - 16;
  drawQr(doc, d.url, x0 + inner - qrSize, qy, qrSize);
  put(doc, T.scanForItems, x0 + inner - qrSize - 20, qy + qrSize + 2, { bold: true, size: fit(doc, T.scanForItems, true, 12, 7, qrSize + 40, 1), width: qrSize + 40, align: 'center', lineBreak: false });
  if (d.price) put(doc, d.price, x0, H - m - 10 - 46, { bold: true, size: fit(doc, d.price, true, 30, 12, aw2, 1), width: aw2, lineBreak: false });
}

// A neighborhood sale in the shape flyerData reads: its name as the title, the
// area as the address, its days, and the participating sales as the list.
function eventAsPost(ev, sales) {
  return {
    title: ev.name, street: ev.areaLabel, city: null, state: null, zipCode: null,
    priceMin: null, priceMax: null, isFree: false, saleDays: ev.days || [],
    items: (sales || []).map((s, i) => ({ id: i, position: i, sold: false, name: s.title, priceCents: null, label: s.street || '' })),
  };
}

// -> Promise<Buffer>. opts.lang picks the flyer's language (default English).
function buildPdf(post, opts) {
  const o = Object.assign({ layout: 'letter', arrow: 'none', photo: null }, opts);
  const d = flyerData(post, o);
  const size = o.layout === 'half' ? [396, 612] : o.layout === 'sign' ? [792, 612] : [612, 792];
  const doc = new PDFDocument({ size, margin: 0, autoFirstPage: true, compress: true, lang: d.lang,
    info: { Title: i18n.t(d.lang, o.layout === 'sign' ? 'flyer.docSign' : 'flyer.docFlyer', { title: d.title }), Author: 'RapidGarage', Creator: 'RapidGarage', Producer: 'RapidGarage' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  if (o.layout === 'sign') drawSign(doc, d, o.arrow); else drawFlyer(doc, d, o.photo, o.layout === 'half');
  doc.end();
  return done;
}

module.exports = { LAYOUTS, ARROWS, HEADLINES, pdfText, flyerText, isWinAnsi, flyerData, scheduleLines, signWhen, qrPng, qrSvg, buildPdf, eventAsPost, EC };
