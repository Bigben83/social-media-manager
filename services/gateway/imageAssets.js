const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const IMAGE_DIMENSIONS = { '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920], '3:4': [1080, 1440], '4:5': [1080, 1350] };
async function imageMetadata(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 50000000 }).metadata();
  const rotated = [5, 6, 7, 8].includes(meta.orientation);
  return { width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
}
async function normalizeImage(buffer, aspect, fit = 'contain') {
  if (!IMAGE_DIMENSIONS[aspect] || !['contain', 'cover'].includes(fit)) throw new Error('Choose a supported aspect ratio and fit method');
  const [width, height] = IMAGE_DIMENSIONS[aspect];
  const original = await imageMetadata(buffer);
  const output = await sharp(buffer, { limitInputPixels: 50000000 }).rotate().resize(width, height, { fit, background: '#ffffff', position: 'centre' }).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { buffer: output, mime: 'image/jpeg', width, height, aspect, fit, original, adjusted: original.width * height !== original.height * width };
}
async function saveImageAsset({ buffer, mime, metadata = {}, getDb, workspaceId, uploadDir, origin }) {
  const ext = /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png';
  const filename = `${randomUUID()}.${ext}`;
  const url = `${(origin || '').replace(/\/$/, '')}/media/${filename}`;
  const record = { filename, originalName: filename, url, mimetype: mime, size: buffer.length, folder: null, ...metadata, workspaceId, uploadedAt: new Date() };
  await fs.writeFile(path.join(uploadDir, filename), buffer);
  try { await (await getDb()).collection('media_files').insertOne(record); }
  catch (err) { await fs.unlink(path.join(uploadDir, filename)).catch(() => {}); throw err; }
  return record;
}
module.exports = { IMAGE_DIMENSIONS, imageMetadata, normalizeImage, saveImageAsset };
