const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/utils/analytics.ts'), 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleObject.exports });
const { auditErrorMessage } = moduleObject.exports;
test('provider and server errors never become not-enough-posts messages', () => {
  assert.equal(auditErrorMessage({ response: { data: { error: 'Audit failed', detail: 'Provider authentication failed' } } }, 'Connection failed'), 'Audit failed: Provider authentication failed');
  assert.equal(auditErrorMessage({ response: { data: { error: 'No published posts are available for this account filter.' } } }, 'Connection failed'), 'No published posts are available for this account filter.');
  assert.equal(auditErrorMessage(new Error('Network error'), 'Check connection'), 'Check connection');
  assert.equal(auditErrorMessage({ response: { data: '<html>Proxy timeout</html>' } }, 'Check connection'), 'Check connection');
});
