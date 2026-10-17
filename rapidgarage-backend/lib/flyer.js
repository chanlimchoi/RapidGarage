'use strict';
// Print assets for a sale: QR codes (PNG/SVG) and PDFs drawn with pdfkit.
//   letter  US Letter flyer (8.5x11 in, portrait)
//   half    half-page flyer (5.5x8.5 in), same layout scaled down
//   sign    bold yard sign (11x8.5 in, landscape) with an optional arrow
// The QR is drawn as vector squares (crisp at any size) with error correction
// "Q" (25%), so a bit of rain, tape or a staple doesn't stop it scanning.
// Fonts are the PDF built-ins (Helvetica), so no font files ship with the app;
// text is limited to Windows-1252, and anything outside it (e.g. emoji) is dropped.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const schedule = require('./schedule');
const { formatPrice } = require('./price');

const BRAND = '#c2410c';
const INK = '#1c1917';
const MUTED = '#57534e';
const EC = 'Q';
const LAYOUTS = ['letter', 'half', 'sign'];
const ARROWS = ['none', 'left', 'right'];
const HEADLINES = { garage: 'Garage sale', yard: 'Yard sale', moving: 'Moving sale', estate: 'Estate sale' };

// ---- text -----------------------------------------------------------------
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2010-\u2012]/g, '-').replace(/\u2212/g, '-').replace(/[\u00a0\u2007\u202f]/g, ' ')
    .split('').filter((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.indexOf(ch) !== -1;
    }).join('').replace(/\s+/g, ' ').trim();
}

