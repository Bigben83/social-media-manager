const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiFailure, confirmTikTokPublish } = require('../services/utils/tiktokPublishing');
test('TikTok HTTP 200 API failures do not count as successful publishing', () => {
  assert.throws(() => apiFailure({ data: { error: { code: 'access_token_invalid', message: 'Invalid token' } } }), /Invalid token/);
});
test('TikTok init acceptance only becomes success after publishing completes', async () => {
  let calls = 0;
  const result = await confirmTikTokPublish('https://example.com','test-key','publish', { request: async () => ({ data: { data: { status: ++calls === 1 ? 'PROCESSING_DOWNLOAD' : 'PUBLISH_COMPLETE', publicaly_available_post_id: ['post'] } } }), delay: async () => {} });
  assert.equal(calls,2); assert.equal(result.status,'published');
});
test('TikTok pending outcomes prevent unsafe retries', async () => {
  await assert.rejects(confirmTikTokPublish('https://example.com','test-key','publish', { attempts: 1, request: async () => ({ data: { data: { status: 'PROCESSING_UPLOAD' } } }) }), error => error.uncertain === true);
});
