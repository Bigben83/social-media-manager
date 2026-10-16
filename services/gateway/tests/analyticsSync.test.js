const Fastify = require('fastify');
const { createAnalyticsSync, registerAnalyticsSync } = require('../analyticsSync');
const { createBackgroundJobs } = require('../jobs');
const fakeDb = require('./fakeDb');

function fixture() {
  const db = fakeDb(), http = { get: jest.fn() };
  const credentials = {
    facebook: { pages: [{ id: 'page', name: 'Page', selected: true, accessToken: 'encrypted' }] },
    instagram: { accounts: [{ id: 'ig', username: 'example', selected: true, accessToken: 'encrypted' }] },
  };
  const getCredentials = jest.fn(async (ws, platform) => ws === 'a' ? credentials[platform] : null);
  const deps = { getDb: async () => db, http, getCredentials, decryptToken: () => 'private-token' };
  const checkpoint = {}, progress = {};
  const context = { checkpoint, assertWorkspace: jest.fn(async () => {}), saveCheckpoint: async patch => Object.assign(checkpoint, structuredClone(patch)), setProgress: async patch => Object.assign(progress, structuredClone(patch)) };
  return { ...deps, db, credentials, checkpoint, progress, context, run: createAnalyticsSync(deps) };
}
const fbPost = id => ({ id, message: id, created_time: '2025-02-01T12:00:00Z', reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } });
const igPost = id => ({ id, caption: id, timestamp: '2024-02-01T12:00:00Z', like_count: 5, comments_count: 2 });
const page = (data, after) => ({ data: { data, ...(after && { paging: { next: 'https://untrusted.example/never-follow?access_token=secret', cursors: { after } } }) } });

test('all history follows canonical cursor requests, upserts native identities and keeps reach separate from views', async () => {
  const f = fixture();
  f.http.get.mockImplementation(async (url, config) => {
    expect(url.startsWith('https://graph.facebook.com/v22.0/')).toBe(true);
    if (url.endsWith('/page/posts')) return config.params.after ? page([fbPost('page_2')]) : page([fbPost('page_1')], 'next');
    if (url.endsWith('/ig/media')) return page([igPost('ig_1')]);
    return { data: { data: [{ name: 'reach', values: [{ value: 50 }] }, { name: 'saved', values: [{ value: 3 }] }] } };
  });
  expect((await f.run({ workspaceId: 'a', payload: { history: 'all' } }, f.context)).total).toBe(3);
  const rows = await f.db.collection('post_metrics').find({ workspaceId: 'a' }).toArray();
  expect(rows).toHaveLength(3);
  expect(rows.find(r => r.platform === 'instagram').metrics).toMatchObject({ reach: 50, views: null, saves: 3, likes: 5, comments: 2 });
  expect(f.http.get.mock.calls[1][1].params.after).toBe('next');
  expect(JSON.stringify(f.checkpoint)).not.toContain('private-token');
  await f.run({ workspaceId: 'a', payload: { history: 'all' } }, { ...f.context, checkpoint: {} });
  expect(await f.db.collection('post_metrics').countDocuments({ workspaceId: 'a' })).toBe(3);
  expect(f.getCredentials.mock.calls.every(([ws]) => ws === 'a')).toBe(true);
});

test('failure retains the last completed page and retry skips completed accounts', async () => {
  const f = fixture();
  f.http.get.mockImplementation(async (url, config) => {
    if (url.endsWith('/page/posts')) return page([fbPost('page_1')]);
    if (url.endsWith('/ig/media')) {
      if (config.params.after) throw Object.assign(new Error('secret token in axios URL'), { response: { data: { error: { code: 190 } } } });
      return page([igPost('ig_1')], 'resume-here');
    }
    throw new Error('Insights unavailable');
  });
  await expect(f.run({ workspaceId: 'a', payload: { history: 'all' } }, f.context)).rejects.toThrow('Some accounts');
  expect(f.checkpoint.accounts['facebook:page'].done).toBe(true);
  expect(f.checkpoint.accounts['instagram:ig']).toMatchObject({ count: 1, after: 'resume-here', insightsUnavailable: 1 });
  expect(f.progress.errors[0].error).toContain('Access expired');
  expect(JSON.stringify(f.checkpoint)).not.toContain('secret token');
  f.http.get.mockReset();
  f.http.get.mockImplementation(async (url, config) => {
    expect(url.endsWith('/ig/media')).toBe(true);
    expect(config.params.after).toBe('resume-here');
    return page([]);
  });
  expect((await f.run({ workspaceId: 'a', payload: { history: 'all' } }, f.context)).total).toBe(2);
  expect(f.http.get).toHaveBeenCalledTimes(1);
  expect(f.progress.errors).toEqual([]);
});

