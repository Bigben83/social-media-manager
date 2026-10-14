const { matchesSignature } = require('../media');
test('media signatures reject disguised HTML and mismatched extensions', () => {
  expect(matchesSignature(Buffer.from('<html>not a picture</html>'), '.png')).toBe(false);
  expect(matchesSignature(Buffer.from('GIF89a'), '.jpg')).toBe(false);
  expect(matchesSignature(Buffer.from('GIF89a'), '.gif')).toBe(true);
  expect(matchesSignature(Buffer.from([137,80,78,71,13,10,26,10]), '.png')).toBe(true);
  expect(matchesSignature(Buffer.from('RIFF0000WEBP'), '.webp')).toBe(true);
  expect(matchesSignature(Buffer.from('RIFF0000AVI '), '.avi')).toBe(true);
});
