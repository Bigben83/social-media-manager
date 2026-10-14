require('dotenv').config();
const Fastify = require('fastify');
const { Server } = require('socket.io');
const { getDb } = require('./utils/MongoDBConnector');
const { createLogger } = require('./utils/logger');
function createService(dbProvider = getDb) {
  const app = Fastify({ loggerInstance: createLogger('socket') });
  const io = new Server(app.server);
  const validWorkspace = async id => typeof id === 'string' && !!await (await dbProvider()).collection('workspaces').findOne({ _id: id, deleting: { $ne: true } });
  io.use(async (socket, next) => {
    try {
      const workspaceId = socket.handshake.auth.workspaceId;
      if (!await validWorkspace(workspaceId)) return next(new Error('Workspace not found'));
      socket.data.workspaceId = workspaceId;
      next();
    } catch { next(new Error('Workspace unavailable')); }
  });
  io.on('connection', socket => socket.join(`workspace:${socket.data.workspaceId}`));
  app.get('/health', async () => ({ status: 'ok', service: 'socket' }));
  app.post('/events/feed', async (request, reply) => {
    const { workspaceId, platform, items, fetchedAt } = request.body || {};
    if (!await validWorkspace(workspaceId)) return reply.code(404).send({ error: 'Workspace not found' });
    if (typeof platform !== 'string' || !Array.isArray(items) || items.length > 100) return reply.code(400).send({ error: 'Invalid feed event' });
    const scopedItems = items.filter(item => item && item.workspaceId === workspaceId && item.platform === platform);
    io.to(`workspace:${workspaceId}`).emit('feed.items', { workspaceId, platform, items: scopedItems, fetchedAt });
    return { success: true, count: scopedItems.length };
  });
  app.addHook('onClose', async () => { await new Promise(resolve => io.close(resolve)); });
  return { app, io };
}
if (require.main === module) {
  const { app } = createService();
  app.listen({ port: 8084, host: '0.0.0.0' }).catch(err => { app.log.error(err); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
}
module.exports = { createService };
