const assert = require('assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const i18n = require('../lib/i18n');
const ft = require('../lib/flyerText');
const flyer = require('../lib/flyer');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (v) => (v && typeof v === 'object' ? Object.values(v) : [v]);
const pdfOf = (r) => r.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

describe('i18n', function () {
  this.timeout(30000);

  describe('catalogs', () => {
    const en = i18n._catalogs.en;
    for (const code of ['es', 'ko', 'zh-CN']) {
      it(code + ' has every English string and message, with the same placeholders', () => {
        const cat = i18n._catalogs[code];
        for (const part of ['strings', 'messages']) {
          assert.deepStrictEqual(Object.keys(cat[part]).filter((k) => !(k in en[part])), [], 'stray ' + part);
          for (const [k, v] of Object.entries(en[part])) {
            assert.ok(cat[part][k] !== undefined, code + ' missing ' + part + ' ' + k);
            const want = [...new Set(forms(v).flatMap(holes))].filter((h) => h !== 'count');
            for (const f of forms(cat[part][k])) {
              assert.ok(String(f).trim() || !String(forms(v)[0]).trim(), code + ' empty ' + k);
              assert.deepStrictEqual([...new Set(holes(f))].filter((h) => h !== 'count').sort(), want, code + ' placeholders of ' + k);
            }
            if (typeof v === 'object') assert.ok(cat[part][k].other, code + ' plural other for ' + k);
          }
        }
      });
    }
    it('the shared flyer and price wording matches the web app catalog', () => {
      // The print preview (frontend) and the PDF (here) must say the same thing.
      for (const code of i18n.CODES) {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'rapidgarage-frontend', 'app', 'i18n', 'locales', code + '.js'), 'utf8');
        const fe = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1).replace(/,\s*}$/, '}'));
        for (const [k, v] of Object.entries(i18n._catalogs[code].strings)) {
          if (k in fe) assert.deepStrictEqual(v, fe[k], code + ' ' + k);
        }
      }
    });
  });

  describe('language negotiation', () => {
    it('reads Accept-Language by preference and maps regional tags', () => {
      assert.strictEqual(i18n.fromAcceptLanguage('ko-KR,ko;q=0.9,en;q=0.8'), 'ko');
      assert.strictEqual(i18n.fromAcceptLanguage('fr-CA,fr;q=0.9,es-MX;q=0.5'), 'es');
      assert.strictEqual(i18n.fromAcceptLanguage('en;q=0.2, zh-TW;q=0.8'), 'zh-CN');
      assert.strictEqual(i18n.fromAcceptLanguage('de, *'), null);
      assert.strictEqual(i18n.fromAcceptLanguage(''), null);
    });
  });

  describe('messages', () => {
    it('translates exact sentences and leaves English alone', () => {
      assert.strictEqual(i18n.translate('ko', 'Post not found.'), '게시물을 찾을 수 없습니다.');
      assert.strictEqual(i18n.translate('en', 'Post not found.'), 'Post not found.');
    });
    it('fills templates, formatting numbers and translating labels', () => {
      assert.strictEqual(i18n.translate('es', 'Keep the note under 1000 characters.'), 'La nota debe tener menos de 1,000 caracteres.');
      assert.strictEqual(i18n.translate('ko', 'Lowest price must be $100,000 or less.'), '최저 가격은(는) $100,000 이하여야 합니다.');
      assert.strictEqual(i18n.translate('zh-CN', 'Highest price can\'t be negative.'), '最高价格不能为负数。');
      assert.strictEqual(i18n.translate('ko', '"cat.gif" is not a JPEG, PNG or WebP image.'), '"cat.gif"은(는) JPEG, PNG 또는 WebP 이미지가 아닙니다.');
    });
    it('every literal message in the code has a translation (static check)', () => {
      // Complete literals passed to the error helpers or set as field errors.
      // Messages built with + or ${} are covered by templates and the run-time
      // check in zz-i18n-coverage.test.js.
      const STR = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
      const res = [
        new RegExp(String.raw`\b(?:badRequest|notFound|forbidden|conflict|unauthorized)\(res,\s*(?:${STR})\s*[,)]`, 'g'),
        new RegExp(String.raw`\bsendError\(res,\s*\d+,\s*'[a-z_]+',\s*(?:${STR})\s*[,)]`, 'g'),
        new RegExp(String.raw`\berrors(?:\.\w+|\[\w+\])\s*=\s*(?:${STR})\s*;`, 'g'),
        new RegExp(String.raw`\{\s*error:\s*(?:${STR})\s*\}`, 'g'),
      ];
      const dirs = ['controllers', 'lib', 'middlewares'].map((d) => path.join(__dirname, '..', d));
      const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
      const found = new Set();
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        for (const re of res) for (const m of src.matchAll(re)) found.add((m[1] !== undefined ? m[1] : m[2]).replace(/\\'/g, "'"));
      }
      assert.ok(found.size > 100, 'scanner found ' + found.size);
      const missing = [...found].filter((msg) => i18n.translate('ko', msg) === msg && i18n.translate('es', msg) === msg);
      missing.forEach((msg) => i18n._misses.delete(msg));
      assert.deepStrictEqual(missing, []);
    });

    it('unknown text passes through unchanged', () => {
      assert.strictEqual(i18n.translate('ko', 'Some brand-new message.'), 'Some brand-new message.');
      i18n._misses.delete('Some brand-new message.');
    });
  });

  describe('API', () => {
    let agent, userId;
    beforeEach(async () => {
      await models.sequelize.sync({ force: true });
      agent = request.agent(app);
      const r = await agent.post('/signup').set('Accept-Language', 'zh-CN,zh;q=0.9').send({ email: 'kim@example.com', password: PW, firstName: 'Minji', lastName: 'Kim', locale: 'ko' });
      assert.strictEqual(r.status, 201);
      userId = r.body.id;
    });

    it('signup saves the language the person signed up in, /me returns it', async () => {
      assert.strictEqual((await agent.get('/me')).body.user.locale, 'ko');
      const r = await request(app).post('/signup').set('Accept-Language', 'es-MX').send({ email: 'eva@example.com', password: PW, firstName: 'Eva' });
      assert.strictEqual(r.body.locale, 'es', 'falls back to the browser language');
      const n = await request(app).post('/signup').send({ email: 'ned@example.com', password: PW, firstName: 'Ned' });
      assert.strictEqual(n.body.locale, null, 'no language: not chosen yet');
    });

    it('PUT /me/locale saves a supported language and rejects others', async () => {
      assert.strictEqual((await request(app).put('/me/locale').send({ locale: 'es' })).status, 401);
      const r = await agent.put('/me/locale').send({ locale: 'zh-cn' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.locale, 'zh-CN');
      const bad = await agent.put('/me/locale').set('Accept-Language', 'es').send({ locale: 'fr' });
      assert.strictEqual(bad.status, 400);
      assert.strictEqual(bad.body.error.message, 'Elige un idioma: en, es, ko, zh-CN.');
      assert.strictEqual((await models.User.findByPk(userId)).locale, 'zh-CN');
    });

    it('errors and field errors follow Accept-Language, then the account language', async () => {
      const r = await agent.post('/post').set('Accept-Language', 'es').send({ title: '', zipCode: '1', priceMin: -3 });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error.code, 'bad_request', 'codes stay machine-readable');
      assert.strictEqual(r.body.error.message, 'Publicación no válida.');
      assert.strictEqual(r.body.error.details.title, 'El título es obligatorio.');
      assert.strictEqual(r.body.error.details.priceMin, 'Precio mínimo no puede ser negativo.');
      assert.match(r.headers.vary || '', /Accept-Language/);
      // No header: the account's language (ko).
      const k = await agent.get('/post/999999');
      assert.strictEqual(k.body.error.message, '게시물을 찾을 수 없습니다.');
      // Logged out, no header: English as before.
      assert.strictEqual((await request(app).get('/post/999999')).body.error.message, 'Post not found.');
      // Malformed JSON goes through the same path.
      const j = await request(app).post('/login').set('Accept-Language', 'zh-CN').set('Content-Type', 'application/json').send('{"x":');
      assert.strictEqual(j.body.error.message, '请求的 JSON 格式有误。');
    });

    it('the short-link page speaks the scanner\'s language', async () => {
      const r = await request(app).get('/s/zzzzzzzz').set('Accept-Language', 'ko-KR');
      assert.strictEqual(r.status, 404);
      assert.match(r.text, /<html lang="ko">/);
      assert.match(r.text, /볼 수 없는 세일입니다/);
      assert.match(r.text, /내 주변 세일 찾기/);
      assert.match((await request(app).get('/s/zzzzzzzz')).text, /This sale isn’t available/);
    });
  });

  describe('dates, times and money per locale', () => {
    const days = [{ date: '2026-10-24', start: '08:00', end: '14:30' }, { date: '2026-10-25', start: '08:00', end: '14:30' }];
    it('writes schedule lines in each language', () => {
      assert.deepStrictEqual(ft.dayLines('en', days.slice(0, 1)), ['Sat, Oct 24  ·  8 AM – 2:30 PM']);
      assert.deepStrictEqual(ft.dayLines('es', days.slice(0, 1)), ['sáb, 24 oct  ·  8 a.m. – 2:30 p.m.']);
      assert.deepStrictEqual(ft.dayLines('ko', days.slice(0, 1)), ['10월 24일 (토)  ·  오전 8시 – 오후 2:30']);
      assert.deepStrictEqual(ft.dayLines('zh-CN', days.slice(0, 1)), ['10月24日 周六  ·  8:00 – 14:30'], '24-hour clock in Chinese');
    });
    it('sign lines and prices', () => {
      assert.deepStrictEqual(ft.signLines('en', days), ['SAT & SUN', '8AM–2:30PM']);
      assert.deepStrictEqual(ft.signLines('ko', days), ['토·일', '오전8시–오후2:30']);
      assert.strictEqual(ft.priceIn('es', { priceMin: 5, priceMax: 1200 }), '$5–$1,200');
      assert.strictEqual(ft.priceIn('zh-CN', { priceMax: 50 }), '最高 $50');
      assert.strictEqual(ft.priceIn('ko', { isFree: true }), '무료');
      assert.strictEqual(ft.centsIn('es', 250), '$2.50');
    });
  });

  describe('alert emails', () => {
    const items = (n) => Array.from({ length: n }, (x, i) => ({
      post: { id: 10 + i, title: '이사 세일 ' + i, city: 'Fort Lee', state: 'NJ', priceMin: 5, priceMax: 50 },
      seller: { firstName: 'Bora', lastName: 'Lee', email: 'bora@example.com' },
      alert: { id: 7, label: null, radiusMiles: 10, userId: 1 },
      distanceMiles: 1.5,
    }));
    it('are written in the recipient\'s language, never exposing the seller\'s email', () => {
      const m = alerts.renderEmail({ id: 1, firstName: '민지', locale: 'ko' }, items(2));
      assert.strictEqual(m.subject, '내 주변 새 개러지 세일 2개');
      assert.ok(m.text.startsWith('민지님, 안녕하세요.'));
      assert.ok(m.text.includes('1.5마일 거리') && m.text.includes('판매자 Bora L.'));
      assert.ok(m.text.includes('알림 관리: '));
      assert.ok(m.html.includes('<html lang="ko">') && m.html.includes('10마일 이내'));
      assert.strictEqual(m.headers['Content-Language'], 'ko');
      for (const body of [m.text, m.html, m.subject]) assert.ok(!body.includes('bora@example.com'));
      const es = alerts.renderEmail({ id: 1, firstName: 'Eva', locale: 'es' }, items(1));
      assert.strictEqual(es.subject, 'Nueva venta de garaje cerca de ti: 이사 세일 0');
      assert.ok(es.text.includes('Una venta nueva coincide con tus alertas de RapidGarage:'));
      const en = alerts.renderEmail({ id: 1, firstName: 'Ann', locale: null }, items(2));
      assert.strictEqual(en.subject, '2 new garage sales near you');
      assert.ok(en.text.includes('Hi Ann,') && en.text.includes('within 10 mi'));
    });
  });

  describe('flyer PDFs', () => {
    let seller, postId;
    let now = new Date('2026-10-23T14:00:00Z');
    before(() => schedule.setClock(() => now));
    after(() => schedule.setClock(null));
    beforeEach(async () => {
      await models.sequelize.sync({ force: true });
      seller = request.agent(app);
      await seller.post('/signup').send({ email: 'sam@example.com', password: PW, firstName: 'Sam' });
      const p = await seller.post('/post').send({ title: '이사 세일: 가구와 책', street: '30 Henry St', city: 'Brooklyn', state: 'NY', zipCode: '11201', priceMin: 1, priceMax: 80,
        schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '14:00' }] } });
      postId = p.body.id;
      await seller.post('/post/' + postId + '/items').send({ name: '책상 🪑', price: '45' });
    });

    it('flyerData uses the chosen language and keeps CJK user text', async () => {
      const post = await models.Post.findByPk(postId, { include: [{ model: models.SaleDay, as: 'saleDays' }, { model: models.SaleItem, as: 'items' }] });
      const d = flyer.flyerData(post, { url: 'u', lang: 'zh-CN', headline: 'moving' });
      assert.strictEqual(d.headline, '搬家甩卖');
      assert.strictEqual(d.title, '이사 세일: 가구와 책');
      assert.deepStrictEqual(d.when, ['10月24日 周六  ·  8:00 – 14:00']);
      assert.deepStrictEqual(d.items, [{ name: '책상', price: '$45' }], 'emoji dropped, Hangul kept');
      assert.strictEqual(d.text.when, '时间');
    });

    it('embeds the CJK font only when the flyer needs it', async () => {
      const ko = await pdfOf(seller.get('/post/' + postId + '/print/flyer.pdf?lang=ko&layout=sign&arrow=left'));
      assert.strictEqual(ko.status, 200);
      assert.ok(ko.body.slice(0, 5).toString() === '%PDF-');
      assert.ok(ko.body.includes('NotoSansCJKsc'), 'CJK font embedded');
      assert.ok(ko.body.length < 400000, 'only used glyphs: ' + ko.body.length);
      await models.Post.update({ title: 'Big yard sale' }, { where: { id: postId } });
      await models.SaleItem.destroy({ where: { postId } });
      const en = await pdfOf(seller.get('/post/' + postId + '/print/flyer.pdf?lang=en'));
      assert.strictEqual(en.status, 200);
      assert.ok(!en.body.includes('NotoSansCJKsc'), 'English uses the built-in fonts');
      const bad = await seller.get('/post/' + postId + '/print/flyer.pdf?lang=fr');
      assert.strictEqual(bad.status, 400);
      assert.ok(bad.body.error.details.lang);
    });

    it('ships the font licence next to the font', () => {
      const dir = path.join(__dirname, '..', 'assets', 'fonts');
      assert.match(fs.readFileSync(path.join(dir, 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i);
      assert.ok(fs.statSync(path.join(dir, 'RapidGarageCJK-Regular.otf')).size < 5 * 1024 * 1024, 'subset stays small');
    });
  });
});
