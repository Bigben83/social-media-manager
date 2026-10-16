const sharp = require('sharp');
const { normalizeImage } = require('../imageAssets');
test('provider output becomes exact 9:16 and 3:4 JPEG without stretching', async () => {
  const input = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#ff0000' } }).png().toBuffer();
  for (const [aspect, width, height] of [['9:16', 1080, 1920], ['3:4', 1080, 1440]]) {
    const result = await normalizeImage(input, aspect);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata).toMatchObject({ width, height, format: 'jpeg' });
    expect(result.adjusted).toBe(true);
    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
  }
  const cropped = await normalizeImage(input, '3:4', 'cover');
  const pixel = await sharp(cropped.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  expect(pixel[0]).toBeGreaterThan(245); expect(pixel[1]).toBeLessThan(10);
});
test('image preparation rejects corrupt input and unsupported ratios', async () => {
  await expect(normalizeImage(Buffer.from('not an image'), '3:4')).rejects.toThrow();
  await expect(normalizeImage(Buffer.alloc(0), '4:3')).rejects.toThrow('supported');
});
