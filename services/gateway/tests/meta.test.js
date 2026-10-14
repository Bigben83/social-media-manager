jest.mock('axios');
const axios = require('axios');
const { pageReference, listAll, discoverPage, publicDiscovery, mergeDiscovery } = require('../meta');
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

beforeEach(() => jest.resetAllMocks());

test('accepts Facebook URLs and rejects arbitrary hosts and Graph paths', () => {
  expect(pageReference('https://www.facebook.com/rackxapp')).toBe('rackxapp');
  expect(pageReference('https://www.facebook.com/profile.php?id=1389753804217664')).toBe('1389753804217664');
  expect(() => pageReference('https://example.com/rackxapp')).toThrow();
  expect(() => pageReference('../me')).toThrow();
});

test('follows cursors through every results page', async () => {
  axios.get.mockResolvedValueOnce({ data: { data: [{ id: 'one' }], paging: { next: 'ignored', cursors: { after: 'next' } } } })
    .mockResolvedValueOnce({ data: { data: [{ id: 'two' }] } });
  expect(await listAll('me/accounts', 'secret')).toEqual([{ id: 'one' }, { id: 'two' }]);
  expect(axios.get.mock.calls[1][1].params.after).toBe('next');
});

test('direct lookup includes the linked Instagram account but public results contain no tokens', async () => {
  axios.get.mockResolvedValueOnce({ data: { id: 'page', name: 'Rack-X', access_token: 'page-secret' } })
    .mockResolvedValueOnce({ data: { instagram_business_account: { id: 'ig' } } })
    .mockResolvedValueOnce({ data: { id: 'ig', username: 'rackx.app' } });
  const discovery = await discoverPage('rackxapp', 'user-secret');
  expect(discovery.igAccounts[0].pageId).toBe('page');
  expect(discovery.pages[0].accessToken).toMatch(/^ENC:v1:/);
  const result = publicDiscovery(discovery);
  expect(result.pages[0].accessToken).toBeUndefined();
  expect(result.igAccounts[0].accessToken).toBeUndefined();
});

test('does not misrepresent a failed Instagram lookup as no linked account', async () => {
  axios.get.mockResolvedValueOnce({ data: { id: 'page', name: 'Rack-X', access_token: 'secret' } })
    .mockRejectedValueOnce({ response: { data: { error: { code: 200 } } } });
  const result = await discoverPage('rackxapp', 'secret');
  expect(result.warnings).toEqual([{ pageId: 'page', pageName: 'Rack-X', error: 'Meta API error 200' }]);
});

test('rejects Pages without a usable Page token and preserves existing selections', async () => {
  axios.get.mockResolvedValueOnce({ data: { id: 'page', name: 'Rack-X' } });
  await expect(discoverPage('rackxapp', 'secret')).rejects.toThrow('cannot obtain a Page token');
  const result = mergeDiscovery({ pages: [{ id: 'page', selected: true }] }, { pages: [{ id: 'page', selected: false, name: 'updated' }], igAccounts: [] });
  expect(result.pages).toEqual([{ id: 'page', selected: true, name: 'updated' }]);
});
