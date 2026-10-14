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
const { useComposeStore } = load('../src/stores/compose.ts');
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
