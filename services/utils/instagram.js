const INSTAGRAM_PLACEMENTS = ['feed', 'story', 'reel'];
const INSTAGRAM_FORMATS = {
  feed: { aspect: '3:4', width: 1080, height: 1440, media: ['image'] },
  story: { aspect: '9:16', width: 1080, height: 1920, media: ['image', 'video'] },
  reel: { aspect: '9:16', width: 1080, height: 1920, media: ['video'] },
};
function instagramPlacement(destination) {
  return destination.instagramPlacement || (destination.videoUrl ? 'reel' : 'feed');
}
function instagramValidation(destination) {
  const placement = instagramPlacement(destination);
  if (!INSTAGRAM_PLACEMENTS.includes(placement)) return 'Invalid Instagram placement';
  if (destination.imageUrl && destination.videoUrl) return 'Choose one Instagram image or video';
  if (placement === 'reel' && !destination.videoUrl) return 'Instagram Reels require a video; render images into a video first';
  if (placement === 'feed' && destination.videoUrl) return 'Choose Reel for an Instagram video';
  if (destination.shareToFeed !== undefined && (placement !== 'reel' || typeof destination.shareToFeed !== 'boolean')) return 'Share to feed is only available for Reels';
  if (destination.coverUrl && placement !== 'reel') return 'Cover artwork is only available for Reels';
  return null;
}
function instagramCapabilities(accountType) {
  return { accountType: accountType || 'UNKNOWN', feed: true, reel: true, story: accountType === 'BUSINESS', storyEligibility: accountType ? (accountType === 'BUSINESS' ? 'eligible' : 'business_required') : 'check_required', formats: INSTAGRAM_FORMATS };
}
module.exports = { INSTAGRAM_PLACEMENTS, INSTAGRAM_FORMATS, instagramPlacement, instagramValidation, instagramCapabilities };
