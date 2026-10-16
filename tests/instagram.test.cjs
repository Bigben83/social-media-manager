const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instagramCapabilities, instagramPlacement } = require('../services/utils/instagram');
const { destinationKey, deliveryKey, validatePost } = require('../services/utils/publishing');
const base = { platform: 'instagram', accountId: 'one', imageUrl: '/media/image.jpg' };
test('legacy Instagram destinations retain their receipts and inferred placement', () => {
  assert.equal(destinationKey(base), 'instagram:one');
  assert.equal(instagramPlacement(base), 'feed');
  assert.equal(instagramPlacement({ videoUrl: '/media/clip.mp4' }), 'reel');
  assert.equal(validatePost('caption', [base]), null);
});
test('placements have distinct delivery receipts on the same account', () => {
  const story = { ...base, instagramPlacement: 'story' };
  assert.notEqual(deliveryKey('post', base), deliveryKey('post', story));
  assert.equal(validatePost('caption', [base, story]), null);
  assert.equal(validatePost('caption', [base, { ...base, instagramPlacement: 'feed' }]), 'Duplicate destination');
});
test('invalid Instagram formats and options fail before dispatch', () => {
  assert.match(validatePost('caption', [{ ...base, instagramPlacement: 'reel' }]), /require a video/);
  assert.match(validatePost('caption', [{ ...base, instagramPlacement: 'bad' }]), /Invalid Instagram placement/);
  assert.match(validatePost('caption', [{ ...base, shareToFeed: true }]), /only available for Reels/);
  assert.match(validatePost('caption', [{ ...base, videoUrl: '/media/clip.mp4' }]), /Choose one/);
});
test('unknown and Creator accounts never advertise Stories eligibility', () => {
  assert.equal(instagramCapabilities('BUSINESS').story, true);
  assert.equal(instagramCapabilities('MEDIA_CREATOR').story, false);
  assert.equal(instagramCapabilities(null).storyEligibility, 'check_required');
});
