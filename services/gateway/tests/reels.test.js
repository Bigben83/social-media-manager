const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');
const fakeDb = require('./fakeDb');
const { prepareReel, createReelHandler } = require('../reels');
const { probeFile } = require('../utils/mediaProbe');
const execute = promisify(execFile);

test('Reel scene validation enforces ownership, timing and soundtrack consent', async () => {
  const db = fakeDb();
  await db.collection('media_files').insertOne({ filename: 'owned.jpg', workspaceId: 'one', mimetype: 'image/jpeg' });
  await db.collection('media_files').insertOne({ filename: 'audio.mp3', workspaceId: 'one', mimetype: 'audio/mpeg' });
  const input = { scenes: [{ mediaUrl: '/media/owned.jpg', text: 'Hello', duration: 3 }] };
  expect((await prepareReel(db, 'one', input, 'https://manager.example')).scenes[0].filename).toBe('owned.jpg');
  await expect(prepareReel(db, 'other', input, 'https://manager.example')).rejects.toThrow('workspace');
  await expect(prepareReel(db, 'one', { ...input, audioUrl: '/media/audio.mp3' }, 'https://manager.example')).rejects.toThrow('permission');
  await expect(prepareReel(db, 'one', { scenes: [{ ...input.scenes[0], duration: 0 }] }, 'https://manager.example')).rejects.toThrow('duration');
});

test('real Reel render produces a reusable 1080x1920 H264/AAC video and checkpoints scenes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-test-'));
  const db = fakeDb();
  try {
    const buffer = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#9e2020' } }).jpeg().toBuffer();
    await fs.writeFile(path.join(directory, 'owned.jpg'), buffer);
    await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', path.join(directory, 'audio.mp3')], { windowsHide: true });
    for (const [filename, mimetype] of [['owned.jpg', 'image/jpeg'], ['audio.mp3', 'audio/mpeg']]) await db.collection('media_files').insertOne({ filename, workspaceId: 'one', mimetype });
    const payload = await prepareReel(db, 'one', { scenes: [{ mediaUrl: '/media/owned.jpg', duration: 3, text: 'Scene one & <test>' }, { mediaUrl: '/media/owned.jpg', duration: 3, text: 'Scene two', fit: 'cover' }], transition: 'fade', audioUrl: '/media/audio.mp3', audioRightsConfirmed: true }, 'https://manager.example');
    const job = { _id: 'render-test', workspaceId: 'one', payload };
    await db.collection('ai_jobs').insertOne({ _id: job._id, workspaceId: 'one', status: 'running' });
    const checkpoint = {};
    let interrupt = true;
    const ctx = { checkpoint, assertWorkspace: async () => {}, setProgress: async () => {}, saveCheckpoint: async patch => { Object.assign(checkpoint, patch); if (interrupt) { interrupt = false; throw new Error('Simulated worker restart'); } } };
    const handler = createReelHandler({ getDb: async () => db, uploadDir: directory, origin: 'https://manager.example' });
    await expect(handler(job, ctx)).rejects.toThrow('Simulated worker restart');
    expect(checkpoint.scenes).toEqual([0]);
    const result = await handler(job, ctx);
    expect(await probeFile(path.join(directory, 'reel-render-test.mp4'))).toMatchObject({ width: 1080, height: 1920, codec: 'h264', audioCodec: 'aac', fps: 30 });
    expect(result.duration).toBeCloseTo(6, 0);
    expect(checkpoint.scenes).toEqual([0, 1]);
    expect((await handler(job, ctx)).mediaUrl).toBe(result.mediaUrl);
    expect((await db.collection('media_files').find({ renderJobId: 'render-test' }).toArray())).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, 'owned.jpg'))).toEqual(buffer);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}, 60000);
