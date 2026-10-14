const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const { createService } = require('../services/socket');
process.env.LOG_LEVEL = 'silent';
test('live feed broadcasts remain inside a workspace and reject cross-workspace items', async () => {
  const db = { collection: () => ({ findOne: async q => ['one', 'two'].includes(q._id) ? { _id: q._id } : null }) };
  const { app } = createService(async () => db);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const first = io(address, { auth: { workspaceId: 'one' }, transports: ['websocket'] });
  const second = io(address, { auth: { workspaceId: 'two' }, transports: ['websocket'] });
  try {
    await Promise.all([once(first, 'connect'), once(second, 'connect')]);
    let leaked = false;
    second.on('feed.items', () => { leaked = true; });
    const received = once(first, 'feed.items');
    const response = await app.inject({ method: 'POST', url: '/events/feed', payload: { workspaceId: 'one', platform: 'facebook', items: [ { workspaceId: 'one', platform: 'facebook', originalId: 'a' }, { workspaceId: 'two', platform: 'facebook', originalId: 'b' } ] } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual((await received)[0].items.map(x => x.originalId), ['a']);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(leaked, false);
    assert.equal((await app.inject({ method: 'POST', url: '/events/feed', payload: { workspaceId: 'missing', platform: 'facebook', items: [] } })).statusCode, 404);
  } finally { first.disconnect(); second.disconnect(); await app.close(); }
});
