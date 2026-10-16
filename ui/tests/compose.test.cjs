const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const pinia = require('pinia');
const axios = { post: async () => ({ data: {} }), defaults: { headers: { common: {} } } };
const modules = new Map();
function load(file) {
  file = path.resolve(__dirname, file);
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} }; modules.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, crypto: require('crypto').webcrypto, console,
    require: name => name === 'axios' ? axios : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts') : require(name) });
  return module.exports;
}
const { useComposeStore, draftMediaUrl } = load('../src/stores/compose.ts');
let store;
beforeEach(() => {
  pinia.setActivePinia(pinia.createPinia()); store = useComposeStore(); store.content = 'Keep this post';
  store.destinations = [{ key: 'facebook:one', platform: 'facebook', accountId: 'one', selected: true }, { key: 'facebook:two', platform: 'facebook', accountId: 'two', selected: true }];
});
test('failed deliveries retain content and report each account', async () => {
  axios.post = async () => ({ data: { results: [{ platform: 'facebook', accountId: 'one', success: false, error: 'No access' }] } });
  assert.equal(await store.post(), false); assert.equal(store.content, 'Keep this post'); assert.equal(store.lastResult.ok, false);
});
test('partial publishing deselects successful destinations and retains the rest', async () => {
  axios.post = async () => ({ data: { results: [{ platform: 'facebook', accountId: 'one', success: true }, { platform: 'facebook', accountId: 'two', success: false }] } });
  await store.post(); assert.equal(store.destinations[0].selected, false); assert.equal(store.destinations[1].selected, true); assert.equal(store.content, 'Keep this post');
});
test('confirmed success clears the editor but retains the success message', async () => {
  axios.post = async () => ({ data: { results: [{ platform: 'facebook', accountId: 'one', success: true }, { platform: 'facebook', accountId: 'two', success: true }] } });
  assert.equal(await store.post(), true); assert.equal(store.content, ''); assert.equal(store.lastResult.ok, true);
});
test('videos are sent as videoUrl and retries retain the same request key', async () => {
  store.mediaUrl = 'https://example.com/video.mp4'; const calls = [];
  axios.post = async (...args) => { calls.push(args); throw new Error('Connection interrupted'); };
  await store.post(); await store.post();
  assert.equal(calls[0][1].destinations[0].videoUrl, store.mediaUrl); assert.equal(calls[0][1].destinations[0].imageUrl, undefined);
  assert.equal(calls[0][2].headers['Idempotency-Key'], calls[1][2].headers['Idempotency-Key']);
});

test('legacy MCP images load, survive editing and save, and reach publishing', async () => {
  const url = 'https://example.com/media/owned.png';
  store.loadDraft({ _id: 'draft-one', content: 'Image draft', mediaUrl: '', destinations: [{ key: 'facebook:one', selected: true, imageUrl: url }] });
  assert.equal(store.mediaUrl, url);
  assert.equal(store.destinations[1].selected, false);
  let saved, posted;
  axios.put = async (_, payload) => { saved = payload; return { data: { success: true } }; };
  store.content = 'Edited image draft';
  assert.equal(await store.saveDraft(), true); assert.equal(saved.mediaUrl, url);
  axios.post = async (_, payload) => { posted = payload; return { data: { results: [{ platform: 'facebook', accountId: 'one', success: true }] } }; };
  assert.equal(await store.post(), true); assert.equal(posted.destinations[0].imageUrl, url);
});

test('legacy MCP videos reach scheduling and removing an image persists after reload', async () => {
  const destination = { key: 'facebook:one', selected: true, videoUrl: 'https://example.com/media/clip.mp4' };
  store.loadDraft({ _id: 'draft-one', content: 'Video draft', mediaUrl: '', destinations: [destination] });
  store.scheduledAt = '2026-11-01T10:00'; let scheduled;
  axios.post = async (_, payload) => { scheduled = payload; return { data: { success: true } }; };
  assert.equal(await store.post('Australia/Sydney'), true);
  assert.equal(scheduled.destinations[0].videoUrl, destination.videoUrl);
  store.loadDraft({ _id: 'draft-one', content: 'Remove image', mediaUrl: '', destinations: [{ key: 'facebook:one', selected: true, imageUrl: 'https://example.com/media/owned.png' }] });
  store.mediaUrl = ''; let saved;
  axios.put = async (_, payload) => { saved = payload; return { data: { success: true } }; };
  await store.saveDraft(); store.loadDraft({ _id: 'draft-one', ...saved });
  assert.equal(store.mediaUrl, '');
});

test('draft attachment lookup prioritizes the editor field and loading a text-only draft clears old state', () => {
  assert.equal(draftMediaUrl({ mediaUrl: 'replacement.png', destinations: [{ imageUrl: 'old.png' }] }), 'replacement.png');
  assert.equal(draftMediaUrl({ mediaUrl: '', destinations: [{ imageUrl: 'one.png' }, { imageUrl: 'two.png' }] }), '');
  store.mediaUrl = 'old.png'; store.loadDraft({ _id: 'empty', content: 'Text only', mediaUrl: '', destinations: [] });
  assert.equal(store.mediaUrl, ''); assert.equal(store.selectedDestinations.length, 0);
});

test('Instagram placement and Reel options survive draft reload, save and dispatch', async () => {
  store.destinations = [{ key: 'instagram:one', platform: 'instagram', accountId: 'one', selected: false }];
  store.loadDraft({ _id: 'draft', content: 'Reel', mediaUrl: '/media/reel.mp4', destinations: [{ key: 'instagram:one:reel', platform: 'instagram', accountId: 'one', selected: true, instagramPlacement: 'reel', shareToFeed: false, coverUrl: '/media/cover.jpg' }] });
  let saved, sent;
  axios.put = async (_, value) => { saved = value; return { data: {} }; };
  await store.saveDraft();
  assert.equal(saved.destinations[0].instagramPlacement, 'reel');
  assert.equal(saved.destinations[0].shareToFeed, false);
  axios.post = async (_, value) => { sent = value; return { data: { results: [{ platform: 'instagram', accountId: 'one', instagramPlacement: 'reel', success: true }] } }; };
  await store.post();
  assert.equal(sent.destinations[0].coverUrl, '/media/cover.jpg');
  assert.equal(sent.destinations[0].shareToFeed, false);
});