// ---- schedule -------------------------------------------------------------
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function clock12(hhmm, compact) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  const t = m ? hh + ':' + String(m).padStart(2, '0') : String(hh);
  return compact ? t + ap : t + ' ' + ap;
}
// Upcoming (not ended) days, sorted; all days marked ended if none are left.
function saleDays(post, at) {
  const t = +(at || schedule.now());
  const all = (post.saleDays || []).map((d) => ({ date: d.date, start: String(d.startTime).slice(0, 5), end: String(d.endTime).slice(0, 5), endsAt: +new Date(d.endsAt) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1));
  const live = all.filter((d) => d.endsAt > t);
  return { days: live.length ? live : all, ended: all.length > 0 && !live.length };
}
function dayParts(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { wd: WD[schedule.weekdayOf(date)], mon: MON[m - 1], d, y };
}
function scheduleLines(days) {
  return days.map((x) => { const p = dayParts(x.date); return p.wd + ', ' + p.mon + ' ' + p.d + '  ·  ' + clock12(x.start) + ' – ' + clock12(x.end); });
}
// Big-sign wording: "SAT & SUN  8AM–2PM" when the hours match, else one line per day.
function signWhen(days) {
  if (!days.length) return [];
  const sameHours = days.every((x) => x.start === days[0].start && x.end === days[0].end);
  const hours = (x) => clock12(x.start, true) + '–' + clock12(x.end, true);
  if (sameHours && days.length <= 3) return [days.map((x) => dayParts(x.date).wd).join(' & ').toUpperCase(), hours(days[0])];
  return days.slice(0, 2).map((x) => (dayParts(x.date).wd + ' ' + dayParts(x.date).mon + ' ' + dayParts(x.date).d + '  ' + hours(x)).toUpperCase())
    .concat(days.length > 2 ? ['+ ' + (days.length - 2) + ' MORE DAYS'] : []);
}

function cents(c) {
  if (c == null) return '';
  if (c === 0) return 'Free';
  return '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
}

// What goes on the flyer (also used by tests and the HTML print view).
function flyerData(post, opts) {
  const o = opts || {};
  const { days, ended } = saleDays(post, o.now);
  const unsold = (o.noItems ? [] : post.items || []).filter((i) => !i.sold).sort((a, b) => a.position - b.position || a.id - b.id);
  const cityLine = [post.city, [post.state, post.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    title: pdfText(post.title) || 'Garage sale',
    headline: HEADLINES[o.headline] || HEADLINES.garage,
    street: pdfText(post.street),
    cityLine: pdfText(cityLine),
    price: pdfText(formatPrice(post) || ''),
    when: scheduleLines(days),
    signWhen: signWhen(days),
    ended,
    items: unsold.slice(0, o.itemCount || 6).map((i) => ({ name: pdfText(i.name), price: cents(i.priceCents) })),
    unsoldCount: unsold.length,
    url: o.url,
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
function fit(doc, text, font, max, min, width, lines) {
  doc.font(font);
  for (let s = max; s > min; s -= 1) {
    doc.fontSize(s);
    if (doc.heightOfString(text, { width, lineGap: 0 }) <= s * 1.2 * (lines || 1) + 0.5) return s;
  }
  return min;
}

function coverImage(doc, buf, x, y, w, h) {
  doc.save();
  doc.roundedRect(x, y, w, h, 8).clip();
  doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
  doc.restore();
}

// ---- flyers (letter / half) ---------------------------------------------
function drawFlyer(doc, d, photo, half) {
  const W = doc.page.width;
  const H = doc.page.height;
  const s = half ? 0.68 : 1;
  const m = 40 * s;
  const inner = W - 2 * m;
  // Brand band.
  const band = 54 * s;
  doc.rect(0, 0, W, band).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22 * s).text('RapidGarage', m, band / 2 - 11 * s, { lineBreak: false });
  doc.font('Helvetica').fontSize(10 * s).text('Garage & yard sales near you', m, band / 2 - 5 * s, { width: inner, align: 'right', lineBreak: false });
  let y = band + 26 * s;
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(13 * s).text(d.headline.toUpperCase(), m, y, { characterSpacing: 2 * s, lineBreak: false });
  y += 22 * s;
  const tSize = fit(doc, d.title, 'Helvetica-Bold', 44 * s, 18 * s, inner, 2);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(tSize).text(d.title, m, y, { width: inner, height: tSize * 2.5, ellipsis: true, lineGap: 0 });
  y = doc.y + 18 * s;
  // Details (left) and photo (right).
  const photoW = photo ? (half ? 130 : 220) : 0;
  const leftW = photo ? inner - photoW - 20 * s : inner;
  const top = y;
  const label = (t) => { doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(10 * s).text(t.toUpperCase(), m, y, { width: leftW, characterSpacing: 1 }); y = doc.y + 3 * s; };
  const body = (t, size, bold) => { doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size * s).text(t, m, y, { width: leftW, lineGap: 2 * s }); y = doc.y + 12 * s; };
  label('When');
  if (d.when.length) {
    const shown = d.when.slice(0, half ? 3 : 4);
    shown.forEach((l, i) => body(l + (i === shown.length - 1 && d.when.length > shown.length ? '  (+' + (d.when.length - shown.length) + ' more)' : ''), 16, true));
    if (d.ended) body('This sale has ended.', 12, false);
  } else body('See the listing for dates and times.', 14, false);
  label('Where');
  body([d.street, d.cityLine].filter(Boolean).join('\n') || 'See the listing for the address.', 15, false);
  if (d.price) { label('Prices'); body(d.price, 15, true); }
  if (photo) coverImage(doc, photo, W - m - photoW, top, photoW, photoW * 0.75);
  y = Math.max(y, photo ? top + photoW * 0.75 + 16 * s : y);
  // Featured items.
  const qrSize = half ? 124 : 196;
  const qrTop = H - m - qrSize - 18 * s;
  const items = d.items.slice(0, half ? 4 : 6);
  if (items.length) {
    label('Featured items');
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
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12 * s).text('•', ix, iy, { lineBreak: false });
      const priceW = it.price ? doc.font('Helvetica-Bold').fontSize(12 * s).widthOfString(it.price) : 0;
      doc.fillColor(INK).font('Helvetica').fontSize(12 * s).text(it.name, ix + 12 * s, iy, { width: colW - 12 * s - priceW - 8, height: rowH, ellipsis: true, lineBreak: false });
      if (it.price) doc.font('Helvetica-Bold').text(it.price, ix + colW - priceW, iy, { lineBreak: false });
    });
    y = startY + rows * rowH;
    const more = d.unsoldCount - items.length;
    if (more > 0 && y + 14 * s < qrTop - 6) { doc.fillColor(MUTED).font('Helvetica').fontSize(10 * s).text('…and ' + more + ' more on the listing', m + 12 * s, y); }
  }
  // QR block.
  doc.save().roundedRect(m, qrTop - 12 * s, inner, qrSize + 24 * s, 12 * s).lineWidth(1.5).stroke('#e7e5e4').restore();
  drawQr(doc, d.url, m + 12 * s, qrTop, qrSize);
  const tx = m + qrSize + 32 * s;
  const tw = inner - qrSize - 44 * s;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20 * s).text('Scan for photos, items & directions', tx, qrTop + 14 * s, { width: tw });
  doc.fillColor(MUTED).font('Helvetica').fontSize(11 * s).text('Point your phone camera at the code, or type:', tx, doc.y + 8 * s, { width: tw });
  doc.fillColor(BRAND).font('Courier-Bold').fontSize(fit(doc, d.url, 'Courier-Bold', 15 * s, 7, tw, 1)).text(d.url, tx, doc.y + 4 * s, { width: tw, lineBreak: false });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8 * s).text('Listed on RapidGarage', m, H - m + 4 * s, { width: inner, align: 'center', lineBreak: false });
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
  const W = doc.page.width;
  const H = doc.page.height;
  const m = 30;
  doc.save().lineWidth(10).rect(m / 2, m / 2, W - m, H - m).stroke(INK).restore();
  const inner = W - 2 * m - 20;
  const x0 = m + 10;
  let y = m + 22;
  const head = d.headline.toUpperCase();
  const hs = fit(doc, head, 'Helvetica-Bold', 120, 40, inner, 1);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(hs).text(head, x0, y, { width: inner, align: 'center', lineBreak: false });
  y += hs * 1.05;
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
  const when = d.signWhen.length ? d.signWhen : ['SEE LISTING'];
  const lines = when.slice(0, 3);
  const per = (rowH - 6) / lines.length;
  lines.forEach((l, i) => {
    const sz = Math.min(fit(doc, l, 'Helvetica-Bold', 96, 22, ww, 1), per / 1.15);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(sz).text(l, wx, y + i * per + (per - sz) / 2, { width: ww, align: 'center', lineBreak: false });
  });
  y += rowH + 14;
  // Address (left) + QR (right).
  const aw2 = inner - qrSize - 24;
  const street = (d.street || '').toUpperCase();
  if (street) {
    const ss = fit(doc, street, 'Helvetica-Bold', 54, 22, aw2, 1);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(ss).text(street, x0, y + 6, { width: aw2, lineBreak: false, ellipsis: true });
    y = y + 6 + ss * 1.15;
  }
  if (d.cityLine) doc.fillColor(MUTED).font('Helvetica').fontSize(fit(doc, d.cityLine, 'Helvetica', 26, 12, aw2, 1)).text(d.cityLine, x0, y + 2, { width: aw2, lineBreak: false });
  const qy = H - m - 10 - qrSize - 16;
  drawQr(doc, d.url, x0 + inner - qrSize, qy, qrSize);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('SCAN FOR ITEMS', x0 + inner - qrSize, qy + qrSize + 2, { width: qrSize, align: 'center', lineBreak: false });
  if (d.price) doc.fillColor(INK).font('Helvetica-Bold').fontSize(fit(doc, d.price, 'Helvetica-Bold', 30, 12, aw2, 1)).text(d.price, x0, H - m - 10 - 46, { width: aw2, lineBreak: false });
}

// -> Promise<Buffer>
function buildPdf(post, opts) {
  const o = Object.assign({ layout: 'letter', arrow: 'none', photo: null }, opts);
  const d = flyerData(post, o);
  const size = o.layout === 'half' ? [396, 612] : o.layout === 'sign' ? [792, 612] : [612, 792];
  const doc = new PDFDocument({ size, margin: 0, autoFirstPage: true, compress: true,
    info: { Title: d.title + (o.layout === 'sign' ? ' (sign)' : ' (flyer)'), Author: 'RapidGarage', Creator: 'RapidGarage', Producer: 'RapidGarage' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  if (o.layout === 'sign') drawSign(doc, d, o.arrow); else drawFlyer(doc, d, o.photo, o.layout === 'half');
  doc.end();
  return done;
}

module.exports = { LAYOUTS, ARROWS, HEADLINES, pdfText, flyerData, scheduleLines, signWhen, qrPng, qrSvg, buildPdf, EC };
