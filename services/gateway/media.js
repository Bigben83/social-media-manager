const fs = require('fs');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo' };
function matchesSignature(bytes, ext) {
  if (ext === '.jpg' || ext === '.jpeg') return bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (ext === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (ext === '.webp' || ext === '.avi') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === (ext === '.webp' ? 'WEBP' : 'AVI ');
  if (ext === '.mp4' || ext === '.mov') return bytes.length >= 16 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  return false;
}
async function detectUploadType(filepath, ext) {
  const file = await fs.promises.open(filepath, 'r');
  try { const buffer = Buffer.alloc(64); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); return matchesSignature(buffer.subarray(0, bytesRead), ext) ? TYPES[ext] : null; }
  finally { await file.close(); }
}
module.exports = { matchesSignature, detectUploadType };
