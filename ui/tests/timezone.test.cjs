const { test } = require('node:test');
const assert = require('node:assert/strict');
const { naiveDatetimeToUtc } = require('../src/utils/timezone.ts');
test('Sydney scheduling uses the correct summer and winter offsets', () => {
  assert.equal(naiveDatetimeToUtc('2026-01-20T09:00','Australia/Sydney'), '2026-01-19T22:00:00.000Z');
  assert.equal(naiveDatetimeToUtc('2026-07-20T09:00','Australia/Sydney'), '2026-07-19T23:00:00.000Z');
});
test('nonexistent DST times and invalid dates are rejected', () => {
  assert.throws(() => naiveDatetimeToUtc('2026-10-04T02:30','Australia/Sydney'), /does not exist/);
  assert.throws(() => naiveDatetimeToUtc('2026-02-30T09:00','UTC'), /valid date/);
});
test('the repeated DST hour selects the earlier occurrence', () => {
  assert.equal(naiveDatetimeToUtc('2026-04-05T02:30','Australia/Sydney'), '2026-04-04T15:30:00.000Z');
});
