const sharp = require('sharp');
const { createHash } = require('crypto');
const { instagramPlacement } = require('./utils/instagram');
const { validateMetadata } = require('./utils/instagramMedia');
const { probeBuffer } = require('./utils/mediaProbe');

// Prepare every Instagram destination before any public mutation. Conversion
// changes encoding only: no crop, resize, or replacement of the original asset.
function createPostPreflight({ getDb, loadMedia, saveImage, getAccounts, probeVideo = probeBuffer }) {
  return async (content, destinations, workspaceId) => {
    const prepared = [], images = new Map();
    for (const destination of destinations) {
      const dest = { ...destination };
      if (dest.platform !== 'instagram') { prepared.push(dest); continue; }
      const accounts = await getAccounts(workspaceId);
      if (!accounts.some(a => a.id === dest.accountId && a.selected && a.accessToken)) throw new Error('Instagram account is no longer connected to this workspace');
      const placement = instagramPlacement(dest);
      for (const field of ['imageUrl', 'coverUrl', 'videoUrl']) {
        if (!dest[field]) continue;
        const sourceUrl = dest[field];
        const buffer = await loadMedia(sourceUrl, workspaceId);
        if (field === 'videoUrl') {
          validateMetadata(await probeVideo(buffer), placement, true, !!dest.instagramPlacement);
          continue;
        }
        const meta = await sharp(buffer, { limitInputPixels: 50000000 }).metadata();
        if ((meta.pages || 1) > 1) throw new Error('Prepare a still image or a Reel before publishing an animated image to Instagram');
        const rotated = [5, 6, 7, 8].includes(meta.orientation);
        const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
        const imagePlacement = field === 'coverUrl' ? 'reel' : placement;
        // Check geometry before conversion so a wrong ratio cannot silently crop.
        validateMetadata({ codec: 'mjpeg', size: 1, width, height }, imagePlacement, false, !!dest.instagramPlacement);
        if (meta.format !== 'jpeg' || buffer.length > 8 * 1024 * 1024 || rotated) {
          const preparationKey = createHash('sha256').update('instagram-jpeg-v1:' + workspaceId).update(buffer).digest('hex');
          let asset = images.get(preparationKey) || await (await getDb()).collection('media_files').findOne({ workspaceId, preparationKey });
          if (!asset) {
            const jpeg = await sharp(buffer, { limitInputPixels: 50000000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
            validateMetadata({ codec: 'mjpeg', size: jpeg.length, width, height }, imagePlacement, false, !!dest.instagramPlacement);
            asset = await saveImage(jpeg, workspaceId, { width, height, sourceUrl, preparationKey });
          }
          images.set(preparationKey, asset);
          dest[field] = asset.url;
        }
      }
      prepared.push(dest);
    }
    return prepared;
  };
}
module.exports = { createPostPreflight };
