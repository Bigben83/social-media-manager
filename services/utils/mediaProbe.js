const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const execute = promisify(execFile);
async function probeFile(filename) {
  const { stdout } = await execute(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  const data = JSON.parse(stdout), video = data.streams?.find(s => s.codec_type === 'video'), audio = data.streams?.find(s => s.codec_type === 'audio');
  if (!video) throw new Error('No image or video stream found');
  const [num, den] = (video.avg_frame_rate || '0/1').split('/').map(Number);
  const rotation = Number(video.tags?.rotate || video.side_data_list?.find(s => s.rotation)?.rotation || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, duration: Number(data.format?.duration || video.duration || 0), fps: den ? num / den : 0, codec: video.codec_name, audioCodec: audio?.codec_name, size: Number(data.format?.size || 0) };
}
async function probeBuffer(buffer) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'social-probe-'));
  try { const file = path.join(directory, 'media'); await fs.writeFile(file, buffer); return await probeFile(file); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
module.exports = { probeFile, probeBuffer };
