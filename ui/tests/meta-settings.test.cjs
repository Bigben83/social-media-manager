const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { createPinia, setActivePinia } = require('pinia');
const { createI18n } = require('vue-i18n');
const { renderToString } = require('@vue/server-renderer');
const { parse, compileScript } = require('@vue/compiler-sfc');

const axios = { defaults: { headers: { common: {} } } };
const modules = new Map();
function load(file) {
  file = path.resolve(__dirname, file);
  if (modules.has(file)) return modules.get(file);
  let source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.vue')) {
    source = compileScript(parse(source, { filename: file }).descriptor, { id: file, inlineTemplate: true }).content;
  }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console, setTimeout, Intl,
    localStorage: { getItem: () => null },
    require: name => name === 'axios' ? axios
      : name === 'vue-router' ? { useRoute: () => ({ query: {} }), useRouter: () => ({}) }
      : name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + (name.endsWith('.vue') ? '' : '.ts')) : require(name),
  });
  modules.set(file, module.exports);
  return module.exports;
}
const { usePlatformsStore } = load('../src/stores/platforms.ts');
const Settings = load('../src/views/Settings.vue').default;
const AccountAvatar = load('../src/components/AccountAvatar.vue').default;
let pinia, store;
beforeEach(() => {
  pinia = createPinia(); setActivePinia(pinia); store = usePlatformsStore();
});

test('saved accounts load even when publishing capabilities are unavailable', async () => {
  axios.get = async url => {
    if (url.endsWith('/capabilities')) throw new Error('Temporarily unavailable');
    return { data: { facebook: { pages: [{ id: 'page' }], allPages: [{ id: 'page', selected: true }] }, instagram: { accounts: [{ id: 'ig' }] } } };
  };
  await store.fetchMetaConnections();
  assert.equal(store.connectedPages[0].id, 'page');
  assert.equal(store.connectedIgAccounts[0].id, 'ig');
  assert.equal(store.allFbPages[0].selected, true);
});

test('refresh reloads saved pictures immediately and keeps new accounts in discovery', async () => {
  store.connectedPages = [{ id: 'page', picture: 'expired' }];
  axios.post = async () => ({ data: { pending: true, pages: [{ id: 'page' }, { id: 'new' }], igAccounts: [] } });
  axios.get = async url => ({ data: url.endsWith('/capabilities') ? { publishing: ['facebook'] } : { facebook: { pages: [{ id: 'page', picture: 'fresh' }], allPages: [{ id: 'page', picture: 'fresh', selected: true }] } } });
  assert.equal(await store.refreshMetaDiscovery(), true);
  assert.equal(store.connectedPages[0].picture, 'fresh');
  assert.equal(store.connectedPages.length, 1);
  assert.equal(store.metaDiscovery.pages.length, 2);
});

async function settingsHtml() {
  const app = vue.createSSRApp(Settings).use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en: load('../src/locales/en.ts').default } }));
  app.component('router-link', { setup: (_, { slots }) => () => vue.h('a', slots.default?.()) });
  app.component('font-awesome-icon', { props: ['icon'], render() { return vue.h('span', { 'data-icon': this.icon }); } });
  return renderToString(app);
}

test('Settings keeps deselected saved accounts visible when health checks fail', async () => {
  store.metaCredentials = { configured: true };
  store.statuses = [{ platform: 'facebook', connected: false, error: 'Token expired' }];
  store.allFbPages = [{ id: 'page', name: 'Workspace Page', selected: false }];
  store.allIgAccounts = [{ id: 'ig', username: 'workspace.ig', selected: false }];
  const html = await settingsHtml();
  assert.ok(html.includes('Workspace Page'));
  assert.ok(html.includes('@workspace.ig'));
  assert.ok(html.includes('Save Selection'));
  assert.ok(html.includes('fa-brands fa-facebook'));
  assert.ok(html.includes('fa-brands fa-instagram'));
  assert.ok(!html.includes('Connect with Facebook &amp; Instagram'));
});

test('an empty workspace shows the connect action without another workspace accounts', async () => {
  store.metaCredentials = { configured: true };
  const html = await settingsHtml();
  assert.ok(html.includes('Connect with Facebook &amp; Instagram'));
  assert.ok(!html.includes('Save Selection'));
});

test('a failed avatar shows the platform icon and a refreshed URL retries the image', async () => {
  const node = (type, text = '') => ({ type, text, children: [], props: {} });
  const renderer = vue.createRenderer({
    createElement: node, createText: text => node('text', text), createComment: text => node('comment', text),
    setText: (el, text) => { el.text = text; }, setElementText: (el, text) => { el.text = text; },
    patchProp: (el, key, _, value) => { el.props[key] = value; },
    insert(el, parent, anchor) { el.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, el); },
    remove(el) { el.parent.children.splice(el.parent.children.indexOf(el), 1); },
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1],
  });
  const src = vue.ref('expired.jpg');
  const app = renderer.createApp({ render: () => vue.h(AccountAvatar, { src: src.value, platform: 'instagram' }) });
  app.component('font-awesome-icon', { render: () => vue.h('icon') });
  const root = node('root'); app.mount(root);
  const avatar = root.children[0];
  assert.equal(avatar.children[0].type, 'img');
  avatar.children[0].props.onError(); await vue.nextTick();
  assert.equal(avatar.children[0].type, 'icon');
  src.value = 'fresh.jpg'; await vue.nextTick();
  assert.equal(avatar.children[0].type, 'img');
  assert.equal(avatar.children[0].props.src, 'fresh.jpg');
  app.unmount();
});
