'use strict';
const axios = require('axios');
const { encryptToken } = require('./utils/crypto');
const GRAPH_API = 'https://graph.facebook.com/v22.0';

function pageReference(value) {
  if (typeof value !== 'string') throw new Error('Enter a Facebook Page URL or ID');
  let ref = value.trim();
  if (/^https?:\/\//i.test(ref)) {
    const url = new URL(ref);
    if (!['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname.toLowerCase())) throw new Error('Use a facebook.com Page URL');
    ref = url.pathname === '/profile.php' ? url.searchParams.get('id') : url.pathname.split('/').filter(Boolean)[0];
  }
  if (!ref || !/^[a-zA-Z0-9._-]{1,100}$/.test(ref)) throw new Error('Invalid Facebook Page URL or ID');
  return ref;
}

async function graphGet(endpoint, userToken, params = {}) {
  return (await axios.get(`${GRAPH_API}/${endpoint}`, { params: { ...params, access_token: userToken }, timeout: 15000 })).data;
}

async function listAll(endpoint, token, params = {}) {
  const items = [];
  let after;
  const seen = new Set();
  for (let batch = 0; batch < 100; batch++) {
    const result = await graphGet(endpoint, token, { ...params, limit: 100, ...(after && { after }) });
    items.push(...(result.data || []));
    if (!result.paging?.next) return items;
    after = result.paging.cursors?.after;
    if (!after || seen.has(after)) throw new Error('Meta returned invalid pagination; reconnect and retry');
    seen.add(after);
  }
  throw new Error('Meta returned too many results; discovery was not saved');
}

function safeError(err) {
  // Never persist URLs or request configs containing tokens.
  return err.response?.data?.error?.code ? `Meta API error ${err.response.data.error.code}` : 'Meta lookup failed; check access or reconnect';
}

async function discoverPage(reference, userToken) {
  const page = await graphGet(pageReference(reference), userToken, { fields: 'id,name,access_token,picture' });
  if (!page.access_token) throw new Error('This authorisation cannot obtain a Page token. Check Page access and reconnect.');
  const result = {
    pages: [{ id: page.id, name: page.name, picture: page.picture?.data?.url || null, accessToken: encryptToken(page.access_token), selected: false }],
    igAccounts: [], warnings: [],
  };
  try {
    const linked = await graphGet(page.id, page.access_token, { fields: 'instagram_business_account' });
    if (linked.instagram_business_account?.id) {
      const profile = await graphGet(linked.instagram_business_account.id, userToken, { fields: 'id,username,name,profile_picture_url' });
      result.igAccounts.push({ id: profile.id, username: profile.username || profile.name, name: profile.name, avatar: profile.profile_picture_url || null, pageId: page.id, accessToken: encryptToken(userToken), selected: false });
    }
  } catch (err) {
    result.warnings.push({ pageId: page.id, pageName: page.name, error: safeError(err) });
  }
  return result;
}

function mergeDiscovery(existing, incoming) {
  const merge = (a, b) => [...new Map([...a, ...b.map(item => ({ ...item, selected: a.find(old => old.id === item.id)?.selected ?? item.selected }))].map(item => [item.id, item])).values()];
  return { pages: merge(existing?.pages || [], incoming.pages || []), igAccounts: merge(existing?.igAccounts || [], incoming.igAccounts || []), warnings: incoming.warnings || [] };
}

// Refresh known accounts immediately; connecting new accounts still requires selection.
function refreshExistingAccounts(existing, incoming) {
  const byId = new Map(incoming.map(account => [account.id, account]));
  return existing.map(account => {
    const fresh = byId.get(account.id);
    return fresh ? { ...account, ...fresh, selected: account.selected } : account;
  });
}

async function discoverAccounts(userToken) {
  const pageIds = new Set((await listAll('me/accounts', userToken, { fields: 'id,name' })).map(p => p.id));
  const warnings = [];
  // Business client assets can be absent from /me/accounts.
  try {
    for (const business of await listAll('me/businesses', userToken, { fields: 'id,name' })) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try { for (const page of await listAll(`${business.id}/${edge}`, userToken, { fields: 'id,name' })) pageIds.add(page.id); }
        catch (err) { warnings.push({ pageName: business.name, error: safeError(err) }); }
      }
    }
  } catch (err) { warnings.push({ pageName: 'Business portfolios', error: safeError(err) }); }
  let result = { pages: [], igAccounts: [], warnings: [] };
  for (const id of pageIds) {
    try {
      const discovered = await discoverPage(id, userToken);
      warnings.push(...discovered.warnings);
      result = mergeDiscovery(result, discovered);
    } catch (err) { warnings.push({ pageId: id, error: safeError(err) }); }
  }
  return { ...result, warnings };
}

function publicDiscovery(discovery) {
  if (!discovery) return { pending: false, pages: [], igAccounts: [], warnings: [] };
  return {
    pending: true, discoveredAt: discovery.discoveredAt,
    pages: (discovery.pages || []).map(({ id, name, picture, selected }) => ({ id, name, picture, selected: !!selected })),
    igAccounts: (discovery.igAccounts || []).map(({ id, username, name, avatar, pageId, selected }) => ({ id, username, name, avatar, pageId, selected: !!selected })),
    warnings: discovery.warnings || [],
  };
}
module.exports = { pageReference, listAll, discoverPage, discoverAccounts, mergeDiscovery, publicDiscovery, refreshExistingAccounts };
