const { createBackgroundJobs } = require('../jobs');
const fakeDb = require('./fakeDb');
function setup(db, handlers) {
  const queued = new Map();
  const queue = { add: jest.fn(async (type, data, opts) => { const job = { data, id: opts.jobId, getState: async () => 'waiting' }; queued.set(job.id, job); return job; }), getJob: async id => queued.get(id) };
  const jobs = createBackgroundJobs({ getDb: async () => db, queue, handlers });
  return { jobs, queue, queued };
}
test('jobs persist progress and results across manager restart and hide other workspaces', async () => {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'one' });
  const handler = jest.fn(async (job, ctx) => { await ctx.setProgress({ completed: 1, total: 1 }); await ctx.saveCheckpoint({ done: true }); return { value: job.payload.value }; });
  const first = setup(db, { brief: handler });
  const doc = await first.jobs.submit('one', 'brief', { value: 42 });
  const restarted = setup(db, { brief: handler });
  await restarted.jobs.recover();
  expect(restarted.queue.add).toHaveBeenCalledTimes(1);
  await restarted.jobs.process({ data: { id: doc._id } });
  const saved = await restarted.jobs.get(doc._id, 'one');
  expect(saved.status).toBe('done'); expect(saved.progress.completed).toBe(1); expect(saved.result.value).toBe(42);
  expect(await restarted.jobs.get(doc._id, 'two')).toBe(null);
  await restarted.jobs.process({ data: { id: doc._id } });
  expect(handler).toHaveBeenCalledTimes(1);
});
test('interrupted jobs resume their persisted checkpoint', async () => {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'one' });
  await db.collection('ai_jobs').insertOne({ _id: 'interrupted', workspaceId: 'one', type: 'calendar', status: 'running', payload: {}, progress: { completed: 1 }, checkpoint: { brief: 'already generated' } });
  const handler = jest.fn(async (_job, ctx) => { expect(ctx.checkpoint.brief).toBe('already generated'); return { resumed: true }; });
  const { jobs, queue } = setup(db, { calendar: handler });
  await jobs.recover(); expect(queue.add).toHaveBeenCalledTimes(1);
  await jobs.process({ data: { id: 'interrupted' } });
  expect((await jobs.get('interrupted','one')).result.resumed).toBe(true);
});
test('deleted or deleting workspaces never run a job', async () => {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'deleting', deleting: true });
  const handler = jest.fn(); const { jobs } = setup(db, { brief: handler });
  for (const ws of ['deleted','deleting']) { const doc = await jobs.submit(ws, 'brief', {}); await expect(jobs.process({ data: { id: doc._id } })).rejects.toThrow('Workspace'); }
  expect(handler).not.toHaveBeenCalled();
});
test('enqueue failure keeps a durable record for later recovery', async () => {
  const db = fakeDb(); const { jobs, queue } = setup(db, { brief: async () => ({}) });
  queue.add.mockRejectedValueOnce(new Error('redis unavailable'));
  await expect(jobs.submit('one', 'brief', {})).rejects.toThrow('recorded for recovery');
  expect(db.tables.get('ai_jobs')[0].status).toBe('queued');
  await jobs.recover(); expect(queue.add).toHaveBeenCalledTimes(2);
});

test('cancelled rendering cannot be overwritten by worker completion', async () => {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'one' });
  let jobs;
  const instance = setup(db, { render: async job => { await jobs.cancel(job._id, 'one'); return { published: false }; } });
  jobs = instance.jobs;
  const doc = await jobs.submit('one', 'render', {});
  expect(await jobs.cancel(doc._id, 'other')).toBe(false);
  await jobs.process({ data: { id: doc._id } });
  expect((await jobs.get(doc._id, 'one')).status).toBe('cancelled');
});
