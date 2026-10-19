// node --test: crash reports from the web app (app/lib/errorReporter.js).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as reporter from '../app/lib/errorReporter.js';

describe('error reporter', () => {
  let sent;
  beforeEach(() => {
    reporter.reset();
    sent = [];
    reporter.setTransport((body) => sent.push(body));
  });

  test('sends nothing until the server turns it on', () => {
    assert.equal(reporter.report('error', new Error('boom')), false);
    assert.equal(sent.length, 0);
  });

  test('sends kind, message and stack; each distinct error once', () => {
    globalThis.window = { location: { pathname: '/post/5', search: '?token=secret' }, addEventListener() {}, removeEventListener() {} };
    reporter.enable();
    const err = new Error('boom');
    assert.equal(reporter.report('render', err, { componentStack: '\n    at Post' }), true);
    assert.equal(reporter.report('render', err), false, 'same error again');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'render');
    assert.equal(sent[0].message, 'boom');
    assert.equal(sent[0].path, '/post/5', 'no query string');
    assert.match(sent[0].stack, /at Post/);
    // Non-Error values and unknown kinds.
    assert.equal(reporter.report('rejection', 'plain string reason'), true);
    assert.equal(sent[1].message, 'plain string reason');
    assert.equal(reporter.report('weird', new Error('x')), false);
    assert.equal(reporter.report('error', ''), false);
    delete globalThis.window;
  });

  test('at most 5 reports per page', () => {
    globalThis.window = { location: { pathname: '/' }, addEventListener() {}, removeEventListener() {} };
    reporter.enable();
    for (let i = 0; i < 10; i++) reporter.report('error', new Error('e' + i));
    assert.equal(sent.length, 5);
    delete globalThis.window;
  });
});
