const { destinationMatch, historyPipeline, normalizePost, summaryAccumulator } = require('../analytics');
test('an account filter must match platform and ID within the same destination', () => {
  expect(destinationMatch({ platform: 'facebook', accountId: 'one' })).toEqual({ destinations: { $elemMatch: { platform: 'facebook', accountId: 'one' } } });
});
test('scheduled and immediate posts share one pagination pipeline', () => {
  const pipeline=historyPipeline('ws',null);
  expect(pipeline[0].$match.workspaceId).toBe('ws');
  expect(pipeline[0].$match.status.$in).toContain('published');
  expect(pipeline[2].$unionWith.pipeline[0].$match.workspaceId).toBe('ws');
  expect(()=>historyPipeline('ws',null,'2026-99')).toThrow();
});
test('partial posts are correctly attributed to the selected account', () => {
  const post={_id:'post',type:'scheduled',status:'partial',destinations:[{platform:'facebook',accountId:'one'},{platform:'facebook',accountId:'two'}],platformResults:{'facebook:one':{success:true},'facebook:two':{success:false}}};
  expect(normalizePost(post,{platform:'facebook',accountId:'one'}).status).toBe('published');
  expect(normalizePost(post,{platform:'facebook',accountId:'two'}).status).toBe('failed');
  expect(normalizePost(post,null).status).toBe('partial');
});
test('summary counts partial posts separately and uses confirmed destination success', () => {
  const now=Date.now();const summary=summaryAccumulator(now);
  summary.add(normalizePost({_id:'post',type:'immediate',status:'partial',publishedAt:new Date(now),destinations:[{platform:'facebook',accountId:'one'},{platform:'facebook',accountId:'two'}],platformResults:{'facebook:one':{success:true},'facebook:two':{success:false}}}));
  expect(summary.result()).toMatchObject({total:1,published:0,partial:1,failed:0,successRate:50,byPlatform:{facebook:1},recentCount:1});
});

test('imported activity is counted without changing app delivery outcomes', () => {
  const now = Date.now(), summary = summaryAccumulator(now);
  const imported = normalizePost({ _id: 'old', type: 'imported', status: 'published', publishedAt: new Date(now), content: 'Native post', destinations: [{ platform: 'instagram', accountId: 'one' }], metrics: { likes: 12 } });
  summary.add(imported);
  expect(imported.metrics.likes).toBe(12);
  expect(summary.result()).toMatchObject({ total: 1, imported: 1, published: 0, deliveries: 0, byPlatform: { instagram: 1 }, recentCount: 1 });
  summary.add(normalizePost({ _id: 'failed', type: 'immediate', status: 'failed', destinations: [{ platform: 'instagram', accountId: 'one' }], platformResults: { 'instagram:one': { success: false } } }));
  expect(summary.result()).toMatchObject({ total: 2, imported: 1, failed: 1, deliveries: 1, successRate: 0 });
});

test('historical imports and receipt lookups stay scoped to the workspace and account', () => {
  const imported = historyPipeline('private', { platform: 'instagram', accountId: 'one' })[3].$unionWith.pipeline;
  expect(imported[0].$match).toMatchObject({ workspaceId: 'private', platform: 'instagram', accountId: 'one' });
  for (const stage of imported.filter(s => s.$lookup)) {
    expect(stage.$lookup.pipeline[0].$match.workspaceId).toBe('private');
  }
});
