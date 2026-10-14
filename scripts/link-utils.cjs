const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname,'..');
const shared = path.join(root,'services','utils');
for (const name of ['gateway','scheduler','feed-aggregator','socket','twitter','mastodon','bluesky','instagram','facebook','pinterest','tiktok']) {
  const link=path.join(root,'services',name,'utils');
  if (!fs.existsSync(link)) fs.symlinkSync(shared,link,process.platform==='win32'?'junction':'dir');
}
