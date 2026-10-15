const { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('crypto');
const { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const { encryptToken, decryptToken } = require('./utils/crypto');
const SCOPES = ['social:read', 'social:drafts', 'social:publish', 'social:schedule'];
const hash = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function checkPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [type, salt, expected] = String(encoded).split(':');
  if (type !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
}
function createAuthProvider({ getDb, resourceUrl }) {
  const resource = resourceUrl.href;
  const table = async name => (await getDb()).collection(name);
  const checkResource = value => { if (value && String(value) !== resource) throw new InvalidTargetError('This token is only valid for the SocialManager MCP endpoint'); };
  const getGrant = async id => {
    const grant = await (await table('mcp_grants')).findOne({ _id: id });
    if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) throw new InvalidTokenError('Connector access expired or was revoked');
    return grant;
  };
  async function issueTokens(grant, scopes) {
    const accessToken = randomToken(), refreshToken = randomToken(), now = new Date();
    await (await table('mcp_tokens')).insertMany([
      { _id: hash(accessToken), kind: 'access', grantId: grant._id, clientId: grant.clientId, scopes, resource, expiresAt: new Date(Date.now() + 3600000), createdAt: now },
      { _id: hash(refreshToken), kind: 'refresh', used: false, grantId: grant._id, clientId: grant.clientId, scopes, resource, expiresAt: grant.expiresAt, createdAt: now },
    ]);
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') };
  }
  const provider = {
    clientsStore: {
      async getClient(id) {
        const doc = await (await table('mcp_clients')).findOne({ _id: id });
        if (!doc) return undefined;
        const { _id, ...client } = doc;
        if (client.client_secret) client.client_secret = decryptToken(client.client_secret);
        return client;
      },
      async registerClient(metadata) {
        if (!metadata.redirect_uris?.length || metadata.redirect_uris.length > 10) throw new InvalidClientMetadataError('Register between 1 and 10 redirect URLs');
        for (const raw of metadata.redirect_uris) {
          const url = new URL(raw);
          if (url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new InvalidClientMetadataError('Redirect URLs must use HTTPS or loopback HTTP');
        }
        const client = { ...metadata, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
        await (await table('mcp_clients')).insertOne({ ...client, _id: client.client_id, ...(client.client_secret && { client_secret: encryptToken(client.client_secret) }) });
        return client;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource);
      const scopes = params.scopes?.length ? [...new Set(params.scopes)] : SCOPES;
      if (scopes.some(scope => !SCOPES.includes(scope))) throw new InvalidScopeError('Unknown SocialManager permission');
      const id = randomUUID();
      await (await table('mcp_authorizations')).insertOne({ _id: id, clientId: client.client_id, clientName: client.client_name || 'MCP client', redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, state: params.state, scopes, resource, expiresAt: new Date(Date.now() + 600000) });
      res.redirect('/connector/authorize?request=' + id);
    },
    async approveAuthorization(id, workspaceIds, scopes) {
      const pending = await (await table('mcp_authorizations')).findOne({ _id: id, expiresAt: { $gt: new Date() } });
      if (!pending) throw new InvalidGrantError('Authorization request expired; connect again');
      if (!workspaceIds.length || !scopes.includes('social:read') || scopes.some(scope => !pending.scopes.includes(scope))) throw new InvalidScopeError('Select a workspace and only the requested permissions');
      const db = await getDb();
      for (const workspaceId of workspaceIds) { const ws = await db.collection('workspaces').findOne({ _id: workspaceId }); if (!ws || ws.deleting) throw new InvalidGrantError('Workspace is unavailable'); }
      const consumed = await (await table('mcp_authorizations')).findOneAndDelete({ _id: id, expiresAt: { $gt: new Date() } });
      if (!consumed) throw new InvalidGrantError('Authorization request was already used');
      const grant = { _id: randomUUID(), clientId: pending.clientId, clientName: pending.clientName, workspaceIds, scopes, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000) };
      await db.collection('mcp_grants').insertOne(grant);
      const code = randomToken();
      await db.collection('mcp_codes').insertOne({ _id: hash(code), grantId: grant._id, clientId: pending.clientId, codeChallenge: pending.codeChallenge, redirectUri: pending.redirectUri, resource, scopes, expiresAt: new Date(Date.now() + 300000) });
      const redirect = new URL(pending.redirectUri);redirect.searchParams.set('code', code);if (pending.state) redirect.searchParams.set('state',pending.state);
      return redirect.href;
    },
    async challengeForAuthorizationCode(client, code) {
      const doc = await (await table('mcp_codes')).findOne({ _id: hash(code), clientId: client.client_id, expiresAt: { $gt: new Date() } });
      if (!doc || doc.resource !== resource) throw new InvalidGrantError('Code expired or was already used');
      return doc.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, target) {
      checkResource(target);
      const codes = await table('mcp_codes');
      const doc = await codes.findOne({ _id: hash(code), clientId: client.client_id, expiresAt: { $gt: new Date() } });
      if (!doc || doc.resource !== resource || !redirectUri || doc.redirectUri !== redirectUri) throw new InvalidGrantError('Invalid code or redirect URL');
      const grant = await getGrant(doc.grantId);
      if (!await codes.findOneAndDelete({ _id: doc._id, clientId: client.client_id, expiresAt: { $gt: new Date() } })) throw new InvalidGrantError('Code was already used');
      return issueTokens(grant, doc.scopes);
    },
    async exchangeRefreshToken(client, token, requestedScopes, target) {
      checkResource(target);
      const tokens = await table('mcp_tokens');
      const doc = await tokens.findOne({ _id: hash(token), kind: 'refresh', clientId: client.client_id, expiresAt: { $gt: new Date() } });
      if (!doc || doc.resource !== resource) throw new InvalidGrantError('Refresh token expired');
      const grant = await getGrant(doc.grantId);
      const scopes = requestedScopes?.length ? [...new Set(requestedScopes)] : doc.scopes;
      if (scopes.some(scope => !doc.scopes.includes(scope))) throw new InvalidScopeError('Cannot increase permissions during refresh');
      const consumed = await tokens.updateOne({ _id: doc._id, used: false }, { $set: { used: true } });
      if (!consumed.matchedCount) { await provider.revokeGrant(grant._id);throw new InvalidGrantError('Refresh token replay detected; reconnect'); }
      return issueTokens(grant, scopes);
    },
    async verifyAccessToken(token) {
      const doc = await (await table('mcp_tokens')).findOne({ _id: hash(token), kind: 'access', expiresAt: { $gt: new Date() } });
      if (!doc || doc.resource !== resource) throw new InvalidTokenError('Access token expired or is invalid');
      const grant = await getGrant(doc.grantId);
      return { token, clientId: doc.clientId, scopes: doc.scopes, expiresAt: Math.floor(doc.expiresAt.getTime() / 1000), resource: new URL(resource), extra: { grantId: grant._id, workspaceIds: grant.workspaceIds } };
    },
    async revokeGrant(id) { await (await table('mcp_grants')).updateOne({ _id: id }, { $set: { revokedAt: new Date() } }); },
    async revokeToken(client, request) {
      const doc = await (await table('mcp_tokens')).findOne({ _id: hash(request.token), clientId: client.client_id });
      if (doc) await provider.revokeGrant(doc.grantId);
    },
    getGrant,
  };
  return provider;
}
module.exports = { SCOPES, hash, randomToken, passwordHash, checkPassword, createAuthProvider };
