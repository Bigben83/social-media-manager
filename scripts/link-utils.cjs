const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname,'..');
const shared = path.join(root,'services','utils');
for (const name of ['connector','gateway','scheduler','feed-aggregator','socket','twitter','mastodon','bluesky','instagram','facebook','pinterest','tiktok']) {
  const link=path.join(root,'services',name,'utils');
  if (!fs.existsSync(link)) {
    try { fs.symlinkSync(shared,link,process.platform==='win32'?'junction':'dir'); }
    catch { fs.mkdirSync(link, { recursive: true }); }
  }
  // Network checkouts can contain physical copies instead of usable junctions.
  // Keep those copies current, including newly added shared modules.
  if (fs.realpathSync(link) !== fs.realpathSync(shared)) {
    for (const file of fs.readdirSync(shared, { withFileTypes: true })) {
      if (file.isFile()) fs.copyFileSync(path.join(shared, file.name), path.join(link, file.name));
    }
  }
}