test('recent sync and an account filter read only one page of that account', async () => {
  const f = fixture();
  f.http.get.mockResolvedValue(page([fbPost('page_1')], 'more'));
  await f.run({ workspaceId: 'a', payload: { history: 'recent', account: 'facebook:page' } }, f.context);
  expect(f.http.get).toHaveBeenCalledTimes(1);
  expect(Object.keys(f.checkpoint.accounts)).toEqual(['facebook:page']);
  expect(f.checkpoint.accounts['facebook:page'].done).toBe(true);
});

test('workspace removal during a request prevents history writes', async () => {
  const f = fixture();
  f.http.get.mockImplementation(async () => {
    f.context.assertWorkspace.mockRejectedValue(new Error('Workspace no longer available'));
    return page([fbPost('page_1')]);
  });
  await expect(f.run({ workspaceId: 'a', payload: { history: 'all', account: 'facebook:page' } }, f.context)).rejects.toThrow('Workspace');
  expect(await f.db.collection('post_metrics').countDocuments({})).toBe(0);
});

test('repeated cursors fail visibly rather than loop or report truncated success', async () => {
  const f = fixture();
  f.http.get.mockResolvedValue(page([], 'same'));
  await expect(f.run({ workspaceId: 'a', payload: { history: 'all', account: 'facebook:page' } }, f.context)).rejects.toThrow('Some accounts');
  expect(f.http.get).toHaveBeenCalledTimes(2);
  expect(f.progress.errors[0].error).toContain('incomplete page');
});

test('sync routes recover status after reload, hide other workspaces and reject invalid requests', async () => {
  const f = fixture(), app = Fastify(), handlers = {};
  const queue = { add: jest.fn(), getJob: async () => null };
  const jobs = createBackgroundJobs({ getDb: f.getDb, handlers, queue });
  app.addHook('preHandler', async request => { request.workspaceId = request.headers['x-workspace-id'] || 'a'; });
  registerAnalyticsSync(app, { ...f, jobs, handlers });
  await app.ready();
  try {
    const request = (method, url, ws, payload) => app.inject({ method, url, headers: { 'x-workspace-id': ws }, payload });
    const first = await request('POST', '/analytics/crawl', 'a', { history: 'all' });
    expect(first.statusCode).toBe(202);
    const id = first.json().jobId;
    expect((await request('POST', '/analytics/crawl', 'a', { history: 'recent' })).json().jobId).toBe(id);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect((await request('GET', '/analytics/sync', 'a')).json().job.jobId).toBe(id);
    expect((await request('GET', '/analytics/sync', 'b')).json().job).toBe(null);
    expect((await request('POST', `/analytics/sync/${id}/retry`, 'b', {})).statusCode).toBe(404);
    expect((await request('POST', '/analytics/crawl', 'a', { history: 'everything' })).statusCode).toBe(400);
    expect((await request('POST', '/analytics/crawl', 'a', { account: {} })).statusCode).toBe(400);
    await f.db.collection('ai_jobs').updateOne({ _id: id }, { $set: { status: 'failed', checkpoint: { saved: true } } });
    expect((await request('POST', `/analytics/sync/${id}/retry`, 'a', {})).statusCode).toBe(202);
    expect((await jobs.get(id, 'a')).checkpoint).toEqual({ saved: true });
  } finally { await app.close(); }
});
