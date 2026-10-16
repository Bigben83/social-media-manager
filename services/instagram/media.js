const { externalGet } = require('./utils/externalFetch');
const { probeBuffer } = require('./utils/mediaProbe');
const { instagramPlacement } = require('./utils/instagram');
function validateMetadata(meta, placement, video) {
  const fail = message => { throw Object.assign(new Error(message), { validation: true }); };
  if (video) {
    if (!['h264', 'hevc'].includes(meta.codec) || (meta.audioCodec && meta.audioCodec !== 'aac')) fail('Use an MP4/MOV video with H.264 or HEVC video and AAC audio');
    if (meta.duration < 3 || meta.duration > (placement === 'story' ? 60 : 900)) fail('Video duration is outside the supported Instagram range');
    if (meta.fps < 23 || meta.fps > 60 || meta.width > 1920) fail('Use 23–60 fps video with at most 1920 horizontal pixels');
  } else if (meta.codec !== 'mjpeg' || meta.size > 8 * 1024 * 1024) fail('Prepare a JPEG image smaller than 8 MB before publishing to Instagram');
  const valid = placement === 'feed' ? meta.width * 4 === meta.height * 3 || meta.width * 5 === meta.height * 4 : meta.width * 16 === meta.height * 9;
  if (!valid) fail(`Prepare this attachment at ${placement === 'feed' ? '3:4 (or a separately reviewed 4:5 export)' : '9:16'} before publishing`);
}
function createMediaValidator({ getDb, resolveMediaUrl, fetchMedia = externalGet, probe = probeBuffer }) {
  return async (body, workspaceId) => {
    // Legacy posts retain Meta's validation. New explicit placements enforce the
    // product's exact ratios against decoded bytes, including external URLs.
    if (!body.instagramPlacement) return;
    for (const field of ['imageUrl', 'videoUrl', 'coverUrl']) {
      if (!body[field]) continue;
      const url = resolveMediaUrl(body[field]);
      const path = new URL(url).pathname;
      if (body[field].startsWith('/media/') || url.startsWith((process.env.APP_BASE_URL || 'invalid') + '/media/')) {
        const filename = /^\/media\/([a-zA-Z0-9_.-]+)$/.exec(path)?.[1];
        if (!filename || !await (await getDb()).collection('media_files').findOne({ filename, workspaceId })) throw Object.assign(new Error('Attachment is not in this workspace Media Library'), { validation: true });
      }
      const response = await fetchMedia(url, { responseType: 'arraybuffer', maxBytes: field === 'videoUrl' ? 100 * 1024 * 1024 : 8 * 1024 * 1024, timeout: 30000 });
      const meta = await probe(Buffer.from(response.data));
      validateMetadata(meta, field === 'coverUrl' ? 'reel' : instagramPlacement(body), field === 'videoUrl');
    }
  };
}
module.exports = { createMediaValidator, validateMetadata };
