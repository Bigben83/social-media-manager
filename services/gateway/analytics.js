'use strict';
const { destinationKey } = require('./utils/publishing');
function accountFilter(account) {
  if (!account) return null;
  if (typeof account !== 'string' || account.length > 200) throw new Error('Invalid account filter');
  const [platform, ...rest] = account.split(':');
  return { platform, ...(rest.length && { accountId: rest.join(':') }) };
}
function destinationMatch(filter) { return filter ? { destinations: { $elemMatch: { platform: filter.platform, ...(filter.accountId && { accountId: filter.accountId }) } } } : {}; }
// Facebook may return PAGE_POST or POST in publishing receipts. Compare only
// within the same workspace and account; captions are never an identity key.
function nativeId(value) { return { $cond: [{ $eq: ['$$platform', 'facebook'] }, { $arrayElemAt: [{ $split: [{ $convert: { input: value, to: 'string', onNull: '', onError: '' } }, '_'] }, -1] }, { $convert: { input: value, to: 'string', onNull: '', onError: '' } }] }; }
function importedPipeline(ws, filter) {
  const receiptMatch = { $anyElementTrue: [{ $map: {
    input: { $objectToArray: { $ifNull: ['$platformResults', {}] } }, as: 'receipt',
    in: { $and: [
      { $in: ['$$receipt.k', ['$$key', { $concat: ['$$key', ':story'] }, { $concat: ['$$key', ':reel'] }]] },
      { $eq: [nativeId('$$receipt.v.postId'), nativeId('$$postId')] },
    ] },
  } }] };
  const lookups = ['posts', 'scheduled_jobs'].flatMap((from, i) => [
    { $lookup: { from, let: { platform: '$platform', key: { $concat: ['$platform', ':', '$accountId'] }, postId: '$postId' }, pipeline: [
      { $match: { workspaceId: ws, $expr: receiptMatch } }, { $limit: 1 }, { $project: { _id: 1 } },
    ], as: `receipt${i}` } },
    { $match: { [`receipt${i}.0`]: { $exists: false } } },
  ]);
  return [
    { $match: { workspaceId: ws, platform: { $in: ['facebook', 'instagram'] }, postId: { $type: 'string', $ne: '' }, accountId: { $type: 'string' }, ...(filter && { platform: filter.platform, ...(filter.accountId && { accountId: filter.accountId }) }) } },
    { $sort: { fetchedAt: -1, _id: -1 } },
    { $group: { _id: { platform: '$platform', accountId: '$accountId', postId: '$postId' }, doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    ...lookups,
    { $project: { _id: 1, type: { $literal: 'imported' }, content: 1, publishedAt: 1, permalink: 1, metrics: 1,
      status: { $literal: 'published' },
      destinations: [{ platform: '$platform', accountId: '$accountId' }],
      platformResults: { $arrayToObject: [[{ k: { $concat: ['$platform', ':', '$accountId'] }, v: { success: true, postId: '$postId' } }]] },
    } },
  ];
}
function historyPipeline(ws, filter, month) {
  const scoped = { workspaceId: ws, ...destinationMatch(filter) };
  const pipeline = [
    { $match: { ...scoped, status: { $in: ['completed','published','partial','failed'] } } },
    { $project: { _id: 1, type: { $literal: 'scheduled' }, content: 1, destinations: 1, platformResults: 1, status: { $cond: [{ $eq: ['$status','completed'] },'published','$status'] }, publishedAt: { $ifNull: ['$completedAt','$scheduledAt'] } } },
    { $unionWith: { coll: 'posts', pipeline: [
      { $match: { ...scoped, type: 'immediate', status: { $in: ['published','partial','failed'] } } },
      { $project: { _id: 1, type: 1, content: 1, destinations: 1, platformResults: 1, status: 1, publishedAt: 1 } },
    ] } },
    { $unionWith: { coll: 'post_metrics', pipeline: importedPipeline(ws, filter) } },
  ];
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM');
    const start = new Date(`${month}-01T00:00:00Z`); const end = new Date(start); end.setUTCMonth(end.getUTCMonth()+1);
    pipeline.push({ $match: { publishedAt: { $gte: start, $lt: end } } });
  }
  return pipeline;
}
function normalizePost(doc, filter) {
  const destinations = (doc.destinations || []).filter(d => !filter || (d.platform === filter.platform && (!filter.accountId || d.accountId === filter.accountId)));
  const results = Object.fromEntries(destinations.map(d => {
    const key = destinationKey(d);
    return [key, doc.platformResults?.[key] || { success: ['completed','published'].includes(doc.status) }];
  }));
  const values = Object.values(results);
  const status = values.length ? values.every(r=>r.success) ? 'published' : values.some(r=>r.success) ? 'partial' : 'failed' : doc.status;
  return { _id: String(doc._id), type: doc.type, content: doc.content || '', destinations, platformResults: results, status, publishedAt: doc.publishedAt, ...(doc.permalink && { permalink: doc.permalink }), ...(doc.metrics && { metrics: doc.metrics }) };
}
function summaryAccumulator(now = Date.now()) {
  const data = { total: 0, imported: 0, published: 0, partial: 0, failed: 0, recentCount: 0 };
  const platforms = {}; const days = {}; let deliveries = 0; let succeeded = 0;
  return {
    add(post) {
      data.total++; if (post.type === 'imported') data.imported++; else if (post.status in data) data[post.status]++;
      const results = Object.entries(post.platformResults); const successes = results.filter(([,r])=>r.success);
      if (post.type !== 'imported') { deliveries += results.length; succeeded += successes.length; }
      const time = new Date(post.publishedAt).getTime();
      if (successes.length && time >= now - 7*86400000) data.recentCount++;
      if (successes.length && time >= now - 30*86400000) { const day = new Date(time).toISOString().slice(0,10); days[day] = (days[day] || 0)+1; }
      for (const [key] of successes) { const platform = key.split(':')[0]; platforms[platform] = (platforms[platform] || 0)+1; }
    },
    result() { return { ...data, deliveries, successRate: deliveries ? Math.round(100*succeeded/deliveries) : 0, byPlatform: platforms, byDay: Object.entries(days).sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>({date,count})) }; },
  };
}
function registerAnalytics(app, getDb) {
  app.get('/analytics/summary', async (request, reply) => {
    try {
      const filter = accountFilter(request.query.account); const db = await getDb(); const summary = summaryAccumulator();
      for await (const doc of db.collection('scheduled_jobs').aggregate(historyPipeline(request.workspaceId,filter))) summary.add(normalizePost(doc,filter));
      return summary.result();
    } catch (err) { if (err.message === 'Invalid account filter') return reply.code(400).send({ error: err.message }); throw err; }
  });
  app.get('/analytics/posts', async (request, reply) => {
    const limit = Number(request.query.limit || 20); const skip = Number(request.query.skip || 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(skip) || skip < 0) return reply.code(400).send({ error: 'Invalid pagination' });
    let filter; try { filter = accountFilter(request.query.account); } catch (err) { return reply.code(400).send({ error: err.message }); }
    const db = await getDb(); const pipeline = historyPipeline(request.workspaceId,filter);
    const [rows, counts] = await Promise.all([
      db.collection('scheduled_jobs').aggregate([...pipeline, { $sort: { publishedAt: -1, _id: -1, type: 1 } }, { $skip: skip }, { $limit: limit }]).toArray(),
      db.collection('scheduled_jobs').aggregate([...pipeline, { $count: 'total' }]).toArray(),
    ]);
    return { posts: rows.map(doc=>normalizePost(doc,filter)), total: counts[0]?.total || 0 };
  });
  app.get('/analytics/export', async (request, reply) => {
    let filter, pipeline; try { filter=accountFilter(request.query.account); pipeline=historyPipeline(request.workspaceId,filter,request.query.month); } catch (err) { return reply.code(400).send({ error: err.message }); }
    const db=await getDb();
    const escape=value=>`"${String(value).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')}"`;
    async function* csv() {
      yield 'Date,Time (UTC),Type,Platforms,Status,Content\r\n';
      for await (const raw of db.collection('scheduled_jobs').aggregate([...pipeline,{ $sort: { publishedAt: -1, _id: -1 } }])) {
      const post=normalizePost(raw,filter); const date=post.publishedAt?new Date(post.publishedAt).toISOString():'';
      yield [date.slice(0,10),date.slice(11,16),post.type,post.destinations.map(d=>d.platform).join(' | '),post.status,post.content].map(escape).join(',')+'\r\n';
      }
    }
    reply.header('Content-Type','text/csv; charset=utf-8');reply.header('Content-Disposition',`attachment; filename="posts-${request.query.month || 'all'}.csv"`);
    return reply.send(require('stream').Readable.from(csv()));
  });
}
module.exports = { accountFilter, destinationMatch, historyPipeline, normalizePost, summaryAccumulator, registerAnalytics };
