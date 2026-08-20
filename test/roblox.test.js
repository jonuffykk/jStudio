'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyError,
  normalizeCookie,
  parseAssetLines,
  sanitizeFilename,
} = require('../src/main/roblox/api');

test('normalizeCookie accepts every common paste format', () => {
  assert.equal(normalizeCookie('ABC123'), '.ROBLOSECURITY=ABC123');
  assert.equal(normalizeCookie('.ROBLOSECURITY=ABC123'), '.ROBLOSECURITY=ABC123');
  assert.equal(normalizeCookie('"ABC123"'), '.ROBLOSECURITY=ABC123');
  assert.equal(normalizeCookie('_|WARNING|_do-not-share; .ROBLOSECURITY=XYZ'), '.ROBLOSECURITY=XYZ');
  assert.equal(normalizeCookie(''), '');
  assert.equal(normalizeCookie(null), '');
});

test('parseAssetLines reads the wire format, skips noise and dedupes', () => {
  const entries = parseAssetLines(
    ['123 - Run - U: 55', '# comment', '123 - Run - U: 55', '999 - Dance - G: 77', 'garbage'].join('\n')
  );
  assert.deepEqual(entries, [
    { id: '123', name: 'Run', creatorType: 'user', creatorId: '55' },
    { id: '999', name: 'Dance', creatorType: 'group', creatorId: '77' },
  ]);
});

test('parseAssetLines tolerates empty and non-string input', () => {
  assert.deepEqual(parseAssetLines(''), []);
  assert.deepEqual(parseAssetLines(null), []);
});

test('classifyError buckets known failures', () => {
  assert.equal(classifyError('HTTP 401').category, 'Invalid cookie');
  assert.equal(classifyError('HTTP 429 rate limit').category, 'Rate limited');
  assert.equal(classifyError('HTTP 404 not found').category, 'Asset unavailable');
  assert.equal(classifyError('HTTP 503').category, 'Network failure');
  assert.equal(classifyError(new Error('totally unexpected')).category, 'Unknown');
});

test('sanitizeFilename strips path-illegal characters only', () => {
  assert.equal(sanitizeFilename('a/b:c*d?'), 'a_b_c_d_');
  assert.equal(sanitizeFilename('Idle - Loop'), 'Idle - Loop');
  assert.equal(sanitizeFilename(''), 'asset');
  assert.equal(sanitizeFilename('x'.repeat(200)).length, 100);
});
