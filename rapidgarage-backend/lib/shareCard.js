'use strict';
// Branded 1200x630 link-preview card (Open Graph / Twitter image) for a sale,
// a neighborhood sale, a wanted post, or the site itself.
//
// Text is drawn as glyph outlines from the same Noto Sans CJK SC subset the
// flyer PDFs embed (assets/fonts, OFL; Latin, Hangul, kana, GB2312 Chinese),
// turned into SVG paths with fontkit and rasterized by sharp. Nothing depends
// on the fonts installed on the server, so Korean and Chinese titles render
// the same in Docker as on a laptop. The face has no bold; "bold" text gets a
// thin outline in its own color (as on the flyers). Characters the face lacks
// (emoji) are dropped.
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const sharp = require('sharp');

const W = 1200;
const H = 630;
const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'RapidGarageCJK-Regular.otf');
let face = null;
const font = () => { if (!face) face = fontkit.create(fs.readFileSync(FONT)); return face; };

const COLORS = { bg: '#fffaf5', ink: '#1c1b19', muted: '#57534e', brand: '#c2410c', brandSoft: '#ffedd5', brandText: '#9a3412', free: '#15803d', freeSoft: '#dcfce7', line: '#f1e4d6' };

const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// Width of `text` at `size` px.
function measure(text, size) {
  const run = font().layout(text);
  return run.positions.reduce((w, p, i) => w + (run.glyphs[i].id ? p.xAdvance : 0), 0) * size / font().unitsPerEm;
}

const CJK_RE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

// Break `text` into tokens that may wrap: words, and single CJK characters.
function tokens(text) {
  const out = [];
  clean(text).split(/(\s+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) { out.push(' '); return; }
    // Chinese/Japanese have no spaces; any character may start a line. Korean
    // words are kept whole unless they don't fit at all.
    if (CJK_RE.test(part) && !/[\uac00-\ud7af]/.test(part)) Array.from(part).forEach((c) => out.push(c));
    else out.push(part);
  });
  return out;
}

// Greedy wrap into at most `maxLines` lines no wider than `width`; the last
// line gets an ellipsis when text is left over.
function wrap(text, size, width, maxLines) {
  const lines = [];
  let line = '';
  const list = tokens(text);
  for (let i = 0; i < list.length; i++) {
    let tok = list[i];
    if (tok === ' ' && !line) continue;
    const next = line + tok;
    if (measure(next.trimEnd(), size) <= width) { line = next; continue; }
    if (!line.trim()) {
      // One token wider than the line: split it by characters.
      let part = '';
      for (const c of Array.from(tok)) {
        if (measure(part + c, size) > width) { lines.push(part); part = ''; if (lines.length === maxLines) break; }
        part += c;
      }
      line = part;
    } else {
      lines.push(line.trimEnd());
      line = tok === ' ' ? '' : tok;
    }
    if (lines.length === maxLines) { line = list.slice(i).join(''); break; }
  }
  if (lines.length < maxLines) { if (line.trim()) lines.push(line.trim()); return lines; }
  // Out of lines: ellipsize the last one if anything was cut.
  const rest = clean(line);
  if (rest) {
    let last = lines[maxLines - 1];
    while (last && measure(last + '…', size) > width) last = Array.from(last).slice(0, -1).join('');
    lines[maxLines - 1] = last.trimEnd() + '…';
  }
  return lines.slice(0, maxLines);
}

const n = (v) => Math.round(v * 100) / 100;

// One line of text as SVG <path>s; x is the left edge, y the baseline.
function textSvg(text, x, y, size, fill, opts) {
  const o = opts || {};
  const f = font();
  const k = size / f.unitsPerEm;
  const run = f.layout(text);
  let pen = o.align === 'right' ? x - measure(text, size) : x;
  const stroke = o.bold ? ` stroke="${fill}" stroke-width="${o.bold === true ? 34 : o.bold}" stroke-linejoin="round"` : '';
  let out = '';
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i];
    if (g.id) {
      const d = g.path.toSVG();
      if (d) out += `<path transform="translate(${n(pen + p.xOffset * k)} ${n(y - p.yOffset * k)}) scale(${n(k * 1e4) / 1e4} ${-n(k * 1e4) / 1e4})" d="${d}"${stroke}/>`;
      pen += p.xAdvance * k;
    }
  });
  return `<g fill="${fill}">${out}</g>`;
}

