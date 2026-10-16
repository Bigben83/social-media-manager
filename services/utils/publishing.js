const { createHash } = require('crypto');
const { instagramValidation } = require('./instagram');
const PLATFORM_PORTS = { twitter: 3001, mastodon: 3003, bluesky: 3004, instagram: 3005, facebook: 3006, pinterest: 3008, tiktok: 3007 };
const PLATFORM_SERVICES = Object.fromEntries(Object.entries(PLATFORM_PORTS).map(([platform, port]) => [platform, process.env[`${platform.toUpperCase()}_SERVICE_URL`] || `http://${platform}:${port}`]));
const accountKey = dest => dest.accountId ? `${dest.platform}:${dest.accountId}` : dest.platform;
const destinationKey = dest => accountKey(dest) + (dest.platform === 'instagram' && ['story', 'reel'].includes(dest.instagramPlacement) ? `:${dest.instagramPlacement}` : '');
function deliveryKey(postId, dest) { return createHash('sha256').update(`${postId}:${destinationKey(dest)}`).digest('hex'); }
function scheduleDelay(value, now = Date.now()) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('scheduledAt must include its UTC offset');
  const delay = new Date(value).getTime() - now;
  if (!Number.isFinite(delay) || delay <= 0) throw new Error('scheduledAt must be a valid future time');
  return delay;
}
function validatePost(content, destinations) {
  if (typeof content !== 'string') return 'content is required';
  if (!Array.isArray(destinations) || !destinations.length || destinations.length > 100) return 'Choose between 1 and 100 destinations';
  if (!content.trim() && !destinations.every(d => d?.platform === 'instagram' && d.instagramPlacement === 'story')) return 'content is required';
  const seen = new Set();
  for (const dest of destinations) {
    if (!dest || !PLATFORM_SERVICES[dest.platform]) return 'Unsupported publishing platform';
    if (dest.accountId !== undefined && (typeof dest.accountId !== 'string' || !dest.accountId)) return 'Invalid account ID';
    if (['facebook', 'instagram', 'pinterest'].includes(dest.platform) && !dest.accountId) return 'Choose a specific Page, account, or board';
    if (['twitter', 'mastodon', 'bluesky'].includes(dest.platform) && (dest.imageUrl || dest.videoUrl)) return 'Media publishing is not yet supported for this platform; publish text or choose a media-capable account';
    if (dest.platform === 'instagram' && !dest.imageUrl && !dest.videoUrl) return 'Instagram requires an image or video';
    if (dest.platform === 'instagram') { const error = instagramValidation(dest); if (error) return error; }
    else if (dest.instagramPlacement !== undefined || dest.shareToFeed !== undefined || dest.coverUrl !== undefined) return 'Instagram options require an Instagram destination';
    if (dest.platform === 'pinterest' && !dest.imageUrl) return 'Pinterest requires an image';
    if (dest.platform === 'tiktok' && !dest.videoUrl) return 'TikTok requires a video';
    for (const field of ['imageUrl', 'videoUrl', 'link', 'coverUrl']) if (dest[field] !== undefined && (typeof dest[field] !== 'string' || !/^(https?:\/\/|\/media\/)/.test(dest[field]))) return 'Invalid media or link URL';
    const key = destinationKey(dest); if (seen.has(key)) return 'Duplicate destination'; seen.add(key);
  }
  return null;
}
function failureResult(err) {
  const ambiguous = ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code);
  const status = err.response?.status;
  const retryable = !ambiguous && (err.response?.data?.retryable ?? (['ECONNREFUSED', 'EAI_AGAIN'].includes(err.code) || status === 429 || status >= 500));
  return { success: false, retryable: !!retryable, uncertain: ambiguous || !!err.response?.data?.uncertain, error: ambiguous ? 'Publishing outcome is unknown. Check the account before retrying.' : (err.response?.data?.error || err.message || 'Publishing failed') };
}
module.exports = { PLATFORM_SERVICES, accountKey, destinationKey, deliveryKey, validatePost, failureResult, scheduleDelay };
