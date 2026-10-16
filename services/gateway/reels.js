const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { normalizeImage } = require('./imageAssets');
const { probeFile } = require('./utils/mediaProbe');
const execute = promisify(execFile);
const xml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function textLines(text) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const raw of paragraph.split(/\s+/).filter(Boolean)) {
      for (let offset = 0; offset < raw.length; offset += 28) {
        const word = raw.slice(offset, offset + 28);
        if ((line + ' ' + word).trim().length > 28) { lines.push(line); line = ''; }
        line = (line + ' ' + word).trim();
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > 6) throw new Error('Scene text is too long for the safe area. Use six short lines or fewer.');
  return lines;
}
async function sceneImage(buffer, scene) {
  const prepared = await normalizeImage(buffer, '9:16', scene.fit);
  const lines = textLines(scene.text);
  if (!lines.length) return prepared.buffer;
  const overlay = `<svg width="1080" height="1920"><rect x="72" y="1050" width="840" height="430" rx="22" fill="black" fill-opacity="0.72"/><text font-family="DejaVu Sans,Arial,sans-serif" font-size="48" fill="white">${lines.map((line, i) => `<tspan x="104" y="${1120 + i * 58}">${xml(line)}</tspan>`).join('')}</text></svg>`;
  return sharp(prepared.buffer).composite([{ input: Buffer.from(overlay) }]).jpeg({ quality: 92 }).toBuffer();
}
async function ownedMedia(db, workspaceId, value, origin) {
  if (typeof value !== 'string') throw new Error('Choose media from this workspace');
  const url = new URL(value, origin || 'http://local.invalid');
  if (url.origin !== new URL(origin || 'http://local.invalid').origin) throw new Error('Use media from this workspace Media Library');
  const filename = /^\/media\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/.exec(url.pathname)?.[1];
  const record = filename && await db.collection('media_files').findOne({ filename, workspaceId });
  if (!record) throw new Error('Media is missing or belongs to another workspace');
  return record;
}
async function prepareReel(db, workspaceId, input, origin) {
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw new Error('Choose between 1 and 12 image scenes');
  if (!['cut', 'fade'].includes(input.transition || 'cut')) throw new Error('Choose cut or fade transitions');
  const scenes = [];
  for (const source of input.scenes) {
    const record = await ownedMedia(db, workspaceId, source.mediaUrl, origin);
    if (!record.mimetype?.startsWith('image/')) throw new Error('Every scene needs an image');
    const duration = Number(source.duration);
    if (!Number.isFinite(duration) || duration < 3 || duration > 10) throw new Error('Scene duration must be between 3 and 10 seconds');
    if (typeof source.text !== 'string' || source.text.length > 168) throw new Error('Keep scene text under 168 characters');
    textLines(source.text);
    if (!['contain', 'cover'].includes(source.fit || 'contain')) throw new Error('Choose image padding or cropping');
    scenes.push({ filename: record.filename, duration, text: source.text, fit: source.fit || 'contain' });
  }
  let audioFilename = null;
  if (input.audioUrl) {
    if (input.audioRightsConfirmed !== true) throw new Error('Confirm you have permission to use the soundtrack');
    const audio = await ownedMedia(db, workspaceId, input.audioUrl, origin);
    if (!/^(audio|video)\//.test(audio.mimetype)) throw new Error('Choose an uploaded audio or video soundtrack');
    audioFilename = audio.filename;
  }
  return { scenes, audioFilename, audioRightsConfirmed: !!audioFilename, transition: input.transition || 'cut' };
}
function createReelHandler({ getDb, uploadDir, origin, run = execute }) {
  return async (job, ctx) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(job._id)) throw new Error('Invalid render job ID');
    const db = await getDb(), filename = `reel-${job._id}.mp4`, output = path.join(uploadDir, filename);
    const existing = await db.collection('media_files').findOne({ filename, workspaceId: job.workspaceId });
    if (existing) return { mediaUrl: existing.url, width: existing.width, height: existing.height, duration: existing.duration };
    const work = path.join(uploadDir, '.reel-work', job._id);
    await fs.mkdir(work, { recursive: true });
    try {
      const ffmpeg = async args => run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: work, windowsHide: true, timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
      const completed = new Set(ctx.checkpoint.scenes || []);
      for (let i = 0; i < job.payload.scenes.length; i++) {
        await ctx.assertWorkspace();
        const scene = job.payload.scenes[i];
        const asset = await db.collection('media_files').findOne({ filename: scene.filename, workspaceId: job.workspaceId });
        if (!asset) throw new Error('A source image is no longer in this workspace');
        const clip = `scene-${i}.mp4`;
        await ctx.setProgress({ step: 'rendering', completed: i, total: job.payload.scenes.length + 1 });
        let valid = false;
        if (completed.has(i)) { try { valid = (await probeFile(path.join(work, clip))).width === 1080; } catch { /* render it again */ } }
        if (!valid) {
          await fs.writeFile(path.join(work, `scene-${i}.jpg`), await sceneImage(await fs.readFile(path.join(uploadDir, scene.filename)), scene));
          const filters = job.payload.transition === 'fade' ? `fade=t=in:st=0:d=0.25,fade=t=out:st=${scene.duration - 0.25}:d=0.25,format=yuv420p` : 'format=yuv420p';
          await ffmpeg(['-loop', '1', '-framerate', '30', '-i', `scene-${i}.jpg`, '-t', String(scene.duration), '-vf', filters, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-movflags', '+faststart', `scene-${i}.tmp.mp4`]);
          await ctx.assertWorkspace();
          await fs.rename(path.join(work, `scene-${i}.tmp.mp4`), path.join(work, clip));
          completed.add(i);
          await ctx.saveCheckpoint({ scenes: [...completed] });
        }
      }
      await ctx.assertWorkspace();
      const duration = job.payload.scenes.reduce((sum, scene) => sum + scene.duration, 0);
      await fs.writeFile(path.join(work, 'scenes.txt'), job.payload.scenes.map((_, i) => `file 'scene-${i}.mp4'`).join('\n'));
      await ctx.setProgress({ step: 'assembling', completed: job.payload.scenes.length, total: job.payload.scenes.length + 1 });
      const args = ['-f', 'concat', '-safe', '0', '-i', 'scenes.txt'];
      if (job.payload.audioFilename) {
        if (!await db.collection('media_files').findOne({ filename: job.payload.audioFilename, workspaceId: job.workspaceId })) throw new Error('Soundtrack is no longer in this workspace');
        args.push('-stream_loop', '-1', '-i', path.resolve(uploadDir, job.payload.audioFilename), '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-ar', '48000', '-b:a', '128k');
      } else args.push('-an');
      args.push('-c:v', 'copy', '-t', String(duration), '-movflags', '+faststart', 'finished.mp4');
      await ffmpeg(args);
      await ctx.assertWorkspace();
      const metadata = await probeFile(path.join(work, 'finished.mp4'));
      if (metadata.width !== 1080 || metadata.height !== 1920 || metadata.codec !== 'h264' || metadata.size > 100 * 1024 * 1024) throw new Error('Rendered video failed Instagram export validation');
      await fs.rename(path.join(work, 'finished.mp4'), output);
      const url = `${(origin || '').replace(/\/$/, '')}/media/${filename}`;
      await db.collection('media_files').updateOne({ _id: 'reel-' + job._id, workspaceId: job.workspaceId }, { $setOnInsert: { filename, url, mimetype: 'video/mp4', originalName: filename, size: metadata.size, width: 1080, height: 1920, aspect: '9:16', duration: metadata.duration, renderJobId: job._id, tags: ['rendered-reel'], folder: null, sourceImages: job.payload.scenes.map(s => s.filename), uploadedAt: new Date() } }, { upsert: true });
      await ctx.setProgress({ step: 'done', completed: job.payload.scenes.length + 1 });
      await fs.rm(work, { recursive: true, force: true });
      return { mediaUrl: url, width: 1080, height: 1920, duration: metadata.duration };
    } catch (err) {
      const current = await db.collection('ai_jobs').findOne({ _id: job._id, workspaceId: job.workspaceId });
      if (!current || current.status === 'cancelled') await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      if (err.cmd) throw new Error('Video rendering failed. Check that the selected images and soundtrack are readable, then retry.');
      throw err;
    }
  };
}
function registerReels(app, { getDb, jobs, handlers, uploadDir, origin }) {
  let cleanup;
  app.addHook('onReady', async () => {
    if (process.env.NODE_ENV === 'test') return;
    const removeExpiredWork = async () => {
      const root = path.resolve(uploadDir, '.reel-work');
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      const db = await getDb();
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
        const target = path.resolve(root, entry.name);
        if (path.dirname(target) !== root) continue;
        const job = await db.collection('ai_jobs').findOne({ _id: entry.name });
        if (!job || ['done', 'cancelled'].includes(job.status)) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      }
    };
    await removeExpiredWork();
    cleanup = setInterval(() => { void removeExpiredWork().catch(() => {}) }, 3600000);
    cleanup.unref();
  });
  app.addHook('onClose', async () => clearInterval(cleanup));
  handlers.reel_render = createReelHandler({ getDb, uploadDir, origin });
  app.post('/reels/render', async (request, reply) => {
    try {
      const payload = await prepareReel(await getDb(), request.workspaceId, request.body || {}, origin);
      const job = await jobs.submit(request.workspaceId, 'reel_render', payload);
      return reply.code(202).send({ jobId: job._id });
    } catch (err) { return reply.code(err.statusCode || 400).send({ error: err.message }); }
  });
  app.delete('/reels/jobs/:id', async (request, reply) => {
    const job = await jobs.get(request.params.id, request.workspaceId);
    if (!job || job.type !== 'reel_render') return reply.code(404).send({ error: 'Render job not found' });
    return { success: await jobs.cancel(job._id, request.workspaceId) };
  });
  app.post('/reels/jobs/:id/retry', async (request, reply) => {
    const job = await jobs.get(request.params.id, request.workspaceId);
    if (!job || job.type !== 'reel_render') return reply.code(404).send({ error: 'Render job not found' });
    return { success: await jobs.retry(job._id, request.workspaceId) };
  });
}
module.exports = { prepareReel, createReelHandler, registerReels, sceneImage };