// The house mark (same shape as the app icon: a garage).
function logo(x, y, s) {
  return `<g transform="translate(${x} ${y})"><rect width="${s}" height="${s}" rx="${s * 0.24}" fill="${COLORS.brand}"/>
<path transform="translate(${s * 0.2} ${s * 0.2}) scale(${s * 0.6 / 24})" d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M7 21v-7h10v7 M7 17h10" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// spec: { kicker, title, lines: [string], chip: { text, tone: 'free'|'brand' }, footer, generic, tagline }
function svgFor(spec) {
  const pad = 72;
  const inner = W - pad * 2;
  let body = '';
  body += `<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`;
  body += `<rect x="0" y="0" width="${W}" height="14" fill="${COLORS.brand}"/>`;
  body += `<circle cx="${W - 40}" cy="${H + 60}" r="300" fill="${COLORS.brandSoft}"/>`;
  body += logo(pad, 58, 64);
  body += textSvg('RapidGarage', pad + 84, 104, 38, COLORS.ink, { bold: 40 });
  if (spec.generic) {
    const lines = wrap(spec.title, 76, inner, 2);
    lines.forEach((l, i) => { body += textSvg(l, pad, 300 + i * 96, 76, COLORS.ink, { bold: 30 }); });
    if (spec.tagline) wrap(spec.tagline, 36, inner, 2).forEach((l, i) => { body += textSvg(l, pad, 300 + lines.length * 96 + 10 + i * 50, 36, COLORS.muted); });
  } else {
    let y = 180;
    if (spec.kicker) {
      const kw = measure(spec.kicker, 28) + 40;
      body += `<rect x="${pad}" y="${y - 34}" width="${n(kw)}" height="48" rx="24" fill="${COLORS.brandSoft}"/>`;
      body += textSvg(spec.kicker, pad + 20, y, 28, COLORS.brandText, { bold: 30 });
      y += 36;
    }
    // One line at 68px, two at 60px, else up to three at 52px.
    const t = clean(spec.title);
    const size = measure(t, 68) <= inner ? 68 : wrap(t, 60, inner, 3).length <= 2 ? 60 : 52;
    wrap(t, size, inner, 3).forEach((l) => { y += size * 1.2; body += textSvg(l, pad, y, size, COLORS.ink, { bold: 30 }); });
    y += 12;
    const bottom = spec.chip && spec.chip.text ? H - 124 : H - 60;
    (spec.lines || []).filter(Boolean).slice(0, 3).forEach((line) => {
      if (y + 48 > bottom) return;
      y += 48;
      body += textSvg(wrap(line, 32, inner, 1)[0], pad, y, 32, COLORS.muted);
    });
    if (spec.chip && spec.chip.text) {
      const free = spec.chip.tone === 'free';
      const cw = measure(spec.chip.text, 32) + 48;
      body += `<rect x="${pad}" y="${H - 108}" width="${n(Math.min(cw, inner))}" height="56" rx="28" fill="${free ? COLORS.freeSoft : COLORS.brandSoft}"/>`;
      body += textSvg(wrap(spec.chip.text, 32, inner - 48, 1)[0], pad + 24, H - 69, 32, free ? COLORS.free : COLORS.brandText, { bold: 30 });
    }
  }
  if (spec.footer) body += textSvg(spec.footer, W - pad, H - 64, 28, COLORS.muted, { align: 'right' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

async function renderCard(spec) {
  return sharp(Buffer.from(svgFor(spec))).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
}

// A sale photo (already EXIF-stripped on upload) cropped to 1200x630.
async function renderPhoto(buf) {
  return sharp(buf).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

module.exports = { W, H, measure, wrap, svgFor, renderCard, renderPhoto, COLORS };
