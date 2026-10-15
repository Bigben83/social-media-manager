// Restore the editor attachment field on older MCP drafts without changing their text or retry fingerprint.
async function repairDraftMedia(db, publicOrigin, apply = false) {
  const rows = await db.collection('drafts').find({ source: 'mcp', mediaUrl: '' }).toArray();
  const result = { inspected: rows.length, eligible: 0, repaired: 0, skipped: 0 };
  for (const draft of rows) {
    const urls = [...new Set((draft.destinations || []).flatMap(d => [d.imageUrl, d.videoUrl]).filter(Boolean))];
    if (urls.length !== 1) { result.skipped++; continue; }
    let url;
    try { url = new URL(urls[0], publicOrigin); } catch { result.skipped++; continue; }
    const match = /^\/media\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
    if (url.origin !== publicOrigin || !match || !await db.collection('media_files').findOne({ filename: match[1], workspaceId: draft.workspaceId })) { result.skipped++; continue; }
    result.eligible++;
    if (apply) {
      // An edit made since inspection wins. Preserve ordering, content and MCP idempotency metadata.
      const changed = await db.collection('drafts').updateOne(
        { _id: draft._id, workspaceId: draft.workspaceId, mediaUrl: '', updatedAt: draft.updatedAt },
        { $set: { mediaUrl: url.href } }
      );
      result.repaired += changed.matchedCount;
    }
  }
  return result;
}

module.exports = { repairDraftMedia };
if (require.main === module) {
  require('dotenv').config();
  const { getDb } = require('./utils/MongoDBConnector');
  (async () => {
    const publicOrigin = new URL(process.env.MCP_PUBLIC_URL).origin;
    console.log(JSON.stringify(await repairDraftMedia(await getDb(), publicOrigin, process.argv.includes('--apply'))));
    process.exit(0);
  })().catch(err => { console.error('Draft media repair failed: ' + err.message); process.exit(1); });
}
