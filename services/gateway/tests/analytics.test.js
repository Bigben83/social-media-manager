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
