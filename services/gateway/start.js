require('dotenv').config();
const app = require('./server.js');
const { connect } = require('./utils/MongoDBConnector');

async function start() {
  await connect();
  await app.listen({ port: 8084, host: '0.0.0.0' });
  console.log('[Gateway] API service running on port 8084');
}

start().catch((err) => {
  console.error('[Gateway] Failed to start:', err);
  process.exit(1);
});
