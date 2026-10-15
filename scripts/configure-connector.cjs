// Configure only the MCP connector; the application's existing access is unchanged.
const fs = require('fs');
const path = require('path');
const { randomBytes, scryptSync } = require('crypto');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
if (!args.includes('--url')) throw new Error('Usage: node scripts/configure-connector.cjs --url https://manager.example/mcp [--secret-file /private/path] [--rotate]');
const url = new URL(value('--url'));
if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) throw new Error('Use a public HTTPS /mcp URL');
const envPath = path.join(root, '.env');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n') : '';
const secretPath = args.includes('--secret-file') ? path.resolve(value('--secret-file')) : path.join(root, '.connector-owner-password');
const existingHash = /^MCP_ADMIN_PASSWORD_HASH=(.+)$/m.exec(env)?.[1];
if (!existingHash || args.includes('--rotate')) {
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  const password = fs.existsSync(secretPath) && !args.includes('--rotate') ? fs.readFileSync(secretPath, 'utf8').trim() : randomBytes(24).toString('base64url');
  if (password.length < 20) throw new Error('The private password file must contain at least 20 characters');
  fs.writeFileSync(secretPath, password + '\n', { mode: 0o600 });
  fs.chmodSync(secretPath, 0o600);
  const salt = randomBytes(16).toString('hex');
  const encoded = 'scrypt:' + salt + ':' + scryptSync(password, salt, 64).toString('hex');
  env = env.replace(/^MCP_ADMIN_PASSWORD_HASH=.*\n?/gm, '');
  env += (env.endsWith('\n') || !env ? '' : '\n') + 'MCP_ADMIN_PASSWORD_HASH=' + encoded + '\n';
}
env = env.replace(/^MCP_PUBLIC_URL=.*\n?/gm, '');
env += (env.endsWith('\n') || !env ? '' : '\n') + 'MCP_PUBLIC_URL=' + url.href + '\n';
fs.writeFileSync(envPath, env, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);
console.log('Connector configuration saved. Read the owner password privately from: ' + secretPath);
console.log('Recreate the connector container to apply it: docker compose up -d --force-recreate connector');
