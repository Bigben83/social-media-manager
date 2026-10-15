const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDraftDate } = require('../src/utils/draftDate.ts');

test('draft wall times display unchanged across browser timezones and DST boundaries', () => {
  for (const value of ['2026-11-02T09:30', '2026-07-02T09:30', '2026-10-04T02:30']) {
    assert.equal(formatDraftDate(value, 'en', 'Australia/Sydney'), formatDraftDate(value, 'en', 'America/Los_Angeles'));
    assert.match(formatDraftDate(value, 'en', 'Australia/Sydney'), new RegExp(value.slice(11)));
  }
});

test('absolute draft timestamps include the viewer timezone and empty dates remain empty', () => {
  assert.match(formatDraftDate('2026-11-01T22:30:00Z', 'en', 'Australia/Sydney'), /2 Nov 2026, 09:30/);
  assert.match(formatDraftDate('2026-07-01T23:30:00Z', 'tr', 'Australia/Sydney'), /2 Tem 2026 09:30/);
  assert.equal(formatDraftDate('', 'en', 'UTC'), '');
  assert.equal(formatDraftDate('invalid', 'en', 'UTC'), '');
});
