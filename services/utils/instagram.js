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
function instagramContainerParams(post, resolve = value => value) {
  const placement = instagramPlacement(post);
  const params = {};
  if (placement !== 'story') params.caption = post.content || '';
  if (placement === 'story') params.media_type = 'STORIES';
  if (post.videoUrl) { params.video_url = resolve(post.videoUrl); params.media_type = placement === 'story' ? 'STORIES' : 'REELS'; }
  else params.image_url = resolve(post.imageUrl);
  if (placement === 'reel') {
    if (post.shareToFeed !== undefined) params.share_to_feed = post.shareToFeed;
    if (post.coverUrl) params.cover_url = resolve(post.coverUrl);
  }
  return params;
}
module.exports = { INSTAGRAM_PLACEMENTS, INSTAGRAM_FORMATS, instagramPlacement, instagramValidation, instagramCapabilities, instagramContainerParams };
